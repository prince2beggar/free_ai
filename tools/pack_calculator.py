"""Offline SRS 9.4 planning calculator. No accounts, network or pack activation."""

from __future__ import annotations

import argparse
from datetime import date
from decimal import Decimal, InvalidOperation, localcontext
from fractions import Fraction
import json
from math import ceil, floor
from pathlib import Path
import re
import sys
from typing import NoReturn


ROOT = Path(__file__).resolve().parents[1]
MINOR_PER_BDT = 100
MICRO_CU_PER_BDT = 10000
TOKENS_PER_MILLION = 1000000


class InputError(ValueError):
    """Invalid or infeasible planning input."""


class BlockedInput(InputError):
    """Required evidence/value is unknown; never replace it with zero."""


def integer(value: object, field: str, minimum: int = 0) -> int:
    if value is None:
        raise BlockedInput(f"TODO-VERIFY: {field}")
    if type(value) is not int or value < minimum:
        raise InputError(f"{field} must be an integer at least {minimum}")
    return value


def number(value: object, field: str) -> Fraction:
    if value is None:
        raise BlockedInput(f"TODO-VERIFY: {field}")
    if (not isinstance(value, str) or len(value) > 128
            or re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", value) is None):
        raise InputError(f"{field} must be a finite decimal string")
    try:
        decimal = Decimal(value)
    except InvalidOperation:
        raise InputError(f"{field} must be a finite decimal string") from None
    if not decimal.is_finite() or decimal < 0:
        raise InputError(f"{field} must be finite and nonnegative")
    return Fraction(decimal)


def mapping(value: object, field: str) -> dict:
    if not isinstance(value, dict):
        raise InputError(f"{field} must be an object")
    return value


def decimal_text(value: Fraction) -> str:
    """All monetary products here have terminating decimal representations."""
    with localcontext() as context:
        context.prec = len(str(abs(value.numerator))) + len(str(value.denominator)) + 20
        text = format(Decimal(value.numerator) / Decimal(value.denominator), "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def blocked_result(blockers: list[str]) -> dict:
    return {
        "status": "blocked", "pack_sales_ready": False,
        "token_cap_display": None, "token_cap_input": None,
        "token_cap_output": None, "cost_cap_micro_cu": None,
        "blockers": list(dict.fromkeys(blockers)),
    }


def calculate_pack(config: dict) -> dict:
    """Compute a fully specified hypothetical case with exact rational math."""
    config = mapping(config, "config")
    if (type(config.get("schema_version")) is not int or config["schema_version"] != 1
            or config.get("mode") != "hypothetical"):
        raise InputError("Arithmetic requires schema_version 1 and mode hypothetical")
    if config.get("currency") != "BDT":
        raise InputError("Pack amounts must be BDT integer minor units")
    price_minor = integer(config.get("price_minor"), "price_minor", 1)
    hosting_minor = integer(config.get("hosting_share_minor"), "hosting_share_minor")
    quantum = integer(config.get("rounding_quantum"), "rounding_quantum", 1)
    useful = integer(config.get("minimum_useful_tokens"), "minimum_useful_tokens", 1)
    tool_micro = integer(config.get("tool_budget_micro_cu"), "tool_budget_micro_cu")
    buffer = number(config.get("buffer_pct"), "buffer_pct")
    input_share = number(config.get("input_share"), "input_share")
    output_share = number(config.get("output_share"), "output_share")
    safety = number(config.get("safety_factor"), "safety_factor")
    if not 0 <= buffer < 1:
        raise InputError("buffer_pct must be at least 0 and less than 1")
    if input_share > 1 or output_share > 1 or input_share + output_share != 1:
        raise InputError("Input and output shares must be in [0,1] and sum to 1")
    if not 0 < safety <= 1:
        raise InputError("safety_factor must be greater than 0 and at most 1")

    fee = mapping(config.get("fee"), "fee")
    fixed = integer(fee.get("fixed_minor"), "fee.fixed_minor")
    minimum = integer(fee.get("minimum_minor"), "fee.minimum_minor")
    percentage = number(fee.get("percentage_rate"), "fee.percentage_rate")
    if percentage > 1:
        raise InputError("fee.percentage_rate must be at most 1")
    if fee.get("rounding") is None:
        raise BlockedInput("TODO-VERIFY: fee.rounding")
    if fee["rounding"] != "ceil_minor":
        raise InputError("Only explicitly configured ceil_minor fee rounding is supported")
    fee_minor = ceil(max(Fraction(fixed) + percentage * price_minor, Fraction(minimum)))

    rows = config.get("model_rates")
    if not isinstance(rows, list) or not rows:
        raise BlockedInput("TODO-VERIFY: model_rates")
    normalized = []
    for row in rows:
        row = mapping(row, "model rate")
        identifier = row.get("id")
        if not isinstance(identifier, str) or not identifier or len(identifier) > 128:
            raise InputError("Each model rate requires an id of 1 to 128 characters")
        rate_in = number(row.get("input_bdt_per_1m"), "model input rate")
        rate_out = number(row.get("output_bdt_per_1m"), "model output rate")
        normalized.append({"id": identifier, "input_bdt_per_1m": decimal_text(rate_in),
                           "output_bdt_per_1m": decimal_text(rate_out)})
    # Independent maxima protect classes where different routes dominate each side.
    rate_in = max(number(row["input_bdt_per_1m"], "input rate") for row in normalized)
    rate_out = max(number(row["output_bdt_per_1m"], "output rate") for row in normalized)
    blended = input_share * rate_in + output_share * rate_out
    if blended <= 0:
        raise InputError("Blended cost must be positive; free quotas cannot create unlimited paid-pack tokens")
    price = Fraction(price_minor, MINOR_PER_BDT)
    buffer_bdt = price * buffer
    budget = price - Fraction(fee_minor + hosting_minor, MINOR_PER_BDT) - buffer_bdt
    if budget <= 0:
        raise InputError("AI budget must be positive after fees, hosting and selling-price buffer")
    cost_cap = floor(budget * MICRO_CU_PER_BDT)
    if tool_micro >= cost_cap:
        raise InputError("Tool budget leaves no funded token budget")
    raw = budget / blended * TOKENS_PER_MILLION * safety
    initial = floor(raw / quantum) * quantum

    def caps(total: int) -> tuple[int, int]:
        incoming = floor(total * input_share)
        return incoming, total - incoming

    def cost(total: int) -> Fraction:
        incoming, outgoing = caps(total)
        return ((incoming * rate_in + outgoing * rate_out) / TOKENS_PER_MILLION
                + Fraction(tool_micro, MICRO_CU_PER_BDT))

    # Both caps are monotone as total rises. Find the largest funded whole quantum;
    # this also covers rounding one extra token into an expensive output bucket.
    low, high = 0, initial // quantum
    while low < high:
        mid = (low + high + 1) // 2
        if ceil(cost(mid * quantum) * MICRO_CU_PER_BDT) <= cost_cap:
            low = mid
        else:
            high = mid - 1
    total = low * quantum
    if total <= 0:
        raise InputError("Rounding/cost checks leave no funded token quantum")
    incoming, outgoing = caps(total)
    actual_cost = cost(total)
    rounded_cost = ceil(actual_cost * MICRO_CU_PER_BDT)
    warnings = ["HYPOTHETICAL_ONLY", "PACK_ACTIVATION_REQUIRES_PHASE_6_CHECKS"]
    if total < useful:
        warnings.append("BELOW_MINIMUM_USEFUL_SIZE")
    return {
        "status": "hypothetical_result", "pack_sales_ready": False,
        "fee_minor": fee_minor, "buffer_bdt": decimal_text(buffer_bdt),
        "ai_budget_bdt": decimal_text(budget),
        "blended_bdt_per_1m": decimal_text(blended),
        "raw_token_fraction": {"numerator": str(raw.numerator), "denominator": str(raw.denominator)},
        "initial_token_cap_display": initial, "token_cap_display": total,
        "token_cap_input": incoming, "token_cap_output": outgoing,
        "cost_cap_micro_cu": cost_cap, "worst_case_cost_bdt": decimal_text(actual_cost),
        "worst_case_cost_micro_cu": rounded_cost,
        "caps_reduced_for_cost": total < initial, "warnings": warnings,
        "input_snapshot": {
            "classification": "HYPOTHETICAL", "currency": "BDT", "price_minor": price_minor,
            "hosting_share_minor": hosting_minor, "fee": {
                "fixed_minor": fixed, "minimum_minor": minimum,
                "percentage_rate": decimal_text(percentage), "rounding": "ceil_minor"},
            "buffer_pct": decimal_text(buffer), "input_share": decimal_text(input_share),
            "output_share": decimal_text(output_share), "safety_factor": decimal_text(safety),
            "rounding_quantum": quantum, "minimum_useful_tokens": useful,
            "tool_budget_micro_cu": tool_micro, "model_rates": normalized,
        },
    }


def audit_research(config: dict, research: dict) -> dict:
    """Read-only evidence audit; source mode never issues pack grants."""
    config = mapping(config, "config")
    research = mapping(research, "pricing_inputs")
    if (type(config.get("schema_version")) is not int or config["schema_version"] != 1
            or config.get("mode") != "sourced"):
        raise InputError("Research audit requires schema_version 1 and mode sourced")
    try:
        as_of = date.fromisoformat(config["as_of"])
    except (KeyError, TypeError, ValueError):
        raise InputError("Sourced audit requires an explicit ISO as_of date") from None
    blockers = []

    def record(collection: str, identifier: object) -> dict:
        rows = research.get(collection)
        if not isinstance(identifier, str) or not isinstance(rows, list):
            raise BlockedInput(f"TODO-VERIFY: selected {collection}")
        matches = [v for v in rows if isinstance(v, dict) and v.get("id") == identifier]
        if len(matches) != 1:
            raise InputError(f"Select one unique record in {collection}")
        return matches[0]

    def evidence(row: dict, label: str) -> None:
        sources = research.get("sources", {})
        ids = row.get("source_ids")
        if not isinstance(sources, dict) or not isinstance(ids, list) or not ids:
            blockers.append(f"{label} source/date evidence is missing")
            return
        for sid in ids:
            source = sources.get(sid, {})
            if not isinstance(source, dict) or not source.get("url") or not source.get("read_at"):
                blockers.append(f"{label} source/date evidence is missing")

    ids = config.get("model_price_ids")
    if not isinstance(ids, list) or not ids:
        raise BlockedInput("TODO-VERIFY: selected model prices")
    for identifier in ids:
        row = record("model_prices", identifier)
        evidence(row, "Model price")
        for boundary, comparison in [("effective_from", lambda d: as_of < d),
                                     ("effective_until", lambda d: as_of > d)]:
            value = row.get(boundary)
            if value is not None:
                try:
                    outside = comparison(date.fromisoformat(value))
                except (TypeError, ValueError):
                    raise InputError("Model price period date is invalid") from None
                if outside:
                    blockers.append("Selected model price period does not include as_of date")
        if row.get("eligible_for_feasibility") is not True:
            blockers.append("Selected model/provider eligibility and billing conditions are unverified")
        for field in ["input_per_1m", "output_per_1m"]:
            if row.get(field) is None:
                blockers.append("Selected model rate is TODO-VERIFY")
    fx = record("fx_rates", config.get("fx_rate_id"))
    evidence(fx, "FX")
    if fx.get("quote_units_per_base_unit") is None or fx.get("eligible_for_feasibility") is not True:
        blockers.append("Actual settlement FX and acquisition charges are TODO-VERIFY")
    gateway = record("payment_fee_schedules", config.get("payment_fee_schedule_id"))
    evidence(gateway, "Payment fee")
    if gateway.get("contract_confirmed") is not True or gateway.get("eligible_for_feasibility") is not True:
        blockers.append("Payment fee schedule/merchant contract is unverified")
    unknown_terms = gateway.get("unverified_terms")
    if isinstance(unknown_terms, dict) and any(v is None for k, v in unknown_terms.items() if k != "status"):
        blockers.append("Required fee, tax, refund or settlement terms are TODO-VERIFY")
    for row in research.get("unresolved_costs", []):
        if isinstance(row, dict) and row.get("value") is None:
            blockers.append("All-in provider/optional/tax cost evidence remains TODO-VERIFY")
    blockers.append("Sourced mode audits evidence only; funded pack generation, cost inclusion and reachability approval belong to Phase 6")
    result = blocked_result(blockers)
    result.update(mode="sourced_evidence_audit", as_of=as_of.isoformat(),
                  selected_model_price_ids=ids, selected_fx_rate_id=config.get("fx_rate_id"),
                  selected_payment_fee_schedule_id=config.get("payment_fee_schedule_id"))
    return result


def reject_json_number(_value: str) -> NoReturn:
    raise InputError("JSON decimal numbers must be strings; non-finite values are forbidden")


def unique_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise InputError("Duplicate JSON object keys are forbidden")
        result[key] = value
    return result


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"), parse_float=reject_json_number,
                           parse_constant=reject_json_number, object_pairs_hook=unique_object)
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise InputError("Cannot read a valid UTF-8 JSON input file") from None
    return mapping(value, "JSON input")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--examples", action="store_true", help="Run both hypothetical SRS 9.4 examples")
    mode.add_argument("--research", action="store_true", help="Audit pending sourced inputs; exit 3 means blocked")
    mode.add_argument("--config", type=Path, help="Read one hypothetical or sourced configuration")
    parser.add_argument("--pricing-inputs", type=Path, default=ROOT / "docs/pricing_inputs.json")
    args = parser.parse_args(argv)
    try:
        if args.examples or args.research:
            fixtures = load_json(ROOT / "docs/pack_calculator_inputs.json")
            if args.examples:
                result = {"status": "hypothetical_examples", "pack_sales_ready": False,
                          "results": [calculate_pack(v) for v in fixtures["examples"]]}
            else:
                result = audit_research(fixtures["sourced_pending_example"], load_json(args.pricing_inputs))
        else:
            config = load_json(args.config)
            result = (audit_research(config, load_json(args.pricing_inputs))
                      if config.get("mode") == "sourced" else calculate_pack(config))
        code = 3 if result["status"] == "blocked" else 0
    except BlockedInput as error:
        result, code = blocked_result([str(error)]), 3
    except InputError as error:
        result, code = {"status": "invalid", "pack_sales_ready": False, "error": str(error)}, 2
    except (KeyError, TypeError, ValueError):
        result, code = {"status": "invalid", "pack_sales_ready": False,
                        "error": "Input structure or value is invalid"}, 2
    print(json.dumps(result, indent=2, ensure_ascii=True))
    return code


if __name__ == "__main__":
    sys.exit(main())
