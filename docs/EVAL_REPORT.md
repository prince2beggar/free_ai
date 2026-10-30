# Phase 0 Evaluation — Step 0.8

Prepared/updated: **2026-10-13**, Asia/Dhaka. Status: **offline preparation complete; thresholds APPROVED; full Step 0.8 NEEDS OWNER for concrete scope and real evidence**. Requirements: [SRS Step 0.8 / Section 17.1 / P4](../srs/SRS_v2.1_AI_Workspace.md); preparation/approval records: EVAL-001 and EVAL-APPROVAL-001 in [DECISIONS.md](DECISIONS.md).

**No real model was evaluated.** The saved results are explicitly labeled canned-stub harness diagnostics. Real Bangla/English/coding quality, latency, token usage and provider cost remain unverified. All four provider candidates stay disabled and their model scores remain unchanged. The offline helper cannot enable providers, assert `agent_ready`, authorize calls or establish Phase 0 GO.

## Evaluation artifacts

| Artifact | Purpose |
|---|---|
| [suite.json](../tests/eval/suite.json) | 30 language prompts: 15 Bangla and 15 English; 15 coding tasks; per-case pass/fail review checks and critical flags |
| [policy.json](../tests/eval/policy.json) | Frozen draft snapshot whose thresholds are externally approved in EVAL-APPROVAL-001; runnable target/account/key/environment/expiry still unresolved |
| [fixtures.json](../tests/eval/fixtures.json) | Project-authored canned answers used only to exercise the harness; not model outputs or human-reviewed real responses |
| [evaluate_models.py](../tools/evaluate_models.py) | Standard-library-only offline validator, prompt exporter, fixture runner and unverified-input assessor |
| [test_eval_harness.py](../tests/unit/test_eval_harness.py) | 27 behavior/CLI tests, including provenance, critical/per-language failures, input bounds and no candidate-code execution |
| [eval_harness_results.json](eval_harness_results.json) | Saved passing-fixture diagnostics; model is `CANNED_STUB`, not a hosted provider/model |

All prompts and fixtures are original synthetic project data; no customer conversations, files, credentials or production accounts are used. The suite is a small pilot evaluation, not a statistically representative benchmark or proof of broad product safety. Keep prompts, grading policy and model identity fixed for comparisons; changing them requires a new snapshot and pre-run threshold disposition.

Canonical JSON content SHA-256 values, independent of indentation/key order:

- Suite: `adb7cad85a871c2e8119637b30006dbe02adf48e249155402464f74c79b88695`.
- Policy: `25d95a14a45802bb76a3223dedfd16b950cf069fab1872a56a808bc71ec904be`.
- Fixtures: `1e0126d77557229c863c890bf84fcb93acca4aa053ba236945bc3995dcfd01d4`.
- Grader file-byte SHA-256: `4b325d7b6f56959a84c4cbb44a82131ebe8e3c79aeb61cb8ecdbfb5e81703810`.

## Approved quality thresholds — EVAL-APPROVAL-001

The owner approved these project-specific criteria on 2026-10-13 in EVAL-APPROVAL-001, referencing the frozen snapshots above. This is approval of thresholds, not real quality results. The offline helper's draft policy and pre-approval canned output remain unchanged; the binding owner decision is recorded separately. No imported file can approve itself, and threshold changes cannot retroactively qualify an earlier real run.

| Gate | Approved pass criterion |
|---|---|
| Chat overall | At least **26/30** cases (>=85%) |
| Bangla subset | At least **13/15** (>=85%) |
| English subset | At least **13/15** (>=85%) |
| Critical chat cases | All **BN07–BN09 and EN07–EN09** pass; a high average cannot hide a critical failure |
| Coding | At least **12/15** (>=80%), with isolated functional evidence for evaluated code |
| Critical coding cases | All **CODE03, CODE08, CODE09, CODE12, CODE14, CODE15** pass |

