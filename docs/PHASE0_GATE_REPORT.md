# Phase 0 Gate Report — Step 0.9

Prepared/updated: **2026-10-13**, Asia/Dhaka. **Technical report complete; owner CHANGE-SHAPE initially approved Step 1.1 and subsequently extended the complete local 1-series in LOCAL-PHASE1-001 / SRS 17.1.2.** Local implementation is complete; [PHASE1_REPORT.md](PHASE1_REPORT.md) records its evidence. The owner has deferred account setup. Step 0.8, hosted-product Phase 0 and original hosted Phase 1 acceptance remain open; no hosted GO or Phase 2 acceptance is inferred.

**Recommendation for the existing hosted-product scope: NO-GO pending required evidence.** This means the current hosted gate cannot pass, not that the product has been proved permanently infeasible. The owner approved the bounded local prototype alternative below; the canonical SRS now records that exception. Its mock results cannot clear the hosted-product gates.

Authority: [SRS Section 17.1, P2/P4 and Steps 0.8–1.1](../srs/SRS_v2.1_AI_Workspace.md). Evidence and prior approvals: [DECISIONS.md](DECISIONS.md), [PROGRESS.md](../PROGRESS.md), [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md). `GO_CHAT_ONLY` still requires every core condition; missing real chat evidence cannot be treated as a coding-only failure.

## Acceptance and evidence scope

This documentation-only step checks all five Section 17.1 conditions, links evidence and unresolved question IDs, distinguishes a recommendation from an owner decision, supplies the next work order, and preserves approved inputs and frozen artifacts. Applicable verification is document/record/link/hash validation plus the local secret scan. Application lint/types/tests are N/A because no implementation changes.

Existing public-source observations were recorded on October 12–13, 2026 in the linked research reports. This step reads those repository artifacts; it does not revalidate vendor terms, prices, releases or account dashboards. Refresh the applicable official sources before adoption, calls or funding. **TODO-VERIFY is never a passing gate.**

Recorded inputs: **100 daily active free users**, **BDT 1,500/month maximum hosting budget**, and **five requests/user/day ASSUMED**. These inputs remain unchanged. Region D10 and audience D-AGE remain unresolved. No account/key is ready; the owner now plans to set it up later.

## Section 17.1 gate assessment

| Condition | Required evidence | Current finding | Gate status and source |
|---|---|---|---|
| 1 — Public multi-user providers (core) | At least two providers confirmed in writing from applicable current terms to permit the intended serving on the selected tiers | Four research candidates; **zero confirmed eligible**. Every candidate is disabled/HOLD with owner approval and actual quotas unconfirmed. This is an evidence count, not a finding that every vendor forbids the product | **BLOCKED — TODO-VERIFY.** [Provider matrix](PROVIDER_TERMS_MATRIX.md), [research flags](provider_research.json); D4, D10, D-AGE, TERMS and provider-specific FIT questions |
| 2 — Target capacity and real chat quality (core) | Eligible account/pool capacity supports 100 users; at least one eligible real model passes approved Bangla/English thresholds | Conditional low/medium/high bounds are **120 / 35 / 16** users at five requests each. Medium/high miss the target; even low remains unverified without eligible quotas and measured traffic. **No real model evaluated; chat scores unknown** | **BLOCKED — TODO-VERIFY.** [Capacity](CAPACITY.md), [evaluation report](EVAL_REPORT.md); CAP-QUOTAS, CAP-TRAFFIC, CAP-TARGET-GAP, EVAL-SCOPE, EVAL-REVIEWS |
| 3 — Real coding/agent quality (agent branch) | An eligible model passes language/coding thresholds approved before the run; all critical cases and isolated functional coding checks pass | Thresholds approved in EVAL-APPROVAL-001; synthetic harness prepared. Coding scores and functional evidence **unknown**, not an observed model failure. `agent_ready=false` | **NOT MET — TODO-VERIFY; agent branch unavailable.** [Evaluation report](EVAL_REPORT.md), [canned diagnostics](eval_harness_results.json); EVAL-FUNCTIONAL. Passing this alone would not fix the core blockers |
| 4 — Affordable bounded hosting (core) | Eligible available plan, all-in monthly cost within BDT 1,500, and enforceable bounds on variable spending | HOST-001 reference totals **BDT 1,190.36 / 1,398.44 / 1,502.47** are conditional; the last exceeds the ceiling. No verified available all-in quote or enforceable overage limit is established | **BLOCKED — TODO-VERIFY.** HOST-001 in [decisions](DECISIONS.md); CAP-HOSTING, HOST-QUOTE, HOST-SPEND, HOST-OPERATIONS and CAP-FX-FRESHNESS |
| 5 — Legal and dependencies (core) | Applicable legal/license review and selected dependency dispositions have no unresolved blocking findings | Public candidate review is complete, but project legal/audience/region decisions and selected-artifact/graph review are pending. Gateway/framework/auth adoption holds remain; no installed application graph exists | **BLOCKED — TODO-VERIFY.** [Dependency review](DEPENDENCY_REVIEW.md), DEP-001/STACK-001/GATEWAY-001 in [decisions](DECISIONS.md); LEGAL, DEP-ARTIFACTS, DEP-LICENSE, DEP-COMPAT, DEP-RUNTIME |

