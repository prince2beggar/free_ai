"""Offline Phase 0 evaluation preparation. No providers, credentials or execution."""

import argparse
import ast
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "tests/eval"
MAX_FILE_BYTES = 1_048_576
MAX_RESPONSE_BYTES = 16_384
MAX_AST_NODES = 2_048


class EvaluationError(ValueError):
    """Sanitized validation error, without input excerpts."""


class _FixtureRun(dict):
    """In-memory fixture provenance; deserialized files never get this type."""


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise EvaluationError("Duplicate JSON field.")
        result[key] = value
    return result


def _constant(_value):
    raise EvaluationError("Non-finite JSON value.")


def _parse(text):
    return json.loads(text, object_pairs_hook=_pairs, parse_constant=_constant)


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def artifact_hash(value):
    """Hash canonical JSON content, independent of indentation/key order."""
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def load_json(path):
    try:
        with Path(path).open("rb") as stream:
            raw = stream.read(MAX_FILE_BYTES + 1)
        if len(raw) > MAX_FILE_BYTES:
            raise EvaluationError("JSON file exceeds the size limit.")
        result = _parse(raw.decode("utf-8"))
        _canonical(result).encode("utf-8")
        return result
    except EvaluationError:
        raise
    except (OSError, UnicodeError, ValueError, RecursionError):
        raise EvaluationError("Cannot read valid bounded UTF-8 JSON.") from None


def _keys(value, required, optional=()):
    if not isinstance(value, dict) or not set(required) <= set(value) or set(value) - set(required) - set(optional):
        raise EvaluationError("Missing or unexpected object fields.")


def _text(value, maximum=MAX_RESPONSE_BYTES, allow_empty=False):
    if not isinstance(value, str) or (not value and not allow_empty):
        raise EvaluationError("Invalid or oversized text field.")
    try:
        if len(value.encode("utf-8")) > maximum:
            raise EvaluationError("Invalid or oversized text field.")
    except UnicodeError:
        raise EvaluationError("Invalid Unicode text field.") from None


def _integer(value, minimum=0, maximum=None):
    if type(value) is not int or value < minimum or (maximum is not None and value > maximum):
        raise EvaluationError("Invalid integer field.")


def validate_suite(suite):
    _keys(suite, ("schema_version", "suite_id", "created_at", "data_provenance", "system_message", "cases"))
    if type(suite["schema_version"]) is not int or suite["schema_version"] != 1:
        raise EvaluationError("Unsupported suite schema.")
    if suite["data_provenance"] != "PROJECT_AUTHORED_SYNTHETIC":
        raise EvaluationError("Suite must contain project-authored synthetic data.")
    for key in ("suite_id", "created_at", "system_message"):
        _text(suite[key])
    if not isinstance(suite["cases"], list) or len(suite["cases"]) != 45:
        raise EvaluationError("Suite requires exactly 45 cases.")
    seen = set()
    counts = {"bn": 0, "en": 0, "coding": 0}
    for case in suite["cases"]:
        _keys(case, ("id", "group", "language", "category", "critical", "prompt", "automatic", "review_checks"))
        for key in ("id", "language", "category", "prompt"):
            _text(case[key])
        if case["id"] in seen or type(case["critical"]) is not bool:
            raise EvaluationError("Duplicate case ID or invalid critical flag.")
        seen.add(case["id"])
        if case["group"] == "chat" and case["language"] in ("bn", "en"):
            counts[case["language"]] += 1
        elif case["group"] == "coding" and case["language"] in ("python", "javascript", "typescript", "sql"):
            counts["coding"] += 1
        else:
            raise EvaluationError("Invalid case group/language.")
        check = case["automatic"]
        _keys(check, ("kind",), ("expected",))
        if check["kind"] not in ("json_exact", "text_exact", "nonempty", "python_syntax"):
            raise EvaluationError("Unknown automatic check kind.")
        if check["kind"] in ("json_exact", "text_exact"):
            if "expected" not in check:
                raise EvaluationError("Exact check requires expected data.")
            if check["kind"] == "text_exact":
                _text(check["expected"])
        elif "expected" in check:
            raise EvaluationError("Unexpected exact-check answer.")
        reviews = case["review_checks"]
        if not isinstance(reviews, list) or not reviews:
            raise EvaluationError("Every case requires a review rubric.")
        review_ids = set()
        for review in reviews:
            _keys(review, ("id", "description"))
            _text(review["id"], 80)
            _text(review["description"])
            if review["id"] in review_ids:
                raise EvaluationError("Duplicate review check.")
            review_ids.add(review["id"])
    if counts != {"bn": 15, "en": 15, "coding": 15}:
        raise EvaluationError("Suite must contain 15 Bangla, 15 English and 15 coding cases.")
    if not any(c["critical"] and c["group"] == "chat" for c in suite["cases"]) or not any(c["critical"] and c["group"] == "coding" for c in suite["cases"]):
        raise EvaluationError("Chat and coding critical cases are required.")


