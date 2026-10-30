# Local Phase 2 — registry, usage ledger, Governor, Router, Abuse, Control Center and next steps

Updated: 2026-10-15, Asia/Dhaka. **Phase 2: DONE for local synthetic scope; Steps 2.1–2.10: DONE locally. STOP: owner accepts admin/router behavior before Phase 3.** LOCAL-PHASE2-001 and [SRS 17.1.4](../srs/SRS_v2.1_AI_Workspace.md) authorized local synthetic work while actual integrations remain deferred. Original real Google/provider/hosted Phase 1 acceptance remains open.

## Step 2.1 contract and result

Size: high risk (new module, migration, staff authorization). Goal: persist editable, versioned provider/model metadata with enforced eligibility gates, sourced disabled imports and append-only rollback evidence. The [registry service](../packages/registry/index.mjs), [configuration](../packages/registry/defaults.json), [CLI](../tools/phase2/registry.mjs) and [tests](../tests/unit/phase2-registry.mjs) implement this contract using existing reviewed PGlite/Node dependencies.

| Acceptance criterion / SRS mapping | Implemented evidence |
|---|---|
| REG-01: terms, dated review, multi-user/privacy and owner/quota gates | Each missing gate blocks activation transactionally. External providers remain disabled even with claimed flags; the existing DB constraint also refuses activation. |
| REG-02: provider/model create/edit, capabilities, context, exact CU rates, agent/Bangla metadata, free flag | Trusted staff service supports create/update/list/history. Unknown actual context/rates/quality stay null/unverified; enabled synthetic fixtures require verified fixture metadata. Decimal rate strings are preserved without floating-point rounding. |
| Versioned changes and rollback | Base row, metadata, immutable history and minimal audit commit together. Expected revisions reject stale edits; actor-scoped idempotency rejects changed payloads and accepts reordered fields. Rollback appends a new revision and rechecks current parent eligibility. |
| REG-03/05 and security/privacy | Only environment-variable references can occupy secretRef; key values are never loaded. No key pooling/rotation, network transport, staff HTTP routes or private customer content. DB role/status is checked on reads and changes; staff audit records role/target and history identifies actor/time. |
| Source import and bounded storage | Frozen source hashes are checked by CLI; four candidates/eight grouped model records stay disabled. Source observations have field allowlists, bounded arrays/scalars and a 32 KiB record cap; SQL has a 64 KiB JSON backstop. Row caps and reserved Phase 1 terminal audit capacity remain enforced. Reseed preserves edits/history. |
| Migration compatibility | Default migration target remains 1. Phase 2 explicitly opts into 3; additive migrations 002/003 are tested up/down/reapply. Migration001 and the already-applied002 were preserved. Phase 1 regression checks pass. |

The four imported providers have ownerApproved=false, allowsMultiuser=false and quotaConfirmed=false. Conditional privacy evidence remains unknown; Gemini's sourced may_train flag is retained. Actual account limits, verified model context, operational rates and real evaluation scores are not inferred from public prices. Metadata stores exact decimal CU rates **per 1,000 billable input/output tokens**, matching SRS6.2; public USD-per-million observations remain separate and supply no verified FX/rate. Legacy BIGINT columns retain placeholders and must not supply Phase 2 accounting. Step2.2 now implements exact rational multiplication, total-cost rounding and the10,000-micro-CU scale for synthetic accounting. Disabled unknown-context rows have a legacy integer placeholder; the registry's null/verification fields govern future routing.

The synthetic CLI reviewer is a newly inserted local fixture, never a promotion of an existing user. Actor IDs are trusted service inputs, not browser authentication. Staff web/API use waits for Step 2.6's separate identity, roles and MFA. Earlier local development seed audit entries remain immutable; the corrected insert records staff roles for new events. No production or customer data belongs in this local fixture database.

## Run and check

