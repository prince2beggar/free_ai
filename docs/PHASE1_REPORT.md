# Phase 1 local implementation and acceptance report

Date: **2026-10-13, Asia/Dhaka**. Authorization: LOCAL-PHASE1-001 and [SRS Section 17.1.2](../srs/SRS_v2.1_AI_Workspace.md). **Steps 1.1–1.10 are technically complete for the authorized local synthetic series.** Hosted Phase 1 acceptance remains open. Local results establish application behavior, not real Google sign-in, model quality, eligible account quotas or hosted capacity.

Subsequent owner instruction: LOCAL-PHASE2-001 / SRS17.1.4 defers actual integrations and starts ordered local synthetic Phase2. [PHASE2_REPORT](PHASE2_REPORT.md) records completed Step2.1 and next Step2.2. This separate scope extension does not close the original acceptance gaps in this report.

The current updated isolated preview is **http://127.0.0.1:4176**; the earlier Step 1 preview remains on port 4174. Restart the normal synthetic launcher with `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase1` from the repository root (default port 4174; choose a free local port if occupied). Synthetic identities **Demo Alpha / Demo Beta** are shared fixtures, not private accounts. Normal launcher data stays under ignored `.phase1-local/database`; the isolated follow-up preview uses `.phase1-integration/local-staging-database`. The original memory-only Step 1.1 preview remains available on port 4173.

**P1-PREHOST-001 follow-up:** [the integration guide](PHASE1_INTEGRATION_GUIDE.md) documents configured Google Web OAuth on loopback, the guarded Groq fixed-suite test runner, privacy-preserving request logs and local-draft-v2 notices. Independent review closed four findings: actual prompt/system hash binding, first-call TPM admission, repeated-deletion tombstone stability and expiry after durable reservation. Actual Google/provider credentials and concrete account scope remain absent; no real model call or Google sign-in was performed. Hosting/domain are explicitly owner-deferred.

## Step completion

| Step | Local implementation / evidence | Remaining original hosted acceptance |
|---|---|---|
| 1.1 | Strict TypeScript client, modular Node server, pinned runtime/dependencies, lint/formatter/tests, fail-closed environment validation and a configured CI workflow | Real hosted app/PostgreSQL/gateway compose and CI deployment NOT RUN |
| 1.2 | PostgreSQL-compatible PGlite, checksummed up/down migrations, idempotent synthetic seed; required eight tables plus routing, request, consent/state and deletion records; 10 database tests PASS; file-backed close/reopen PASS | Hosted PostgreSQL driver/roles, operational backups and scale remain future evidence |
| 1.3 | Server-managed hashed-token sessions/CSRF/consent/logout/deletion; configured Google HTTP start/callback with PKCE/state/nonce/JWT and session rotation tested with injected signed identities; demo login disabled in Google mode | Actual Google project/client/consent and real sign-in NOT RUN; synthetic default stays disabled for external auth |
| 1.4 | One enabled synthetic gateway, normalized stream, health, exact persisted synthetic provider/model, zero retries/fallbacks; no key reader or network model adapter in the running application | Eligible real provider/account/key/model/expiry missing; real reply NOT RUN |
| 1.5 | Owned persisted conversation create/reopen/rename/delete, bounded SSE, cancellation/disconnect/error cleanup, idempotency, ordered history, routing records and estimated synthetic usage; backend regressions PASS | Actual vendor token/price/latency evidence NOT RUN |
| 1.6 | Responsive chat, EN/BN sample input/output/status, saved conversations, model disclosure, stop, account/usage controls and linked legal drafts; desktop/360 px Edge flow PASS; hostile markup rendered as text | Full translated interface, localized numbers/dates, screen-reader/contrast audit and mobile 4G performance target remain unverified |
| 1.7 | Atomic daily/concurrency admission, IP/user/endpoint rates, request/body/input/context/output bounds, timeouts and durable storage admission caps; direct API negative/race tests PASS | Real account RPM/TPM/daily/shared-pool capacity belongs to the deferred provider evidence and Phase 2 |
| 1.8 | Versioned local-draft-v2 Terms, Privacy, AUP, Cookies and Refunds; v1 history retained; optional Google subject/name and separate scoped Groq evaluation processing disclosed | Qualified legal/provider/region/audience review before public use remains required |
| 1.9 | Headers, CSRF/authorization/IDOR, error/bundle/static boundary tests, locked dependency/license/integrity review, SBOM, npm advisory audit and secret scan; security findings/dispositions below | Remote CI has not executed; container scan N/A without an image; hosted TLS/roles/OS/WASM inventory and complete release review remain pending |
| 1.10 | Actual persistent loopback staging starts; seven page/health checks and authenticated saved synthetic stream/provenance/delete/logout PASS; acceptance matrix below | Owner staging acceptance and original real Google/model/hosted checks remain open; no Phase 2 opening is inferred |

