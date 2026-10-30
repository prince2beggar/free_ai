# Open Questions

Updated: 2026-10-13. Steps 0.1–0.7, the Step 0.9 report and local 1.1–1.10 implementation are technically complete. LOCAL-PHASE1-001 extends the local CHANGE-SHAPE / SRS 17.1.2 and accepts recommended defaults; local permission questions are resolved. [PHASE1_REPORT.md](PHASE1_REPORT.md) records 87 passing tests and the remaining external/release checks. Full Step 0.8 remains NEEDS OWNER with account setup deferred; [the hosted gate](PHASE0_GATE_REPORT.md) stays NO-GO pending evidence. D2=100, D3=BDT 1,500/month and five requests/day ASSUMED remain unchanged.

| ID | Needed decision/evidence | Needed before | Owner |
|---|---|---|---|
| D4 | Research candidates chosen: Gemini, GroqCloud, OpenRouter, Workers AI. Approve an intended-use/tier/model shortlist after resolving matrix conditions | Before a provider is treated as eligible/enabled | Project owner |
| D10 | Target regions (Bangladesh-only or additional markets) | Terms/legal feasibility | Project owner |
| EVAL | Offline 45-case suite/harness is complete with 43 passing unit/CLI tests. EVAL-APPROVAL-001 resolves threshold approval and records supplied caps/stop rules. Resolve concrete EVAL-SCOPE fields, EVAL-REVIEWS/EVAL-FUNCTIONAL; no real-model quality is proven | Step 0.8 real calls / quality acceptance | Project owner; agent supplies evidence |
| TERMS | Public terms/privacy/quota review recorded in PROVIDER_TERMS_MATRIX; unresolved intended-use permission, exact account controls, and model terms remain | Phase 0 gate | Agent supplies sources; owner/advisor reviews decisions |
| PRICING | Sourced observations are in pricing_inputs.json; Step 0.5 calculator verifies hypothetical arithmetic and audits evidence only. Actual settlement FX, all-in fees/taxes, contracts, model classes and billing semantics remain unverified; all feasibility/pack-sale flags are false | Verified financial claims/gate; refresh before Ph6 | Agent researches; owner approves financial choices |
| LEGAL | Step 0.6 public-source dependency/license review complete; applicable project legal obligations, chosen-artifact obligations and required advisor approval remain pending; see DEP-LICENSE | Phase 0 gate / public launch | Owner and qualified advisor |
| D1/D8 | Local defaults adopted: independent Free AI Workspace branding and 30-day metadata retention targets; chat/account content deletion immediate, audit/usage expiry deferred and disclosed. Final public branding/legal/retention decision remains | Hosted/public release | Project owner/advisor; agent implements verified controls |
| D9 | Second admin/recovery contact | Phase 2 | Project owner |
| D6/D11/D12/D13 | PAYMENT-001 defers activation, with SSLCommerz first contract candidate and direct bKash/Nagad alternatives. Owner's actual merchant/business/gateway/startup-funding choice, reserve/buffer, model classes/pack points and rollover remain unresolved | Phase 6 | Project owner |
| D7 | Free-agent access policy | Phase 4 | Project owner |
| D5 | SANDBOX-001 proposes browser-first later execution; final owner runtime/scope choice remains pending. Resolve Pyodide/MPL/packages and WebContainers commercial terms; optional server execution stays DEFERRED, not SKIPPED, pending separate funding/host/isolation evidence | Study Ph0; confirm Ph5a/5b | Project owner |

Research may proceed without credentials. Record TODO-VERIFY for unconfirmed facts; required unknowns block the matching gate, not unrelated work.

**GATE-OWNER/local recommendations resolved:** LOCAL-PHASE1-001 authorizes the entire local 1-series and supersedes the earlier Step 1.1 implementation stop. Do not request local/default approval again. Real integrations and hosted acceptance retain their actual evidence requirements; provider setup remains owner-deferred.

## Provider-specific follow-ups from Step 0.2

All rows are TODO-VERIFY unless resolved by a new dated decision/evidence record. Source and clause locations are in PROVIDER_TERMS_MATRIX.md. Research did not authorize contacting providers or using accounts.