From `D:\free_ai`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-registry
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-check
```

The first command creates/reopens ignored `.phase2-local/registry-database`, explicitly migrates and idempotently imports the reviewed research. Do not run concurrent launchers against this directory. It does not load `.env` or make provider calls. Use the trusted service methods for local fixture edits with unique idempotency keys and expected revisions; there is no admin web interface yet. Migration down is for explicitly authorized disposable test data only; dropping migration002 removes registry metadata/history and does not remove legacy provider/model rows. Do not downgrade a persistent database as an application rollback. Use versioned service rollback for configuration changes.

Observed twice after final migration: **LOCAL_PHASE2_REGISTRY_READY; four disabled providers, eight research models, 12 versions; realProvidersEnabled=0, credentialsRead=false, modelCallsMade=0.** Reopen/reseed preserved the same version count.

## Verification and review

- `-Task phase2-check`: types/lint/formatter PASS; **13 registry tests passed, 0 failed**. Meaningful option-injection, field-order, audit-attribution and source-size regressions were observed failing before correction and passing afterward.
- `-Task phase1-check`: types/lint/formatter/build PASS; **5 prototype +45 Phase 1 +2 security tests passed**. Final additive migration003 was followed by a repeated **10/10 Phase 1 DB checks**, included in the existing45 and not additional tests.
- Independent review closed source-size and audit-attribution findings; final reviewer ran **4 focused checks** and verified direct SQL rejects oversized before/after history JSON. No remaining material findings in the scoped review.
- No package was added; lockfile/graph unchanged. CI now includes Phase 2 checks but remote CI is **NOT RUN**. Prior Python/browser evidence remains in [PHASE1_REPORT](PHASE1_REPORT.md); those unchanged surfaces were not rerun for this registry-only step.

Final record/hash/ignore/PowerShell/secret-scan results are recorded in [PROGRESS](../PROGRESS.md). Live provider/account/quality/capacity, actual alerts, hosted/admin acceptance and release/legal checks remain unverified. No complete Phase 2 acceptance is claimed.

## First, second, and next

1. **Done: Steps 2.1–2.10 all completely implemented and verified locally.**
2. **Phase 2 verification evidence:** 203 unit tests in `tests/unit/phase2*.mjs` PASS, 9 browser integration tests in `tests/integration/phase2*.mjs` PASS.
3. **STOP:** owner accepts admin/router behavior; additional providers need approval before traffic. Phase 3 (Files, Productivity, First Public Release) is next.
4. **Later:** resume [real Google/provider setup](PHASE1_INTEGRATION_GUIDE.md), eligible model evaluation and original integration/release evidence, then verify the owner-supplied host/domain. Deferred checks remain open throughout local Phase 2.

## Step 2.2 contract and evidence

High risk: accounting, ownership, and migration. [SRS 6.2](../srs/SRS_v2.1_AI_Workspace.md) remains canonical. [Ledger service](../packages/ledger/index.mjs), [exact arithmetic](../packages/ledger/arithmetic.mjs), [local configuration](../packages/ledger/defaults.json), [migration004](../packages/db/migrations/004_ledger.up.sql), and [state/DB tests](../tests/unit/phase2-ledger.mjs) implement the LEDGER-LOCAL-001 scope with existing reviewed dependencies.

| Acceptance / requirement | Executed local evidence |
|---|---|
| Signed settlement and rounding | Grant100CU/reserve20CU/release20CU/commit12CU gives88CU available and12CU spend. Exact rational input/output/tool total is rounded up once at10,000 micro-CU/CU; token-grant helper rounds down. JSON carries decimal integer strings. Values above JS safe-integer precision survive DB reservations/history. |
| QUOTA-01/03, T2.4 | Transactional global storage guard plus entitlement/reservation locks, actor-scoped journal keys, semantic payload hashes, unique row keys, and one linked correction. Concurrent admissions accept five of twelve20CU holds against100CU; duplicate concurrent settlements leave40CU available and60CU spend. Changed-key payload replay fails. |
| QUOTA-01/04, T2.8 | Predispatch cancellation releases; dispatched unknown usage retains its bound. Deadline sweep commits the conservative full bound and appends one durable local operations alert. Authoritative synthetic correction is linked once; original estimated row remains true. Views distinguish unknown pending, estimated, and resolved usage. |
| Parent-task conservation |40CU task hold gives60CU available;12CU call consumes hold without another debit, leaves28CU outstanding, and completion restores88CU. Approval/review waits retain funds and time out; termination releases only unallocated funds. Active-parent late corrections restore its hold; terminal tasks cannot start calls. |
| QUOTA-05, ownership, zero-cost routing | Real service integration and API tests isolate A/B free/pack balances/history. UI shows input/output tokens, time, estimates/pending status, and safe refusal text at desktop/360px. Zero CU is not a blanket refusal of verified zero-cost routes; positive-cost dispatch still requires its full funded bound. |
| Durable, bounded evidence / NFR-05 | Immutable ledger/journal/alerts, rate/FX fixture snapshots, row/JSON caps, and reserved closure/correction capacity. Disposable migration up/down/reapply preserves earlier data. File reopen and a separate process exiting immediately after acknowledged writes both retain committed rows, journal, and hold state. Hosted power-loss/backup durability remains unverified. |

Dispatch markers and reported usage are synthetic fixtures; the service has no provider transport. Snapshots use exact verified registry CU rates and a labeled `synthetic-no-fx` value, never a fabricated actual settlement FX. Paid pack sales, real refunds/payment policy, provider capacity, real model usage, and agent runtime remain at their owning steps. **Full chat/router ledger coupling is Step2.4**; this preview shows the saved synthetic accounting example alongside separately metered canned chat. Staff mutation HTTP routes still wait for Step2.6 MFA. Local alert records do not establish Step2.8 delivery.

Run from `D:\free_ai`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-ledger
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-check
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-coverage
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-browser
```

`phase2-ledger` creates/reopens ignored `.phase2-local/ledger-database`, explicitly opts into migrations1–4, and replays one synthetic signed example without new rows. `phase2` builds and serves **http://127.0.0.1:4177**; select Demo Alpha for its saved allowance, or Demo Beta for the empty owned view. The verified hidden preview is currently running there; do not start a second launcher while it is active. The exclusive launcher lock refuses concurrent opens and failed acquisition cannot remove another process's lock. Foreground launchers stop with Ctrl+C. After an abnormal exit, inspect the recorded process/port before removing a stale lock; never downgrade/delete a persistent ledger to roll back an operation. Original Phase1 preview/data remain separate.

Final checks: **46/46 Phase2 tests** (20 state/DB,8 arithmetic,5 usage API,13 registry), **52/52 regression tests** (5 prototype,45 Phase1,2 security), and **2/2 browser tests** (existing Phase1 and new ledger desktop/mobile). Types/lint/formatter/build pass. Ledger-only coverage reuses33 tests: **98.68% lines,86.91% branches,100% functions**; arithmetic100% in all three dimensions. These are100 unique executed tests, not133. Unchanged Python/original prototype-browser evidence was not rerun.

Independent **source review** completed after reviewer tool availability hit a usage limit: exact source was supplied without implementation reasoning. Two findings—unknown usage labeled resolved and zero CU implying blanket refusal—were reproduced and fixed, then re-reviewed closed. The reviewer executed no additional probes; execution evidence above is from the primary agent. No remaining scoped material findings. Actual loopback smoke verifies available880000micro-CU/spend120000,88 remaining input tokens,four owned rows,empty Beta view,401 unauthenticated,400 owner override,405 write refusal, and concurrent-launcher refusal with active lock preserved. Reopen/replay preserves ledger4/journal4/registry-version4 counts. No new dependency, credential read, real provider/payment traffic, spending, deployment, public exposure, or generated-code execution. Remote CI is configured **NOT RUN**; original phase/release/legal acceptance remains open.

## Step 2.3 contract and evidence