Each case passes only if its automatic check and every required review check pass. A missing/null review is UNREVIEWED; missing responses remain in the full denominator. Required factual/meaning/instruction/fluency reviews must be recorded by a reviewer able to assess the target language. Do not accept a model's self-grading, silently exclude failures, or retry/cherry-pick an answer to meet the bar. Transport/refusal/truncation failures and incomplete reviews must be reported explicitly; incomplete evidence cannot pass the real gate.

The canned stub programmatically simulates rubric results to test the grader. It does not provide independent human language judgments. Syntax/format success is insufficient for real coding correctness: record actual expected-input/output/boundary checks in an approved isolated runner, with tool/runtime/version, observed results, timeout/resource/network limits and review evidence. This helper never runs generated code. No suitable isolated runtime has been selected or approved under D5; functional code evidence remains pending. Chat can be evaluated independently of the agent branch, as SRS Section 17.1 specifies, once its real-run authorization is supplied.

## Coverage and grading limits

| Cases | Coverage | Automatic check / required review |
|---|---|---|
| BN01–BN15 / EN01–EN15 | Fact extraction, summaries, translation, writing, structured output, CSV arithmetic, missing facts, quoted injection, private-resource boundaries, exact format, ordering, corrected context, localized numbers, clarification and conflicting sources | Exact JSON/text where specified; otherwise nonempty content followed by case-specific factual, language and instruction review |
| CODE01–CODE07 | Normalization, integer bounds, tenant-scoped SQL, stable deduplication, a deliberately limited CSV contract, chunks and mutable-default repair | Source syntax/format plus behavioral/boundary review; isolated functional checks not executed |
| CODE08–CODE15 | Ownership checks, integer minor units, exhaustive TypeScript variants, zero denominator, portable path confinement, atomic queue claim, bounded attempts and unknown usage | Source syntax/format plus case-specific security/correctness review; isolated execution/compiler/DB checks not executed |

Coding mix: **9 Python, 3 JavaScript, 1 TypeScript and 2 SQL**. Python uses bounded AST parsing only, with no execution; the other six cases receive only a nonempty automatic check, followed by the explicit review rubric. No JavaScript runtime, TypeScript compiler, database or sandbox is installed by this step. The suite's own prompt examples and review checks define expected behaviors and negative cases; syntax alone cannot validate them.

## Executed harness evidence

| Run | Chat diagnostics | Coding diagnostics | Meaning |
|---|---|---|---|
| Passing canned fixture | 30 PASS / 30 | 15 PASS / 15 | Expected fixtures/declared simulated reviews exercise the success path; **real quality remains null** |
| Deliberately failing canned fixture | 0 PASS, 30 FAIL | 0 PASS, 15 FAIL | Failure detection works; CLI exit 1 |
| Partial canned fixture | 10 PASS, 20 MISSING | 0 PASS, 15 MISSING | Missing results use the full denominator; CLI exit 3 |

Passing fixture output contains `real_quality_proven=false`, `chat_quality_pass=null`, `coding_quality_pass=null`, `agent_ready=false`, `phase0_go=false`, `full_step_complete=false`, and zero provider calls made by the harness. Observed provider cost for the local stub is **BDT 0**, because no provider is called; this is not a price estimate for a real model. Imported metadata/costs are unverified and are not promoted to observed cost or model provenance.

Executed checks:

- New tests first failed because the grader did not exist; the implementation then passed its behavior checks. An independent review found two provenance gaps, reproduced them, and verified their fixes: saved inputs cannot claim canned provenance, and draft policies cannot self-declare approval.
- `python -B -m unittest discover -s tests/unit -p 'test_*.py' -v` -> **43 tests, OK**: 27 evaluation tests plus the 16 existing calculator tests.
- Passing/failing/partial profiles exercised with expected exits 0/1/3; saved the passing summary using the command below.
- Python source syntax and `.eval-local` Git-ignore behavior checked locally. No application linter/typechecker is configured; TypeScript application checks are N/A to this offline Python tool. Standard-library source/input checks and unit tests cover the implemented behavior.
- Working-tree secret scan and final artifact/link/hash/status checks are recorded in PROGRESS.md after completion. Earlier provider/pricing/capacity/dependency/calculator/tool/specification artifacts remain preserved; no credentials were read or used.