| ID | Missing evidence/decision | Needed before | Owner |
|---|---|---|---|
| D-AGE | Define audience ages and age controls; review provider-specific consumer/student fit | Provider shortlist / public launch | Project owner/advisor |
| PROV-GEMINI-FIT | Intended workspace fits Gemini business/consumer, age, region and API-sublicensing restrictions | Gemini eligibility | Owner/advisor; provider confirmation if needed |
| PROV-GEMINI-LIMITS | Exact free project/model RPM, TPM, RPD/TPD; billing unlinked; active project counters | Capacity math / authorized evaluation | Owner supplies scoped account evidence |
| PROV-GROQ-FIT | Customer-app grant reconciled with resale/competing-service limits; chosen model terms reviewed | Groq eligibility | Owner/advisor; provider confirmation if needed |
| PROV-GROQ-LIMITS | Exact Free organization/model limits and reset semantics; public tab/exception ambiguity resolved | Capacity math / authorized evaluation | Owner supplies scoped account evidence |
| PROV-GROQ-PRIVACY | Chosen account ZDR/retention and consent settings match the requested sensitivity | Private routing | Owner supplies scoped settings evidence |
| PROV-OR-FIT | Intended multi-provider service fits integrated-app rights and §7(4) competing/API-resale restrictions, or written permission obtained | OpenRouter eligibility | Owner/advisor; provider confirmation if needed |
| PROV-OR-TIER | Resolve Free API versus prepaid terms, credit expiry versus blog claims, exact account daily/minute/token counters and reset | Capacity/billing claims | Owner/provider documentation evidence |
| PROV-OR-PRIVACY | Free data-policy routing availability versus documented controls; chosen endpoint training/retention and logging opt-ins | Private routing | Owner/provider documentation evidence |
| PROV-CF-FIT | Intended derived app use covered by applicable Cloudflare agreement; model-specific licenses and regional eligibility reviewed | Workers AI eligibility | Owner/advisor |
| PROV-CF-MODEL | Current free-eligible tool model, model-specific neuron/token rates, shared account counter/reset, and paid-model exclusion | Capacity math / authorized evaluation | Owner supplies scoped evidence; agent reviews current catalog |

## Pricing-specific follow-ups from Step 0.3

All rows are TODO-VERIFY. The JSON records source URLs/date and distinguishes public observations from project-specific eligibility and contracts. Step 0.3 is a completed research artifact; these unknowns still block the matching financial or provider gate.

| ID | Missing evidence/decision | Needed before | Owner |
|---|---|---|---|
| FX-SETTLEMENT | Choose permitted provider-payment method/issuer; verify settlement-date USD/BDT rate, FX/acquisition fees and refund conversion. Bangladesh Bank/EBL references are not an approved project rate | All-in provider cost / financial feasibility | Owner supplies scoped issuer/account evidence |
| PRICE-MODELS | Choose model classes and exact provider/tier/endpoints; confirm account access, hidden-reasoning billing and worst-case prices for every allowed fallback. OpenRouter Chutes price is endpoint-specific; Gemini announced 2027 rates must use the correct date | Calculator funding claims / registry enablement | Owner selects; agent verifies current evidence |
| PRICE-TOOLS | Source every enabled search/code tool, caching/storage, batch/flex or non-text surcharge; optional paths remain excluded while unknown | Optional-cost routes / financial feasibility | Agent researches authorized scope |
| PRICE-TAX | Applicable provider/gateway/foreign-card taxes, tax inclusion, withholding and other acquisition charges | All-in cost / pack sales | Owner/account evidence and qualified advisor |
| PRICE-PROVIDER-BILLING | Provider plan/subscription charges, invoice currency, acquisition costs and billing rounding; Cloudflare token equivalents are rounded and its paid base plan/hosting costs are outside inference rates | All-in cost / pack sales | Agent researches; owner supplies account evidence |
| PRICE-OR-CREDITS | Credit-purchase minimum, gross/net basis, rounding and plan-specific terms; do not apply platform fee again per request. Business minimum fee remains unknown | OpenRouter paid feasibility | Owner/account or checkout evidence; agent reviews sources |
| FEE-SSLCOMMERZ | Project-specific Basic quote, fixed/minimum fees, rounding, VAT/tax inclusion, renewal, settlement, reserves, refund fee/original fee return, chargebacks and supported small pack amounts. Published setup fee is separate startup funding | Gateway choice / pack sales | Owner supplies merchant quote/contract |
| FEE-BKASH | Direct online PGW merchant contract covering percentage/fixed/minimum/setup/maintenance fees, tax, rounding, refunds and settlement; QR/PRA/consumer rates cannot substitute | Direct bKash choice / pack sales | Owner supplies merchant quote/contract |
| FEE-NAGAD | Direct online merchant PGW contract covering percentage/fixed/minimum/setup/maintenance fees, tax, rounding, refunds and settlement; consumer/aggregator rates cannot substitute | Direct Nagad choice / pack sales | Owner supplies merchant quote/contract |