## T1.1–T1.4 and requirement evidence

| Check | Actual local result | Evidence limit |
|---|---|---|
| T1.1 | PASS: local sign-in, saved conversation, progressive synthetic reply, reopen and actual synthetic routing identity | Real Google/provider end-to-end variant NOT RUN |
| T1.2 | PASS: private APIs reject unsigned requests; two synthetic users cannot read, alter or delete each other's conversations; revoked sessions fail | Shared demo identities are a local fixture only |
| T1.3 | PASS: built client has no server/credential configuration; allowlisted static files cannot expose `.env`, database, dependency or server files | No real key exists in this test scope |
| T1.4 | PASS: User A cannot read User B's conversation by changing its ID; update/delete/send ownership negatives also pass | Verified with two separate synthetic users, not two sessions of the same shared demo identity |

The [traceability matrix](REQUIREMENT_TRACEABILITY.md) remains the canonical requirement ownership map. These are scoped results, not blanket release acceptance:

| Requirements | Evidence / disposition |
|---|---|
| AUTH-01–04, AUTH-07 | Local profile/session/consent/usage/logout/deletion and signed synthetic OIDC tests PASS. Actual Google onboarding and HTTPS Secure-cookie deployment NOT RUN. Google identity is not used as unique-person proof |
| REG-03, ROUTE-01, ROUTE-06, CHAT-01/02/06/07 | Synthetic gateway/API/UI tests PASS; every saved assistant message identifies its actual synthetic route. No research candidate is enabled; real credentials/model transport NOT RUN |
| QUOTA-02, SEC-02/03/04/07, OPS-02 | Direct server bounds, transaction/concurrency/idempotency, CSRF/ownership/rate/error tests PASS; no reliance on client limits |
| PRIV-01/02/04, AUP-01, LEG-01/05 | Draft copy links and independent product branding reviewed locally. Full prompts live in owned chat records, not operational/audit logs; no external model processor is active. Public/legal review pending |
| SEC-01 | No credential value is accessed. Future rotation procedure: disable the route, revoke/replace the credential in approved server secret storage, update only its reference, verify within an explicit scope, then re-enable. This procedure has no live execution evidence |
| SEC-05 | Local CSP, frame denial, no-referrer, MIME protection and cache boundaries checked. HTTP loopback intentionally has no HSTS or Secure session cookie; hosted HTTPS settings NOT RUN |
| SEC-06, OPS-01 | Pinned CI workflow includes secret/dependency checks, unit/browser/security tests and SBOM; remote execution/deployment NOT RUN. Disposable migration down/up and local restart/persistence verified; container/host rollback NOT RUN |
| OPS-03, OPS-09 | Local architecture has no paid overages, external model calls, weight downloads or host inference. Vendor spending controls and all-in host budget remain unverified |
| NFR-02/03 | Progressive local stream tested; formal provider-relative timing and phone/4G LCP NOT MEASURED |
| NFR-06/07/08 | Keyboard labels/focus, EN/BN sample rendering and 360 px layout checked. Full WCAG/contrast/screen-reader and complete translation/date/number coverage pending |
| NFR-10/11/12 | Chat stream/error responses carry request IDs; launcher emits only generated correlation ID, fixed surface/method/status/duration with a privacy regression. Modules have no required cloud account in default mode; UI discloses synthetic results and changeable models/quotas/provider terms. Hosted observability/portability not demonstrated |

## Original local-series verification snapshot