def validate_policy(policy):
    _keys(policy, ("schema_version", "policy_id", "status", "chat_min_percent", "bangla_min_percent",
                   "english_min_percent", "coding_min_percent", "critical_cases_must_all_pass",
                   "real_coding_requires_isolated_functional_evidence", "proposed_call_scope"))
    if type(policy["schema_version"]) is not int or policy["schema_version"] != 1:
        raise EvaluationError("Unsupported policy schema.")
    _text(policy["policy_id"], 160)
    if policy["status"] != "PROPOSED_NOT_APPROVED":
        raise EvaluationError("The offline helper accepts draft policies only; approval is an external owner record.")
    for key in ("chat_min_percent", "bangla_min_percent", "english_min_percent", "coding_min_percent"):
        _integer(policy[key], 1, 100)
    if policy["critical_cases_must_all_pass"] is not True or policy["real_coding_requires_isolated_functional_evidence"] is not True:
        raise EvaluationError("Critical/isolated-functional evidence requirements cannot be disabled.")
    scope = policy["proposed_call_scope"]
    _keys(scope, ("models_per_authorization", "max_calls", "retries", "fallbacks", "max_input_tokens_per_call",
                  "max_output_tokens_per_call", "max_total_input_tokens", "max_total_output_tokens",
                  "max_provider_spend_minor", "spend_currency", "permitted_data",
                  "provider_model_key_environment_expiry", "authorization_record"))
    for key in ("models_per_authorization", "max_calls", "retries", "fallbacks", "max_input_tokens_per_call",
                "max_output_tokens_per_call", "max_total_input_tokens", "max_total_output_tokens", "max_provider_spend_minor"):
        _integer(scope[key])
    _integer(scope["max_input_tokens_per_call"], 1)
    _integer(scope["max_output_tokens_per_call"], 1)
    if scope["models_per_authorization"] != 1 or scope["max_calls"] != 45 or scope["retries"] != 0 or scope["fallbacks"] != 0:
        raise EvaluationError("Offline proposal uses one model, 45 calls and no retries/fallbacks.")
    if scope["max_provider_spend_minor"] != 0 or scope["spend_currency"] != "BDT" or scope["permitted_data"] != "PROJECT_AUTHORED_SYNTHETIC_ONLY":
        raise EvaluationError("Offline proposal has no paid-provider authorization.")
    if scope["authorization_record"] is not None or scope["provider_model_key_environment_expiry"] is not None:
        raise EvaluationError("This offline harness cannot accept or grant live-call authorization.")
    if scope["max_total_input_tokens"] != scope["max_calls"] * scope["max_input_tokens_per_call"] or scope["max_total_output_tokens"] != scope["max_calls"] * scope["max_output_tokens_per_call"]:
        raise EvaluationError("Proposed total token bounds are inconsistent.")