High risk: shared quota admission, authorization and migration. [Governor service](../packages/governor/index.mjs), [exact arithmetic](../packages/governor/arithmetic.mjs), [configuration](../packages/governor/defaults.json), [migration005](../packages/db/migrations/005_governor.up.sql), [state tests](../tests/unit/phase2-governor.mjs) and [boundary regressions](../tests/unit/phase2-governor-boundaries.mjs) implement GOVERNOR-LOCAL-001/002 with existing reviewed Node/PGlite. Migrations1–4 and the default target1 remain unchanged; migration5 is explicit and additive.

| Acceptance / requirement | Executed local evidence |
|---|---|
| QUOTA-06, component T2.9 | Every applicable provider/account/model request, total-token, input-token and output-token limit/window is held in one transaction. Canonical provider→account→model ownership prevents pool aliases and duplicate budgets. Concurrent20 simulated requests across two models admit8 against the shared safe request limit; no partial holds survive failure at any scope/metric. |
| Exact safety/window handling | Exact BigInt floor(limit×factor), default0.8; all accounting BIGINT reads use SQL text. Values above2^53 retain every digit. Dispatch atomically releases/rebinds old holds to fresh windows and rechecks every window/TTL after all awaited writes; crossing allocations, journal or expiry rolls back the marker and restores the old holds. |
| QUOTA-07 daily token policy | Shared daily nodes aggregate once; independent providers sum, account/provider ancestors clamp model sums. Fair share floors min(trust cap,remaining/max(1,expected users)); shrinking pools lower the result and zero expected users is safe. Requests stay separate admission constraints; an explicitly configured50 tokens/request supplies a conservative daily request budget, also clamping the synthetic token budget. No daily bound means refusal rather than minute extrapolation. |
| Component T2.1, eligibility and ownership | Exhaustion raises a safe capacity refusal before the simulated transport callback. Unknown/conflicting scopes/accounts and disabled pools/models fail closed. Active synthetic staff checks guard configuration/dispatch/jobs/snapshots; users operate/read only their own reservations/policy, with permissions rechecked before replay. |
| Uncertainty, idempotency and bounded closure | Predispatch cancellation releases holds; dispatch consumes request quota and retains uncertain token bounds. Durable deadlines estimate the full bound; one late correction updates captured old counters without touching a new window. Six simultaneous sweeps report/post one estimate, followed by one correction. Immutable events/journals and storage closure slots preserve reconciliation. |
| Migration/persistence | Disposable up/down/reapply preserves the earlier ledger schema. Close/reopen retains dispatched holds/deadlines and permits later correction. Separate persistent CLI runs/reopens preserve complete logical state and fixed IDs; lock-held launch refuses a second opener without removing its lock. |

