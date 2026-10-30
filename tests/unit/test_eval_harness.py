"""Behavior checks for the offline grader; never execute candidate code."""

import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("eval_harness", ROOT / "tools/evaluate_models.py")
grader = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(grader)


class EvaluationHarnessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.suite, cls.policy, cls.fixtures = grader.load_artifacts()

    def run_data(self, profile="passing"):
        return grader.make_stub_run(self.suite, self.policy, self.fixtures, profile)

    def test_exact_suite_counts_and_language_balance(self):
        cases = self.suite["cases"]
        self.assertEqual(len(cases), 45)
        self.assertEqual(sum(c["group"] == "chat" for c in cases), 30)
        for language in ("bn", "en"):
            self.assertEqual(sum(c["group"] == "chat" and c["language"] == language for c in cases), 15)
        self.assertEqual(sum(c["group"] == "coding" for c in cases), 15)

    def test_duplicate_case_is_rejected(self):
        suite = copy.deepcopy(self.suite)
        suite["cases"][-1]["id"] = suite["cases"][0]["id"]
        with self.assertRaises(grader.EvaluationError):
            grader.validate_suite(suite)

    def test_missing_case_is_rejected(self):
        suite = copy.deepcopy(self.suite)
        suite["cases"].pop()
        with self.assertRaises(grader.EvaluationError):
            grader.validate_suite(suite)

    def test_policy_rejects_boolean_and_out_of_range_thresholds(self):
        for value in (True, -1, 101):
            policy = copy.deepcopy(self.policy)
            policy["chat_min_percent"] = value
            with self.assertRaises(grader.EvaluationError):
                grader.validate_policy(policy)

    def test_fixture_passing_results_are_not_real_quality(self):
        summary = grader.assess_run(self.suite, self.policy, self.run_data())
        self.assertEqual(summary["diagnostics"]["chat"]["passed"], 30)
        self.assertEqual(summary["diagnostics"]["coding"]["passed"], 15)
        self.assertTrue(summary["diagnostic_thresholds"]["chat_pass"])
        self.assertTrue(summary["diagnostic_thresholds"]["coding_pass"])
        self.assertFalse(summary["real_quality_proven"])
        self.assertIsNone(summary["chat_quality_pass"])
        self.assertIsNone(summary["coding_quality_pass"])
        self.assertFalse(summary["agent_ready"])
        self.assertFalse(summary["phase0_go"])
        self.assertEqual(summary["provider_calls_made_by_harness"], 0)

    def test_fixture_failure_is_detected(self):
        summary = grader.assess_run(self.suite, self.policy, self.run_data("failing"))
        self.assertEqual(summary["diagnostics"]["chat"]["failed"], 30)
        self.assertFalse(summary["diagnostic_thresholds"]["chat_pass"])
        self.assertFalse(summary["diagnostic_thresholds"]["coding_pass"])

    def test_missing_responses_use_full_suite_denominator(self):
        run = self.run_data()
        run["responses"] = run["responses"][:1]
        summary = grader.assess_run(self.suite, self.policy, run)
        self.assertEqual(summary["diagnostics"]["chat"]["total"], 30)
        self.assertEqual(summary["diagnostics"]["chat"]["missing"], 29)
        self.assertFalse(summary["diagnostic_thresholds"]["chat_pass"])

    def test_missing_reviews_are_unreviewed(self):
        run = self.run_data()
        run["responses"][0]["reviews"] = {}
        summary = grader.assess_run(self.suite, self.policy, run)
        self.assertEqual(summary["cases"][0]["status"], "UNREVIEWED")

    def test_critical_failure_cannot_be_hidden_by_high_average(self):
        run = self.run_data()
        case = next(c for c in self.suite["cases"] if c["group"] == "chat" and c["critical"])
        response = next(r for r in run["responses"] if r["id"] == case["id"])
        response["reviews"][case["review_checks"][0]["id"]] = False
        summary = grader.assess_run(self.suite, self.policy, run)
        self.assertEqual(summary["diagnostics"]["chat"]["passed"], 29)
        self.assertFalse(summary["diagnostic_thresholds"]["chat_pass"])

    def test_per_language_floor_is_enforced(self):
        run = self.run_data()
        cases = [c for c in self.suite["cases"] if c["language"] == "bn" and not c["critical"]][:3]
        for case in cases:
            response = next(r for r in run["responses"] if r["id"] == case["id"])
            response["reviews"][case["review_checks"][0]["id"]] = False
        summary = grader.assess_run(self.suite, self.policy, run)
        self.assertEqual(summary["diagnostics"]["chat"]["passed"], 27)
        self.assertFalse(summary["diagnostic_thresholds"]["chat_pass"])

    def test_unverified_import_does_not_become_verified_model_evidence(self):
        run = self.run_data()
        run["kind"] = "IMPORTED_UNVERIFIED"
        run["metadata"]["provider_id"] = "claimed-provider"
        run["metadata"]["model_id"] = "claimed-model"
        run["metadata"]["approval_record"] = "claimed-owner-approval"
        summary = grader.assess_run(self.suite, self.policy, run)
        self.assertFalse(summary["real_quality_proven"])
        self.assertIsNone(summary["observed_provider_cost_minor"])
        self.assertFalse(summary["phase0_go"])

    def test_stub_metadata_cannot_be_relabelled_as_a_real_provider(self):
        run = self.run_data()
        run["metadata"]["provider_id"] = "claimed-provider"
        run["metadata"]["cost_minor"] = 7
        with self.assertRaises(grader.EvaluationError):
            grader.assess_run(self.suite, self.policy, run)

    def test_policy_cannot_self_declare_owner_approval(self):
        policy = copy.deepcopy(self.policy)
        policy["status"] = "APPROVED_BY_RECORDED_OWNER_DECISION"
        with self.assertRaises(grader.EvaluationError):
            grader.validate_policy(policy)

    def test_cli_saved_stub_claim_is_always_imported_unverified(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = self.run_data()
            run["metadata"]["provider_id"] = "claimed-provider"
            run["metadata"]["model_id"] = "claimed-model"
            run["metadata"]["cost_minor"] = 7
            path = Path(tmp) / "claimed-stub.json"
            path.write_text(json.dumps(run), encoding="utf-8")
            result = subprocess.run([sys.executable, "-B", str(ROOT / "tools/evaluate_models.py"),
                                     "score", "--input", str(path)], capture_output=True, text=True,
                                    encoding="utf-8", timeout=15)
            self.assertEqual(result.returncode, 3, result.stderr)
            summary = json.loads(result.stdout)
            self.assertEqual(summary["input_kind"], "IMPORTED_UNVERIFIED")
            self.assertIsNone(summary["model_provenance"])
            self.assertIsNone(summary["observed_provider_cost_minor"])
            self.assertFalse(summary["real_quality_proven"])

    def test_stale_suite_and_policy_hashes_are_rejected(self):
        for key in ("suite_sha256", "policy_sha256"):
            run = self.run_data()
            run[key] = "0" * 64
            with self.assertRaises(grader.EvaluationError):
                grader.assess_run(self.suite, self.policy, run)

    def test_unknown_and_duplicate_response_ids_are_rejected(self):
        for duplicate in (False, True):
            run = self.run_data()
            if duplicate:
                run["responses"].append(copy.deepcopy(run["responses"][0]))
            else:
                run["responses"][0]["id"] = "UNKNOWN"
            with self.assertRaises(grader.EvaluationError):
                grader.assess_run(self.suite, self.policy, run)

    def test_boolean_review_is_not_integer_one(self):
        run = self.run_data()
        response = run["responses"][0]
        response["reviews"][next(iter(response["reviews"]))] = 1
        with self.assertRaises(grader.EvaluationError):
            grader.assess_run(self.suite, self.policy, run)

    def test_unknown_review_check_is_rejected(self):
        run = self.run_data()
        run["responses"][0]["reviews"]["unknown"] = True
        with self.assertRaises(grader.EvaluationError):
            grader.assess_run(self.suite, self.policy, run)

    def test_exact_json_check_distinguishes_bool_from_number(self):
        check = {"kind": "json_exact", "expected": {"ok": True}}
        self.assertTrue(grader.automatic_check(check, '{"ok":true}'))
        self.assertFalse(grader.automatic_check(check, '{"ok":1}'))

    def test_python_syntax_check_never_executes_candidate_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker = Path(tmp) / "should-not-exist"
            code = "from pathlib import Path\nPath(" + repr(str(marker)) + ").write_text('executed')\n"
            self.assertTrue(grader.automatic_check({"kind": "python_syntax"}, code))
            self.assertFalse(marker.exists())
        self.assertFalse(grader.automatic_check({"kind": "python_syntax"}, "def broken(:"))

    def test_json_loader_rejects_duplicate_keys_nan_and_invalid_utf8(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "input.json"
            for raw in (b'{"x":1,"x":2}', b'{"x":NaN}', b'{"x":1e99999}', b'"\\ud800"', b'\xff'):
                path.write_bytes(raw)
                with self.assertRaises(grader.EvaluationError):
                    grader.load_json(path)

    def test_response_size_limit_is_enforced(self):
        run = self.run_data()
        run["responses"][0]["text"] = "x" * (grader.MAX_RESPONSE_BYTES + 1)
        with self.assertRaises(grader.EvaluationError):
            grader.assess_run(self.suite, self.policy, run)

    def test_unknown_secret_field_is_rejected_without_echoing_value(self):
        run = self.run_data()
        run["api_key"] = "private-value-do-not-echo"
        with self.assertRaises(grader.EvaluationError) as caught:
            grader.assess_run(self.suite, self.policy, run)
        self.assertNotIn("private-value-do-not-echo", str(caught.exception))

    def test_export_excludes_grading_answers_and_fixture_data(self):
        exported = grader.export_prompts(self.suite, self.policy)
        self.assertEqual(len(exported["cases"]), 45)
        for case in exported["cases"]:
            self.assertEqual(set(case), {"id", "group", "language", "messages"})

    def test_report_does_not_include_response_text_or_reviews(self):
        summary = grader.assess_run(self.suite, self.policy, self.run_data())
        for case in summary["cases"]:
            self.assertNotIn("text", case)
            self.assertNotIn("reviews", case)
            if case["group"] == "coding":
                self.assertEqual(case["functional_test_status"], "NOT_EXECUTED")

    def test_cli_validation_and_failure_profiles(self):
        command = [sys.executable, "-B", str(ROOT / "tools/evaluate_models.py")]
        for args, status in ((["validate"], 0), (["stub", "--profile", "passing"], 0),
                             (["stub", "--profile", "failing"], 1), (["stub", "--profile", "partial"], 3)):
            result = subprocess.run(command + args, capture_output=True, text=True, encoding="utf-8", timeout=15)
            self.assertEqual(result.returncode, status, result.stderr)
            obj = json.loads(result.stdout)
            if args[0] == "stub":
                self.assertFalse(obj["real_quality_proven"])

    def test_cli_output_refuses_to_overwrite_existing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "existing.json"
            output.write_text("keep", encoding="utf-8")
            result = subprocess.run([sys.executable, "-B", str(ROOT / "tools/evaluate_models.py"),
                                     "stub", "--output", str(output)], capture_output=True, text=True,
                                    encoding="utf-8", timeout=15)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(output.read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main()
