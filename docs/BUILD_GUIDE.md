# Build Guide — What to Do First, Second, and Next

Updated: 2026-10-13. Applies to SRS v2.1.1 and Operating Manual v1.1.

## 1. Start here

Steps 0.1–0.7, the Step 0.9 report and **local Phase 1 implementation (1.1–1.10) are DONE**. [The Phase 1 report](PHASE1_REPORT.md) maps the local series and remaining real/hosted checks. **Local Phase 2 is IN PROGRESS: Steps2.1–2.5 registry, ledger, Governor, Router and abuse DONE; Step2.6 next.** LOCAL-PHASE2-001 / canonical SRS17.1.4 records the owner's instruction to defer real integrations and start ordered synthetic work. Full Step0.8 and original live/hosted Phase0/1/2 acceptance remain open. [PHASE2_REPORT](PHASE2_REPORT.md) supplies current commands and evidence.

**Current follow-up:** P1-PREHOST-001 / SRS 17.1.3 implements configured local Google OAuth, a durable scoped Groq evaluation runner, request logging and updated local-draft-v2 notices. The new isolated preview is at 127.0.0.1:4176. [PHASE1_INTEGRATION_GUIDE](PHASE1_INTEGRATION_GUIDE.md) gives the exact sequence: Google Web-client setup on loopback, eligible Free account/model/scope, verified real tests/review, then the owner-supplied host/domain. Actual credentials/scope remain absent; hosted staging and domain work are explicitly deferred.

1. Bootstrap is complete: Git main, folder skeleton, README, ignore rules, empty `.env.example`, and checksum-pinned local scanner were verified. See README for the repeatable scanner commands; do not rebuild existing planning files.
2. Pilot inputs are recorded in CAPACITY-001: D2 = 100 daily active free users, D3 = BDT 1,500/month hosting ceiling; five requests/user/day is ASSUMED. D10 target regions and intended audience ages remain unresolved. D4 research candidates were authorized in RESEARCH-001; the production shortlist is still unapproved.
3. Read [the completed provider matrix](PROVIDER_TERMS_MATRIX.md). It covers four candidates with public-source findings and TODO-VERIFY conditions; no provider is enabled. Resolve intended-use and account-specific conditions before counting eligible capacity or calling a model.
4. Read [the sourced pricing inputs](pricing_inputs.json): model/tier/period prices, dated FX references, partial gateway schedules and explicit unknown costs. All feasibility flags remain false; advertised rates do not approve a pack sale.
5. Read [the capacity report](CAPACITY.md): three conditional user bounds of 120/35/16 at five requests each. Exact eligible account quotas, actual traffic and hosting costs are TODO-VERIFY; the medium/high references do not cover 100 users.
6. Use [the pack calculator guide](PACK_CALCULATOR.md) to run examples or audit pending sourced inputs. The 65,000/1,800,000-token SRS examples pass; actual pack generation/activation remains unapproved.
7. Read [the dependency review](DEPENDENCY_REVIEW.md): reference releases/licenses/security dispositions and the actual reviewed local Node/PGlite/JOSE graph. Local adoption is authorized and tested; hosted-stack, image/OS/WASM/full-graph/legal checks remain in DEP-001 and the open questions.
8. Read [the completed Step 0.7 records](DECISIONS.md): HOST-001, DB-001, STACK-001, GATEWAY-001, SANDBOX-001 and PAYMENT-001. Preferred planning direction is one VPS with Next.js/TypeScript, PostgreSQL data/queue and internal LiteLLM core; conditional Hetzner cost references fit D3 in two sensitivities, but availability, actual all-in charges and enforced overage bounds are unverified. Browser/server execution and payment activation stay deferred.
9. Read [the Step 0.8 report](EVAL_REPORT.md): 45 cases/offline harness are prepared and the prior 43 tests pass. EVAL-APPROVAL-001 records **approved thresholds** and supplied test caps/stop rules. Full Step 0.8 stays **NEEDS OWNER**; account setup is owner-deferred. When resumed, supply the concrete provider/model/account/key/environment/free-only/expiry fields without re-approving thresholds/caps, then collect real language and isolated coding evidence.
10. **First: run/check the completed registry, ledger, Governor and Router** using [PHASE2_REPORT](PHASE2_REPORT.md); Router preview127.0.0.1:4178 and ledger4177. **Next: Step2.6 Control Center foundation**, followed by separate staff MFA/admin, simulator/private routing and T2 verification. **Later:** resume actual Google/provider/evaluation setup and verify the owner-supplied host/domain and original legal/release/phase gates. No repeated permission is needed for authorized local work; synthetic results cannot establish live/hosted acceptance.