## Repeatable local commands

From the repository root:

```powershell
python -B tools/evaluate_models.py validate
python -B tools/evaluate_models.py stub --profile passing
python -B tools/evaluate_models.py stub --profile failing
python -B tools/evaluate_models.py stub --profile partial
python -B -m unittest discover -s tests/unit -p 'test_*.py' -v
```

To create a new summary file, add `--output <new-path>` to `stub`; existing files are never overwritten. The recorded summary was created as `docs/eval_harness_results.json`. Do not pass that summary to `score`: summaries do not contain response bodies/review declarations.

`export` outputs only case IDs/group/language/messages, with no fixture answers or grading keys. `score --input <saved-run.json>` reads offline responses and supplied review declarations only; every saved input is classified **IMPORTED_UNVERIFIED**, even if its own `kind` claims STUB. It cannot validate call authorization, actual provider identity/usage/cost or real quality. Put future captures/review files in ignored `.eval-local`, with approved access/retention; do not commit real outputs or private metadata. The committed summary contains no raw answers, private response text or review notes.

Saved input schema: version 1; declared `kind` STUB or IMPORTED_UNVERIFIED; matching canonical suite/policy hashes; metadata keys `provider_id`, `model_id`, `model_version`, `source_urls`, `approval_record`, `cost_minor`, `cost_currency`; responses containing `id`, `text`, `reviews` keyed by suite review-check IDs with boolean/null values. These are declarations, not grants. HTTPS source URLs are not fetched. Unknown/duplicate fields, non-finite data, invalid Unicode and oversized files/responses are rejected without input excerpts. Files are limited to 1 MiB, each response to 16 KiB and Python AST to 2,048 nodes. No executable provider transport or environment/key reader exists in this helper.

Exit codes: **0** complete successful offline operation/fixture diagnostic; **1** diagnostic failure; **2** invalid input/output (including overwrite refusal); **3** incomplete/unreviewed or imported-unverified evidence. Exit 0 never means a real quality gate passed.

## Real-model results — NOT RUN

| Candidate | Exact evaluated model/version and source | Bangla / English / coding scores | Real usage, latency and cost | State |
|---|---|---|---|---|
| Google Gemini Developer API | TODO-VERIFY; no evaluated model | null / null / null | Not measured | Disabled; terms/account/test scope unresolved |
| GroqCloud | TODO-VERIFY; no evaluated model | null / null / null | Not measured | Disabled; terms/account/test scope unresolved |
| OpenRouter | TODO-VERIFY; no evaluated endpoint/model | null / null / null | Not measured | Disabled; downstream terms/account/test scope unresolved |
| Cloudflare Workers AI | TODO-VERIFY; no evaluated account/model | null / null / null | Not measured | Disabled; model/account/test scope unresolved |

Source/evidence references: [provider matrix](PROVIDER_TERMS_MATRIX.md), [provider research](provider_research.json), [pricing inputs](pricing_inputs.json), [capacity](CAPACITY.md), [dependency review](DEPENDENCY_REVIEW.md), [open questions](OPEN_QUESTIONS.md). Public prices, model capability claims and fixtures do not establish measured quality. An actual authorized run must capture exact provider/model/version/endpoint sources, dated scope/expiry, environment, request records, input/output and billed reasoning usage, outcome/latency, observed all-in costs or explicit unknowns, reviewer evidence and approved threshold/suite snapshots. Private raw capture stays outside committed reports.

## Recorded approval and remaining next steps