## Capacity-specific follow-ups from Step 0.4

The owner authorized conditional calculations with missing quotas flagged. CAPACITY.md contains the completed planning artifact; these TODO-VERIFY items prevent a verified 100-user capacity/hosting claim. D2/D3 values are recorded in CAPACITY-001 and must not be requested again unless the owner revises them.

| ID | Missing evidence/decision | Needed before | Owner |
|---|---|---|---|
| CAP-QUOTAS | Exact permitted account/tier/model limits and remaining daily request/token/Neuron budgets; RPM/TPM and split limits, pool identities/overlap, reset metadata, other workloads, no-overage billing and context/output/concurrency constraints | Verified capacity / Phase 0 gate | Owner supplies scoped credential-free dashboard evidence; agent checks provider-specific conditions |
| CAP-TRAFFIC | Measure input including history/context, billed output/reasoning, attempts/failures, daily requests/user and peak-minute shape; replace assumed five requests, token profiles, retry factor and peak share | Verified target support / ongoing recomputation | Owner pilot observations; authorized evaluation evidence |
| CAP-HOSTING | HOST-001 records one-VPS preference and conditional BDT 1,190.36/1,398.44/1,502.47 sensitivities. Confirm an eligible available host with all-in app/database/storage/backups/bandwidth/logging/domain charges <= BDT 1,500 and enforced bounds; reference price fit is not an approved quote | Phase 0 host gate / purchase or deployment | Agent supplies evidence; owner approves final plan |
| CAP-TARGET-GAP | Confirm an eligible model/pool mix that supports 100 users; medium/high conditional reference bounds are 35/16 and retries/outages shrink capacity. Revised allowance/target/scope needs a new owner decision | Verified capacity / Phase 0 GO | Owner decides after evidence; agent recalculates |
| CAP-FX-FRESHNESS | October 13 effective FX was not found in retrieved official pages; October 12 reference rates were re-read October 13. Verify settlement-date FX for any funded hosting/provider choice | Funding/hosting decision | Agent refreshes sources; owner supplies chosen issuer evidence |

## Dependency-specific follow-ups from Step 0.6

The public-source review and current bounded local graph review are complete; Node/PGlite/JOSE and the local tool graph are installed within LOCAL-PHASE1-001. Hosted-stack/image/OS/WASM and release dispositions below remain TODO-VERIFY. Excluded/deferred choices do not block unrelated local work. Sources, versions and findings are in [DEPENDENCY_REVIEW.md](DEPENDENCY_REVIEW.md).

| ID | Missing evidence/decision | Needed before | Owner |
|---|---|---|---|
| DEP-ARTIFACTS | Select exact canonical artifacts/versions and approved scope; refresh release/advisory evidence, verify hashes/provenance, capture lockfiles/SBOM and scan transitive/vendored/image/OS/WASM packages. Resolve LiteLLM supply-chain and selected-artifact findings; root licenses and zero repository records are not full audits | Dependency adoption; SEC-06/LEG-04 and release gates | Agent supplies evidence; owner approves scoped adoption |
| DEP-LICENSE | Preserve notices/NOTICE/change notices and applicable covered-source access; review exact copied modules and bundled licenses, Pyodide MPL/package duties, LiteLLM enterprise rights, Redis license choice and WebContainers runtime entitlement/price. Open WebUI and Dify stay excluded under current reuse direction; changing it requires a new dated decision | Affected reuse, Phase 0 legal gate and public launch | Owner/advisor; agent supplies sources |
| DEP-COMPAT | Choose/test supported Node/framework/React/auth/compiler graph; resolve Next.js SSRF incomplete patch mapping or applicable configuration mitigation, Auth.js optional vulnerable-range core peer and stable/beta choice, and TypeScript major compatibility. Record exact applicable security dispositions rather than latest-version assumptions | Step 0.7 proposals; Step 1.1/1.3 adoption | Agent supplies evidence and integration checks; owner reviews material unresolved risk |
| DEP-RUNTIME | Select a patched supported Python distribution for future CI/deployment/untrusted-file handling; existing 3.11.9 remains bounded local offline tooling only. For optional execution, verify browser origin/package/network controls or funded Linux/KVM/host/kernel/guest isolation and T5 checks; no generated code on app host | Future CI/runtime adoption; D5 / Phase 5a or optional 5b | Agent researches/validates authorized scope; owner approves funding and rollout |