For close control, use `RUN STEP n.m` followed by `NEXT`. For a whole phase, use `RUN PHASE n`; the agent still stops at required approvals. `STATUS` reports progress without changing anything.

## 2. Recommended order

Phase numbers remain stable identifiers. The recommended order puts cost recovery before later paid agent and sandbox rollout.

| Order | Stage | Command | Ready when / exit |
|---|---|---|---|
| 1 | Feasibility | `RUN PHASE 0` | Research, capacity, pricing, license/legal review, and real-model evaluation; owner records GO or GO_CHAT_ONLY |
| 2 | Private MVP chat | `RUN PHASE 1` | Phase 0 approved; T1.1–T1.4 and assigned checks pass; staging accepted |
| 3 | Router, quotas, and admin | `RUN PHASE 2` | Local start authorized by LOCAL-PHASE2-001; original live/hosted Phase1 acceptance and T2.1–T2.9/admin-router acceptance remain required for full completion |
| 4 | Files, productivity, first public release | `RUN PHASE 3` | Phase 2 accepted; T3.1–T3.3, legal, backup, privacy, and incident checks pass; owner approves launch |
| 5 | Payments and sustainable funding | `RUN PHASE 6` | Phase 3 closed; gateway/pricing approved; T6.1–T6.9; separately approved pilot reconciles before wider rollout |
| 6 | Coding patch agent and workbench | `RUN PHASE 4` | Phase 3 closed, D7 set, real agent evaluation passes; T4.1–T4.7; owner approves agent rollout |
| 7 | Browser execution | `RUN PHASE 5a` | Phase 4 closed; runtime/license decision D5; T5a.1–T5a.3 |
| 8 | Optional server sandbox | `RUN PHASE 5b` | Phase 5a and normally Phase 6 closed; selected D5, funded hard budget; T5.1–T5.4; owner approves limited rollout |
| 9 | Growth and integrations | `RUN PHASE 7` | Phase 6 closed; each feature's own dependencies pass; GitHub L4 also needs Phase 4 |

The owner may choose the agent/browser branch before payments after Phase 3. GO_CHAT_ONLY defers that branch until a new real-model evaluation passes. Browser-only scope records Phase 5b as SKIPPED and does not require server-sandbox tests. A separately funded, explicitly approved sandbox pilot can substitute for Phase 6; funding cannot be inferred from a ledger grant.

## 3. Exact steps inside each stage

### Phase 0 — Prove feasibility before product code

| Step | Do this | Evidence / next dependency |
|---|---|---|
| 0.1 | Finish repo skeleton and agent entrypoints; create memory files and secret-scan configuration | Files and links valid; no credentials or product code |
| Inputs | Record D2, D3, candidate D4, D10 | Needed before dependent research and capacity math |
| 0.2 | Review official current provider terms, privacy policies, prices, and quota ownership | Provider Terms Matrix; D4 approval follows this review |
| 0.3 | Record model prices, dated FX, and payment-fee sources | DONE: valid sourced `pricing_inputs.json`; unresolved provider conditions carried forward; unknown fees cannot justify a pack sale |
| 0.4 | Calculate low/medium/high capacity scenarios | DONE: three conditional scenarios; shared pools counted once and safety applied; verified 100-user support remains TODO-VERIFY |
| 0.5 | Build the price-first calculator | DONE: exact 65,000/1,800,000 examples and 16 unit/CLI tests; real pack readiness remains pending |
| 0.6 | Review gateway, UI, auth, editor, runtime, and sandbox dependencies | DONE: sourced license/release/security/disposition fields for 20 named components and an unspecified category; blocking adoption findings and graph/legal follow-ups stay explicit |
| 0.7 | Record hosting, database, stack, sandbox options, and gateway choices | DONE: six options/choice/reason/revisit records, 13 dated sources and exact conditional D3 comparisons; actual host quote/cap/availability and adoption approval remain pending; optional features deferred |
| 0.8 | Approve evaluation thresholds; validate harness with stubs, then evaluate real eligible models | NEEDS OWNER: 45-case suite/offline harness complete; prior 43 tests PASS; thresholds APPROVED and caps/stop rules recorded; target/account/key/environment/free-only/expiry fields, real reviews/isolated coding evidence pending |
| 0.9 | Write gate report and recommendation | DONE: local CHANGE-SHAPE later extended to the 1-series by LOCAL-PHASE1-001; hosted scope remains NO-GO pending evidence |