1. **DONE: numerical thresholds approved** in EVAL-APPROVAL-001 for the frozen suite/rubric/policy. Do not request that approval again.
2. The owner's supplied test bounds are recorded: one identified model, at most **45 total calls**, no retries/fallbacks, at most **4,000 input/1,024 output tokens per call**, **BDT 0 provider spend**, synthetic data only. Aggregate 180,000/46,080 token bounds follow from these limits. **Stop and report immediately on any cost signal, 4xx/5xx error or quota warning; other calls require a new approval.** The supplied template still has placeholders for provider/model, eligibility/account limits/read dates, key variable name, local/staging environment, free-only evidence and expiry. Fill only those missing fields; no target/key/expiry may be inferred. Verify actual tokenization, shared limits and free-only/no-overage enforcement before dispatch. Hosting D3 cannot fund inference.
3. Add/verify only the approved provider adapter and perform the authorized real run; no adapter is implemented or API shape guessed here. Record actual failures and reviewer evidence. For real coding correctness, use an approved isolated runner rather than the application host; runtime/entitlement/funding approval is separate.
4. When account setup resumes, complete/update this report with real evidence and reassess [the Step 0.9 gate report](PHASE0_GATE_REPORT.md), now prepared with a NO-GO recommendation pending evidence for the current scope. Step 0.8 stays NEEDS OWNER and real quality remains unknown. Stub results cannot justify GO; even a real quality pass would not close the other core gates.

The remaining exact-target/reference/validity requirement comes from SRS P4's pre-real-call checkpoint. Threshold approval and specified test bounds are recorded; the incomplete target/account/key/environment/free-only/expiry fields still prevent dispatch. No real quality, execution-runtime approval or Phase 0 acceptance is inferred from the template.

## Account readiness — owner confirmed none

On 2026-10-13, the owner confirmed **no provider account is ready**. The remaining task is account setup, followed by concrete scope/evidence; another copy of the placeholder template cannot identify an account. Existing threshold and cap approvals persist.

The owner subsequently deferred account setup until later and asked to proceed. GATE-REVIEW-001 records that deferral; [PHASE0_GATE_REPORT.md](PHASE0_GATE_REPORT.md) completes the next documentation process. LOCAL-PROTOTYPE-001 then approves only the restricted local Step 1.1 synthetic web preview; it authorizes no real evaluation. Real evaluation is not skipped or marked DONE. Resume the setup instructions below when the owner is ready; no further account input is requested now.

An optional starting route is **Groq Free for the private synthetic evaluation**, subject to account/test-use eligibility. This is a setup recommendation, not final provider/model selection or a production serving approval. Official sources below were read **2026-10-13**:

1. Open the [Groq quickstart](https://console.groq.com/docs/quickstart) and follow its [API key page](https://console.groq.com/keys) to register/sign in and create a key personally. Keep the account on **Free**; do not upgrade to Developer or add a payment method for this zero-spend scope. [Billing FAQs](https://console.groq.com/docs/billing-faqs) describe the paid upgrade/payment-method requirement. Verify actual account tier/billing state before any calls; no provider account was created by the agent.
2. Store the key locally through approved secret storage/environment configuration; the official quickstart uses **GROQ_API_KEY**. Share only the variable name, never its value. Existing `.env` files are ignored; no key file or value is created/read here.
3. Choose an exact model actually available to the account's Free tier using the [current model list](https://console.groq.com/docs/models) and [account/rate-limit guidance](https://console.groq.com/docs/rate-limits). Supply observed account RPM/TPM/daily request/token limits and check date. Public example tables are not account evidence. [Deprecations](https://console.groq.com/docs/deprecations) say `llama-3.1-8b-instant` and `llama-3.3-70b-versatile` were removed from Free/Developer on August 16, 2026; do not run the legacy Llama example still present in quickstart for a new Free test.
4. Supply the actual provider/model, dated terms/test-use and Free/no-overage evidence, chosen local/staging environment, key variable name and exact Asia/Dhaka expiry. Your 45-call/zero-spend/token caps and immediate stop rules are already recorded. [Spend-limit documentation](https://console.groq.com/docs/spend-limits) says the paid spend-limit feature is not available on Free; do not upgrade to obtain it. The actual Free/no-cost boundary still needs verification, not an invented zero-value paid setting.

The Groq community Free-charge FAQ returned a redirect to the general company site when opened; its search excerpt is not treated as verified account/billing evidence. No model/API example was executed, no SDK installed and no key requested in chat. Existing Groq terms/privacy/downstream-model conditions in PROVIDER_TERMS_MATRIX.md and EVAL-SCOPE remain unresolved until the concrete test scope is reviewed.