| Command / check | Result |
|---|---|
| `tools/prototype.ps1 -Task phase1-check` | PASS: strict types, ESLint, Prettier, build, 5 original prototype unit tests, 35 Phase 1 unit tests and 2 security tests |
| `python -B -m unittest discover -s tests/unit -p 'test_*.py'` | PASS: 43 existing evaluator/calculator unit/CLI tests |
| `tools/prototype.ps1 -Task phase1-browser` | PASS: 1 Edge desktop/mobile test with two-user isolation, persisted CRUD, EN/BN, cancellation, escaped hostile markup, usage, deletion/revocation and legal navigation |
| `tools/prototype.ps1 -Task browser` | PASS: 1 original prototype browser regression |
| Automated total | **87 tests PASS**; launcher HTTP smoke and disk close/reopen are additional recorded manual checks |
| Actual executable launcher and HTTP smoke | PASS: port 4174, `/`, `/health`, all five legal pages, local authenticated synthetic stream/reopen/provenance/delete/logout |
| Persistent PGlite close/reopen | PASS: an owned synthetic conversation survives closing and reopening a separate ignored `.phase1-test/persistence-*` database |
| `tools/prototype.ps1 -Task audit` | PASS: npm reported **found 0 vulnerabilities**, explicitly including development dependencies; limited to that advisory response |
| Registry integrity/license inventory | PASS: all **82 registry packages** match official HTTPS exact-version metadata. MIT 55, Apache-2.0 15, BSD-2-Clause 6, BSD-3-Clause 1, ISC 4, BlueOak-1.0.0 1; bundled notices retained |
| `tools/prototype.ps1 -Task phase1-sbom` | PASS: [local Phase 1 SBOM](phase1-sbom.json), separate from the historical prototype graph; [dependency evidence](phase1_dependency_evidence.json) |
| `tools/scan-secrets.ps1` | PASS: no secret findings in working tree, including new source and ignored local data; redacted pinned scanner |
| Final record/integrity checks | PASS: 19 UTF-8 Markdown files, 95 local links, balanced fences, all 64 step IDs, 189 requirement rows, five-line handoff, 82-package/83-component SBOM match, six private-path ignore checks, 13 protected artifact hashes and 44,865-byte historical decision prefix preserved; four PowerShell tools parse; CI YAML formatter check PASS |

Windows browser screenshots are under ignored `.tools/phase1-preview/desktop.png` and `mobile.png`; they contain synthetic test content. The CI workflow is configured in `.github/workflows/phase1-local.yml` with pinned official action commits and a checksum-pinned Gitleaks 8.30.1 Linux download. It has **not** run on a remote repository. No commit, push, remote message or hosted deployment occurred.

## Pre-host integration follow-up verification

P1-PREHOST-001 checks executed on 2026-10-13: `phase1-check` PASS (types/lint/formatter/build, 5 original prototype unit + **45 Phase 1 unit** + 2 security); existing Python tests 43 PASS; Phase 1 and original Edge browser tests 1 each PASS. Current total **97 automated tests PASS**, with no live credentials/model/Google-account use. The auth/scoped-Groq adapter coverage run reuses 12 tests: **100% line, 85% branch, 91.11% function coverage** across those two files; it does not measure future router/ledger/agent modules or establish live correctness. CI now configures that threshold check but has not run remotely.

Independent follow-up review ran the Google/provider/observability tests and closed all four identified findings: frozen payload binding, first-call account TPM, repeat-deletion hash stability and post-I/O expiry. No remaining actionable finding was reported in those reviewed paths; this does not substitute for real account/host or complete UI/public-release review.

The updated persistent isolated preview on **127.0.0.1:4176** passed seven page/health checks, draft-v2 links, request-ID headers and authenticated synthetic chat/reopen/provenance/delete/logout. Basic palette review initially found muted text/focus contrast below the target on pale backgrounds; colors were darkened. Nine palette pairs now have minimum text **4.808:1** and focus **4.038:1**, with primary button **7.411:1**. Browser regression verifies the final layout; full screen-reader/WCAG, complete translations/date/number formatting and phone/4G/provider-relative timing remain unverified.