def load_artifacts():
    suite = load_json(DATA / "suite.json")
    policy = load_json(DATA / "policy.json")
    fixtures = load_json(DATA / "fixtures.json")
    validate_suite(suite)
    validate_policy(policy)
    _keys(fixtures, ("schema_version", "provenance", "answers"))
    if type(fixtures["schema_version"]) is not int or fixtures["schema_version"] != 1 or fixtures["provenance"] != "PROJECT_AUTHORED_CANNED_STUB_NOT_MODEL_OUTPUT":
        raise EvaluationError("Invalid canned fixture provenance/schema.")
    if not isinstance(fixtures["answers"], dict) or set(fixtures["answers"]) != {c["id"] for c in suite["cases"]}:
        raise EvaluationError("Canned fixtures must cover exactly the suite IDs.")
    for answer in fixtures["answers"].values():
        _text(answer)
    return suite, policy, fixtures


def automatic_check(check, text):
    """Format/syntax only; ast.parse does not execute source or test behavior."""
    if not isinstance(text, str) or not text.strip() or len(text.encode("utf-8")) > MAX_RESPONSE_BYTES:
        return False
    try:
        kind = check["kind"]
        if kind == "json_exact":
            return _canonical(_parse(text)) == _canonical(check["expected"])
        if kind == "text_exact":
            return text.strip() == check["expected"]
        if kind == "nonempty":
            return True
        if kind == "python_syntax":
            tree = ast.parse(text.strip())
            return sum(1 for _ in ast.walk(tree)) <= MAX_AST_NODES
    except (ValueError, SyntaxError, TypeError, RecursionError):
        return False
    raise EvaluationError("Unknown automatic check.")


def make_stub_run(suite, policy, fixtures, profile="passing"):
    if profile not in ("passing", "failing", "partial"):
        raise EvaluationError("Unknown fixture profile.")
    responses = []
    for case in suite["cases"]:
        passing = profile != "failing"
        responses.append({"id": case["id"], "text": fixtures["answers"][case["id"]] if passing else "def broken(:",
                          "reviews": {r["id"]: passing for r in case["review_checks"]}})
    return _FixtureRun({"schema_version": 1, "kind": "STUB", "suite_sha256": artifact_hash(suite),
            "policy_sha256": artifact_hash(policy),
            "metadata": {"provider_id": "offline-fixture", "model_id": "CANNED_STUB", "model_version": "1",
                         "source_urls": [], "approval_record": None, "cost_minor": 0, "cost_currency": "BDT"},
            "responses": responses[:10] if profile == "partial" else responses})


