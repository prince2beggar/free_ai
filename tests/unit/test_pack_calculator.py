"""SRS 9.4 examples and financial-boundary behavior for the offline calculator."""

from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import unittest

from tools.pack_calculator import BlockedInput, InputError, calculate_pack, audit_research

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = json.loads((ROOT / "docs/pack_calculator_inputs.json").read_text(encoding="utf-8"))


class PackCalculatorTests(unittest.TestCase):
    def case(self):
        return deepcopy(FIXTURES["examples"][0])

    def small_case(self):
        case = self.case()
        case.update(price_minor=100, hosting_share_minor=0, buffer_pct="0",
                    safety_factor="1", rounding_quantum=1, minimum_useful_tokens=1)
        case["fee"].update(fixed_minor=0, percentage_rate="0", minimum_minor=0)
        return case

    def test_premium_srs_example(self):
        result = calculate_pack(self.case())
        self.assertEqual(result["buffer_bdt"], "5")
        self.assertEqual(result["ai_budget_bdt"], "40.5")
        self.assertEqual(result["blended_bdt_per_1m"], "480")
        self.assertEqual(result["token_cap_display"], 65000)
        self.assertEqual((result["token_cap_input"], result["token_cap_output"]), (55250, 9750))
        self.assertEqual(result["cost_cap_micro_cu"], 405000)
        self.assertEqual(result["worst_case_cost_micro_cu"], 312000)
        self.assertIn("BELOW_MINIMUM_USEFUL_SIZE", result["warnings"])
        self.assertFalse(result["pack_sales_ready"])

    def test_everyday_srs_example(self):
        result = calculate_pack(deepcopy(FIXTURES["examples"][1]))
        self.assertEqual(result["blended_bdt_per_1m"], "17.4")
        self.assertEqual(result["token_cap_display"], 1800000)
        self.assertEqual((result["token_cap_input"], result["token_cap_output"]), (1530000, 270000))
        self.assertEqual(result["worst_case_cost_micro_cu"], 313200)
        self.assertNotIn("BELOW_MINIMUM_USEFUL_SIZE", result["warnings"])

    def test_mixed_class_uses_separate_worst_input_and_output(self):
        case = self.case()
        case["model_rates"] = [
            {"id": "input-heavy", "input_bdt_per_1m": "300", "output_bdt_per_1m": "30"},
            {"id": "output-heavy", "input_bdt_per_1m": "12", "output_bdt_per_1m": "1500"},
        ]
        result = calculate_pack(case)
        self.assertEqual(result["token_cap_display"], 65000)
        self.assertEqual(result["worst_case_cost_micro_cu"], 312000)

    def test_tool_budget_reduces_caps_by_quantum(self):
        case = self.case()
        case["tool_budget_micro_cu"] = 100000
        result = calculate_pack(case)
        self.assertEqual(result["initial_token_cap_display"], 65000)
        self.assertEqual(result["token_cap_display"], 60000)
        self.assertEqual((result["token_cap_input"], result["token_cap_output"]), (51000, 9000))
        self.assertEqual(result["worst_case_cost_micro_cu"], 388000)
        self.assertTrue(result["caps_reduced_for_cost"])

    def test_split_rounding_cannot_exceed_funded_budget(self):
        case = self.small_case()
        case["price_minor"] = 95
        case["model_rates"] = [{"id": "rounding-edge", "input_bdt_per_1m": "0", "output_bdt_per_1m": "100000"}]
        result = calculate_pack(case)
        self.assertEqual(result["initial_token_cap_display"], 63)
        self.assertEqual(result["token_cap_display"], 60)
        self.assertEqual((result["token_cap_input"], result["token_cap_output"]), (51, 9))
        self.assertEqual(result["worst_case_cost_micro_cu"], 9000)
        self.assertEqual(result["cost_cap_micro_cu"], 9500)

    def test_positive_cost_rounds_up_once_after_summing_components(self):
        case = self.small_case()
        case["model_rates"] = [{"id": "micro-boundary", "input_bdt_per_1m": "0.333333", "output_bdt_per_1m": "0.333333"}]
        result = calculate_pack(case)
        self.assertEqual(result["token_cap_display"], 3000003)
        self.assertEqual(result["worst_case_cost_micro_cu"], 10000)
        self.assertEqual(result["worst_case_cost_bdt"], "0.999999999999")

    def test_percentage_fixed_and_minimum_fee_rounding(self):
        case = self.small_case()
        case["price_minor"] = 1001
        case["fee"].update(fixed_minor=13, percentage_rate="0.025", minimum_minor=0)
        result = calculate_pack(case)
        self.assertEqual(result["fee_minor"], 39)
        self.assertEqual(result["ai_budget_bdt"], "9.62")
        case["fee"]["minimum_minor"] = 40
        self.assertEqual(calculate_pack(case)["fee_minor"], 40)

    def test_cost_cap_rounds_down(self):
        case = self.small_case()
        case.update(price_minor=101, buffer_pct="0.00001")
        case["model_rates"] = [{"id": "floor-edge", "input_bdt_per_1m": "1", "output_bdt_per_1m": "1"}]
        result = calculate_pack(case)
        self.assertEqual(result["ai_budget_bdt"], "1.0099899")
        self.assertEqual(result["cost_cap_micro_cu"], 10099)
        self.assertLessEqual(result["worst_case_cost_micro_cu"], 10099)

    def test_invalid_inputs_are_rejected(self):
        for key, value in [("price_minor", 0), ("price_minor", True),
                           ("hosting_share_minor", -1), ("buffer_pct", "1"),
                           ("safety_factor", "0"), ("safety_factor", "1.01"),
                           ("safety_factor", 0.8), ("buffer_pct", "NaN"),
                           ("buffer_pct", "1e999999999"), ("buffer_pct", "0_1"),
                           ("schema_version", True),
                           ("rounding_quantum", 0), ("input_share", "0.9"),
                           ("tool_budget_micro_cu", -1)]:
            with self.subTest(key=key, value=value):
                case = self.case()
                case[key] = value
                with self.assertRaises(InputError):
                    calculate_pack(case)

    def test_nonpositive_budget_zero_rates_and_unfunded_tools_rejected(self):
        for mutation in ["budget", "rates", "tools", "quantum"]:
            with self.subTest(mutation=mutation):
                case = self.case()
                if mutation == "budget": case["hosting_share_minor"] = 5000
                if mutation == "rates":
                    case["model_rates"][0].update(input_bdt_per_1m="0", output_bdt_per_1m="0")
                if mutation == "tools": case["tool_budget_micro_cu"] = 405000
                if mutation == "quantum": case["rounding_quantum"] = 1000000000
                with self.assertRaises(InputError): calculate_pack(case)

    def test_unknown_costs_are_not_zero(self):
        for mutation in ["rate", "fee", "hosting"]:
            with self.subTest(mutation=mutation):
                case = self.case()
                if mutation == "rate": case["model_rates"][0]["output_bdt_per_1m"] = None
                if mutation == "fee": case["fee"]["fixed_minor"] = None
                if mutation == "hosting": case["hosting_share_minor"] = None
                with self.assertRaises(BlockedInput): calculate_pack(case)

    def test_research_unknowns_block_all_grants_without_mutation(self):
        research = json.loads((ROOT / "docs/pricing_inputs.json").read_text(encoding="utf-8"))
        original = deepcopy(research)
        result = audit_research(FIXTURES["sourced_pending_example"], research)
        self.assertEqual(result["status"], "blocked")
        self.assertIsNone(result["token_cap_display"])
        self.assertIsNone(result["cost_cap_micro_cu"])
        self.assertFalse(result["pack_sales_ready"])
        self.assertTrue(any("FX" in x for x in result["blockers"]))
        self.assertTrue(any("fee" in x.lower() for x in result["blockers"]))
        self.assertEqual(research, original)

    def test_future_and_expired_price_periods_are_blocked(self):
        research = json.loads((ROOT / "docs/pricing_inputs.json").read_text(encoding="utf-8"))
        for price_id, as_of in [("gemini-flash-paid-2027", "2026-12-31"),
                                ("gemini-flash-paid-2026", "2027-01-01")]:
            with self.subTest(price_id=price_id):
                case = deepcopy(FIXTURES["sourced_pending_example"])
                case.update(model_price_ids=[price_id], as_of=as_of)
                result = audit_research(case, research)
                self.assertTrue(any("price period" in x for x in result["blockers"]))
                self.assertIsNone(result["token_cap_display"])

    def test_cli_examples_and_research_exit_codes(self):
        for arg, code in [("--examples", 0), ("--research", 3)]:
            with self.subTest(arg=arg):
                proc = subprocess.run([sys.executable, str(ROOT / "tools/pack_calculator.py"), arg],
                                      cwd=ROOT / "docs", capture_output=True, text=True, check=False)
                self.assertEqual(proc.returncode, code, proc.stderr)
                result = json.loads(proc.stdout)
                self.assertFalse(result["pack_sales_ready"])
                if arg == "--examples":
                    self.assertEqual([v["token_cap_display"] for v in result["results"]], [65000, 1800000])
                else: self.assertIsNone(result["token_cap_display"])

    def test_json_reader_rejects_duplicate_keys_and_float_tokens(self):
        from tempfile import NamedTemporaryFile
        from tools.pack_calculator import load_json

        for content in ['{"price_minor":1,"price_minor":2}',
                        '{"buffer_pct":0.1}', '{"buffer_pct":NaN}']:
            with self.subTest(content=content):
                # A single temporary file is closed before Windows reopens it.
                with NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".json", delete=False) as stream:
                    stream.write(content)
                    path = Path(stream.name)
                try:
                    with self.assertRaises(InputError): load_json(path)
                finally:
                    path.unlink()

    def test_cli_custom_config_and_unknown_cost(self):
        from tempfile import NamedTemporaryFile

        for missing, expected_code in [(False, 0), (True, 3)]:
            with self.subTest(missing=missing):
                case = self.case()
                if missing: case["hosting_share_minor"] = None
                with NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".json", delete=False) as stream:
                    json.dump(case, stream)
                    path = Path(stream.name)
                try:
                    proc = subprocess.run([sys.executable, str(ROOT / "tools/pack_calculator.py"),
                                           "--config", str(path)], cwd=ROOT / "docs",
                                          capture_output=True, text=True, check=False)
                    self.assertEqual(proc.returncode, expected_code, proc.stderr)
                    result = json.loads(proc.stdout)
                    self.assertFalse(result["pack_sales_ready"])
                    self.assertEqual(result["token_cap_display"], None if missing else 65000)
                finally:
                    path.unlink()


if __name__ == "__main__":
    unittest.main()