The quotas, fixed reset anchors, trust caps, expected100 users and50-token request conversion in the [fixture](../packages/governor/fixture.json) are **synthetic configured assumptions**, not actual provider/account capacity. The trusted `runFairShare` job creates immutable token-policy snapshots; it does not credit ledger funds. Full chat/router/ledger admission and policy enforcement follow in Steps2.4/2.5. No Governor HTTP mutation surface or background provider transport is introduced. Actual headers, premium/system slices, task budgets, monitoring/delivery and hosted retention remain at their owning phases/steps.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-governor
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-check
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-governor-coverage
.\.tools\node-v24.21.0-win-x64\node.exe --test --test-concurrency=1 tests/unit/prototype*.mjs tests/unit/phase1*.mjs tests/security/phase1*.mjs
```

The CLI uses separate ignored `.phase2-local/governor-database`, migration5 and `.phase2-local/governor-launcher.lock`; it closes normally after printing the saved example. Run one opener at a time. Fixed keys replay the original example/job without new rows; the policy retains its original timestamp while current counter windows may reset. Use a new trusted job key for a new policy generation. After abnormal exit, verify no process owns the data before removing a stale lock. Never downgrade/delete a persistent database to undo an operation. Existing ledger4177 and Phase1 previews/data remain separate.

Final verification: **92/92 Phase2** (46 prior registry/ledger +46 Governor:20 arithmetic,17 state/DB,9 boundary), **52/52 regression** (5 prototype,45 Phase1,2 security), types/lint/formatter/build PASS. These are **144 unique tests executed for this step**. Governor-only coverage reuses46: **99.50% lines,89.21% branches,100% functions**; arithmetic100% in all three dimensions. The first format check failed for two unformatted files; formatting and the complete check then passed. SQL has no installed Prettier parser; actual migration tests validate it. Unchanged browser/Python evidence from preceding steps was not rerun.

Independent reviewer ran the37 arithmetic/state tests and reproduced a MAJOR reset race beyond the earlier time check. The final completion guard fixes it; independent allocation/journal/storage/final-guard probes now reject and restore holds with zero dispatch events/journals. Source re-review and repeated37 tests close the finding; no remaining substantive finding. Root's nine boundary checks and full suite verify the final code. Security/FinOps pass for the local scope: owned resources, trusted staff, bounded input/storage, minimal pseudonymous events, no prompts/files/secrets or external fetch/transport; retention privilege/hosted durability remain unverified. Local secret scan PASS. No package, credential read, actual provider/payment/paid traffic, spending, deployment, public exposure or generated-code execution. CI includes Governor coverage but remote CI is **NOT RUN**.

Observed twice: **LOCAL_PHASE2_GOVERNOR_READY**; pools4/limits16/routes2/counters16/reservations2/allocations24/operations13/events13/job1/fair-share2/registry-versions6, ledger entitlements/rows0. Shared account usage2 requests/40 tokens, holds0; each model1 request/20 tokens. Daily safe request remainder798×50 gives39900 tokens, below token-counter remainder39960, so floor(39900/100) yields a399-token policy capped at1000. Saved policy/IDs/counts are unchanged on replay. The smoke check's initial token-only39960 expectation was corrected to include the configured request conversion; no service/schema/data correction was needed. Root independently reopened and verified counts/usage/policy. Locked CLI exits1 with its active marker preserved; existing4177 HTTP200.

## Step 2.4 contract and evidence

High risk: funded/shared admission, authorization, provenance and migration. ROUTER-LOCAL-001/002 implements the Step2.4 command using existing reviewed Node/PGlite. The [Router service](../packages/router/index.mjs), [context accounting](../packages/router/context.mjs), [policy selection](../packages/router/policy.mjs), [configuration](../packages/router/defaults.json), [migration006](../packages/db/migrations/006_router.up.sql) and optional API/repository/UI integration preserve Phase1 behavior when Router is absent. Migrations1–5 and default migration target1 remain unchanged;6 is explicit. Disposable up/down/reapply checks validate the migration; persistent data was never downgraded/deleted.

| Acceptance / requirement | Executed local evidence |
|---|---|
| ROUTE-02/03/04, T2.2 | Capability/class/language, verified synthetic context/rates, active eligibility and entitlement filtering; eligible free preference; exact funded paid fixture. Zero balance never dispatches a paid route. Every attempt atomically reserves and marks both ledger and all applicable Governor quotas before synthetic transport; exhaustion, expiry and cancellation roll back together. |
| ROUTE-09/14 | Immutable versioned policies, prepared policy snapshot and actual candidate/chosen/reason/fallback records. Trusted staff dry-run uses sample requests with zero calls/accounting mutations; ordinary users cannot inspect other users or invoke staff simulation. Separate staff web/MFA remains2.6 and simulator UI2.8. |
| ROUTE-10/11, T2.3 | Configured default one retry/one fallback, no account rotation, durable shared original/retry/regenerate budget. Provider/model breakers retain failures within their window, open/cool off as configured and exclude healthy user stops. Manual fallback rechecks capabilities/funding; pinned/free-only restrictions remain strict. |
| ROUTE-12/13, CHAT-03/05 | Auto/manual/free-only and General/Coding/Writing/Research presets; clear safe refusals/reset/alternatives. Actual live/saved attempts and changed-model banner. Any partial output blocks automatic resend. Owned retry/regenerate reuses the original prompt and durable budget; stop preserves uncertain dispatched usage. Mobile browser and routing-off controls PASS. |
| CHAT-04 | Synthetic codepoint tokenizer includes system prompt, all retained history and reserved output. Trim complete old turns while preserving the newest user turn; refuse unknown/unverified/impossible context. Long-history HTTP check remains within context. Summary requests fail explicitly; no fabricated summary or extra call. |
| QUOTA-01/04/06/07, component T2.1/2.4/2.8/2.9 | Combined input/output free daily bound from the saved Governor policy, captured day counters, exact signed settlement and durable unknown-use holds. Cancellation detected after commit but before gateway entry proves zero use and restores funds/request/token quotas. Restart recovers without resending. Deleted chat removes private attempt content while minimal holds still estimate and correct once against captured old counters. |
| Durable/bounded scope and maintenance | Immutable minimal policy/decision/correction events, bounded requests/attempts/holds and reserved closure capacity. One policy generation per configured local day; day capture/job run/final guard share a transaction, rollback and bounded retry prevent midnight key races. Policy refresh never grants money. File close/reopen preserves policy, retry family, holds and deadline recovery. |

The [separate fixture](../packages/router/fixture.json) has three canned synthetic models, toy per1,000-token CU rates, Alpha100CU pack plus free entitlement and Beta free entitlement. The free fixture entitlement has100000 input/output tokens, while current **combined daily Router policy is1000 tokens**; these are distinct bounds. Configured expected1 active user,1000tokens/request,0.8 safety and provider/account/model windows are assumptions. General English quality and unobserved latency remain unknown; coding/Bangla scores are labeled synthetic. There is no real tokenizer, quality evaluation, provider transport, credential loader, staff mutation HTTP, abuse2.5 or private-routing2.9 activation.

Run from `D:\free_ai`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-router
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-router-preview
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-check
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-router-coverage
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-router-browser
```

The CLI creates/reopens ignored `.phase2-local/router-database`, explicitly applies migrations1–6 and owns `.phase2-local/router-launcher.lock`. No-argument mode prints fixture status and closes; preview mode builds/serves **http://127.0.0.1:4178** with bounded60-second sweep/daily-policy maintenance. The verified hidden preview is active, **PID23120**. Do not open its database or start another launcher while the lock is active. Foreground launchers stop with Ctrl+C; after abnormal exit, verify process/port ownership before handling a stale lock. Never downgrade/delete persistent data to undo a configuration operation. Ledger4177 PID15112 and Phase1 4176 remain separate and available.

Final automated evidence is **191 unique passing checks:133 Phase2 +52 regression +6 browser**. Phase2 consists of92 prior registry/ledger/Governor and41 Router:13 context/policy,11 service/migration/accounting,6 HTTP,7 review boundaries,1 durability,1 dry-run and2 local-day checks. The complete Phase2 run passed129 checks before the four final durability/dry-run/day cases were added; those four then passed together. After the final fixture fix, the other37 Router cases and4 Router browser checks passed together. Regression5 prototype+45 Phase1+2 security and preserved Phase1/ledger browser2 also pass. Repeated reviewer/coverage runs are not additional unique tests. Unchanged Python/original prototype-browser evidence was not rerun.

Types/lint/formatter/build PASS; final fixture/day/persistence/simulation lint/format checks PASS. Measured Router coverage reuses38 tests: **96.62% lines,87.93% branches,97.30% functions**, above the70% line gate. Context has100% lines; policy98.48%; service95.88%. The two later dry-run/day files and additional midnight case are separately passing; Router service/context/policy source has not changed since measurement.