def _validate_run(suite, policy, run):
    _keys(run, ("schema_version", "kind", "suite_sha256", "policy_sha256", "metadata", "responses"))
    if type(run["schema_version"]) is not int or run["schema_version"] != 1 or run["kind"] not in ("STUB", "IMPORTED_UNVERIFIED"):
        raise EvaluationError("Only labeled stub or unverified offline inputs are supported.")
    if run["kind"] == "STUB":
        canonical_metadata = {"provider_id": "offline-fixture", "model_id": "CANNED_STUB", "model_version": "1",
                              "source_urls": [], "approval_record": None, "cost_minor": 0, "cost_currency": "BDT"}
        if type(run) is not _FixtureRun or run["metadata"] != canonical_metadata:
            raise EvaluationError("Stub provenance must come from the in-memory canned fixture generator.")
    if run["suite_sha256"] != artifact_hash(suite) or run["policy_sha256"] != artifact_hash(policy):
        raise EvaluationError("Run suite/policy snapshot does not match current artifacts.")
    metadata = run["metadata"]
    _keys(metadata, ("provider_id", "model_id", "model_version", "source_urls", "approval_record", "cost_minor", "cost_currency"))
    for key in ("provider_id", "model_id", "model_version", "approval_record", "cost_currency"):
        if metadata[key] is not None:
            _text(metadata[key], 256)
    if metadata["cost_minor"] is not None:
        _integer(metadata["cost_minor"])
    if not isinstance(metadata["source_urls"], list) or len(metadata["source_urls"]) > 20:
        raise EvaluationError("Invalid provenance source list.")
    for source in metadata["source_urls"]:
        _text(source, 512)
        if not source.startswith("https://"):
            raise EvaluationError("Provenance sources must be HTTPS URLs; they are not fetched.")
    if not isinstance(run["responses"], list) or len(run["responses"]) > 45:
        raise EvaluationError("Invalid response list.")
    cases = {c["id"]: c for c in suite["cases"]}
    seen = set()
    for response in run["responses"]:
        _keys(response, ("id", "text", "reviews"))
        if not isinstance(response["id"], str) or response["id"] not in cases or response["id"] in seen:
            raise EvaluationError("Unknown or duplicate response ID.")
        seen.add(response["id"])
        # An empty model response is a grade failure, not missing evidence.
        _text(response["text"], allow_empty=True)
        reviews = response["reviews"]
        expected = {r["id"] for r in cases[response["id"]]["review_checks"]}
        if not isinstance(reviews, dict) or set(reviews) - expected:
            raise EvaluationError("Unknown review check.")
        if any(value is not None and type(value) is not bool for value in reviews.values()):
            raise EvaluationError("Reviews must be boolean or null; missing/null means unreviewed.")


def _counts(cases):
    total = len(cases)
    result = {"total": total, "passed": 0, "failed": 0, "missing": 0, "unreviewed": 0}
    for case in cases:
        result[{"PASS": "passed", "FAIL": "failed", "MISSING": "missing", "UNREVIEWED": "unreviewed"}[case["status"]]] += 1
    result["pass_fraction"] = str(result["passed"]) + "/" + str(total)
    return result


def assess_run(suite, policy, run):
    validate_suite(suite)
    validate_policy(policy)
    _validate_run(suite, policy, run)
    responses = {r["id"]: r for r in run["responses"]}
    results = []
    for case in suite["cases"]:
        response = responses.get(case["id"])
        automatic = None
        if response is None:
            status = "MISSING"
        else:
            automatic = automatic_check(case["automatic"], response["text"])
            values = [response["reviews"].get(r["id"]) for r in case["review_checks"]]
            status = "FAIL" if not automatic or False in values else "UNREVIEWED" if None in values else "PASS"
        item = {"id": case["id"], "group": case["group"], "language": case["language"],
                "critical": case["critical"], "status": status, "automatic_check_pass": automatic}
        if case["group"] == "coding":
            item["functional_test_status"] = "NOT_EXECUTED"
        results.append(item)
    groups = {key: _counts([c for c in results if c["group"] == key]) for key in ("chat", "coding")}
    groups.update({key: _counts([c for c in results if c["group"] == "chat" and c["language"] == key]) for key in ("bn", "en")})

    def meets(group, threshold):
        return groups[group]["passed"] * 100 >= groups[group]["total"] * threshold

    def critical_ok(group):
        return all(c["status"] == "PASS" for c in results if c["group"] == group and c["critical"])

    stub = run["kind"] == "STUB"
    return {"schema_version": 1, "report_kind": "OFFLINE_HARNESS_DIAGNOSTICS", "input_kind": run["kind"],
            "generated_at_utc": datetime.now(timezone.utc).isoformat(), "suite_sha256": artifact_hash(suite),
            "policy_sha256": artifact_hash(policy), "grader_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "threshold_status": policy["status"], "review_basis": "CANNED_FIXTURE_SIMULATION" if stub else "UNVERIFIED_IMPORTED_REVIEW_DECLARATIONS",
            "model_provenance": {"provider_id": "offline-fixture", "model_id": "CANNED_STUB", "model_version": "1", "source_urls": []} if stub else None,
            "observed_provider_cost_minor": 0 if stub else None, "cost_currency": "BDT" if stub else None,
            "provider_calls_made_by_harness": 0, "model_code_executed_by_harness": False,
            "diagnostics": groups,
            "diagnostic_thresholds": {"basis": "DIAGNOSTIC_ONLY_NOT_MODEL_QUALITY",
                "chat_pass": meets("chat", policy["chat_min_percent"]) and meets("bn", policy["bangla_min_percent"]) and meets("en", policy["english_min_percent"]) and critical_ok("chat"),
                "coding_pass": meets("coding", policy["coding_min_percent"]) and critical_ok("coding")},
            "cases": results, "real_quality_proven": False, "chat_quality_pass": None, "coding_quality_pass": None,
            "agent_ready": False, "phase0_go": False, "full_step_complete": False,
            "blocking_conditions": ["THRESHOLDS_AND_LIVE_SCOPE_REQUIRE_RECORDED_OWNER_APPROVAL",
                                    "NO_VERIFIED_ELIGIBLE_REAL_MODEL_RUN", "NO_ISOLATED_FUNCTIONAL_CODING_EVIDENCE",
                                    "OTHER_PHASE0_PROVIDER_CAPACITY_HOSTING_LEGAL_GATES_REMAIN_OPEN"]}