GO_CHAT_ONLY permits chat/files when the core gate passes but coding quality fails. Missing required core evidence blocks GO. A stub cannot prove real model quality.

### Phase 1 — Build a private chat MVP

| Step | Do this | Check |
|---|---|---|
| 1.1 | Typed local scaffold, environment validation and checks | DONE locally; configured CI NOT RUN; real compose/hosted deployment deferred |
| 1.2 | Create schema, migrations and seed | DONE: 10 DB tests and file-backed close/reopen PASS |
| 1.3 | Sessions, logout, deletion and Google verifier | DONE locally; synthetic OIDC/state/nonce/signature tests PASS; actual Google login disabled/NOT RUN |
| 1.4 | Normalized gateway and health | DONE for the one synthetic route; eligible real provider/key/model scope still absent |
| 1.5 | Persisted streaming API, owned CRUD and routing records | DONE: isolation/cancellation/error/idempotency/ordering/provenance tests PASS |
| 1.6 | Responsive EN/BN sample chat UI | DONE locally: Edge desktop/360 px/keyboard/stop/model/usage/legal checks PASS; complete translation/WCAG/performance review pending |
| 1.7 | Server rates, daily/concurrency/time/input/output/storage bounds | DONE: direct API and transactional storage/reserved-deletion tests PASS |
| 1.8 | Five versioned local legal drafts | DONE: linked and accurate for synthetic use; qualified review required before public use |
| 1.9 | Security/dependency/secret/bundle checks | DONE locally; CI execution and hosted/container/retention release checks remain distinct |
| 1.10 | Persistent local staging and T1 checks | DONE technical local scope: 87 tests plus HTTP/disk smoke; original real T1.1 and owner/hosted acceptance remain open |

### Phase 2 — Protect shared capacity and build core admin

| Step | Do this | Check |
|---|---|---|
| 2.1 | DONE locally: registry with provider enable gates, versions/rollback and sourced disabled imports |13 tests and independent review PASS; no staff web routes before2.6 |
| 2.2 | DONE locally: immutable signed ledger and owned usage/history views |20 state/DB+8 arithmetic+5 API checks, desktop/mobile,98.68% line coverage and independent source findings closed |
| 2.3 | DONE locally: atomic shared-pool Governor, exact safety factors and daily token policy |46 Governor checks,99.50% line coverage, independent reset-race closure and persistent lock/replay PASS; Router2.4 adds joint chat coupling |
| 2.4 | DONE locally: funded joint Router admission, policies/context, retry/fallback/stop flows and saved attempts |41 Router checks,4 Router browser checks,96.62% line coverage; independent findings closed, disk replay/lock and4178 preview PASS; staff simulator UI2.8 |
| 2.5 | DONE locally: trust0–3, signup/burst equivalent challenges, device/IP risk, source/token caps and audited moderation | 166 Phase2 + 52 regression + 9 browser checks PASS (227 unique); Abuse 98.86% lines/84.8% branches/100% functions; migration/restart/independent/security/4179 replay/lock/HTTP evidence in PHASE2_REPORT; cluster alert records fire, screens/delivery2.8 future |
| 2.6 | DONE locally: staff authentication, TOTP MFA, roles/permissions RBAC, append-only audit, config rollback, hierarchical kill switches | 16 admin tests, 1 browser test, 182 Phase 2 tests PASS; admin coverage 90.48% lines; T2.5–T2.7 verified; port 4180 preview |
| 2.7 | DONE locally: build M1–M6, M11, M13, M14, M16 core modules | 10 module unit tests + 16 foundation tests PASS; M1 live metrics dashboard, M2 providers & rollback, M3 models & CU rates, M4 routing policies & AP-06 simulator & capacity, M5 users search/moderation/adjust/tier, M6 staff MFA reset & activity, M11 abuse alerts & queue, M14 write-only secrets vault, M16 audit log CSV export with AP-10 audit logging |
| 2.8 | DONE locally: routing simulator, live capacity dashboard, health monitoring, and owner alerts | 6 unit tests PASS in tests/unit/phase2-simulator-alerts.mjs; AP-06 zero-mutation routing dry-run with prompt/language/presets/tier/breaker constraints; OPS-05 /health & /admin/api/monitoring/health endpoints, owner alert creation/delivery proof/append-only attempts/retries; OPS-06 provider outage chaos test with automatic fallback, circuit breaker trip, clean 503 admission rejection, and application fault isolation verified; capacity dashboard live metrics |
| 2.9 | DONE locally: private routing, fallback privacy invariance, and training-data notice | 5 unit tests in tests/unit/phase2-private-routing.mjs PASS; ROUTE-05 & PRIV-03 private mode strictly rejects may_train providers with TRAINING_POLICY_FORBIDDEN; manual/pinned overrides cannot bypass; fallback preserves sensitivity; ROUTE-07 once-per-session training data notice and ack endpoints; AP-06 simulator evaluates sensitivity/private mode |
| 2.10 | DONE locally: verify T2.1–T2.9 and all assigned Phase 2 checks | 203 unit tests PASS (tests/unit/phase2*.mjs), 9 browser tests PASS; all T2.1–T2.9 verified; types/lint/format/secrets PASS. STOP: owner accepts admin/router behavior; additional providers need approval before traffic |