**Core conditions 1, 2, 4 and 5 are not established. Neither GO nor GO_CHAT_ONLY is supported.** Condition 3 cannot authorize the agent branch. Missing evidence is kept separate from demonstrated negative results.

## What is complete and what carries forward

- Steps **0.1–0.7**: completed technical bootstrap/research/planning artifacts. Their completion does not grant provider, host, dependency or payment adoption.
- Step **0.8**: offline 45-case suite/harness complete; **full step NEEDS OWNER**. The prior recorded 43 unit/CLI tests validate local tools, not a real model. Account setup is deferred at the owner's request; the step is not skipped or marked DONE.
- Step **0.9**: technical report complete; initial LOCAL-PROTOTYPE-001 later extended by LOCAL-PHASE1-001 for all local 1-series implementation. Phase 0's hosted-product work remains incomplete.

EVAL-APPROVAL-001 preserves approved thresholds: chat **26/30 overall and 13/15 per language**, coding **12/15**, every critical case passes, and real coding needs isolated functional evidence. Preserve the recorded caps: one exact target, at most **45 calls**, **4,000 input / 1,024 output tokens per call**, **no retries/fallbacks**, **BDT 0 provider spend**, synthetic data only; stop/report on any cost signal, 4xx/5xx error or quota warning. Exact target/account/key reference/environment/free-only evidence/expiry remain missing. Do not ask again for the approved thresholds and numerical limits.

Frozen policy/diagnostic JSON predates the approval and retains its draft threshold label. The external decision supplies the actual threshold approval; these snapshots are not rewritten to claim a later run. Similarly, old pricing JSON may list D2/D3 as historical unresolved questions; CAPACITY-001 resolves those inputs. All actual pricing/financial feasibility flags remain false.

Payment activation and optional execution stay deferred. Merchant setup costs, gateway contracts, paid-provider settlement and pack sales belong to their dependent financial/Phase 6 gates; they are not automatically prerequisites to a chat-only prototype. Optional Phase 5b remains DEFERRED, not SKIPPED. None of these deferrals clears core hosting, legal, provider or chat-quality conditions.

## Work order for the existing product scope