def export_prompts(suite, policy):
    validate_suite(suite)
    validate_policy(policy)
    return {"schema_version": 1, "kind": "OFFLINE_PROMPT_EXPORT_NOT_CALL_AUTHORIZATION",
            "suite_sha256": artifact_hash(suite), "policy_sha256": artifact_hash(policy),
            "cases": [{"id": c["id"], "group": c["group"], "language": c["language"],
                       "messages": [{"role": "system", "content": suite["system_message"]}, {"role": "user", "content": c["prompt"]}]}
                      for c in suite["cases"]]}


def _emit(value, output):
    encoded = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if output:
        with Path(output).open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(encoded)
        print(json.dumps({"written": True, "kind": value.get("report_kind", value.get("kind", "validation"))}))
    else:
        print(encoded, end="")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("validate")
    stub = commands.add_parser("stub")
    stub.add_argument("--profile", choices=("passing", "failing", "partial"), default="passing")
    stub.add_argument("--output", type=Path)
    export = commands.add_parser("export")
    export.add_argument("--output", type=Path)
    score = commands.add_parser("score")
    score.add_argument("--input", type=Path, required=True)
    score.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    try:
        suite, policy, fixtures = load_artifacts()
        if args.command == "validate":
            result = {"result": "PASS", "cases": 45, "chat": 30, "coding": 15, "threshold_status": policy["status"],
                      "suite_sha256": artifact_hash(suite), "policy_sha256": artifact_hash(policy), "provider_calls": 0}
            _emit(result, None)
            return 0
        if args.command == "export":
            _emit(export_prompts(suite, policy), args.output)
            return 0
        if args.command == "stub":
            run = make_stub_run(suite, policy, fixtures, args.profile)
        else:
            run = load_json(args.input)
            if not isinstance(run, dict) or run.get("kind") not in ("STUB", "IMPORTED_UNVERIFIED"):
                raise EvaluationError("Invalid offline input kind.")
            # A file's own provenance/approval declaration is untrusted data.
            run["kind"] = "IMPORTED_UNVERIFIED"
        result = assess_run(suite, policy, run)
        _emit(result, args.output)
        if run["kind"] == "IMPORTED_UNVERIFIED" or any(c["status"] in ("MISSING", "UNREVIEWED") for c in result["cases"]):
            return 3
        return 0 if all(result["diagnostic_thresholds"][key] for key in ("chat_pass", "coding_pass")) else 1
    except (EvaluationError, OSError, UnicodeError, ValueError, RecursionError):
        print("ERROR: invalid input, unavailable output, or existing output; no input excerpts disclosed.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