### Phase 3 — First public release

| Step | Do this | Check |
|---|---|---|
| 3.1 | DONE locally: writing/translation/summary presets and Bangla evaluation | packages/productivity, 6 unit tests PASS in tests/unit/phase3-productivity-presets.mjs; WRITE-01..05 verified; Bangla evaluation suite 15/15 PASS (100% vs 85% bar) |
| 3.2 | DONE locally: safe PDF/TXT/CSV ingestion | packages/files, Migration 10, 7 unit tests PASS in tests/unit/phase3-files.mjs (13 Phase 3 tests total); FILE-01..03, FILE-06, FILE-07, SEC-10, PRIV-05, PRIV-06, T3.1 verified |
| 3.3 | DONE locally: CSV analysis, stats, chart suggestions, and querying | packages/files/analyzer.mjs, 6 unit tests PASS in tests/unit/phase3-csv-analysis.mjs (19 Phase 3 tests total); FILE-04 verified on deterministic benchmark datasets and HTTP API endpoints |
| 3.4 | DONE locally: retention schedules, storage quotas, disk unlinking, and conversation purge | packages/files/retention.mjs, tools/phase3/retention.mjs, 4 unit tests PASS in tests/unit/phase3-retention.mjs (23 Phase 3 tests total); FILE-05, PRIV-05, T3.2 verified |
| 3.5 | DONE locally: AES-256-GCM encrypted backups, SHA-256 integrity, CLI tool, and clean restore | packages/backup, tools/phase3/backup.mjs, 4 unit tests PASS in tests/unit/phase3-backup.mjs (27 Phase 3 tests total); SEC-10, OPS-04, T3.3 verified |
| 3.6 | DONE locally: extended monitoring, bilingual status page, staging parity check, and operational incident runbooks | packages/admin, /api/status, status.html, tools/phase3/staging-check.mjs (8/8 PASS), docs/RUNBOOKS/ (6 runbooks, LEG-07 notification procedure); 5 unit tests PASS in tests/unit/phase3-monitoring-runbooks.mjs (32 Phase 3 tests total); OPS-05, OPS-07, OPS-08, LEG-07 verified |
| 3.7 | DONE locally: acceptance verification (T3.1–T3.3) and public-launch checklist | tests/unit/phase3-launch-verification.mjs (5/5 PASS), full Phase 3 suite (37/37 PASS), docs/PHASE3_GATE_REPORT.md; STOP: owner acceptance required before public release, deployment, or Phase 6 / Phase 4 start |

### Phase 6 — Payments before wider paid capabilities