The first concurrent Phase2/regression/browser runs exceeded this machine's memory (V8 Zone OOM/PGlite DBERR); the failing coordinator was stopped, with persistent previews preserved. Static stages of `phase2-check` passed but its initial test stage did not complete successfully. Final tests were run **serially** with the pinned Node lower-memory command below; these observed passes, rather than an uncompleted wrapper run, supply the evidence. The ignored local GC helper imports `afterEach` from `node:test` and invokes exposed `globalThis.gc()` after each test; it is a verification workaround, not application configuration or a dependency. Avoid running PGlite/browser suites concurrently on this host.

```powershell
.\.tools\node-v24.21.0-win-x64\node.exe --expose-gc --wasm-num-compilation-tasks=1 --import ./.tools/router-test-memory.mjs --test --test-concurrency=1 tests/unit/phase2*.mjs
.\.tools\node-v24.21.0-win-x64\node.exe --expose-gc --wasm-num-compilation-tasks=1 --import ./.tools/router-test-memory.mjs --test --test-concurrency=1 tests/unit/phase2-router-day.mjs tests/unit/phase2-router-durability.mjs tests/unit/phase2-router-simulation.mjs
.\.tools\node-v24.21.0-win-x64\node.exe --expose-gc --wasm-num-compilation-tasks=1 --import ./.tools/router-test-memory.mjs --test --test-concurrency=1 tests/unit/phase2-router-context.mjs tests/unit/phase2-router.mjs tests/unit/phase2-router-api.mjs tests/unit/phase2-router-boundaries.mjs tests/integration/phase2-router-browser.mjs
```

Initial implementation/test-harness failures were corrected before final passing runs: missing module/syntax, missing semantic routing in a test helper and an outdated capacity assumption. Browser assertions initially matched empty user-message attempt containers; scoping to assistant replies fixed the test selectors. Meaningful independent regression failures were reproduced before their source fixes.

Independent review closed four original MAJOR findings: prepared policy changing at dispatch, transport beginning after the first yielded attempt event, user stops counting as provider failures and successes erasing failures inside the breaker window. A post-commit/pretransport cancellation probe then failed with a synthetic charge; the internal zero-use restoration path fixes it. Reviewer independently passed all7 boundary cases and capability/funding/pinned manual-fallback probes. Final review found a MINOR local-midnight key race; its new regression failed, the transaction-bound day/job guard fixed it, and both day checks independently pass. No scoped findings remain.

Exactly two successful no-argument persistent CLI runs, separated by independent locked reads, preserve selected complete table rows and registry metadata: migrations6, entitlements/ledger rows/operations3 each, pools5,limits20,routes3,job1,fair-share rows2,policy version1,Router event1 and no Router requests/attempts before preview traffic. A separately held lock makes CLI exit1 without removing its marker. The preview's third successful startup reports `LOCAL_PHASE2_ROUTER_READY`, syntheticOnly=true, realProvidersEnabled=false, credentialsRead=false and initial modelCallsMade=0. Its database has no external-provider records; the separate original research registry remains disabled and protected.

Actual loopback HTTP smoke verifies Router4178 and preserved ledger4177 HTTP200, Alpha3 models/Beta2,401 without session,404 cross-user conversation and400 owner override. Auto/Coding chooses freeA, manual/Writing chooses the paid-flag canned accounting model, each saves one owned attempt/source link. Replaying the first key returns the same request with no second dispatch; owned history has4 messages and Beta has no conversation. These are synthetic calls/toy ledger debits only. Restart/uncertainty behavior is separately tested on disposable file-backed databases.

Security/FinOps pass within the local scope: trusted actor checks and owned resources, optional feature gating, safe bounded fields/context/storage, exact funded bounds, fail-closed unknowns, private content deletion with content-free reconciliation evidence, no secrets in public bundles or minimal operations logs. No new package/lockfile change, credentials, actual provider/payment/paid traffic, real spending, deployment, public exposure or generated-code execution. CI now includes Router coverage/browser tasks but remote CI is **NOT RUN**. Hosted roles/retention/backup/durability/resource measurements, actual headers/tokenization/quality/FX/capacity and qualified legal/release checks remain unknown. Local component T2 evidence does not close Step2.10 or full phase acceptance. Final record/hash/ignore/PowerShell/secret-scan results are recorded in [PROGRESS](../PROGRESS.md).

## 2026-10-13 Step2.5 checkpoint — historical, superseded below

ABUSE-LOCAL-001 covers AUTH-05/ABUSE-01–04/07. The owner explicitly requested Step2.5 and then completion of its remaining work. Code now written: Abuse service/config, opt-in migration007 and registration, optional API/Router admission hooks, local signup/burst verification and trust/limit UI, isolated launcher/config, service/HTTP/browser cases and wrapper/CI coverage/browser commands. No Step2.6 privileged HTTP/admin interface or actual CAPTCHA/provider transport was added.

The intended local contract includes trust0–3 based on configured age/verified-contact/good behavior; stable server-keyed device/IP-range pseudonyms; source/user caps and minimal cluster evidence; transactional nonce/purpose/source/TTL/single-use proof-of-work; audited trusted moderator suspend/throttle/ban. Optional API uses signed HttpOnly device tokens and socket IP rather than browser/forwarding claims. Owned request creation/cap debit share an outer abuse transaction; every Router attempt rechecks owned admission/current moderation/trust before money/capacity dispatch. The API rejects combining this synthetic abuse fixture with Google-enabled configuration; existing separate Google integration preparation is preserved. These are implementation contracts awaiting executed integration/security evidence, not production anti-bot guarantees.

Preliminary builder reports: core syntax/Prettier and UI TypeScript noEmit passed before usage exhaustion. Root has **not** executed final static checks, any abuse database/HTTP/browser suite, coverage, migration up/down/reapply/restart, protected hashes/record audit, or final secret scan. The new service has not received independent finished-source/security review. The prior191 Step2.4 checks and coverage are historical evidence; they do not establish passes for the changed source. No Step2.5 DONE/phase acceptance claim is made.