| Order | Work | Completion evidence |
|---|---|---|
| 1 | Resolve D10/audience and intended-use/provider-model eligibility; keep candidates inactive until scoped approval | Dated applicability/terms/model evidence for at least two eligible public-serving providers; owner/advisor disposition of applicable restrictions |
| 2 — owner deferred | Set up an eligible test account; supply the missing concrete EVAL-SCOPE fields and verify Free/no-overage settings | Exact target, account limits/date, key reference only, local/staging, free-only evidence and Asia/Dhaka expiry within the existing approved bounds; no secret values committed |
| 3 | Perform authorized real chat evaluation and independent language review; add coding/isolated functional evidence if pursuing agent mode | Versioned real provenance, full denominators/critical cases, usage/cost, approved thresholds and isolated evidence; no promotion of canned/imported declarations |
| 4 | Recompute eligible capacity and confirm a bounded all-in hosting proposal | Shared pools counted once, actual limits/traffic and 100-user fit; eligible available host quote within BDT 1,500 plus verified spending bounds |
| 5 | Resolve material selected-stack/legal findings before adoption | Applicable reviewed artifacts/licenses/security dispositions; later lockfile/SBOM and implementation checks are collected at their owning steps |
| 6 | Refresh this gate report and obtain the owner's recorded outcome | GO or GO_CHAT_ONLY only when the core evidence passes; approved CHANGE-SHAPE needs an explicit revised scope. Start Step 1.1 only under the matching recorded preconditions |

Independent source/dependency/hosting research can continue while account setup is deferred. The entire local series is completed within LOCAL-PHASE1-001; paid/API/account changes and hosted-product acceptance remain outside its evidence.

## Initial approved CHANGE-SHAPE — historical Step 1.1 scope

The following records the original grant, completed before LOCAL-PHASE1-001. Its Step 1.1 implementation stop was superseded by the owner's request to complete the remaining local 1-series; it is not the current work limit. SRS 17.1.2 and PHASE1_REPORT define the current local scope/results. Original live-provider/hosted gates remain unchanged.

**APPROVED in LOCAL-PROTOTYPE-001; restricted Step 1.1 now DONE.** The local preview's actual start/build/types/lint/formatter/tests, browser checks, independent review, dependency/secret/artifact checks are recorded in [PROGRESS.md](../PROGRESS.md). The owner selected this concrete build before setting up a provider account:

1. **DONE:** amend the canonical SRS with the bounded **Step 1.1 local prototype** exception and append LOCAL-PROTOTYPE-001 before coding. Preserve the hosted product's unmet gates and the 100-user/BDT 1,500 planning inputs.
2. Scaffold the local web application, environment validation and relevant checks; add a basic Bangla/English chat preview using **clearly labeled canned synthetic responses**. Bind any preview server to loopback. Select development artifacts only after applicable dependency/provenance/security review; existing adoption holds are not waived.
3. Use synthetic demo data only. No provider keys, model/account calls, external sign-in, production database/customer storage, real uploads, payments, generated-code execution, deployment or public exposure. Public package/document retrieval for reviewed development dependencies is separate from provider traffic and needs no provider credentials.
4. Verify local start/build and applicable behavior/security checks. Demo results prove prototype behavior only; they never establish real AI quality, provider capacity or Phase 0 hosted-product GO.
5. Stop after the approved prototype scope. Before real provider integration or a hosted MVP, resume Step 0.8 and satisfy the matching core/approval gates. Later hosted-product phases remain unopened.

The owner subsequently replied **"Approve local prototype (Recommended)"** to the explicit scope/amendment/Step 1.1 question. LOCAL-PROTOTYPE-001 and canonical SRS Section 17.1.1 record the exception. It applies only to the listed prototype; all hosted-product and later-step gates remain in force.

## Verification and decision checkpoint

Executed evidence is recorded in [PROGRESS.md](../PROGRESS.md): five-condition coverage, evidence/question references, Markdown links/UTF-8/fences, all 64 milestone records, five-line HANDOFF, append-only decision history, protected-artifact hashes, unchanged disabled/quality/financial flags and local secret scanning. No new code tests are needed for this documentation-only change; prior tests are cited as historical evidence, not rerun results.

**Current owner decision: CHANGE-SHAPE — local Steps 1.1–1.10 authorized and technically complete.** No repeated permission question is needed for this local work or its recommended defaults. Original real-account/Google/provider/hosting/legal evidence and staging acceptance remain required; Phase 0 hosted scope and full Step 0.8 are incomplete. Use PHASE1_REPORT's ordered next steps before closing hosted Phase 1 or starting Phase 2.