## Hosting and stack follow-ups from Step 0.7

HOST-001/DB-001/STACK-001/GATEWAY-001/SANDBOX-001/PAYMENT-001 are completed planning records, not signed service/merchant contracts or final adoption approval. These TODO-VERIFY conditions continue into the matching Phase 0/implementation/launch gates; existing D2/D3 amounts must not be requested again.

| ID | Missing evidence/decision | Needed before | Owner |
|---|---|---|---|
| HOST-QUOTE | Verify acceptable host/region and Bangladesh account/payment eligibility, actual plan availability, CPU/OS compatibility, currency, checkout/renewal/startup costs, issuer FX and taxes/fees. CX23 public page renders unavailable; OVH alternative is future-labelled/from-price. Quote the proposed BDT 150 auxiliary envelope rather than assigning domain/offsite/other charges zero | CAP-HOSTING acceptance / scoped purchase | Agent researches public facts; owner supplies scoped credential-free quote and approves choice |
| HOST-SPEND | Verify fixed resources and contractual caps or implement/test enforceable outbound/storage/resource admission. Hetzner traffic emails do not stop billed overage; powered-off instances/unassigned IPs can continue billing. R2's allowances are not a spend cap; actual shared account usage and linked products remain unknown | Bounded hosting claim / deployment | Agent designs/validates controls; owner approves actual resource scope |
| HOST-OPERATIONS | Confirm who handles patches, database consistency, encrypted independent backups/keys, restore and incident recovery, approved data region/retention and operator capacity. Measure colocation RAM/CPU, streaming/disconnect/queue behavior and storage growth; snapshots/free managed restore windows do not establish OPS-04 | Host/data adoption; tests at owning phases before public launch | Owner/operator and agent; advisor for applicable data obligations |

STACK-001 confirms the planning direction only. Existing DEP-ARTIFACTS/DEP-LICENSE/DEP-COMPAT/DEP-RUNTIME cover final version/driver/ORM/queue/TLS/packaging review; no additional package or security waiver is approved here. LEG-02 advisor disposition, LEG-06 merchant requirements and all provider/financial/capacity gates remain unresolved.

## Evaluation-specific follow-ups from Step 0.8

Offline preparation is complete. **EVAL-THRESHOLDS is resolved** by EVAL-APPROVAL-001; do not ask again. Supplied numerical limits and stop rules are recorded, while placeholder target/account/key/environment/free-only/expiry fields keep full Step 0.8 NEEDS OWNER. Stub/imported declarations cannot prove real quality or enable a registry flag. Remaining rows are TODO-VERIFY until resolved by actual dated scope/evidence.

| ID | Missing approval/evidence | Needed before | Owner |
|---|---|---|---|
| EVAL-SCOPE | Owner confirms no account/key ready and defers setup until later. When resumed, set up one eligible Free account personally (optional Groq guidance in EVAL_REPORT), then supply actual provider/model, terms/account limits/dates, key variable name, local/staging, Free/no-overage evidence and Asia/Dhaka expiry. Accepted: 45 total calls, 4K input/1,024 output each, no retries/fallbacks, BDT 0, synthetic only; stop/report on any cost signal, 4xx/5xx or quota warning. Do not re-ask these limits | Specific adapter/key access and real dispatch | Owner sets up/supplies concrete scope; agent verifies docs/limits/enforcement |
| EVAL-REVIEWS | Real response provenance, model/version sources, dated request/usage/latency/cost or explicit unknowns, complete factual/instruction/Bangla/English reviews and failure coverage. Keep raw captures private/ignored; commit redacted summaries only. No model self-grade or cherry-picking | Chat-quality acceptance and registry score use | Agent captures approved evidence; suitable reviewer supplies judgments |
| EVAL-FUNCTIONAL | Select/authorize isolated Python/JS/TS/SQL functional checks, compiler/DB/runtime versions, resource/network/timeout/data/cost bounds and actual results for coding artifacts. The harness performs syntax/format only and never runs candidate code; D5 execution/license/funding conditions remain | Real coding-quality/agent branch acceptance | Owner approves scope; agent/reviewer verifies executed evidence |