Execution failed before the requested read command ran: automatic approval review could not complete because of a usage limit. The tool explicitly says this is a review failure, not an unsafe-action determination, and gives a retry time of11:08PM. A lower-permission sandbox-only read also failed before execution with `helper_unknown_error: setup refresh had errors`. No approval check was bypassed. Further builders also stopped at the usage limit. The affected command/test work must resume when execution and review are available.

The launcher intends separate ignored `.phase2-local/abuse-database`, migration7, `.phase2-local/abuse-launcher.lock`, durable local `.phase2-local/abuse-hmac.key` and loopback4179. **No persistent abuse database/key/lock or4179 preview has been created by root; startup/replay/lock smoke NOT RUN.** The key must remain stable on reopen; missing key with nonempty data refuses startup. Earlier verified previews were not restarted or opened, and persistent data was not deleted/downgraded. Local HMAC keys are not provider credentials; hosted secret storage/rotation and hashed-signal retention remain release evidence.

Commands authored for resuming after source review/static correction:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-check
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-abuse-coverage
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-abuse-browser
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-abuse
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-abuse-preview
```

Run embedded-DB/browser suites serially with the previously verified memory workaround. Required finish: inspect service/client/root contracts, correct any integration failures, full static checks, meaningful migration/trust/challenge/cap/cluster/moderator/IDOR/replay/reset/restart and joint-dispatch regression tests, browser, measured coverage, independent review/security fixes, persistent replay/lock/preview, final hashes/history/links/PowerShell/ignore/secret scan and completion records. No new dependency/lockfile/real provider credentials/traffic/payments/spending/hosting/public exposure/generated-code execution. CI wiring is authored; remote CI NOT RUN.

At that checkpoint the next action was to finish verification. Execution and verification subsequently recovered; the2026-10-14 result below supersedes its pending status.

## Step2.5 — verified local abuse module

Step2.5 DONE under LOCAL-PHASE2-001 / ABUSE-LOCAL-001/003. Optional migration007 preserves originals1–6 and default target1. Existing dependencies implement [Abuse service](../packages/abuse/index.mjs), [defaults](../packages/abuse/defaults.json), API/Router guards, explicit local verification UI and [isolated launcher](../tools/phase2/abuse.mjs). The separate persistent preview is **http://127.0.0.1:4179**, PID1356. The proof is a synthetic equivalent challenge and does not verify a unique human. Staff identity/API/MFA remain2.6; Control Center cluster screens/alert delivery remain2.8.

| Contract | Executed evidence and practical boundary |
|---|---|
| AUTH-05 / ABUSE-01 | New trust0; monotonic configurable0–3 request/token/burst/concurrency bounds; current age/contact/good-behavior evidence and revoked privilege replay. Paid and free routes share the abuse daily token limit; the separate free Governor policy also applies. |
| ABUSE-02 | Signup and suspicious burst rules; minted nonce/source/purpose/TTL/single-use proof; safe challenge/reset errors. Browser explicit work and retry, expiry renewal, memory-only proof clearing, retained draft and360px flow pass. |
| ABUSE-03/04 | Domain-separated HMAC device/IP-range/user keys; IPv4/IPv6/mapped addresses and invalid-zone refusal. Signed HttpOnly device token and socket source reject forwarded/body overrides. Concurrent/replay/reset/source caps, minimal cluster records and restart/deletion survival pass. |
| ABUSE-07 | Current trusted role and protected target checks; bounded reasons; immutable receipts/audit; suspend/throttle/ban and automatic expiry. Valid own session restores after expired suspension; ban stays unavailable. An already dispatched uncertain attempt closes without resend or refund, then estimates/corrects captured old counters once. |
| Joint accounting | One outer abuse guard owns chat admission and logical cap debit. Every funded attempt checks current user/moderation/trust. Synchronous final checks after all awaited outer writes reject minute/TTL crossing with no transport and complete reservation rollback. Pretransport cancellation restores all-route token holds, pack funds and provider quota. Deleted private chat keeps minimal pending settlement obligations. |

An admitted logical request consumes one source/user allowance, including a later Router funding/capacity refusal; completed idempotent replay consumes none. Source-cap refusal rolls back the chat request. A failed funded attempt releases its financial/token/capacity reservations, while the previously admitted logical quota stays consumed. These prevent refusal spam and distinguish request admission from provider accounting. Trust advancement requires trusted configured evidence; a local proof alone does not award verified contact or prove good behavior. No browser-supplied source/trust/staff authority exists.

Final verification: **166 Phase2 + 52 regression + 9 browser checks PASS (227 unique); Abuse 98.86% lines/84.8% branches/100% functions**.33 new Abuse checks comprise19 core,5 HTTP,8 boundary and1 file-backed durability. The52 regression checks cover prototype5, Phase145 and security2; nine browser checks cover Phase1/ledger2, Router4 and Abuse3. Focused, reviewer and coverage reruns are reused evidence. Strict types, full ESLint, formatter and build PASS; final protected-record/secret audits are in PROGRESS. Independent review closes four MAJOR findings: paid daily trust bypass, commit-window recheck gap, banned in-flight closure and expired-session barrier. Key binding and concurrency configuration follow-ups are fixed. Reviewer ran7 boundary passes; root's corrected intentional-AbortError case passed, then the full boundary/Phase2 run supplies final evidence. Source UI/API/security re-review has no remaining material finding.

Failed runs are retained as failures: early missing-proof assertions expected403 instead of the correct429; migration down/default JSON BOM caused SQL42601/JSON failure; a draft fingerprint SQL repair was truncated by JavaScript replacement-string `$'` semantics and corrected using exact checked content. The file-reopen wrong-key test first reproduced callback entry, then passed with fail-closed database fingerprint binding. Config concurrency monotonicity first failed, then passed after validation. Browser copy matching first failed on HTML whitespace; its assertion now accepts whitespace. Cancellation first failed on the intentionally propagated AbortError; corrected expected-error handling reaches all refund checks. 