| Step | Do this | Check |
|---|---|---|
| 6.1 | Build Plan Builder with price-share buffer and worst-model budget | Cost floor, rounding, all required fields, useful-size warning |
| 6.2 | Enforce snapshotted entitlements and all caps | Short packs usable; temporary throttles retain the pack; expiry/top-ups/rollover policy |
| 6.3 | Integrate gateway in test mode | Signatures, replay resistance, idempotency, correct entitlement |
| 6.4 | Build pack/usage UI, optional verification, user data export | Honest caps, countdowns, estimates, consent and ownership |
| 6.5 | Implement refunds and failure accounting | Customer refunds separated from provider costs |
| 6.6 | Track reserve fund and publish permitted aggregate cost data | Real ledger-backed totals |
| 6.7 | Reprice new sales and protect purchased snapshots | Existing promises preserved through funded routing or refund handling |
| 6.8 | Add two-person approval, recovery console, incident center | High-risk changes wait for required second approval |
| 6.9 | Verify T6.1–T6.9, request limited-pilot approval, run pilot, reconcile | STOP twice: BEFORE real pilot and AFTER results for wider payments |

### Phase 4 — Coding patch agent, without execution

| Step | Do this | Check |
|---|---|---|
| 4.1 | Build temporary workspaces and safe ZIP import | Path escape, symlink, zip-bomb, isolation, retention |
| 4.2 | Build state machine, allowed tools, parent budgets, bounds | T4.2/T4.3/T4.7; no double reservation or premature release |
| 4.3 | Enforce server-side policy and prompt-injection defenses | Red-team suite blocks regressions |
| 4.4 | Build plan approval, pause/resume/stop, live activity | No write before approval; terminal task cannot dispatch |
| 4.5 | Build diff review, checkpoints, undo, ZIP/patch download | Accepted state matches downloads; test claims use real evidence |
| 4.6 | Build keyboard/mobile workbench | Tree, editor, agent panel, diff view usable |
| 4.7 | Add permitted research API only when configured | Sources, SSRF protection, separate budget, injection defenses |
| 4.8 | Add agent/admin operations, audited break-glass, alerts and evaluation routing | Metadata-only moderation without break-glass; assigned Ph4 checks |
| 4.9 | Verify T4.1–T4.7 and current real-model readiness | STOP: owner approves agent mode |

### Phase 5a — Browser execution

| Step | Do this | Check |
|---|---|---|
| 5a.1 | Add origin-isolated Python/JavaScript runtime and preview | No platform tokens/cookies or parent DOM access |
| 5a.2 | Add agent run/test tools with risky-action approvals | Real test evidence; stop and approval enforcement |
| 5a.3 | Add task manager, parallel caps, authorized instructions, steering | T5a.1–T5a.3; imported/changed instruction files cannot self-authorize |

### Optional Phase 5b — Server sandbox

| Step | Do this | Check |
|---|---|---|
| 5b.1 | Build isolated, resource-limited, network-denied, funded sandboxes | T5.1–T5.4, concurrency, charging, redaction, cleanup |
| 5b.2 | Review report and propose limited rollout | STOP: owner authorizes users, scope, budget, and rollback |

Skip this entire branch for browser-only scope. Generated code never runs on the application host.

### Phase 7 — Grow only proven features

| Step | Do this | Check |
|---|---|---|
| 7.1 | Add GitHub import/PR integration after Phase 4 | Explicit repo consent, limited scope, audit |
| 7.2 | Publish expanded docs and monthly reliability/cost reports | Status page already exists from Phase 3; numbers reconcile |
| 7.3 | Add evaluation dashboard/history | Real scores inform routing |
| 7.4 | Add public API/webhooks | Authorization, rate limits, audit |
| 7.5 | Add separately tracked Sponsored Pool | Funding and spend reconcile |

## 4. What DONE means

Read the step's ownership in [REQUIREMENT_TRACEABILITY.md](REQUIREMENT_TRACEABILITY.md), execute its applicable checks, and attach evidence in PROGRESS. Planned check IDs are not passing tests. Documentation-only checks may be manual; executable-code checks include applicable lint/types/tests/security checks. Record approvals separately from technical completion.

LOCAL-PHASE2-001 / SRS17.1.4 authorizes the ordered local Phase2 start without treating deferred Phase1 checks as passed. **Next: Step2.6 Control Center foundation.** The owner subsequently requested Step2.5; its local implementation and verification are DONE. Full Step0.8 remains owner-deferred/NEEDS OWNER; existing thresholds/caps persist. Actual provider/Google/hosting, qualified legal/release evidence and original phase acceptance remain required for live/hosted completion. Synthetic success never establishes hosted GO.