## Remaining Phase 1 external and release evidence

These questions are recorded after all authorized local implementation. They do not require re-approving local recommendations or the existing evaluation thresholds/caps.

| ID | Missing evidence | Needed before | Owner |
|---|---|---|---|
| AUTH-LIVE | Google HTTP routes/config/session flow implemented and independently reviewed with signed synthetic transport. Actual Google Web client/consent/test user and exact loopback callback 127.0.0.1:4175 remain owner setup; real sign-in/logout/deletion NOT RUN. Never paste secret values | Real Google verification / original T1.1 | Owner supplies setup; agent verifies within scope |
| RETENTION-PRIVILEGE | Separate privileged PostgreSQL retention connection/role that application SQL cannot assume, bounded expiry procedure and privacy/legal disposition. Generic SQL flag bypass was rejected; local audit/usage remain immutable with admission caps | Claim audit/usage expiry / hosted release | Agent supplies isolation design; owner/advisor reviews retention |
| P1-REVIEW | Independent final UI/storage-cap follow-up unavailable after reviewer allowance was exhausted; root manual review and tests are recorded, not substituted as independent results | Complete hosted release review | Agent/reviewer |
| P1-STAGING | Owner explicitly will supply host/domain later and now defers actual integrations. Updated local synthetic preview is at 127.0.0.1:4176. Real Google/eligible-model T1.1 and hosted CI/migrations/rollback/image/capacity/acceptance remain future evidence. LOCAL-PHASE2-001 / SRS17.1.4 independently authorizes local synthetic Phase2 | Close original live/hosted Phase1 / live Phase2 acceptance | Owner supplies accounts, later host/domain/acceptance; agent implements/tests |
| P1-NFR | Complete UI translations/localized numbers/dates, WCAG/contrast/screen-reader, phone/4G LCP, provider-relative streaming performance and hosted operational evidence | Hosted/public release | Agent supplies measurements/review |

P1-PREHOST-001 completes the independent integration code/security preparation. The fixed-suite provider runner requires the concrete scope and separately reviewed digest, exact-model token evidence and sufficient per-call account TPM; it never enables ordinary real-model chat or promotes unreviewed captures. No-call readiness currently returns NEEDS_ACCOUNT_AND_SCOPE with credentialsRead=false. New request logs are privacy-preserving and correlation tests pass; auth/scoped-adapter coverage exceeds the 70% local target. Follow [PHASE1_INTEGRATION_GUIDE](PHASE1_INTEGRATION_GUIDE.md); qualified legal judgment and actual account/host evidence remain unverified.

LOCAL-PHASE2-001 starts local Phase2 while external checks stay owner-deferred. Steps2.1–2.5 are complete locally; [PHASE2_REPORT](PHASE2_REPORT.md) records 166 Phase2 + 52 regression + 9 browser checks PASS (227 unique); Abuse 98.86% lines/84.8% branches/100% functions. The earlier execution/review usage blocker recovered; final local implementation checks and independent findings are closed. All four research providers remain disabled, actual quotas/reset semantics/tokenization/context/rates/quality unknown. Fixture expected-user/token conversion/rates/caps are synthetic assumptions. Staff identity/MFA2.6, simulator/alert screens and actual delivery2.8, private routing2.9, T2 verification/owner acceptance2.10 remain future. The equivalent local proof-of-work does not prove a unique human; actual anti-bot effectiveness/mobile costs, pseudonym retention/deletion, hosted HMAC backup/rotation and public release review remain unknown. Hosted durability/privilege/backup, actual provider usage/headers/FX/payment and qualified legal evidence remain open.