Serial final commands use the ignored exposed-GC helper described in Step2.4:

```powershell
.\.tools\node-v24.21.0-win-x64\node.exe --expose-gc --wasm-num-compilation-tasks=1 --import ./.tools/router-test-memory.mjs --test --test-concurrency=1 --experimental-test-coverage --test-coverage-lines=70 --test-coverage-include=packages/abuse/*.mjs tests/unit/phase2*.mjs

.\.tools\node-v24.21.0-win-x64\node.exe --expose-gc --wasm-num-compilation-tasks=1 --import ./.tools/router-test-memory.mjs --test --test-concurrency=1 tests/unit/prototype*.mjs tests/unit/phase1*.mjs tests/security/phase1*.mjs
.\.tools\node-v24.21.0-win-x64\node.exe --expose-gc --wasm-num-compilation-tasks=1 --import ./.tools/router-test-memory.mjs --test --test-concurrency=1 tests/integration/phase1-browser.mjs tests/integration/phase2-ledger-browser.mjs tests/integration/phase2-router-browser.mjs tests/integration/phase2-abuse-browser.mjs
```

Two successful actual no-argument CLI launches preserve migrations7, fixture grants3/pools5/limits20/routes3/job1, profiles2, stable key/fingerprint and initial attempts0. Independent reads hold the launcher's exclusive lock and compare all selected rows, excluding only the advancing guard timestamp. Held-lock refusal exits1 without deleting its marker. Preview startup reports syntheticOnly=true, realProvidersEnabled=false, providerCredentialsRead=false, modelCallsMade=0, humanVerification=false and staffWebRoutes=false. Real external-provider rows are absent from this fixture; the original four research providers stay disabled.

Actual HTTP smoke: root200, unauthenticated401, Alpha3/Beta2 models, cross-user404, trust override400, signup without proof429, valid proof login, trust0/token1000 owned status, free and paid-flag canned replies saved, same-key replay with unchanged cap usage, burst proof/429 cap and reset data, four saved messages. Earlier preview health: 4176 unavailable, 4177 unavailable, 4178 unavailable. Original data and locks were not reopened/restarted/deleted. Durability, wrong-key failure and uncertain accounting use disposable file-backed test databases; no live preview database is opened concurrently. The durable local key must accompany database backups; missing/replaced keys fail closed.

Security/FinOps local PASS: exact funds/counters and owned/current role checks, bounded minimal signals/events/storage and closure slots, no raw IP/device in storage or public status, no secret/prompt/output in minimal operations evidence. No dependency/lockfile change, provider credentials/traffic, real Google/payment/spend/hosting/public exposure or generated-code execution. CI coverage/browser wiring is configured; remote CI **NOT RUN**. Real anti-bot effectiveness, mobile work measurements, HMAC rotation/backup operations, signal retention/deletion and hosted roles/durability/backup plus actual capacity/tokenization/quality/FX/legal/release remain open. These synthetic tests do not establish free support for100 users or public launch. FullPhase2/Step2.10 acceptance and original live/hosted gates remain open.

## Step 2.6 — verified local Control Center foundation (admin scope, RBAC, MFA, config rollback, kill switches)

Step 2.6 DONE under LOCAL-PHASE2-001 / ADMIN-LOCAL-001/002. Migration 008 (`008_admin.up.sql` / `008_admin.down.sql`), `packages/admin`, and `tools/phase2/admin.mjs` implement the complete administrative Control Center foundation with existing reviewed dependencies. The persistent admin preview runs on **http://127.0.0.1:4180** with isolated directory `.phase2-local/admin-database`.

| Contract / AC | Executed Evidence and Practical Boundaries |
|---|---|
| **AP-01 & T2.7**: Separate admin app & API scope | `/admin` and `/admin/api/*` endpoints strictly segregated. Non-staff user sessions receiving valid `local_session` cookies receive 403 `ADMIN_FORBIDDEN` on any `/admin/*` route. Anonymous access to protected endpoints returns 401 `STAFF_AUTHENTICATION_REQUIRED`. Verified in unit tests and Playwright browser integration. |
| **AP-02**: Roles & permissions RBAC | Four system roles seeded (`super_admin`, `operator`, `moderator`, `auditor`) with fine-grained permissions (`provider:manage`, `model:manage`, `policy:manage`, `kill_switch:manage`, `user:moderate`, `user:read`, `staff:manage`, `role:manage`, `audit:read`, `config:rollback`). Super-admin role protected from modification. Custom roles supported. Unprivileged actions rejected with 403 `INSUFFICIENT_PERMISSIONS`. |
| **AP-03 & T2.6**: Config versioning & one-click rollback | `config_revisions` table tracks versioned configurations with actor attribution, before/after JSON snapshots, reason codes, and idempotency keys. Rollback of kill switches and routing policies restores prior state, appends a new revision, and updates live behavior immediately. Append-only triggers block any UPDATE/DELETE/TRUNCATE. |
| **AP-04 & T2.7**: Staff MFA (RFC 6238 TOTP) | Two-phase authentication: initial staff login without TOTP issues session with `mfaRequired: true`; calling protected routes returns 403 `MFA_REQUIRED`. Step-up MFA elevation via `/admin/api/auth/mfa` with TOTP code elevates session to `mfaVerified: true`. Step time 30s with window 1 tolerance window verified. Logout revokes session cookies and DB state. |
| **AP-05**: Append-only audit log | `admin_audit_log` records all administrative mutations (`KILL_SWITCH_TOGGLED`, `CONFIG_ROLLBACK`, `ROLE_CREATED`, `ROLE_UPDATED`, `STAFF_ENROLLED`, `SESSION_CREATED`, `MFA_VERIFIED`, `SESSION_REVOKED`). Database trigger `reject_append_only_change()` enforces immutability at the SQL engine level. |
| **AP-09 & T2.5**: Hierarchical kill switches | Switches for `all_ai`, `provider:*`, `model:*`, `free_tier`, `paid_routes`, `signups`, `file_uploads`, and `agent_mode`. Toggling parent switch immediately disables all child operations. Verified over HTTP: enabling `all_ai` halts user chat requests immediately with 503 `KILL_SWITCH_ACTIVE`; rollback immediately restores traffic. |