The no-call readiness command returns **NEEDS_ACCOUNT_AND_SCOPE**, `modelCallsMade=0`, `credentialsRead=false` and `hostDomain=OWNER_DEFERRED`. Actual Google client/account, eligible provider model/limits/free-only/expiry/tokenization and review evidence remain missing; ordinary chat is still synthetic. Full Phase 1 has not been marked accepted. See PHASE1_INTEGRATION_GUIDE for the concrete owner setup and later hosting sequence.

Final follow-up record checks PASS: clean working-tree secret scan (including ignored local data), 20 UTF-8 Markdown files/101 local links/balanced fences, 64 preserved step IDs, 189 requirement rows, five-line HANDOFF, five private-path ignore probes, four PowerShell tools parsing, 13 unchanged protected hashes and 44,865-byte historical decision prefix. No new dependency was added; the reviewed 82-package local graph and historical SBOM remain intact.

## Review findings and storage controls

Independent backend/security review found a real history-ordering bug: equal timestamps plus random UUID sorting could display an assistant before its user and reverse gateway context. The migration now uses an identity `sequence_no`; deterministic equal-time/reversed-UUID regressions pass. Focused independent re-review closed this finding. Browser testing also found an EN/BN cancellation status race; stop-request tracking fixes it. A final reload regression exposed input controls becoming usable before saved history finished loading; initialization now holds the nested busy state throughout restoration, and the browser test deliberately pauses the history request to verify controls stay disabled. Final verification includes both fixes.

Review raised durable history growth. Local admission now caps audit history at **5,000 rows** and usage history at **2,000 rows**, reserving terminal evidence slots so logout, account deletion and pending-job settlement still work. Two dedicated transactional tests verify rollback and these reserves. The new guard and final UI were manually reviewed by the root agent; extra independent UI/follow-up review could not run because the reviewer execution allowance was exhausted. Do not treat that unavailable review as a passing result.

**Audit/usage expiry is deferred.** Automatic approval review rejected a generic SQL session flag that would let application SQL bypass append-only protection. Actual embedded-engine role probes also failed to establish a separate privileged retention boundary. The safe implementation preserves immutability and reports the deferral explicitly. The bounded cleanup job removes expired/revoked sessions, expired OAuth states and eligible deletion metadata/tombstones; it never deletes audit or usage rows. Thirty days is a configured future evidence-retention target, not an applied expiry promise. Deleting a chat/account does not reset daily usage or retained evidence.

The current bounded local server can stop accepting mutations with `LOCAL_STORAGE_FULL`. Stop testing and review synthetic data when this occurs; do not raise caps or add a SQL bypass to simulate production readiness. A hosted PostgreSQL role-separated retention design and matching privacy/legal decision are needed before claiming evidence expiry. Account/chat content deletion works immediately; minimal pseudonymous audit/usage evidence remains as disclosed.

Other defaults in `packages/api/defaults.json`: 20 requests/user/Dhaka day, one active request/user, eight global, 2,000 input characters, 12,000 context characters/40 messages, 512 estimated output tokens, 16,384-byte body, 10-second request/job timeout and one-hour sessions. These are local safety settings, not vendor token quotas or a production capacity promise.

## Next steps in order

1. Use the local preview with synthetic text and review its behavior. All authorized local 1-series implementation is complete; hosted phase acceptance remains open.
2. When you are ready, create the deferred eligible free test account, keep the key local, and supply only the concrete EVAL-SCOPE details already listed in [EVAL_REPORT.md](EVAL_REPORT.md). Existing approved thresholds/caps/stop rules stay in force; no repeat approval is needed for them.
3. Supply a real Google OAuth project/client/allowed redirect setup through approved local secret storage. Verify exact intended environment and real login before enabling external sign-in.
4. Complete real-model evaluation and eligibility, audience/regions, actual quotas/capacity, bounded hosting and selected-stack/legal/retention review. Then re-evaluate [the hosted Phase 0 gate](PHASE0_GATE_REPORT.md).
5. When resumed, run the original real Google/model/hosted T1 checks on an approved staging target and record owner acceptance before full live/hosted Phase2 acceptance. The later LOCAL-PHASE2-001 / SRS17.1.4 exception already permits ordered local synthetic Phase2. Public launch and payments remain later gates.