### Verification and Test Results

- **Admin unit tests**: 16/16 PASS (`tests/unit/phase2-admin-*.mjs`).
- **Admin browser test**: 1/1 PASS (`tests/integration/phase2-admin-browser.mjs`).
- **Admin code coverage**: **90.48% lines** (threshold: 70%), 76.26% branches, 97.30% functions across `packages/admin/*.mjs`.
- **Phase 2 total suite**: 182/182 PASS (`tests/unit/phase2*.mjs`).
- **Regression suites**: 45 Phase 1 tests PASS, 2 security tests PASS, 5 prototype tests PASS.
- **Static checks**: TypeScript typecheck PASS (0 errors), ESLint PASS (0 errors), Prettier format:check PASS (0 warnings).
- **Secret scanner**: `PASS: no secret findings in the working tree.`
- **Persistent preview launcher**: `tools/phase2/admin.mjs` outputs `LOCAL_PHASE2_ADMIN_READY`, serves port 4180 with seeded `super_admin` (`SYNTHETIC_SEED.userA`).

No new third-party dependencies added. No provider credentials, live provider calls, real payment processing, or hosted deployment. Remote CI is configured but NOT RUN.

## Step 2.7–2.9 Implementation Highlights

1. **Step 2.7 Core Modules (M1–M6, M11, M14, M16)**:
   - Full implementation of all 9 core admin modules in `packages/admin/index.mjs` and `packages/api/server.mjs`.
   - Verified in `tests/unit/phase2-admin-modules.mjs` (10/10 PASS).
2. **Step 2.8 Simulator, Alerts, Health & Provider Outage Chaos**:
   - Migration 009: `owner_alerts` and append-only `alert_delivery_attempts` with `reject_append_only_change()` triggers.
   - AP-06 Zero-mutation routing simulator evaluated across prompts, languages, presets, and breakers.
   - OPS-05 System and component health reporting with delivery proof and retries.
   - OPS-06 Provider outage chaos test verifying automatic fallback, circuit breaker trip, clean 503 admission rejection, and fault isolation.
   - Verified in `tests/unit/phase2-simulator-alerts.mjs` (6/6 PASS).
3. **Step 2.9 Private-Mode Routing & Training-Data Notice**:
   - ROUTE-05 & PRIV-03: `rankRoutingCandidates` strictly eliminates `may_train` providers when request sensitivity is `'private'`, even with manual/pinned mode overrides.
   - Fallback privacy invariance: Fallback route preserves `sensitivity: 'private'` and refuses fallback to `may_train` providers.
   - ROUTE-07: Free route using a `may_train` provider detects `trainingNoticeRequired: true` linking to `/legal/privacy.html`, tracked once-per-session.
   - AP-06 Simulator evaluated for private mode and sensitivity.
   - Verified in `tests/unit/phase2-private-routing.mjs` (5/5 PASS).

## Step 2.10 Verification: Acceptance Criteria T2.1–T2.9

| Acceptance Test | Requirement | Local Test Mapping | Result |
|---|---|---|---|
| **T2.1** | Provider pool exhausted refuses admission gracefully without provider call | `tests/unit/phase2-governor.mjs`, `tests/unit/phase2-router.mjs` | **PASS** |
| **T2.2** | Zero balance never dispatches paid route | `tests/unit/phase2-router.mjs`, `tests/unit/phase2-router-api.mjs` | **PASS** |
| **T2.3** | Retry budget holds under failing provider | `tests/unit/phase2-router.mjs`, `tests/unit/phase2-router-durability.mjs` | **PASS** |
| **T2.4** | Ledger balance equals sum of rows after concurrent requests | `tests/unit/phase2-ledger.mjs` | **PASS** |
| **T2.5** | Kill switch disables provider/model/chat immediately | `tests/unit/phase2-admin-killswitches.mjs`, `tests/unit/phase2-admin-api.mjs` | **PASS** |
| **T2.6** | Config rollback restores previous routing behavior | `tests/unit/phase2-admin-rollback.mjs`, `tests/unit/phase2-admin-api.mjs` | **PASS** |
| **T2.7** | Admin routes return 403 for non-staff and require MFA for staff | `tests/unit/phase2-admin-auth.mjs`, `tests/unit/phase2-admin-api.mjs`, `tests/integration/phase2-admin-browser.mjs` | **PASS** |
| **T2.8** | Dispatched cancellation retains bounded hold, resolves at deadline, appends late correction once | `tests/unit/phase2-ledger.mjs`, `tests/unit/phase2-router.mjs` | **PASS** |
| **T2.9** | Multi-model shared-pool concurrent requests cannot double-count or overrun | `tests/unit/phase2-governor.mjs` | **PASS** |

### Phase 2 Complete Verification Evidence
- **Total Phase 2 Unit Tests**: 203/203 PASS (`npm run phase2:test`).
- **Total Phase 2 Browser Integration Tests**: 9/9 PASS (1 admin, 3 abuse, 1 ledger, 4 router).
- **Total Executed Automated Phase 2 Tests**: 212/212 PASS.
- **Static Quality**: TypeScript `typecheck` PASS (0 errors), ESLint `lint` PASS (0 errors, 0 warnings), Prettier `format:check` PASS (all files use Prettier style).
- **Security**: `tools/scan-secrets.ps1` PASS (`PASS: no secret findings in the working tree.`).
- **Scoped Acceptance Status**: Local synthetic Phase 2 complete. **STOP: owner accepts admin/router behavior; additional providers need approval before traffic.** Next: Phase 3 (Files, Productivity, First Public Release).

