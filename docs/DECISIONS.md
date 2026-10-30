# Decisions

## DOC-001 — Canonical documents and corrected execution protocol

Date: 2026-10-12.
Authorization: owner requested fixing the reviewed problems and providing a first/second/next build guide.

Choice: keep `srs/SRS_v2.1_AI_Workspace.md` as the canonical SRS (content version 2.1.1) and `protocol/AGENT_OPERATING_MANUAL.md` as the canonical manual (version 1.1). Root AGENTS/CLAUDE files are pointers. Preserve existing requirement and step IDs; split browser/server execution gates. Use the default serial order 0 → 1 → 2 → 3 → 6 → 4 → 5a → optional 5b → 7, with SRS P2 exceptions.

Reason: remove contradictory accounting, pricing, release scope, trust, and dependency rules; provide one reviewable build sequence. Explicit user authorization covers these documentation corrections.

Scope: documentation and planning setup only. No feasibility GO, provider/credential authorization, budget, hosting purchase, launch, sandbox activation, or real-payment approval has been granted.

Revisit: owner records a permitted phase-order choice or evidence from Phase 0 requires a scope amendment. Append a new record; do not rewrite past decisions.

## BOOT-001 — Repository bootstrap and local secret scanner

Date: 2026-10-12.
Authorization: owner explicitly requested completing the unfinished repository bootstrap (Step 0.1).

Choice: initialize Git on main without committing or adding a remote; preserve empty future application/package/test folders with .gitkeep; add README, empty environment template, ignore rules and LF normalization. Adopt checksum-pinned Gitleaks 8.30.1 as local development tooling under ignored .tools; record its review in DEPENDENCY_REVIEW.

Git execution detail: sandbox-created .git ownership caused normal Git commands under the user's account to reject the repository. An attempted local ownership correction was denied by Windows permissions. Approved host execution added one exact safe.directory entry, D:/free_ai, to that account's Git configuration; no wildcard trust or user identity setting was added. Sandbox command startup still reported setup-refresh errors, so checks ran through approved host execution.

Evidence: both PowerShell scripts parse; executable version/hash and official archive checksum match; the working tree scans clean; a temporary synthetic secret causes exit 1 without disclosure and is removed; bootstrap shape, Git ignores, empty env, links, and planned steps pass. App dependencies, running services, provider traffic, spending, and deployment remain outside this step.

Revisit: refresh tool/version pins only after official-source and dependency review. Add CI/history scanning in Phase 1; obtain owner inputs before dependent feasibility work.

## RESEARCH-001 — Initial provider shortlist for Step 0.2

Date: 2026-10-12.
Authorization: owner requested starting Step 0.2 after the completed bootstrap and selected "Research an initial shortlist" in the clarification.

Scope: research Google Gemini Developer API, GroqCloud, OpenRouter, and Cloudflare Workers AI through current official terms, privacy, pricing, limits, model-capability, and availability documentation. These are research candidates, not enabled providers or an approved production shortlist.

Acceptance: every Appendix B field contains sourced findings or explicit TODO-VERIFY; record clause locations, URL/date, shared-quota ownership, and unresolved launch conditions. No credentials, model calls, account creation, financial commitment, binding legal judgment, or final provider approval is included.

Owner inputs D2/D3/D10 remain unresolved; public-source research can identify conditional region/tier findings without inventing these decisions. D4 candidate research scope is supplied by this record; approval of the resulting shortlist remains separate.

## PRICING-001 — Sourced candidate pricing for Step 0.3

Date: 2026-10-12.
Authorization: owner explicitly requested completing Step 0.3 and carrying forward unresolved provider conditions.

Choice: collect representative online text-inference schedules for the four RESEARCH-001 candidates in `docs/pricing_inputs.json`. Keep model rates, dated USD/BDT references, customer gateway schedules, and provider platform/acquisition charges separate. Use decimal strings for rates and integer minor units for payment amounts; preserve distinct free, paid, endpoint-specific and announced future price periods.

Evidence scope: 15 model/tier/period rows, two dated public FX references plus an unknown actual-settlement entry, three candidate gateway schedules, and 16 official sources. SSLCommerz publishes Basic fees; direct bKash/Nagad online merchant costs and several tax/refund/settlement details remain TODO-VERIFY. Reference FX and advertised fees are not this project's contracted all-in costs.

Eligibility: carry all Step 0.2 provider question IDs and disabled/hold flags forward. Public prices do not resolve intended-use, audience/region, downstream model terms, account quotas, privacy or real quality. All feasibility flags stay false; model classes, actual payment method/FX and gateway choice remain unselected. Unknown costs cannot be coerced to zero or used to justify pack sales.

Scope excludes provider/key use, model calls, contacting providers/gateways, account creation, credit purchases, spending, payment activation and financial/legal approval. Refresh and reconcile account/contract evidence before dependent feasibility or Phase 6 decisions. Step 0.4 still needs D2/D3 and exact eligible account quotas.

## CAPACITY-001 — Pilot inputs and conditional Step 0.4 scenarios

Date: 2026-10-13.
Authorization: owner requested Step 0.4, allowed missing quotas to remain TODO-VERIFY while other scenarios were computed, and selected 100 daily active free users in the follow-up.

Recorded inputs: D2 = 100 daily active free users for the pilot; D3 = maximum BDT 1,500/month hosting ceiling (150,000 minor units). Five requests/user/day is an owner-supplied ASSUMED workload, to be replaced with measured traffic. These inputs authorize planning, not purchases or paid-provider traffic.

Planning choice: hold requests/user/day at five and vary input/output token sizes for low/medium/high cases. Apply SRS safety factor 0.8, with explicitly ASSUMED 1.10 attempt amplification and 5% busiest-minute share. Use only the public Cloudflare shared Neuron and OpenRouter free-request bounds in the conditional main sum; exclude unknown Gemini limits and ambiguous Groq Free/Developer summary limits. All account/model eligibility and exact quotas remain pending. Record 70B replacement, retry and outage sensitivities without creating new quota grants.

Result scope: CAPACITY.md contains three input/result scenarios and the 100-user comparison. Conditional user bounds are 120 / 35 / 16; medium/high do not cover the target. Verified pilot capacity and hosting affordability remain TODO-VERIFY; zero providers are verified eligible. Preserve all provider and pricing flags and existing dated JSON observations. Re-read official FX pages on October 13; retrieved rates still have October 12 effective dates and are not actual settlement rates.

Revisit after account/terms/privacy/model evidence, actual traffic, authorized real-model evaluation and a bounded hosting plan are available. Refresh FX before a funding decision. Keep D10/audience and financial/legal gates open; no Phase 0 GO or deployment is granted by this record.

## CALC-001 — Offline pack calculator for Step 0.5

Date: 2026-10-13.
Authorization: owner requested Step 0.5 after the completed conditional capacity report.

Choice: implement `tools/pack_calculator.py` using the existing Python 3.11.9 standard library, with no installed dependencies. Keep the two hypothetical SRS 9.4 cases in `docs/pack_calculator_inputs.json`, expose generic hypothetical JSON inputs, and provide a read-only sourced-evidence audit. Use exact Fraction arithmetic and decimal strings, integer currency minor units and micro-CU; apply selling-price buffer, independent worst input/output model rates, quantum/split rounding and tool-budget bounds.

Acceptance: reproduce Premium 65,000 tokens and Everyday 1,800,000 tokens, 405,000 micro-CU cost caps, 312,000/313,200 micro-CU worst costs, and the Premium below-150K warning. Meaningful unit/CLI checks cover invalid/unknown costs, fee/minimum rounding, expensive-output split rounding, tool reduction, mixed classes, price periods, JSON parsing and snapshots. Tests were run before implementation and failed for the absent calculator, then passed after implementation.

Scope: local planning, not an application service or production Plan Builder. All outputs keep `pack_sales_ready=false`; sourced mode issues no grants even if evidence later changes. Phase 6 must complete actual all-in currency/acquisition/tax/platform fees, funded-route, reachability and approval checks. The SRS fixtures do not resolve D6/D11/D12/D13 or approve their default commercial choices. Provider and pricing research JSON are preserved unchanged; no credentials, network/model calls, activation, financial commitment or pack sales are authorized here.

Revisit when verified financial inputs and Phase 6 requirements are ready. The user guide documents commands and exit codes; Step 0.6 remains the next license/dependency task.

## DEP-001 — Step 0.6 dependency and license research

Date: 2026-10-13.
Authorization: owner requested Step 0.6 after the prior Phase 0 work. Scope is public-source review and repository documentation, without installations, provider calls, commercial contacts, licensing purchases or services.

Choice: expand `docs/DEPENDENCY_REVIEW.md` to cover 20 named gateway/UI/auth/editor/execution/support/tool components and the unspecified free-aggregation category. Record exact review references, licenses and obligations, publication dates, selected official security evidence and explicit candidate/hold/reference/exclude/defer dispositions. Keep the existing Gitleaks pins and BOOT-001 local scope unchanged. Exact references are research observations, not a tested or approved runtime dependency graph.

Selection implications: LiteLLM core remains the SRS direction with artifact-provenance/security and enterprise-scope holds; Next.js and Auth.js need specific unresolved security/graph mappings before adoption. React, editor, TypeScript, Node and PostgreSQL directions remain conditional proposals. Redis requires a current license choice and security mapping; PostgreSQL queue remains an available SRS alternative. LibreChat/AnythingLLM remain reference-only initially; Open WebUI/Dify stay excluded under the recorded own-brand/workspace direction. Unidentified aggregation repositories cannot inherit a guessed license. Browser execution remains a later D5 decision, with Pyodide covered-source/package obligations and WebContainers SDK-versus-commercial-runtime rights separate; optional server execution stays deferred until funded and approved.

Evidence limits: tagged licenses, official release/npm metadata and selected maintainer disclosures reviewed 2026-10-13. Later GitHub API rate limits were handled through official raw files/public pages/docs; unavailable mappings stay TODO-VERIFY. Zero repository advisory records do not imply a clean resolved graph. No application manifests/lockfiles/images exist yet. Existing Python 3.11.9 is superseded and is retained only for the bounded local offline tool; choose a patched supported distribution for later CI/deployment or untrusted-file handling. No machine-wide upgrade is included.

Acceptance: every scoped review row has a license, release date or explicit identity/runtime unknown, security notes and decision. Verify references/local links, status/next-step consistency, preserved tool/research pins and a clean local secret scan. Docs-only lint/types/application tests are not applicable; prior calculator implementation and its 16 passing tests are unchanged.

Carry forward DEP-ARTIFACTS/DEP-LICENSE/DEP-COMPAT/DEP-RUNTIME and all provider/capacity/pricing conditions. D2=100 and D3=BDT 1,500/month remain recorded inputs. This completes technical Step 0.6 research without approving runtime adoption, legal conclusions, Phase 0 GO, pack sales or deployment. Next: Step 0.7 hosting/database/stack/sandbox/gateway decision records.

## Step 0.7 — Planning decisions and evidence

Date/read date: **2026-10-13**, Asia/Dhaka. Authorization: owner requested Step 0.7. SRS Sections 5.2/5.3, P6 Step 0.7, OPS-03 and LEG-02 apply. These six records have options, a concrete planning choice, reasons and revisit conditions. They do not supersede prior approvals or turn a proposal into a purchase, provider enablement, binding financial/legal choice or phase acceptance.

**Technical record completion is separate from adoption.** D2=100 users and D3=BDT 1,500/month are recorded; no host with confirmed eligibility, availability, all-in charges and enforced overage bounds has yet been established. All DEP-001/provider/pricing/capacity conditions continue. No new application dependencies, accounts, services or code are installed/activated by this step. Sources and dates below supplement the preserved earlier research artifacts.

## HOST-001 — One small VPS; conditional host preference, adoption HOLD

Date: 2026-10-13. Status: **PLANNING CHOICE; hosting adoption HOLD**. D3's budget ceiling is resolved; its vendor/region/purchase choice remains pending.

Options:

| Option | Public reference and fit | Disposition |
|---|---|---|
| A. Hetzner CX23, EU reference | 2 shared vCPUs, 4 GB RAM, 40 GB NVMe; new-order schedule USD 6.49 / EUR 5.49 monthly excluding VAT and IPv4. Primary IPv4 adds USD 0.60 / EUR 0.50; backups add 20% of server price. [S07-H-PLAN] [S07-H-PRICE] [S07-H-IP] [S07-H-BILL] | Preferred cost/reference option **only if available and approved**. Public cost-optimized page currently renders CX23 as unavailable; account/location availability is TODO-VERIFY, not a bookable offer. |
| B. DigitalOcean Basic | 1 GiB USD 6/month; 2 GiB USD 12/month; 4 GiB USD 24/month. Weekly backup adds 20%. At the dated USD/BDT reference, totals before other charges are BDT 892.80 / 1,785.60 / 3,571.20 respectively. [S07-DO] | 2/4 GiB options exceed D3 with backup even before tax/auxiliaries. 1 GiB fits reference cost but has no proof it can run app, PostgreSQL and LiteLLM together; not selected. |
| C. OVHcloud advertised VPS-1 | Worldwide page displays a **VPS 2027** range, from USD 4.54/month with 2 vCores/4 GB/40 GB and daily backup. [S07-OVH] | Research-only fallback. Future-labelled range, "from" price, available region, term/renewal, IP, eligibility and all-in quote are unconfirmed; not substituted into a current funded plan. |
| D. Ordinary shared hosting | SRS 5.3 excludes it: long-running application, PostgreSQL and outbound HTTPS are required. | Reject for this platform. A low headline hosting price does not establish the required service capability. |

Choice: **one VPS deployment topology with colocated app/database/gateway; provisionally prefer A for a later scoped quote/availability check. Do not purchase any host while adoption is held.** Four GB is an ASSUMED planning resource target, not a measured minimum or proof of 100-user support. EU is a price-reference location, not an approved data region; D10/audience and cross-border/legal disposition remain unresolved.

Why: the colocated topology avoids separate paid database/cache/worker services while permitting long-running streaming and server-side credential isolation. Option A leaves more reference headroom than the comparable DigitalOcean sizes. Its availability and variable-usage risks prevent a final deployable-host claim. The existing domain mentioned by the SRS is not evidence of a paid-up project domain or free renewals.

### HOST-001 cost calculation

**VERIFIED public schedule inputs:** USD 6.49 server + USD 0.60 primary IPv4 + 20% server backup rate. The source is the June 15 new-order schedule re-read October 13; refresh the exact checkout quote, currency and tax basis before any commitment. [S07-H-PRICE] [S07-H-IP] [S07-H-BILL]

**Planning rounding:** ceil the USD 1.298 backup estimate to USD 1.30 for a conservative line item, giving **USD 8.39/month**. This is our planning convention, not a verified vendor rounding rule. EUR schedule analog: EUR 5.49 + 0.50 + ceil(1.098, 0.01) = **EUR 7.09**; do not silently mix EUR and USD invoices.

**Dated FX reference:** EBL page/PDF re-read October 13 still has an **October 12, 2026** effective date and USD card-payment rate **BDT 124.00/USD**. It is not the project's chosen issuer, permitted payment method, actual settlement rate, or an October 13 effective quote. [S07-FX] [S07-FX-PDF] `8.39 * 124.00 = BDT 1,040.36` before unresolved charges.

**ASSUMED auxiliary envelope:** BDT 150/month total for any domain-renewal allocation, offsite backup/storage, DNS/TLS/monitoring/transactional-email or other selected hosting-related service. This is a proposed combined allowance, not an assertion that the services are free or available at that price. No paid SaaS or auto-upgrade is selected. Quote every actual item; if the combined total exceeds this envelope, recalculate rather than assigning unknowns zero.

| Conditional scenario | Assumed combined uplift on core for FX/tax/payment charges | Core BDT, rounded up to minor units | Auxiliary envelope BDT | Reference monthly total BDT | Headroom against 1,500 BDT |
|---|---|---|---|---|---|
| Reference only | 0% | 1,040.36 | 150.00 | **1,190.36** | 309.64 |
| Stress case | 20% | 1,248.44 | 150.00 | **1,398.44** | 101.56 |
| Higher stress | 30% | 1,352.47 | 150.00 | **1,502.47** | **-2.47: fails** |

All uplift rates are ASSUMED sensitivities, not Bangladesh tax advice or an upper bound on real fees. The zero-uplift row is a partial-cost reference, not an all-in quote. Three reference totals were recomputed with exact decimal arithmetic; provider inference, payment-gateway setup and optional execution have separate unapproved funding and cannot spend this hosting ceiling.

Budget gate: accept only a dated, eligible and available quote where **all-in app + DB + storage + backups + bandwidth + logging + domain/other selected hosting charges <= BDT 1,500/month**, with bounded variable usage. Actual issuer FX, invoice currency/taxes, card/acquisition fees, first-invoice/setup/minimum funding, renewal and billing rules remain TODO-VERIFY. Separate startup charges cannot be hidden by monthly amortization.

Cost-safety requirements: one planned instance, no automatic scaling, no extra volumes/load balancers/floating IPs/snapshots or paid add-ons without an updated envelope. Hetzner charges outbound overage, and its 75%/100% traffic emails explicitly do **not** stop usage. Powered-off servers and unassigned primary IPv4s can continue billing. A server's monthly price cap is not an account-wide spending cap. Confirm contractual limits or implement and test bounded traffic/storage/resource admission with a reviewed shutdown/recovery plan before deployment; alerts alone do not satisfy CAP-HOSTING. [S07-H-BILL]

Storage/backup choice for planning: use included local disk with global quotas/retention decisions, plus the priced seven-slot server-backup option for recovery. Server snapshots do not prove application-consistent database backups or an independent encrypted restore path. Design encrypted PostgreSQL backups and prove a restore under OPS-04 before the public-release gate. Cloudflare R2 Standard is a possible offsite destination: public allowances are 10 GB-month, 1M Class A and 10M Class B operations, with direct egress free; usage beyond allowances and other linked products can charge. Account/shared usage, region, entitlement and enforceable controls are unknown, so **no R2 account is activated and no unconditional zero cost is counted**. [S07-R2]

Revisit if: CX23 is unavailable in an acceptable region, eligibility fails, all-in quote/auxiliary/overage controls fail D3, load/streaming/backup tests need more resources, or later files/agent features change workload. Compare new bounded offers; a higher ceiling, host purchase or target change requires a new owner decision. Keep CAP-HOSTING, CAP-FX-FRESHNESS, DEP-ARTIFACTS/DEP-RUNTIME and LEGAL open.

## DB-001 — PostgreSQL data and queue; avoid a second data service initially

Date: 2026-10-13. Status: **PLANNING CHOICE; actual database adoption pending host/artifact checks**.

Options:

| Option | Benefit / limitation |
|---|---|
| A. Colocated PostgreSQL and Postgres-backed queue | SRS default, one durable transactional system and no separate service charge; owner must operate patches, backups, disk limits and recovery. |
| B. Managed Neon Free PostgreSQL | October 2 official update reports 1 GB/project, 100 compute-unit-hours/month and a 6-hour instant-restore window. Account/region limits, egress, backup/export, privacy and real latency must be checked. The full pricing page could not be retrieved; do not treat this blog as a complete current service contract. [S07-NEON] |
| C. PostgreSQL plus Redis queue/cache | Possible later scaling separation, but adds service/RAM cost, current Redis license choice and unresolved security mapping from DEP-001. |

Choice: **A for initial chat/data/governor/jobs planning; defer Redis.** PostgreSQL 18.6 is the Step 0.6 review reference, not an installed image pin. No database engine, driver, ORM or queue package is installed; select and review exact artifacts before migrations/scaffolding. Files remain quota-controlled storage, not database blobs by default; no vector database in MVP.

Why: a single persistent store can keep ledger, quota-pool state and job state transactionally consistent, with fewer independently metered services. The documented `SKIP LOCKED` mechanism can support queue consumers, but supplies an inconsistent view and must not be used to bypass ledger/governor correctness. Design atomic reservations and leases, bounded retries, idempotency, expiry/cleanup and fair admission; prove race/recovery behavior at the owning steps. [S07-PG]

Neon is not rejected because it is free; it remains an alternative if the host/backup burden makes A unsuitable. **ASSUMED comparison:** an always-active 0.25-CU database for 31 days uses `0.25 * 24 * 31 = 186 CU-hours`, exceeding the cited 100-CU-hour allowance. A continuously polling queue can defeat idle savings; measure real behavior before counting free compute. Neon's vendor compute units are unrelated to the project's monetary CU/micro-CU. A six-hour restore window is not the SRS independent backup policy.

Revisit if: selected host cost/load or backup/recovery burden fails, multi-instance contention requires another design, or an approved managed plan has documented better all-in fit. DB/queue changes need dependency/license and migration evidence; preserve DEP-ARTIFACTS, CAP-HOSTING and D8/backup requirements.

## STACK-001 — TypeScript/Next.js modular application and own UI

Date: 2026-10-13. Status: **CONFIRMED PLANNING DIRECTION; version/security/integration adoption HOLD where DEP-001 specifies**.

Options: A) Next.js/React frontend and Next.js server API on supported Node LTS with shared TypeScript packages; B) same frontend plus a separately deployed Node API; C) a whole LibreChat fork. Choice: **A**, with own Bangla/English UI and references only from LibreChat/AnythingLLM. Reason: it follows SRS defaults, shares contracts and reduces separately deployed processes for the small pilot. A whole fork would bring additional modules/dependencies, branding assets and review/maintenance scope.

| Layer | Concrete planning choice | Adoption conditions |
|---|---|---|
| App/UI/API | Strict TypeScript; Next.js App Router/React with server API; own mobile-first UI | Review references Next.js 16.4.0, React 19.3.0 and TypeScript 7.0.2 from DEP-001 are not a mutually tested stack or mandatory latest-major install. Validate compiler/build/framework graph before choosing final versions. |
| Runtime | Supported Node LTS; 24.21.0 is the reviewed reference | Exact patched binary/image and host/CPU/OS provenance/compatibility remain pending. Existing local Python 3.11.9 is not an app/CI runtime approval. |
| Sign-in/session | Auth.js / next-auth stable direction for Google sign-in | Reviewed 4.24.15 has an older optional `@auth/core` peer; prove resolved use/applicability and patch every applicable finding. Do not introduce beta/force peer overrides to bypass review. |
| Data/counters/jobs | PostgreSQL under DB-001; logical modules in existing packages layout | Atomic ledger/governor and ownership tests remain future implementation work. |
| AI access | Internal separate LiteLLM core process under GATEWAY-001 | No provider currently eligible/enabled; artifact/security holds continue. |
| TLS/edge/packaging | One TLS ingress, streaming through to app; backend-only DB/gateway interfaces; exact reverse proxy/container/OS components selected and reviewed at Step 1.1 | No extra unnamed library/image is approved by this direction. Self-hosting docs require streaming-capable proxies without response buffering; verify end-to-end, including disconnects. [S07-NEXT] |
| Later editor/runtime | Monaco versus CodeMirror evaluation in Phase 4; SANDBOX-001 for execution | Deferred; no editor or execution dependency added to MVP. |

Next.js mitigation proposal: initial MVP uses own static assets and no attacker-controlled remote image allowlist/`next/og` image generation. This is a planned applicability constraint, not an implemented workaround or clean audit. Record actual feature use against DEP-COMPAT and verify exact patched bundles. Keep auth/image-specific holds open until configuration and graph evidence exist.

Deployment boundaries: app, worker, PostgreSQL and gateway are separate logical/process responsibilities even when colocated. No gateway/admin/database endpoint or key is exposed to browsers; staff access keeps its distinct role/MFA/audit requirements. Persist production state independently of disposable builds, bound worker/concurrent streaming load and all logs/storage, build with verified resource limits, and measure before promising 100 users. Customer/generated code never runs on this application host. Operational logs remain metadata-only; retention defaults still need D8. These are design requirements, not working controls.

Revisit if: dependency/security compatibility cannot be resolved, real streaming/load tests fail within the selected resources, or later worker/API scaling justifies B. Version pins, drivers, packaging and TLS dependencies are reviewed in DEP-ARTIFACTS before implementation; no SRS amendment or final security waiver is inferred.

## GATEWAY-001 — LiteLLM core behind the application router

Date: 2026-10-13. Status: **PLANNING CHOICE; artifact/provider adoption HOLD**.

Options: A) internal LiteLLM MIT core with application-owned registry/governor/ledger; B) application-owned direct-provider adapters; C) a hosted paid aggregation/gateway service. Choice: **A**, following SRS Section 5.4. Reason: a common provider interface avoids duplicating integration work while the app retains policy, accounting and pool control. B is a revisit alternative if verified core artifacts cannot meet the scope; C adds independent fees/terms and is not funded by D3.

Conditions: the reviewed LiteLLM v1.105.0 is a reference, not an approved runtime package/image. Resolve its prior package-security incident, exact artifact/provenance/full graph, enterprise-path rights and applicable advisories from DEP-001. Keep gateway listener internal, keys server-side and free/paid credential scopes separate. Proposed initial gateway automatic retries = **0**; any later router retry/fallback is config-controlled, bounded, reserves the applicable attempt cost and consumes the actual shared provider quota. Do not combine independent retry layers or count skipped retries as extra capacity.

All four research providers stay disabled, unapproved and unverified eligible; private routing and model capability/quality gates still apply. No billing-linked key, provider test, gateway account or inference spend is authorized by this record. D3 funds hosting planning, not paid inference.

Revisit if: A's security/artifact/license/resource conditions fail, real-model/provider eligibility changes, or a separately approved host/gateway quote fits better. Any departure from the SRS direction needs a new recorded choice and, where required, owner approval; carry DEP-ARTIFACTS/DEP-LICENSE and all provider/cost IDs.

## SANDBOX-001 — Browser-first proposal; server execution deferred

Date: 2026-10-13. Status: **DEFERRED feature/owner D5; no execution enabled**.

Options: A) later browser-only Python/JavaScript execution; B) separately funded hosted sandbox service; C) self-managed gVisor/Firecracker-class server isolation. Choice: **A as the planning preference for Phase 5a, with B/C deferred rather than SKIPPED.** D5's final feature/runtime/funding decision is not supplied by this proposal. Reason: execution is not required for the initial chat MVP; optional server execution would add security operations and independent costs to a small host budget.

Pyodide remains a conditional Python candidate, requiring exact bundle/package/MPL/source obligations, isolated origin, no platform cookies/tokens/parent DOM, bounded workers/output and termination checks. JavaScript may use a reviewed browser worker/preview design with its own isolation tests; a full Node/npm runtime is not implied. WebContainers stays HOLD because MIT SDK rights do not settle commercial hosted-runtime entitlement or pricing. No runtime preference overrides DEP-001.

Server execution remains globally disabled and **DEFERRED** for Phase 5b. Do not infer KVM or hardened isolation from an ordinary VPS; gVisor/Firecracker/hosted alternatives need host/kernel/guest/network/license review, a separate hard funding envelope, D5 and the SRS rollout prerequisites plus T5.1–T5.4. It must not execute on the application host. Browser-only final scope can record Phase 5b SKIPPED later through the owner disposition; do not mark it skipped now.

Revisit if: Phase 4 and real-agent quality prerequisites pass, owner confirms runtime scope/terms, or separate server funding and rollout authorization are recorded. Keep D5/DEP-RUNTIME and WebContainers obligations open.

## PAYMENT-001 — Defer activation; SSLCommerz first contract candidate

Date: 2026-10-13. Status: **DEFERRED to Phase 6; merchant/business/funding choice pending D6**.

Options: A) SSLCommerz Basic aggregator; B) direct bKash merchant gateway; C) direct Nagad merchant gateway. Choice: **defer production gateway integration/activation; use A as the first quote/contract candidate in later authorized financial planning**, with B/C retained for contract comparison. Reason: A has a public schedule and includes the common payment channels; the direct routes' applicable online merchant fees/contracts remain unverified. This is not permission to contact a vendor, onboard a merchant or select financial/legal terms.

Re-read SSLCommerz October 13: advertised Basic non-refundable setup fee **BDT 25,500** and standard successful-transaction rate **2.5%** (**3.5% AMEX**), including aggregator bKash/Nagad channels. [S07-SSL] This setup amount is separate startup funding, not the BDT 1,500 monthly hosting ceiling or a direct bKash/Nagad rate. Preserve the October 12 pricing JSON unchanged. Fixed/minimum/rounding/maintenance/tax/refund/chargeback/settlement/reserve and small-pack rules are not a verified project contract.

Before Phase 6 selection, confirm owner's applicable business/merchant status and approved payment method, exact all-in quote, startup/ongoing funding and actual settlement FX; source every allowed payment route and keep pack generation/sales blocked until Phase 6 acceptance. The offline calculator's hypothetical examples do not approve pricing or entitlement grants. LEG-02 advisor/data-region disposition and LEG-06 merchant requirements remain separate; no legal/tax determination is made here.

Revisit if: A's merchant eligibility/setup funding or small-pack/refund/settlement rules fail, or a verified B/C contract has better all-in economics. Keep D6/D11/D12/D13, FEE-SSLCOMMERZ/FEE-BKASH/FEE-NAGAD, FX-SETTLEMENT/PRICE-TAX and the financial gate open.

### Step 0.7 completion and next dependency

All six planning records supply options, choice, reason and revisit conditions. Public price arithmetic is checked; **verified all-in hosting affordability and adoption remain pending**, with no purchase/deployment/provider/payment approval inferred. Existing research/calculator/dependency/tool/specification files are preserved. Docs-only lint/type/app tests are N/A; execute record/link/hash/status checks and the local secret scan before reporting technical DONE.

Next command: **RUN STEP 0.8**. First create the 30 Bangla/English prompts and 15 coding tasks, define reviewable quality thresholds, and validate a clearly labeled offline/stub harness. Real-model calls require separately recorded eligible provider/model/key/data and hard test-budget authorization plus approved thresholds. Missing real authorization blocks real calls, not useful offline evaluation preparation; no stub can establish model quality or Phase 0 GO. Hosting/vendor/license/legal and capacity conditions continue into the Step 0.9 gate report.

### Step 0.7 official-source register

All read **2026-10-13**. FX's effective date is October 12; Hetzner's new-order pricing schedule is effective June 15; Neon's quota update is dated October 2. Quotes/entitlement/checkout terms remain unverified. Earlier dependency/provider/model-price sources remain in their owning artifacts. No authenticated account or inference API was used.

[S07-H-PLAN]: https://www.hetzner.com/cloud/cost-optimized/
[S07-H-PRICE]: https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
[S07-H-IP]: https://docs.hetzner.com/general/infrastructure-and-availability/ipv4-pricing/
[S07-H-BILL]: https://docs.hetzner.com/cloud/billing/faq/
[S07-DO]: https://www.digitalocean.com/pricing/droplets
[S07-OVH]: https://www.ovhcloud.com/en/vps/
[S07-FX]: https://www.ebl.com.bd/forexrate
[S07-FX-PDF]: https://www.ebl.com.bd/assets/other/exchange/Exchange_Rate_12_October_2026.pdf
[S07-R2]: https://developers.cloudflare.com/r2/pricing/
[S07-NEON]: https://neon.com/blog/neon-free-plan-1-gb-per-project
[S07-PG]: https://www.postgresql.org/docs/18/sql-select.html
[S07-NEXT]: https://nextjs.org/docs/app/guides/self-hosting
[S07-SSL]: https://sslcommerz.com/pricing/

## EVAL-001 — Step 0.8 offline suite and harness; real evaluation pending

Date: 2026-10-13.
Authorization: owner requested Step 0.8. Existing records permit synthetic/offline preparation; SRS P4 and Step 0.8 require approval before real provider/key use and real quality runs. No such provider/model/key/data/budget/expiry grant or threshold approval is present.

Options: A) prepare the fixed synthetic suite, proposed rubric and offline harness while preserving real-call gates; B) call research providers without the scoped approval; C) use fixtures as real-quality evidence. Choice: **A**. Reason: it completes useful authorized work and produces a concrete result for review; B/C conflict with the SRS authorization and evidence rules.

Implementation: add 30 chat prompts (15 Bangla/15 English) and 15 coding tasks with pass/fail review checks, exact format checks and critical flags. Add an offline stdlib validator/exporter/assessor and explicitly canned fixture profiles. No provider transport, environment/key reader or candidate-code executor exists. Raw future captures are Git-ignored under `.eval-local`; reports contain case statuses/counters, not raw answers or private review notes. Preserve all prior research/tool/specification/calculator artifacts.

Proposed, **not owner-approved**, thresholds: chat >=85% overall and for each language (26/30 and 13/15 each), coding >=80% (12/15), every critical case passes, and real coding evidence includes isolated functional checks. This is a small project-specific pilot suite, not a representative external benchmark. Freeze canonical JSON content hashes of suite `adb7cad85a871c2e8119637b30006dbe02adf48e249155402464f74c79b88695` and policy `25d95a14a45802bb76a3223dedfd16b950cf069fab1872a56a808bc71ec904be`; a binding approval must reference the snapshot before a real run. The offline policy stays a draft artifact; it cannot approve itself.

Proposed later free-only test envelope: one exact eligible model, <=45 calls, no retries/fallbacks, <=4,000 input/1,024 output tokens per call and 180,000/46,080 aggregate tokens, BDT 0 provider spend, project-authored synthetic data only. Exact account/model/key/environment/expiry and no-overage enforcement remain unapproved/unknown. This proposal does not resolve D4/D10/audience, provider terms/model/account quotas or fund any inference; D3 is still the hosting ceiling.

Evidence: tests first detected the missing harness. 27 evaluator behavior/CLI checks and the 16 existing calculator tests passed together (43 total). Independent review reproduced and then verified fixes for two false-provenance/approval gaps. Passing fixture diagnostics are 30/30 chat and 15/15 coding; failing/partial profiles prove failures and missing-case denominators are not hidden. All profiles leave real quality null, agent readiness/Phase 0 GO false, provider calls zero and candidate-code execution false. Python syntax and ignore behavior checked. Artifact/link/hash/status and secret-scan evidence is recorded in PROGRESS.

Scope/status: **offline preparation complete; full Step 0.8 NEEDS OWNER**, not DONE. There is no real-model Bangla/English/coding result, measured usage/latency/provider price, approved isolated coding evidence or registry activation. Initial model/provider scores remain untouched. EVAL_REPORT.md records repeatable commands, grading limits and exact next inputs. Threshold/run-scope approval and real evidence remain the next dependency; Step 0.9 may record unknowns but cannot infer GO.

Revisit if: owner approves/revises thresholds, supplies a scoped eligible provider/model/key/environment/data/call-token-spend/expiry grant, or selects an approved isolated coding runner. Append the actual authorization/evidence record, refresh applicable terms/quotas/dependency sources and implement only the approved transport. No retroactive approval or self-claimed imported provenance is accepted.

## EVAL-APPROVAL-001 — Owner-approved thresholds and test bounds; target fields unresolved

Date: 2026-10-13, Asia/Dhaka.
Authorization source: owner answered the Step 0.8 clarification with "Approve thresholds only (Recommended)" and supplied an "APPROVED test scope" template containing concrete limits/stop rules but unfilled provider/model/account/key/environment/free-only/expiry placeholders.

Approved thresholds: chat >=85% overall and per language (26/30 overall, 13/15 Bangla and 13/15 English), coding >=80% (12/15), every critical case passes, and real coding requires isolated functional checks. Approval applies to the suite/rubric/policy presented in EVAL_REPORT.md: canonical suite hash `adb7cad85a871c2e8119637b30006dbe02adf48e249155402464f74c79b88695`, canonical policy hash `25d95a14a45802bb76a3223dedfd16b950cf069fab1872a56a808bc71ec904be`. These are approved criteria, not passing real-model results. The immutable draft policy and pre-approval canned summary remain unchanged; this owner decision supplies the external approval record. No retroactive model evaluation occurred.

Accepted test bounds: one exact target once identified; **maximum 45 total calls**, **maximum 4,000 input/1,024 output tokens per call**, **no retries**, **no fallbacks**, **BDT 0 provider spend**, **synthetic data only**. Derived worst-case aggregate bounds are 180,000 input/46,080 output tokens; they do not add calls or funding. Stop and report immediately on **any cost signal, any 4xx/5xx error, or any quota warning**. The owner explicitly limited approval to this scope; any other call needs a new approval. Do not request threshold/cap/stop-rule approval again.

Incomplete scope fields, all TODO-VERIFY: exact provider/model ID; terms URL/read date and test-use eligibility; account RPM/TPM/daily limits/check date; approved key environment-variable name; choice of local or staging environment; dated free-only/no-billing/no-overage evidence; explicit expiry date/time in Asia/Dhaka. The literal placeholders do not identify a target, credential reference or valid period. Do not choose defaults, inspect arbitrary keys, infer an expiry, treat advertised limits as account limits or dispatch a request while these fields remain unresolved.

Disposition: record the approved thresholds and supplied bounds now; request only the missing field values. Once the owner supplies a concrete target/reference/environment/expiry within these bounds, verify current provider/account/model eligibility, tokenization and enforceable no-cost/limit behavior before the authorized dispatch. The approval persists; completing its missing fields does not require re-approving the already accepted numerical limits. No provider is enabled and no model call is made by this record. Actual runtime/code-execution authorization remains separate from approving its required evidence standard.

Full Step 0.8 stays **NEEDS OWNER** for runnable scope and real/reviewer/functional evidence. Resolve/remove EVAL-THRESHOLDS from active questions; keep EVAL-SCOPE/EVAL-REVIEWS/EVAL-FUNCTIONAL and all other Phase 0 conditions open. Revisit through a new dated record if scope, target, thresholds, caps or expiry change.

Account-readiness update, 2026-10-13: after two placeholder scope replies, the owner explicitly answered **"none"** to which provider account is ready. No provider account/key is available for this run. Retain all approved thresholds, bounds and stop rules; the next concrete dependency is owner account setup and actual target/key/limits/validity data. An optional Groq Free setup path is documented with official sources in EVAL_REPORT.md; this is guidance, not owner selection of Groq, account creation on the owner's behalf, accepted provider terms, a model call, or production eligibility. No live transport or credentials are accessed.

## GATE-REVIEW-001 — Account setup deferred; Step 0.9 report prepared

Date: 2026-10-13, Asia/Dhaka.
Authorization: owner replied to the account/setup work order, **"ok i will do that latter go to next process"**. Record provider-account setup as owner-deferred and proceed with the next documentation process, Step 0.9. Preserve EVAL-APPROVAL-001 thresholds, numerical limits and stop rules; full Step 0.8 remains NEEDS OWNER. No ready account or completed real scope is inferred.

Options assessed: A) prepare the evidence-linked gate report with required unknowns explicit; B) infer GO/GO_CHAT_ONLY or start product code from fixtures; C) propose a restricted local prototype for a separate owner CHANGE-SHAPE decision. Choice for this step: **A, with C supplied as an unapproved review option**. B fails SRS Section 17.1/P4/Phase 1 preconditions.

Output: docs/PHASE0_GATE_REPORT.md checks all five Section 17.1 conditions. Recommendation for the current hosted-product scope is **NO-GO pending evidence**, because confirmed public-serving providers, real chat quality, 100-user capacity, bounded all-in hosting and legal/selected-stack dispositions are unresolved. This is not a conclusion that the product can never be feasible, and not an owner gate decision.

Proposed alternative: only after an explicit owner CHANGE-SHAPE approval and canonical SRS amendment, create a loopback-only Step 1.1 local web prototype with synthetic canned chat, environment validation and relevant local checks. No provider keys/calls, external sign-in, customer/production data, payments, code execution, deployment or public exposure. Dependency review/holds remain applicable. The full hosted-product gates and existing D2/D3 are retained; later implementation/activation is not covered. Proposal details and acceptance are in the gate report.

Status: **Step 0.9 technical report complete; owner decision PENDING; Phase 0 open**. No GO, GO_CHAT_ONLY or CHANGE-SHAPE is recorded as approved. No specification, frozen evaluation artifact, provider/pricing flag, runtime configuration or code is changed. Revisit when the owner selects a concrete outcome/scope or new required evidence becomes available. Checks and secret-scan result are recorded in PROGRESS.

## LOCAL-PROTOTYPE-001 — Owner-approved CHANGE-SHAPE for Step 1.1 only

Date: 2026-10-13, Asia/Dhaka. Owner replied **"Approve local prototype (Recommended)"** to the concrete Step 0.9 proposal to record CHANGE-SHAPE, amend the SRS and start Step 1.1 with synthetic canned chat only. This is the actual scoped gate decision; the earlier GATE-REVIEW-001 pending status is historical.

Approved scope: amend canonical SRS Section 17.1.1/P2/Step 1.1 and implement only a local loopback web prototype, environment validation and applicable local quality/security checks. Synthetic Bangla/English canned responses must be clearly labeled; conversations are memory-only. No provider keys/model/account calls, external sign-in, production/customer storage, real uploads, payments, generated-code execution, deployment or public exposure. Package/document retrieval for reviewed development tooling is covered; dependency holds/review remain applicable. Stop after the approved prototype.

Implementation choice: use static HTML/CSS and strict TypeScript with a minimal Node standard-library development server for this restricted preview. This avoids adopting the held Next.js/auth/LiteLLM/database graph. It is a local prototype choice within the authorized amendment, not a replacement of STACK-001/DB-001/GATEWAY-001's later hosted direction. Postgres/gateway compose and hosted CI/deployment are deferred for this exception.

Preserve D2=100, D3=BDT 1,500/month, all disabled provider/financial/real-quality flags and EVAL-APPROVAL-001 limits. Step 0.8/account setup remains owner-deferred/NEEDS OWNER; the hosted-product core gate remains NO-GO pending evidence. A local CHANGE-SHAPE does not close all required Phase 0 work, grant GO/GO_CHAT_ONLY or authorize Step 1.2 onward. Revisit for any additional implementation, real integration, exposure, data, funding or execution scope; do not request this already granted prototype approval again.

## LOCAL-PHASE1-001 — Complete remaining 1-series with recommended local defaults

Date: 2026-10-13, Asia/Dhaka. Owner explicitly requested **"Step 1.2 complet this ... complet the reminig part 1 series"**, accepted recommended choices without further permission, and instructed that questions wait until the full series work is complete. This supersedes LOCAL-PROTOTYPE-001's implementation stop for the new work; no repeat approval question is needed. Canonical SRS Section 17.1.2 records the extension.

Authorized: implement/test/document Steps 1.2–1.10, scoped default decisions and dependency adoption, disposable migration checks, local synthetic persisted data and loopback local staging. Recommended defaults: keep the small typed client/Node modules; use PostgreSQL-compatible PGlite locally when Docker/Postgres are absent, standard-library sessions/API/limits, JOSE verification for Google OIDC, and a clearly synthetic gateway until an eligible real account exists. Preserve future PostgreSQL/hosted-stack direction and all original provider/quality/legal/financial evidence holds.

Scope boundaries: provider setup is still deferred and no usable account/key is supplied. Real Google/provider paths may be implemented with injected synthetic test transports but remain disabled in the local app. No actual account creation, real-key/model calls, spending, production/customer data, generated-code execution, public exposure, paid hosting or public launch is inferred. Existing exact call-budget/expiry prerequisites remain unresolved. All recommended implementation choices within this authorized local task may proceed autonomously.

Acceptance: functional migrations/seed, state/session/CSRF/IDOR tests, persisted owned chat/provenance, synthetic SSE/stop/error/usage, direct API limits, linked versioned legal drafts, security/bundle/dependency/secret review, and T1.1–T1.4 local synthetic acceptance on loopback staging. Complete all independent work; final report distinguishes actual local passes from real Google/eligible-model/hosted checks NOT RUN and requests remaining external information only at the end. Hosted Phase 1 and Phase 2 are not automatically accepted.

## LOCAL-PHASE1-002 — Local defaults, protected retention and completion evidence

Date: 2026-10-13, Asia/Dhaka. Authorization: LOCAL-PHASE1-001 and owner's follow-up to complete the remaining part; recommended choices already accepted, questions deferred until local series completion.

Choice: PostgreSQL-compatible PGlite local persistence, random hashed server sessions, disabled real Google/provider routes, shared synthetic Alpha/Beta profiles, one exact synthetic gateway and versioned independent-brand legal drafts. Keep data under ignored `.phase1-local/database`, bind 127.0.0.1:4174, run bounded session/state cleanup every minute and keep the original memory-only preview available. Options were a functional local stack with synthetic transports, waiting for unavailable credentials, or claiming real integration from fixtures. The first fulfills the authorized work while preserving actual evidence gaps.

Local safety defaults: 20 requests per user per Asia/Dhaka day, one active request/user and eight global, 2,000 input/12,000 context characters, 40 context messages, 512 estimated output tokens, 16,384-byte request body, ten-second request/job bound and one-hour sessions. These are local defaults, not account-model token limits or measured 100-user capacity. Legal version local-draft-v1 needs qualified review before public release.

Retention choice: strict append-only audit/usage evidence. Automatic approval review rejected a generic SQL session-flag deletion bypass because application SQL could use it to evade audit protection; it was not applied. Actual embedded-engine role probes did not establish a privilege split. Session/state and eligible deletion metadata cleanup is implemented; audit/usage expiry remains deferred, with a future 30-day target explicitly not promised as active. Cap local audit/usage rows at 5,000/2,000 and reserve terminal action capacity; transactional regression tests verify rejection rollback and continued account deletion. Revisit with a separate non-assumable hosted PostgreSQL maintenance identity and reviewed privacy policy.

Completion: all local steps 1.1–1.10 technically complete; 87 automated tests pass, actual launcher/page/authenticated synthetic chat/provenance/delete/logout and file-backed close/reopen checks pass. Independent backend review's ordering finding is closed after re-review. Extra independent UI/storage follow-up could not execute because reviewer allowance was exhausted; root manual review and tests are recorded accurately. CI is configured, not remotely executed. No real credentials, model calls, accounts, hosted deployment, spending or new remote communication occurred.

Evidence and ordered external work: docs/PHASE1_REPORT.md. Real Google/eligible provider/model/expiry, real evaluation, actual quotas/capacity/hosting/legal/retention review and owner staging acceptance remain open. Preserve original D2/D3, all disabled research flags and EVAL-APPROVAL-001 thresholds/caps/stop rules. Original hosted Phase 1 is not closed and Phase 2 remains unopened.

## P1-PREHOST-001 — Finish integrations before owner supplies hosting/domain

Date: 2026-10-13, Asia/Dhaka. Owner requested the remaining Google sign-in, approved provider integration/testing, staging and security/legal/release checks, and explicitly will add host/domain after this process. Hosting and domain acquisition/deployment are therefore deferred; continue all implementation, local integration/staging tests and release preparation without requesting repeated permission.

Implement a separately configured loopback integration mode with real Google OAuth endpoints, explicit server-only credential inputs and no shared demo sign-in in that mode. Prepare the reviewed optional Groq transport and a fixed-suite, durable-budget evaluation runner; exact provider/model/account/key reference/free-only/expiry/tokenization evidence remains absent, so preparation does not activate a provider or authorize arbitrary prompts. Keep the ordinary synthetic preview and frozen Phase 0 evidence intact. No real credential values have been supplied or accessed. Account creation/consent, actual login, concrete provider scope and qualified legal judgment cannot be fabricated.

Options: wait for host/domain before all integration work, or finish local setup/testable code first and defer only unavailable external evidence. Choose the latter, as requested. A Web-application Google callback can be configured on loopback for local testing; source and exact setup are recorded in the new integration guide. Local validation cannot prove a future hosted deployment, domain/TLS, operating capacity, legal clearance or owner acceptance. Those remain pending, not passed. Preserve all previously approved evaluation thresholds, caps and stop rules and existing disabled research flags.

## P1-PREHOST-002 — Verified preparation and remaining actual-account evidence

Date: 2026-10-13, Asia/Dhaka. Within P1-PREHOST-001, implement separate LOCAL_GOOGLE loopback configuration with explicit server environment inputs, one-use browser-bound PKCE/nonce/JWT start/callback and rotated sessions. Default chat remains synthetic. Google mode disables shared demo login and keeps data separate; raw email/access/refresh tokens are not stored. Deleted subject hashes are stable under repeated deletion and prevent re-registration resetting retained local usage. No Google credential was supplied/accessed or real account sign-in performed during preparation.

The optional Groq fixed-suite evaluator is implemented with an externally supplied reviewed scope digest, exact frozen suite bytes, concrete model/account/free-only/expiry/tokenization evidence, first-call TPM fit, account pacing, synchronized spent-attempt journal, exclusive lock, bounded response and expiry-clamped transport. HTTP/quota/cost/usage/route/timeout/uncertain capture stops work without retry or fallback. This does not activate ordinary real-model chat or approve a provider from its own flags. Current readiness says NEEDS_ACCOUNT_AND_SCOPE, modelCallsMade=0 and credentialsRead=false. No actual provider request was attempted; raw future captures stay ignored/private and unreviewed, with observed cost unknown unless established.

Independent review reproduced and closed four findings: supplied hashes did not bind payloads, first-call TPM was not checked, repeated deletion double-hashed tombstones, and expiry could cross after awaited journal work. Regressions verify each fix. Privacy-preserving request logs expose only generated ID, fixed surface/method/status/duration; legal drafts advance to local-draft-v2 with v1 history and actual optional processor disclosures, retaining needs-legal-review status. Basic palette contrast was strengthened; full WCAG/translation/performance and qualified legal review remain unverified.

Verification: types/lint/formatter/build, 5 prototype unit, 45 Phase 1 unit, 2 security, 43 Python and 2 browser tests pass (97 unique automated tests); separate auth/Groq coverage reuses 12 and records 100% line/85% branch/91.11% function coverage for those files only. Updated persistent synthetic preview at 127.0.0.1:4176 passes seven pages and authenticated chat/delete/logout with draft v2/request IDs. No dependencies added, research/eval snapshots untouched; host/domain owner-deferred, remote CI NOT RUN, full Phase 0/1 acceptance open and Phase 2 unopened. See docs/PHASE1_INTEGRATION_GUIDE.md for actual Google client and eligible Free model/account/scope setup; do not infer credentials, expiry, token counts, legal clearance or hosted success.

## LOCAL-PHASE2-001 — Owner defers real integrations and starts local Phase 2

Date: 2026-10-13, Asia/Dhaka. Owner replied **"ok we do ir latter than start phase 2"** to the outstanding real Google/provider/release setup. Record these external checks as owner-deferred and start Phase 2 implementation without repeating permission questions. This is an explicit local scope extension, not a passing hosted Phase 1 result; canonical SRS 17.1.4 records the exception to its Phase 2 precondition.

Begin in playbook order with Step 2.1: persisted provider/model registry, activation gates, source-based disabled research seed, editable metadata and append-only version/rollback evidence. Subsequent steps remain ordered: ledger, Governor/router, abuse, separately authenticated MFA admin, simulator/alerts/private routing, then T2 verification. Default work is loopback/local synthetic only, with isolated test databases and reviewed existing Node/PGlite tooling. Keep Phase 1 previews and migration 001 unchanged; new schema migration is opt-in for Phase 2.

No real account/key/model calls, paid routes/payments, host/domain, public exposure, generated-code execution or qualified legal approval is inferred. Existing provider terms/eligibility/quotas, frozen real-quality/financial flags, D2/D3 and EVAL caps/stop rules stay unchanged. Real provider activation remains fail-closed. Registry mutations are trusted service operations checked against database staff identity; no registry/admin web mutation route is exposed before Step 2.6's separate staff authentication/MFA. No production user is promoted to staff. All seed/review identities are labeled synthetic.

Choice: continue the local implementation sequence instead of treating deferred external checks as complete. Technical step completion and remaining live/hosted phase acceptance remain separate; record actual tests and independent review before marking an implemented step DONE.

## LOCAL-PHASE2-002 — Verified Step 2.1 registry implementation

Date: 2026-10-13, Asia/Dhaka. Within LOCAL-PHASE2-001, Step2.1 implements a trusted local staff registry with create/edit/list/history, eligibility gates, exact nullable decimal CU metadata, optimistic revisions, actor-scoped idempotency, transactional minimal audit/version evidence and append-only rollback that rechecks current eligibility. Source imports preserve four disabled providers/eight grouped model records and unknown actual account/context/rates/quality. Exact source hashes are checked; reseeding preserves edits. No browser staff routes exist before Step2.6 MFA.

Choice: retain migration001/default target1 and keep Phase2 schema opt-in; add002 for registry history and003 for byte caps without editing already-applied002. Use existing Node/PGlite dependencies, a separate ignored registry fixture database and a newly inserted labeled synthetic owner reviewer. Keep exact CU rate strings in JSON metadata instead of silently rounding legacy integer columns; Step2.2 must consume an explicit exact micro-CU conversion contract. Neither research rates nor placeholder columns authorize accounting/dispatch.

Verification: phase2-check types/lint/formatter and13 registry tests PASS; existing Phase1-check5+45+2 PASS, with final DB10 reused PASS; CLI close/reopen shows four disabled providers/eight models/12 unchanged versions and no credentials/calls. Independent review closed source-size and staff attribution findings, with four focused checks and oversized before/after SQL probes. Source observations now use bounded allowlists,32KiB records and64KiB DB JSON caps; public operation options cannot inject observations/actions. Earlier audit records remain immutable. No dependency addition, secret/provider/paid/payment traffic, account creation, hosted deployment, public access or generated-code execution; CI configured NOT RUN. Phase2 remains IN PROGRESS with2.2 next; all original live/hosted gates remain open.

## LEDGER-LOCAL-001 — Step 2.2 contract and design

Date: 2026-10-13, Asia/Dhaka. Owner requests next Step2.2 within LOCAL-PHASE2-001. Size: high risk (accounting, authorization, migration). AC: exact decimal/rational total cost rounded up once at10,000 micro-CU/CU; signed append-only rows; transaction/ownership/idempotency/concurrency; standalone full-release-plus-actual-commit; pre-dispatch release versus post-dispatch held uncertainty; conservative deadline estimate/durable alert and one linked late correction; parent sub-allocation without second debit; owned token/time/refusal/history views; migration/restart/durability and independent review. T2.4/T2.8 and QUOTA01/03/04/05 are the current checks, not complete T2 acceptance.

Choose a separate opt-in migration004 and existing reviewed PGlite/Node, preserving migration001-003/default target1 and the existing Phase1 preview. Financial dimensions use BigInt internally and decimal integer strings across JSON boundaries; actual rates are exact registry metadata per1,000 tokens, never legacy placeholders or public USD observations. Lock entitlement/reservation state and a bounded-storage guard inside every operation. Local grants/adjustments require trusted DB staff; ordinary users can operate/read only their own synthetic resources. No staff mutation HTTP route is introduced before2.6 MFA. Ledger operations contain only bounded accounting identifiers/amounts; no prompts, files, key values or raw personal data.

All grants, reported usage and dispatch markers are synthetic fixtures; no model/payment/paid request is made. Unknown usage keeps a bounded hold until a configurable deadline commits the full conservative bound; append late authoritative-synthetic corrections without changing original estimate flags. Keep storage slots for closing/reconciling outstanding holds. Parent calls allocate within the task hold without a new debit; pause/review retain funds, terminal cleanup frees only unused funds, and in-flight allocations remain held. Implement read-only owned HTTP usage views behind explicit local ledger injection; complete router/chat ledger coupling belongs to Step2.4. Qualified release/legal/hosting and actual account evidence remain open. Record actual tests, coverage and independent/security review before DONE.

## LEDGER-LOCAL-002 — Verified Step2.2 implementation

Date:2026-10-13, Asia/Dhaka. Authorization: owner requests completing Step2.2 and its remaining work within LOCAL-PHASE2-001/LEDGER-LOCAL-001. The existing contract is implemented using opt-in migration004, exact BigInt/rational arithmetic and SQL text casts before PGlite's number parser, immutable signed rows/journal/alerts, transactional locking, actor-scoped replay, bounded unknown-usage deadlines, one linked correction, and parent task holds. Trusted DB staff supplies only synthetic grants/reports/dispatch; public endpoints read session-owned balances/history. Original migrations1–3, registry research, evaluation, prices/FX/quality flags, lockfile, and phase gates remain unchanged.

Local standalone100/20/12 and parent100/40/12 examples conserve availability/spend. Closure capacity includes an active parent's adjustment/re-reservation pair and final release. Unknown pending usage is displayed separately from estimated/resolved usage; zero CU does not imply all routes are refused, while positive-cost reserve/dispatch remains funded. The optional synthetic preview explicitly selects the original canned chat model alongside accounting fixtures; full chat/router ledger coupling remains2.4. The CLI's saved signed example persists under separate ignored ledger data and exclusive lock; no external transport/credentials or staff HTTP mutations are introduced.

Verification:46 Phase2+52 regression+2 browser tests PASS;33 reused coverage checks show98.68% lines/86.91% branches/100% functions for ledger only. Actual file reopen and immediate child-process exit preserve acknowledged rows/holds; up/down/reapply is on disposable databases only. Independent source review, performed from exact supplied code when reviewer tools hit a usage limit, found two MINOR display/refusal issues; observed failing regressions, fixes and source re-review close both. Reviewer did not execute additional probes. Actual4177 Alpha/Beta usage/history and launcher-lock smoke PASS; repeated fixture counts4/4/4 and88CU available/12CU spend are preserved. No package added, no actual key/provider/payment/spend/hosting/public or generated-code execution. Remote CI NOT RUN; original live/hosted acceptance stays open. Next Step2.3; revisiting real prices/FX/providers/payments/retention requires matching evidence and scoped authorization.

## GOVERNOR-LOCAL-001 — Step 2.3 contract and design

Date:2026-10-13, Asia/Dhaka. Owner requests Step2.3 within LOCAL-PHASE2-001. Size:high risk (shared quota admission, ownership, migration). AC: QUOTA-06/07 and local T2.1/T2.9; atomic all-scope request/token holds, exact floor(limit×safety factor) with default0.8, shared canonical pool ownership, fresh reset/window checks before synthetic dispatch, idempotency, safe cancellation/uncertain-usage reconciliation, independent review, and rollback/restart/bounded closure evidence. Fair share uses exact token units and configured trust caps/expected users, guards zero users, and keeps request limits separate.

Choice: new opt-in migration005 and existing reviewed Node/PGlite; preserve migrations1–4/default target1, isolated preview/data, frozen registry/evaluation/financial records and disabled research providers. Synthetic pool configuration uses a strict provider→account→model quota tree with canonical ownership and every applicable metric/window checked together. Immutable limit snapshots, current pool statuses and registry eligibility govern admission; unknown or undeclared scope/daily quota evidence fails closed. Provider/account/model daily budgets aggregate without duplicating shared nodes; request-only daily pools use an explicitly configured conservative tokens/request conversion. Exact decimal safety math and BIGINT text reads preserve integer precision.

Every mutation locks a storage guard and appends a minimal actor-scoped journal/event. Predispatch release differs from dispatched request consumption and bounded unknown token holds; reset-window rebinding is atomic before a dispatch marker. Durable bounded maintenance resolves deadlines and preserves capacity for closing existing holds. Staff-only local pool/route setup and fair-share jobs create synthetic policy snapshots; user reads/operations are owned. No staff HTTP surface, credentials, provider/payment/paid traffic, actual vendor-quota inference, money/token grant, or deployment is introduced. Complete router/chat/ledger admission coupling belongs to2.4; staff MFA2.6, real monitoring/alerts2.8, hosted/retention and full phase acceptance stay open.

## GOVERNOR-LOCAL-002 — Verified Step 2.3 implementation

Date:2026-10-13, Asia/Dhaka. Local Step2.3 is DONE within LOCAL-PHASE2-001/GOVERNOR-LOCAL-001. New opt-in migration005 and the Governor service implement immutable canonical pool/limit/route definitions, exact floor safety math, all-scope/window transactional admission, current eligibility, reset rebinding, owned reservation/policy reads and trusted synthetic staff jobs. Request quota is consumed at dispatch; unknown tokens remain bounded through durable deadline estimates and one old-counter correction. Immutable journals/events and closure capacity bound storage. The daily policy aggregates the strict quota tree without shared duplication, floors fair share and uses an explicit conservative request conversion; it issues no money grant. Quotas/reset anchors/trust caps/expected100/50tokens-per-request are synthetic assumptions.

Independent review reproduced a MAJOR reset race during awaited writes beyond the earlier check. A final expiry/all-window guard now runs after every awaited application write before dispatch completion; allocation/journal/storage/last-time probes independently confirm rollback with holds restored and no marker/event/journal. Nine boundary tests also verify exact SQL integers above2^53, revoked replay, conflicting not-applicable scopes and six-worker maintenance with one estimate/count/correction. No unresolved scoped substantive finding.

Verification:92 Phase2+52 regression tests PASS, types/lint/formatter/build PASS;46 reused Governor coverage tests show99.50% lines/89.21% branches/100% functions, arithmetic100%. Two persistent CLI runs/reopens preserve counts/IDs:4 pools,16 limits,2 routes,16 counters,2 reservations,24 allocations,13 operations/events,1 job,2 policy rows,6 registry versions; ledger grants/rows0. Shared usage2requests/40tokens and conservative39900-token remaining budget yield399tokens/user; lock refusal preserves the active lock and ledger4177 remains HTTP200. Root independently verifies saved state. Initial formatting and smoke expected-value issues were corrected and rerun; local secret scan PASS. No dependency, credentials, actual provider/payment/paid call/spend/hosting/public or generated-code execution. Original migrations1–4/research/evaluation/financial records and phase gates stay preserved; remote CI NOT RUN. Step2.4 joint router/chat/ledger/Governor coupling is next, with staff MFA2.6 and actual alert delivery2.8 still future.

## ROUTER-LOCAL-001 — Step 2.4 contract and design

Date:2026-10-13, Asia/Dhaka. Owner clarifies Step2.4 only;2.5 stays TODO. High risk: funded/shared admission, retries, provenance and migration. AC: ROUTE-02/03/04/09–14, CHAT-03/04/05, component T2.2/T2.3 and joint T2.1/2.4/2.8/2.9; capability/context/eligibility filtering, registry exact rates and funded paid routes, every-call ledger/Governor checks, bounded retries/fallbacks/circuit breakers, model/preset overrides, explicit context trimming and separate partial-stream attempts, owned replay/retry/regenerate and durable routing records. Independent/security review and executed tests/coverage/browser evidence precede DONE.

Use existing Node/PGlite and an opt-in migration006; preserve originals1–5 and current previews/data. Compose ledger/Governor service operations on one outer transaction before transport; no provider dispatch may precede both funded and capacity markers. Each attempt gets a separate financial/capacity bound; unknown dispatched usage stays held through deadlines/corrections. Provider/model circuit failure windows and policy versions persist. Automatic resend stops immediately after any streamed output; explicit user retry/regenerate uses a durable shared request-family budget. Reject unknown context/rates/capabilities; trim whole old turns while preserving the newest user turn and reserve output/system context using the known synthetic tokenizer. Never claim real tokenization or fabricate quality/latency.

Keep ordinary Phase1 behavior behind optional Router injection; enable Router UI/models/attempts only for separate synthetic fixture/launcher. New pending assistant rows may carry no model until actual dispatch proves provenance; empty predispatch refusals must never claim an answer. Private attempt content follows owned chat deletion, while bounded minimal journals retain pseudonymous decision evidence. No admin HTTP mutation before2.6 MFA, abuse implementation before2.5, private/training route activation before2.9, external traffic/credentials/payment/spend/hosting or generated-code execution. Local fixture paid labels/rates/funds and free policy are synthetic only; actual provider use remains deferred.

## ROUTER-LOCAL-002 — Verified Step 2.4 implementation

Date:2026-10-13, Asia/Dhaka. Step2.4 is DONE only within LOCAL-PHASE2-001/ROUTER-LOCAL-001; the owner explicitly chose2.4 only, so2.5 stays TODO. Opt-in migration006, Router context/policy/service, optional API/repository/UI integration and a separate persistent launcher implement funded shared admission and owned attempt provenance with existing dependencies. Every synthetic attempt joins ledger/Governor reserve/dispatch in one transaction, with exact registry toy rates and per-user combined daily policy enforcement. Prefer eligible free models; paid-flag canned fixtures require funded bounds. Prepared requests retain their immutable policy version while current registry/funding/capacity is rechecked. Retry/regenerate share the original durable family budget, capabilities remain strict on fallback, and partial output forbids automatic resend.

Private attempt content cascades with owned chat deletion, but minimal content-free accounting holds survive for one deadline estimate/late correction. Post-commit cancellation before gateway entry uses an internal zero-use proof to restore signed funds and all request/token quota; caller claims cannot invoke this path. Started uncertain transport remains held. Provider/model failures persist across successes within the failure window; healthy user stops do not count. Daily fixture policy generation captures its local day under the Governor guard in a joint transaction, rejects day crossing before commit and retries once after rollback; it creates no money grants. Original Governor/schema code is unchanged by the fixture day fix.

Final evidence:133 Phase2+52 regression+6 browser checks PASS (191 unique), including41 Router unit/API/boundary/durability/dry-run/day and4 Router browser cases. Router measured coverage96.62% lines/87.93% branches/97.30% functions reuses38 tests; later dry-run/day cases independently pass. Types/lint/formatter/build and final fixture lint/format PASS. Initial parallel suite execution hit V8/PGlite memory failures; final serial exposed-GC/one-WASM-compilation-task runs passed. The first wrapper test stage was not a passing full `phase2-check`; its static stages and separate final tests supply the evidence. [PHASE2_REPORT](PHASE2_REPORT.md) records exact commands and corrected early harness/browser assumptions.

Independent review closes four MAJOR policy/transport/cancellation-classification/breaker-window findings plus the commit-boundary cancellation follow-up and one MINOR midnight key race. Reviewer independently passes7 boundary and2 day regressions and capability/funding/pinned manual-fallback probes. No scoped issue remains. Two persistent no-argument CLI runs preserve selected accounting/configuration table rows, grants3/pools5/limits20/routes3/job1/policies2/Router policy version1/event1 before traffic; held-lock refusal preserves its marker. Hidden4178 preview PID23120 passes actual owned Alpha/Beta/model/history/replay/auth smoke; ledger4177 PID15112 stays HTTP200. Data directories/locks remain separate and active preview databases must not be opened concurrently.

No dependency/lockfile change, credentials, actual provider/payment/paid traffic, real spend, hosting/public exposure or generated-code execution. Synthetic expected1/1000tokens-per-request, toy rates/quality, free daily1000 and Alpha100CU pack remain assumptions; actual capacity/tokenization/context/quality/FX/headers and hosted retention/durability/legal acceptance are unknown. Preserve migrations1–5, frozen research/evaluation/financial/dependency evidence, append-only journals/history and deferred original gates. Staff web/MFA2.6, simulator/dashboard/delivery2.8, private routing2.9 and full T2/phase acceptance2.10 remain future; remote CI NOT RUN.

## ABUSE-LOCAL-001 — Step 2.5 contract and design

Date:2026-10-13, Asia/Dhaka. Owner explicitly requests Step2.5, superseding the earlier2.4-only limit for this new step. High risk: trust, source pseudonyms, authentication, shared usage and moderation. AUTH-05/ABUSE-01–04/07: new actors start at trust0, configurable0–3 limits rise only with configured age/verified-contact/good-behavior evidence; signup and suspicious bursts require an equivalent challenge; hashed device/IP-range clusters and durable new-account source caps; trusted moderator suspend/throttle/ban actions record bounded reason codes. Tests cover ownership/role/replay/revocation, concurrency/reset/restart, failed joint admission, privacy and challenge nonce/source/purpose/TTL/single-use. Independent review, browser checks, coverage and actual local evidence precede DONE.

Use existing Node/PGlite with opt-in migration007, preserving1–6/default1 and all active previews/data. A server-generated durable local HMAC key pseudonymizes opaque device cookies and canonical socket IP ranges; browser body/forwarding/trust fields cannot supply authority. Equivalent local proof-of-work uses a server-minted bound nonce, bounded proof and transactional single-use validation. This is a labeled local anti-automation challenge, not proof of a unique human or production CAPTCHA acceptance. No external verification service is called. Optional abuse injection leaves original Phase1/Router fixtures unchanged; a separate4179 fixture will exercise protected signup/chat.

An outer abuse guard precedes API/user/Router/ledger/Governor locks. Owned logical request creation and source/user-cap debit commit together; replay does not debit twice. Every model attempt rechecks current moderation and trust against its saved owned admission before funded/capacity dispatch; cached Governor policy cannot weaken current trust caps. Minimal cluster/moderation events contain pseudonyms/counts/reason codes, never prompts/raw IP/device identifiers/contact values. New-account deletion/re-registration cannot reset source counters. Staff mutation/alert web screens wait for2.6/2.8; their trusted service contracts can be tested now. No dependency, actual Google/provider credentials/traffic, payments/spending, hosting/public exposure or generated-code execution is authorized by this step. Original live/hosted/privacy/retention/legal gates remain open.

## ABUSE-LOCAL-002 — Implementation checkpoint, no acceptance

Date:2026-10-13, Asia/Dhaka. Owner asks to complete remaining Step2.5 work. Independent module/UI builders authored the Abuse module/migration007, initial service/browser cases and optional local verification/trust UI; root authored migration registration, optional API/Router admission composition, signed HttpOnly device-cookie handling, separate fixture/launcher and5 HTTP cases, plus package/wrapper/CI wiring. Local launcher uses a separate persistent HMAC key, refuses a missing key with nonempty existing data and never opens another preview's database. Google-enabled plus synthetic abuse configuration is refused before real transport; existing Google preparation stays separate. Later staff/admin HTTP and public release remain unimplemented.

Builders reported preliminary core syntax/format and UI typecheck before usage exhaustion; those reports are not root final execution evidence. Final source inspection/integration tests, migration reversibility/durability, all DB/browser/regression suites, coverage, independent finished-source/security review, persistent CLI/replay/lock/preview and final secret/hash/docs checks are NOT RUN. Automatic approval review failed before executing a local read because its usage limit was reached, explicitly not an unsafe-action finding. Its message gives retry time11:08PM. A lower-permission workspace read then also failed with sandbox setup helper_unknown_error. No approval check was bypassed. Continue verification when tools/review recover; do not claim Step2.5 DONE or reuse prior191 checks as final evidence for changed code. Root created no persistent abuse data/key/lock or4179 preview and did not restart/delete/open earlier live previews. All real traffic/spend/hosting and original gates stay deferred.

## ABUSE-LOCAL-003 — Verified Step2.5 implementation

Date:2026-10-14, Asia/Dhaka. The owner's resumed instruction completes Step2.5 only. The interrupted ABUSE-LOCAL-002 checkpoint is historical; normal execution/review recovered. Step2.5 DONE under LOCAL-PHASE2-001: opt-in migration007, configured trust0–3, bound local signup/burst challenge, stable HMAC source caps/cluster alerts, current trusted moderation/immutable audit, optional API/Router/UI and isolated persistent4179 launcher. Preserve1–6/default1, frozen canonical/research/evaluation/dependency/lockfile evidence and append-only history.

Every route enforces current trust tokens/concurrency; free routes additionally obey Governor policy. One admitted logical request consumes one allowance even if later funding/capacity refuses; completed replay does not. Every attempt rechecks current authority under a guard with final synchronous commit callbacks after all awaited outer writes. Ban stops new dispatch while existing uncertainty closes/estimates/corrects without resend/refund. Expired suspension restores a valid owned session. Durable database fingerprint binding rejects replacement HMAC keys before callback/writes and prevents pseudonym/quota reset; key backup must accompany data.

166 Phase2 + 52 regression + 9 browser checks PASS (227 unique); Abuse 98.86% lines/84.8% branches/100% functions; types/lint/formatter/build PASS. Independent four MAJOR findings and key/concurrency follow-ups closed; local browser/durability/replay/lock/actual4179 smoke pass. [PHASE2_REPORT](PHASE2_REPORT.md) records failed checks, exact final evidence and open practical limits. The proof is not human verification and does not grant trust. Signed device/socket-derived IP signals are not browser authority. Minimal cluster records are delivered to the trusted service now; admin identity/MFA2.6 and screens/delivery2.8 remain future.

No new packages/lockfile, actual credentials/provider/payment/spend/hosting/public/generated-code execution. Actual anti-bot capacity/mobile costs, hashed-signal retention/deletion, hosted key lifecycle/durability/roles/backup and legal/release remain unknown. Remote CI NOT RUN. Steps2.6–2.10/fullphase/original gates remain open; next2.6, no new phase acceptance or public/free-service claim.

## ADMIN-LOCAL-001 — Step 2.6 Control Center foundation contract and design

Date: 2026-10-15, Asia/Dhaka. Owner explicitly requested Step 2.6 within LOCAL-PHASE2-001. Size: high risk (separate staff authentication, roles/permissions RBAC, MFA, append-only audit, config versioning & rollback, kill switches). AC mappings: AP-01 (separate admin scope / user sessions 403 on `/admin/*`), AP-02 (RBAC system & custom roles), AP-03 (config versioning & rollback), AP-04 (MFA for staff), AP-05 (append-only audit log), AP-09 (hierarchical kill switches). Phase 2 criteria: T2.5 (kill switch immediately disables provider/model), T2.6 (config rollback restores prior routing behavior), T2.7 (admin routes return 403 for non-staff and require MFA for staff).

Choice: new opt-in migration 008 (`008_admin.up.sql` / `008_admin.down.sql`) and dedicated `packages/admin` service (`packages/admin/index.mjs`, `packages/admin/totp.mjs`, `packages/admin/defaults.json`). Existing dependencies (Node crypto, PGlite) implement RFC 6238 TOTP, SHA-256 HMAC tokens, and append-only database triggers (`reject_append_only_change()`) on `config_revisions` and `admin_audit_log` preventing UPDATE, DELETE, and TRUNCATE. Separate admin route handling in `packages/api/server.mjs` enforces `/admin/*` boundary isolation: user sessions receive 403 `ADMIN_FORBIDDEN`; unauthenticated requests to `/admin/api/*` receive 401 `STAFF_AUTHENTICATION_REQUIRED`; staff sessions require step-up TOTP verification or receive 403 `MFA_REQUIRED`.

Hierarchical kill switches (`all_ai`, `provider:*`, `model:*`, `free_tier`, `paid_routes`, `signups`, `file_uploads`, `agent_mode`) are checked transactionally before chat admission and provider dispatch; activating a parent switch immediately halts child operations with 503 `KILL_SWITCH_ACTIVE`. Configuration changes append to `config_revisions` with actor attribution, before/after snapshots, reason codes, and idempotency keys; one-click rollback restores prior state and appends a rollback revision. All administrative mutations record immutable events in `admin_audit_log`.

Scope boundaries: local synthetic scope only. No external provider credentials or live network calls; mock TOTP secrets and synthetic staff accounts only. Steps 2.7–2.10 remain future; remote CI NOT RUN.

## ADMIN-LOCAL-002 — Verified Step 2.6 implementation

Date: 2026-10-15, Asia/Dhaka. Step 2.6 is DONE under LOCAL-PHASE2-001 / ADMIN-LOCAL-001. Migration 008, `packages/admin`, and `tools/phase2/admin.mjs` implement the complete Control Center foundation. All acceptance criteria verified with passing local evidence:

1. AP-01 & T2.7: Strict scope separation verified over HTTP and Playwright browser integration. User sessions accessing `/admin` or `/admin/api/*` receive 403 `ADMIN_FORBIDDEN`. Anonymous access to `/admin/api/*` returns 401 `STAFF_AUTHENTICATION_REQUIRED`.
2. AP-02: RBAC enforced with 4 system roles (`super_admin`, `operator`, `moderator`, `auditor`) and custom role creation/update with protected system roles. Unauthorized staff actions rejected with 403 `INSUFFICIENT_PERMISSIONS`.
3. AP-03 & T2.6: Append-only config revisions and one-click rollback verified. Rollback of kill switches and routing policies restores prior behavior and appends a new revision with full actor/reason attribution. Database triggers block UPDATE/DELETE/TRUNCATE on `config_revisions`.
4. AP-04 & T2.7: RFC 6238 TOTP MFA enforced for staff. Initial staff login without TOTP code yields session with `mfaRequired: true`; protected endpoints return 403 `MFA_REQUIRED` until step-up elevation via `/admin/api/auth/mfa`. Logout revokes staff session cookies and database records.
5. AP-05: Append-only `admin_audit_log` records all administrative mutations (login, MFA, kill switches, config rollback, role updates) with actor attribution, target, and metadata. SQL triggers reject any UPDATE, DELETE, or TRUNCATE.
6. AP-09 & T2.5: Kill switches toggle immediately over HTTP API. Enabling `all_ai` or specific model switches immediately halts user chat requests with 503 `KILL_SWITCH_ACTIVE`. Disabling or rolling back the switch immediately restores chat traffic.

Verification evidence:
- 16/16 admin unit tests in `tests/unit/phase2-admin-*.mjs` PASS.
- 1/1 Playwright browser integration test `tests/integration/phase2-admin-browser.mjs` PASS.
- 182/182 Phase 2 unit tests in `tests/unit/phase2*.mjs` PASS.
- 45 Phase 1 tests, 2 security tests, 5 prototype tests all PASS (zero regressions).
- Code coverage for `packages/admin/*.mjs`: 90.48% lines, 76.26% branches, 97.30% functions (exceeding 70% threshold).
- Static checks: TypeScript `npm.cmd run typecheck` PASS (0 errors), ESLint `npm.cmd run lint` PASS (0 errors), Prettier `npm.cmd run phase2:format:check` PASS (0 warnings).
- Secret scanner `tools/scan-secrets.ps1` PASS: `PASS: no secret findings in the working tree.`
- Launcher `tools/phase2/admin.mjs` executes cleanly on port 4180 with seeded `super_admin` (`SYNTHETIC_SEED.userA`).

No new third-party npm runtime dependencies added. No real provider credentials, real payments, or hosted deployment. Remote CI NOT RUN. Steps 2.7–2.10 remain open; next: Step 2.7.

## ADMIN-LOCAL-003 — Step 2.7 Control Center core modules implementation

Date: 2026-10-15, Asia/Dhaka. Step 2.7 is DONE under LOCAL-PHASE2-001. Core modules M1–M6, M11, M14, and M16 are implemented in `packages/admin/index.mjs` and routed in `packages/api/server.mjs`. All modules adhere to strict synthetic scope, RBAC permission checks, append-only config revisions with rollback, and immutable audit logging.

Implemented modules and capabilities:
1. M1 Overview dashboard: Aggregated live metrics (`requests`, `errors`, `latency`, `freePoolRemaining`, `spend`, `activeUsers`, `activeAgentTasks`, `recentAlerts`) synthesized from `router_attempts`, `ledger_entitlements`, and `abuse_cluster_alerts`.
2. M2 Providers lifecycle: Add, edit, test-call, list, and rollback providers. Supports data policy flags, `allows_multiuser`, terms URLs, and review dates.
3. M3 Models lifecycle: Add, edit, list, and rollback models. Configures CU rates (`cu_in_rate_per_1k`, `cu_out_rate_per_1k`), capabilities, context limits, `agent_ready`, Bangla score, and free/funded visibility.
4. M4 Routing & capacity: Routing policy CRUD with config revision history, AP-06 dry-run simulator endpoint (`/admin/api/routing/simulate`) with language/preset heuristics, circuit breakers view, and capacity pools/limits queries.
5. M5 Users management: Search users, inspect details and balances, apply moderation actions (`suspend`, `throttle`, `ban`, `none`) with reason and expiry, update tier (`free`, `funded`, `premium`), and adjust ledger balances with immutable `usage_ledger` entries.
6. M6 Roles & staff: Staff MFA reset (generates new mock secret and revokes active sessions) and paginated staff activity audit logging.
7. M11 Abuse & moderation: View abuse cluster alerts and moderation queue from `abuse_cluster_alerts` and `abuse_moderation`.
8. M14 Secrets vault UI: Write-only secret reference management, secret rotation generating sha256-derived `sec-*` references (never exposing raw secret values), and emergency secret revocation.
9. M16 Audit & compliance: Searchable, filterable audit log viewer and AP-10 compliant CSV export (`/admin/api/audit/export`) which automatically records an immutable `AUDIT_LOG_EXPORTED` audit entry.

Verification evidence:
- 10/10 module unit tests in `tests/unit/phase2-admin-modules.mjs` PASS.
- 16/16 admin foundation unit tests in `tests/unit/phase2-admin-*.mjs` PASS.
- 1/1 Playwright browser integration test `tests/integration/phase2-admin-browser.mjs` PASS.
- TypeScript `npm.cmd run typecheck` PASS.
- ESLint `npm.cmd run lint` PASS (0 errors, 0 warnings).
- Prettier `npm.cmd run phase2:format:check` PASS (all files use Prettier style).
- Secret scanner `tools/scan-secrets.ps1` PASS (`PASS: no secret findings in the working tree.`).
- All privileged mutations audited in `admin_audit_log` (AP-05, AP-10).
- All config mutations record revision history in `config_revisions` with rollback (AP-03, T2.6).
- User session isolation enforced with 403 `ADMIN_FORBIDDEN` on `/admin/*` (AP-01, T2.7).
- RBAC permissions enforced before schema parsing (AP-02).

## ADMIN-LOCAL-004 — Step 2.8 Routing simulator, health monitoring, and alert dispatcher

Date: 2026-10-15, Asia/Dhaka. Step 2.8 is DONE under LOCAL-PHASE2-001. Migration 009 (`packages/db/migrations/009_monitoring.up.sql`), service extensions in `packages/admin/index.mjs`, and API endpoints in `packages/api/server.mjs` implement the complete routing simulator, capacity dashboard, health monitoring, and owner alerting system.

Implemented features & architectural decisions:
1. Migration 009 & DB schema:
   - `owner_alerts`: records platform alert events (`CIRCUIT_BREAKER_OPEN`, `CAPACITY_EXHAUSTION`, `OUTAGE`, `ABUSE_SPIKE`, `SYSTEM_ERROR`) with severity (`info`, `warning`, `critical`, `fatal`), title, message, delivery channel (`webhook`, `in_app`, `email_log`, `sms_log`, `custom`), status (`PENDING`, `DELIVERED`, `FAILED`, `DISMISSED`), metadata, resolved timestamps.
   - `alert_delivery_attempts`: append-only immutable audit trail recording every delivery dispatch attempt, status (`SUCCESS`, `FAILED`), response code, error message, and latency. Enforced with SQL trigger `reject_append_only_change()` rejecting UPDATE, DELETE, or TRUNCATE.
2. AP-06 Zero-mutation routing simulator:
   - Evaluates prospective prompts, language, task presets (`general`, `coding`, `writing`, `research`), user tiers (`free`, `funded`, `premium`), and dynamic circuit breaker states.
   - Accurately predicts candidate ranking, selection, token usage, cost, and fallback chains without generating any database writes, ledger holds, or network calls.
   - Automatically disqualifies models whose circuit breaker or parent provider breaker is OPEN.
3. OPS-05 System & component health monitoring:
   - Endpoints `/health`, `/api/health`, and `/admin/api/monitoring/health` report live status (`ok`, `degraded`, `unhealthy`), uptime, database health, provider pool counts, open circuit breakers count, and unresolved alerts count.
   - Injected clock support (`options.clock`) ensures synthetic tests and production runtimes report consistent breaker window states.
4. OPS-05 Owner alert delivery & retry dispatcher:
   - `registerAlertSink`: supports registering delivery handlers for `in_app`, `webhook` (with HMAC signature verification), and custom sinks.
   - `createOwnerAlert`, `dispatchAlertRecord`, and `retryAlertDelivery` create, attempt dispatch, log append-only attempts, and update alert status.
   - Delivery verification test passes locally before Step 2.8 closure.
5. OPS-06 Provider outage chaos test & fault isolation:
   - Verified that one provider's failure does not affect the rest of the application.
   - Model A network failure triggers transparent fallback to Model B.
   - Breached failure threshold trips circuit breaker to OPEN state, cleanly isolating traffic.
   - Subsequent requests to blocked routes reject fast at admission with 503 `NO_ELIGIBLE_MODELS` without attempt overhead or hung connections.
   - Platform health reports `degraded`, while admin API, user management, and audit logs remain 100% operational.
   - Clock advancement past `coolOffMs` resets the breaker and restores traffic.

Verification evidence:
- 6/6 unit tests in `tests/unit/phase2-simulator-alerts.mjs` PASS.
- 17/17 regression unit tests in `tests/unit/phase2-admin-modules.mjs` and `tests/unit/phase2-router-boundaries.mjs` PASS.
- TypeScript `npm.cmd run typecheck` PASS.
- ESLint `npm.cmd run lint` PASS (0 errors, 0 warnings).
- Prettier `npm.cmd run phase2:format:check` PASS (all files use Prettier style).
- Secret scanner `tools/scan-secrets.ps1` PASS (`PASS: no secret findings in the working tree.`).
- No external provider credentials, live keys, real payments, or remote CI executed.

## ADMIN-LOCAL-005 — Step 2.9 Private routing & training-data notice

Date: 2026-10-15, Asia/Dhaka. Step 2.9 is DONE under LOCAL-PHASE2-001. Router policy extensions in `packages/router/policy.mjs`, router core in `packages/router/index.mjs`, admin simulator in `packages/admin/index.mjs`, and API endpoints in `packages/api/server.mjs` implement private mode routing constraints, fallback privacy invariance, and training-data notice delivery.

Implemented features & architectural decisions:
1. ROUTE-05 & PRIV-03 Private routing policy:
   - When request sensitivity is `'private'` or `privateMode` is `true`, `rankRoutingCandidates` strictly eliminates any provider whose `dataPolicy === 'may_train'` with rejection reason `TRAINING_POLICY_FORBIDDEN`.
   - Rejection occurs before candidate scoring or reservation; private requests never reach `may_train` providers even if capacity or free quota is abundant.
   - Explicit overrides (`mode: 'manual'` or `mode: 'pinned'`) cannot bypass private mode restrictions: attempting to pin a `may_train` model in private mode results in `NO_ELIGIBLE_MODELS`.
2. Fallback privacy invariance:
   - During primary route network failure, fallback route planning preserves request sensitivity (`sensitivity: 'private'`).
   - If only `may_train` models remain, fallback is refused rather than leaking conversation data to training-enabled providers.
3. ROUTE-07 Training-data notice & session tracking:
   - When a free route chooses or considers a candidate on a `may_train` provider, `trainingNoticeRequired: true` is computed.
   - Training notice URL points to `/legal/privacy.html`.
   - Once-per-session tracking in `packages/api/server.mjs`: `sessionTrainingNotices` tracks notice delivery per session ID.
   - Endpoints `GET /api/privacy/training-notice` and `POST /api/privacy/training-notice/ack` query and acknowledge notice status; session logout clears notice state.
4. AP-06 Routing simulator sensitivity evaluation:
   - `simulateRouting` accepts `sensitivity` and `privateMode` parameters.
   - Disqualifies `may_train` models when simulated in private mode, correctly predicting candidates, fallback chains, and `trainingNoticeRequired`.

Verification evidence:
- 5/5 unit tests in `tests/unit/phase2-private-routing.mjs` PASS.
- 22/22 regression unit tests in `tests/unit/phase2-simulator-alerts.mjs`, `tests/unit/phase2-admin-modules.mjs`, `tests/unit/phase2-router-policy.mjs`, and `tests/unit/phase2-router-api.mjs` PASS.
- TypeScript `npm.cmd run typecheck` PASS.
- ESLint `npm.cmd run lint` PASS (0 errors, 0 warnings).
- Prettier `npm.cmd run phase2:format:check` PASS.
- Secret scanner `tools/scan-secrets.ps1` PASS (`PASS: no secret findings in the working tree.`).
- No external provider credentials, live keys, real payments, or remote CI executed.

## ADMIN-LOCAL-006 — Step 2.10 Phase 2 T2.1–T2.9 Verification & Scoped Local Acceptance

Date: 2026-10-15, Asia/Dhaka. Step 2.10 is DONE under LOCAL-PHASE2-001. All Phase 2 subsystems—Registry (2.1), Usage Ledger (2.2), Capacity Governor (2.3), Router (2.4), Abuse & Trust (2.5), Control Center Core (2.6), Admin Modules (2.7), Simulator & Alerts & Chaos (2.8), and Private Routing (2.9)—have been completely implemented, verified, and regression-tested.

Acceptance Verification Matrix (T2.1–T2.9):
- **T2.1 Exhausted Provider Pool Admission Rejection**: Verified in `tests/unit/phase2-governor.mjs` and `tests/unit/phase2-router.mjs`. Requests fail gracefully with `NO_ELIGIBLE_MODELS` without invoking a provider transport. -> **PASS**
- **T2.2 Zero-Balance Paid Route Invariance**: Verified in `tests/unit/phase2-router.mjs` and `tests/unit/phase2-router-api.mjs`. Free preference is absolute; with zero balance, positive-cost routes are never dispatched. -> **PASS**
- **T2.3 Retry Budget Invariance under Failure**: Verified in `tests/unit/phase2-router.mjs` and `tests/unit/phase2-router-durability.mjs`. Retries and fallbacks strictly consume durable family budget; retry/regenerate share original budget. -> **PASS**
- **T2.4 Concurrent Ledger Balance Integrity**: Verified in `tests/unit/phase2-ledger.mjs`. Concurrent reservations and settlements preserve sum-of-rows balance without overspending. -> **PASS**
- **T2.5 Kill Switch Instant Disablement**: Verified in `tests/unit/phase2-admin-killswitches.mjs` and `tests/unit/phase2-admin-api.mjs`. Kill switches disable all AI, provider, or model traffic immediately within the configured check window. -> **PASS**
- **T2.6 Config Rollback Provenance & Restoration**: Verified in `tests/unit/phase2-admin-rollback.mjs` and `tests/unit/phase2-admin-api.mjs`. Rollback creates an append-only revision restoring previous routing policy or configuration state. -> **PASS**
- **T2.7 Admin Scope Isolation & MFA Enforcement**: Verified in `tests/unit/phase2-admin-auth.mjs`, `tests/unit/phase2-admin-api.mjs`, and `tests/integration/phase2-admin-browser.mjs`. User sessions receive 403 `ADMIN_FORBIDDEN` on `/admin/*`; staff routes require valid TOTP MFA elevation. -> **PASS**
- **T2.8 Cancellation Hold Retention & Late Correction**: Verified in `tests/unit/phase2-ledger.mjs` and `tests/unit/phase2-router.mjs`. Cancelled in-flight requests retain bounded hold until deadline, and one late correction reconciles ledgers. -> **PASS**
- **T2.9 Multi-Model Shared-Pool Governor Isolation**: Verified in `tests/unit/phase2-governor.mjs`. Concurrent requests across multiple models sharing a provider/account pool cannot duplicate quota or overrun the pool. -> **PASS**

Verification Evidence Summary:
- 203/203 Phase 2 unit tests in `tests/unit/phase2*.mjs` PASS.
- 9/9 Phase 2 browser integration tests in `tests/integration/phase2*.mjs` PASS.
- Total: 212 automated Phase 2 tests PASS.
- TypeScript `npm.cmd run typecheck` PASS.
- ESLint `npm.cmd run lint` PASS (0 errors, 0 warnings).
- Prettier `npm.cmd run phase2:format:check` PASS.
- Secret scanner `tools/scan-secrets.ps1` PASS.
- Scoped Boundary: Local synthetic scope complete. STOP: owner accepts admin/router behavior; additional providers need approval before traffic. Phase 3 (Files, Productivity, First Public Release) remains next.

## PROD-LOCAL-001 — Phase 3 Step 3.1: Productivity Presets & Bangla Evaluation Quality Bar

Date: 2026-10-15
Context: Phase 2 closed locally following owner acceptance. Phase 3 commences under SRS v2.1.1 and `BUILD_GUIDE.md` Step 3.1. Requirements: `WRITE-01` to `WRITE-05`.
Decision: Implement dedicated productivity presets package (`packages/productivity/`), integrating with router defaults, policy validation, and chat endpoints.

Key Implementations:
1. **WRITE-01 (Drafting, rewriting, grammar, tone)**: Preset `writing` with tasks `draft`, `rewrite`, `grammar`, `tone`. 7 supported tone styles (`formal`, `casual`, `professional`, `academic`, `empathetic`, `concise`, `persuasive`) in both English and natural Bengali (`bn`).
2. **WRITE-02 (Translation & Bangla quality bar)**: Preset `translation` with bidirectional `en->bn` and `bn->en` translation. Evaluated against the 15 canonical Bangla test cases in `tests/eval/suite.json`: 15/15 PASS (100%), satisfying the 85% configured quality bar and passing all 3 critical cases (`BN07`, `BN08`, `BN09`).
3. **WRITE-03 (Summarization & simplified explanations)**: Preset `summary` supporting styles: `executive`, `bullets`, `tldr`, and `simplified` (ELI5 / Explain Like I'm 5) on arbitrary text.
4. **WRITE-04 (Structured outputs)**: Support for `table` (Markdown tables with headers), `outline` (hierarchical indented bullets), and `json` (schema-validated JSON output checking types, required properties, and nested shapes).
5. **WRITE-05 (Input limits & safe chunking)**: Enforces `INPUT_EXCEEDS_LIMIT` with clear descriptive explanation of character/token length and suggested chunks. Provides `chunkContent()` helper splitting oversized documents into bounded chunks preserving paragraph and sentence boundaries.
6. **Router & API Integration**: Updated router defaults, `validatePolicy()`, `resolveRoutingSelection()`, and `packages/api/server.mjs` to accept `translation` and `summary` presets and `productivity` options without breaking backward compatibility.

Evidence:
- `npm run phase3:test`: 6/6 unit tests PASS.
- `node --test tests/unit/phase2-router*.mjs`: 41/41 router tests PASS.
- `npm run typecheck`, `npm run lint`, `npm run phase3:format:check`: all PASS.
- `tools/scan-secrets.ps1`: PASS.
- Documentation: `docs/PHASE3_REPORT.md`, `docs/BUILD_GUIDE.md`, and `docs/REQUIREMENT_TRACEABILITY.md` updated.
- Next: Step 3.2 (File upload pipeline for PDF, TXT, CSV).

## FILE-LOCAL-001 — Phase 3 Step 3.2: Safe PDF/TXT/CSV Ingestion, Limits, and IDOR Prevention

Date: 2026-10-15
Context: Step 3.2 of Phase 3 under SRS v2.1.1 and `BUILD_GUIDE.md`. Requirements: `FILE-01..03`, `FILE-06`, `FILE-07`, `SEC-10`, `PRIV-05`, `PRIV-06`, `T3.1`.
Decision: Implement dedicated files package (`packages/files/`), database Migration 10 (`010_files.up.sql`), per-user isolated storage, and API endpoints with strict content inspection, formula injection protection, and IDOR enforcement.

Key Implementations:
1. **Database Migration 10 (`files` table)**: Created `files` table with `id`, `user_id`, `filename`, `sanitized_name`, `mime_type`, `size_bytes`, `sha256`, `storage_path`, `extracted_text`, `text_chars`, `estimated_tokens`, `status`, `metadata`, `created_at`, `deleted_at`. Strict CHECK constraints enforce supported MIME types, size bounds (up to 10 MB), sha256 regex, non-negative tokens, and `UNIQUE(id, user_id)`.
2. **Content Sniffing & Hostile Format Refusal (`FILE-01..02`, `T3.1`)**: `sniffContentType()` inspects magic bytes. Validates PDF (`%PDF-`) and valid UTF-8 text. Refuses hostile binary signatures: Windows PE (`MZ`), Linux `ELF`, `Mach-O`, ZIP archive `PK\x03\x04` (ZIP deferred to Phase 4, DOCX deferred), GZIP, 7-Zip, RAR, script shebang `#!/`, PHP, HTML/script tags, and binary/null bytes. Enforces size limits (`FILE_TOO_LARGE` on > 10 MB) and non-empty checks (`FILE_EMPTY`).
3. **Filename Sanitization & Path Traversal Protection (`FILE-02`)**: `sanitizeFilename()` strips Unix/Windows directory paths (`../`, `..\\`), null bytes, control characters, and reserved Windows device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1..9`, `LPT1..9`).
4. **CSV Formula Injection Defense & Safe Extraction (`FILE-03`)**: Safe stream-based PDF extraction (`BT..ET`, `Tj`, `TJ`, literal string escapes), UTF-8 text normalization, and CSV quote-aware parsing. `checkCsvFormulaInjection()` detects formula triggers (`=`, `+`, `-`, `@`, `\t`, `\r`) in cells and escapes them with leading `'` in extracted text.
5. **Per-User Isolated Storage & IDOR Protection (`FILE-06`, `PRIV-05`)**: Storage on disk is partitioned by user into `<storageDir>/users/<userId>/`. Database queries strictly scope access by `user_id = $1 AND id = $2`. Accessing, downloading, or deleting another user's file returns 404 (preventing file existence discovery).
6. **Section-by-Section Flow (`FILE-07`)**: `chunkIntoSections()` splits documents exceeding token thresholds into indexed sections with titles, token counts, character counts, and contents. For CSV documents, the header line is preserved at the top of every section batch.
7. **Upload Privacy Warnings (`PRIV-06`)**: Returned in `/api/bootstrap` (`filePrivacyWarning`), `/api/files/warning`, and upload response metadata: "Warning: Do not upload secrets, passwords, API keys, or highly sensitive personal data. Files are stored locally and text is extracted for synthetic/model processing."
8. **API Endpoints & Web Client**: Exposed `/api/files/warning`, `POST /api/files/upload` (JSON base64 and binary stream with CSRF & session auth), `GET /api/files`, `GET /api/files/:id`, `GET /api/files/:id/download`, `GET /api/files/:id/sections`, `DELETE /api/files/:id`. Client methods added to `apps/web/src/api.ts`.

Evidence:
- `npm run phase3:test`: 13/13 unit tests PASS (7 files tests + 6 productivity tests).
- `npm run typecheck`, `npm run lint`, `npm run phase3:format:check`: all PASS.
- `tools/scan-secrets.ps1`: PASS (no secret findings).
- Documentation: `docs/PHASE3_REPORT.md`, `docs/BUILD_GUIDE.md`, and `docs/REQUIREMENT_TRACEABILITY.md` updated.
- Next: Step 3.3 (Add CSV analysis).

## CSV-LOCAL-001 — Phase 3 Step 3.3: CSV Summaries, Missing Values, Statistics, Chart Suggestions, and Querying

Date: 2026-10-15
Context: Step 3.3 of Phase 3 under SRS v2.1.1 (Section 17.1.4), `BUILD_GUIDE.md` Step 3.3, and requirement `FILE-04`.
Decision: Implement dedicated CSV analysis and query module (`packages/files/analyzer.mjs`) supporting deterministic statistics, semantic type profiling, missing-value accounting, rule-based chart recommendation heuristics, and natural-language query execution.

Key Implementations:
1. **Summary & Profiling (`SRS 17.1.4`, `FILE-04`)**: Computes total rows, total columns, column names, preview rows, and type inference (`integer`, `float`, `date`, `boolean`, `string`) across all non-missing values.
2. **Missing-Value Analysis**: `isMissingValue()` checks empty strings, whitespace, null, undefined, 'na', 'n/a', 'nan', 'none'. Generates dataset-level metrics (total missing, affected rows, clean rows count/percentage) and per-column breakdowns (missing count, missing percentage).
3. **Descriptive Statistics**:
   - Numeric columns: count, min, max, sum, mean, median, variance, standard deviation, 25th percentile (q25), 75th percentile (q75), and interquartile range (iqr).
   - Categorical columns: valid count, cardinality (unique count), top frequency ranking, and mode/most-frequent value with percentage distribution.
4. **Chart Suggestion Heuristics**: Recommends visualization types with titles, x/y axes, priorities, and analytical rationales:
   - `line`: temporal time-series (date vs. numeric).
   - `bar`: categorical comparisons (low/medium cardinality string vs. numeric).
   - `scatter`: feature correlation (two numeric columns).
   - `pie`: composition/distribution (low-cardinality categorical with 2 to 7 distinct values).
   - `histogram`: distribution/spread (single numeric variable over large datasets).
5. **Natural Language & Structured Query Engine (`queryCsv`)**:
   - Group-by queries: e.g., "average salary by department", "sum revenue by region".
   - Aggregation metrics: e.g., "average salary", "total revenue", "highest score", "lowest cost".
   - Record counts: e.g., "how many rows are there?".
   - Top N records: e.g., "show top 3 by salary" (places missing/non-numeric values at the bottom).
   - Missing-value inquiries: e.g., "are there missing values in salary?".
   - Fallback general dataset summary overview.
6. **API Endpoints & IDOR Protection**:
   - `GET /api/files/:id/analysis`: returns complete dataset profile and chart recommendations; verifies user session, rejects non-CSV files with 400 (`NOT_CSV_FILE`), and enforces IDOR returning 404.
   - `POST /api/files/:id/query`: answers CSV questions with CSRF protection, input validation, and user ownership isolation.
   - Web client methods `analyzeCsvFile()` and `queryCsvFile()` added to `apps/web/src/api.ts`.

Evidence:
- `tests/unit/phase3-csv-analysis.mjs`: 6/6 unit tests PASS on deterministic benchmark dataset and HTTP API endpoints.
- `npm run phase3:test`: 19/19 Phase 3 tests PASS (0 regressions).
- `npm run typecheck`, `npm run lint`, `npm run phase3:format:check`: all PASS.
- `tools/scan-secrets.ps1`: PASS (no secret findings).
- Documentation: `docs/PHASE3_REPORT.md`, `docs/BUILD_GUIDE.md`, and `docs/REQUIREMENT_TRACEABILITY.md` updated.
- Next: Step 3.4 (Add retention, deletion, storage controls).

## RETENTION-LOCAL-001 — Phase 3 Step 3.4: Data Retention, Storage Quotas, Soft/Hard Deletion, and Privacy Cleanup

Date: 2026-10-15
Context: Step 3.4 of Phase 3 under SRS v2.1.1 (Sections 7.7, 10, 16.2), `BUILD_GUIDE.md` Step 3.4, and requirements `FILE-05`, `PRIV-05`, `T3.2`.
Decision: Implement dedicated storage quota calculation and retention engine (`packages/files/retention.mjs`), user-facing storage endpoints, configurable retention schedules for files and conversations, and automated unlinking and database purge flows.

Key Implementations:
1. **User Storage Usage & Quota Controls (`FILE-05`, `PRIV-05`)**:
   - `getUserStorageUsage({ db, userId, maxUserStorageBytes })`: Calculates exact active storage bytes and file count (`deleted_at IS NULL`).
   - Configurable per-user storage quota (`maxUserStorageBytes`, default 50 MB / 52,428,800 bytes).
   - Ingestion enforcement: `fileService.upload()` verifies `currentUsedBytes + newBytes <= maxUserStorageBytes`. Rejects exceeding uploads with HTTP 413 `STORAGE_QUOTA_EXCEEDED` before touching disk or database.
   - Immediate quota recovery: user-triggered file deletion immediately zeroes out deleted file size from active quota accounting.
2. **Configurable Retention Windows (`FILE-05`, `T3.2`)**:
   - `fileRetentionDays`: Default 30 days. Files older than retention window are marked soft-deleted and unlinked from physical disk.
   - `softDeleteGraceDays`: Default 7 days. Soft-deleted files past grace period are permanently purged from database tables.
   - `conversationRetentionDays`: Default 30 days. Stale active conversations or soft-deleted conversations past grace period have their messages, routing records, chat requests, and conversation rows permanently purged.
3. **Retention Engine (`runRetentionJob`)**:
   - Atomic multi-phase execution (File Expiry -> Disk Unlink -> Hard Purge -> Conversation Purge).
   - Handles missing physical files on disk gracefully (`ENOENT`).
   - Supports `dryRun: true` mode reporting counts of affected resources without mutating database or unlinking files.
   - Returns structured summary: `{ filesExpired, filesPurged, diskBytesFreed, conversationsPurged, durationMs, success }`.
4. **API Endpoints & Tooling**:
   - `GET /api/files/storage`: Returns authenticated user's storage consumption (`usedBytes`, `fileCount`, `quotaBytes`, `remainingBytes`, `usagePercent`). Enforces user isolation.
   - `POST /api/files/cleanup`: Authenticated maintenance endpoint triggering retention cleanup with optional parameter overrides.
   - CLI tool `tools/phase3/retention.mjs`: Standalone runner supporting `--dry-run`, `--file-days`, `--grace-days`, `--conv-days`, and `--storage-dir`.
   - Web client methods `getStorageUsage()` and `triggerRetentionCleanup()` added to `apps/web/src/api.ts`.

Evidence:
- `tests/unit/phase3-retention.mjs`: 4/4 unit tests PASS covering quota enforcement, 413 rejection, immediate quota recovery upon deletion, file expiry and disk unlinking (T3.2), soft-delete grace purge, conversation purge (PRIV-05), and HTTP API endpoints.
- `tools/phase3/retention.mjs --dry-run`: PASS with clean exit code 0.
- `node --test tests/unit/phase3*.mjs`: 23/23 Phase 3 tests PASS (0 regressions).
- TypeScript `typecheck`: PASS (0 errors).
- ESLint `lint`: PASS (0 errors, 0 warnings).
- Prettier `phase3:format:check`: PASS (100% compliant).
- `tools/scan-secrets.ps1`: PASS (no secret findings).
- Documentation: `docs/PHASE3_REPORT.md`, `docs/BUILD_GUIDE.md`, and `docs/REQUIREMENT_TRACEABILITY.md` updated.
- Next: Step 3.5 (Add encrypted backups and restore).

---

### Record: Step 3.5 — Encrypted Backups and Restore (BACKUP-LOCAL-001)

Date: 2026-10-15, Asia/Dhaka. Step 3.5 is DONE under `SRS 17.1.4`, `SEC-10`, `OPS-04`, `T3.3`, and `BUILD_GUIDE.md Step 3.5`.

Context:
`SEC-10` and `OPS-04` require encrypted backups with a tested restore before public release. `T3.3` specifies that a restore from backup succeeds. Backups must protect data confidentiality at rest, guarantee tamper evidence, bundle both database records and physical uploaded storage files, and cleanly restore onto fresh or existing target databases without triggering append-only trigger violations.

Decisions:
1. **Encryption & Key Derivation**:
   - Standard: AES-256-GCM authenticated encryption (`algorithm: aes-256-gcm`).
   - Key derivation: Scrypt (`scryptSync`) with 16-byte cryptographically secure random salt, $N=16384$, $r=8$, $p=1$, generating a 256-bit key.
   - IV: 12-byte cryptographically secure random IV per backup.
   - Integrity: SHA-256 checksum of ciphertext verified before decryption; 16-byte GCM authentication tag verifies authenticity. Wrong passphrase, corrupted ciphertext, or tampered tag fail closed with `INVALID_PASSPHRASE_OR_CORRUPT_ARCHIVE`.
2. **Backup Payload & Manifest**:
   - Package: `packages/backup` (`packages/backup/index.mjs`, `packages/backup/defaults.json`).
   - Relational dump: All 60 database tables queried and serialized in topological dependency order (`RESTORE_TABLE_ORDER`).
   - Storage files: All physical files in `storageBaseDir` collected recursively, sha256-hashed, and base64-encoded.
   - Manifest summary: Metadata, timestamps, schema version, table counts, row counts, file counts, and total bytes included in unencrypted envelope header for zero-decryption inspection.
3. **Database & File Restoration (`restoreBackupArchive`)**:
   - Supports `dryRun: true` mode verifying passphrase, ciphertext SHA-256, and AES-GCM authentication tag without mutating database or filesystem.
   - On active restore:
     - Target database schema reset via `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`.
     - Target migrations applied via `migrateUp(targetDb, { throughVersion })`.
     - Tables restored in topological order using parameterized queries with `ON CONFLICT DO NOTHING` and `OVERRIDING SYSTEM VALUE` for `messages(sequence_no)`.
     - Physical storage files restored with strict path traversal validation (`..`, leading `/` or `\`, null bytes) and SHA-256 verification.
4. **API Endpoints & Tooling**:
   - `GET /admin/api/backups`: Lists existing backup archives with metadata summaries. Enforces `backup:manage` permission.
   - `POST /admin/api/backups`: Creates encrypted backup with passphrase, writes archive to disk, and records `BACKUP_CREATED` audit event.
   - `POST /admin/api/backups/verify`: Verifies backup integrity and returns manifest.
   - `POST /admin/api/backups/restore`: Restores backup archive (supports `dryRun`), records `BACKUP_RESTORED` audit event. Enforces `backup:restore` permission.
   - Standalone CLI `tools/phase3/backup.mjs`: Implements `create`, `verify`, `restore`, and `list` commands with `--dry-run`, `--passphrase`, `--db`, and `--storage-dir`.
   - Web client methods `listBackups()`, `createBackup()`, `verifyBackup()`, and `restoreBackup()` added to `apps/web/src/api.ts`.

Evidence:
- `tests/unit/phase3-backup.mjs`: 4/4 unit tests PASS covering encrypted archive creation (`SEC-10`, `OPS-04`), full database and file storage restoration (`T3.3`), decryption authentication failure and tampering rejection, and HTTP API endpoints.
- `tools/phase3/backup.mjs --help`: PASS with clean exit code 0.
- `node --test tests/unit/phase3*.mjs`: 27/27 Phase 3 unit tests PASS (0 regressions).
- TypeScript `typecheck`: PASS (0 errors).
- ESLint `lint`: PASS (0 errors, 0 warnings).
- Prettier `phase3:format:check`: PASS (100% compliant).
- `tools/scan-secrets.ps1`: PASS (no secret findings).
- Documentation: `docs/PHASE3_REPORT.md`, `docs/BUILD_GUIDE.md`, and `docs/REQUIREMENT_TRACEABILITY.md` updated.
- Next: Step 3.6 (Extend monitoring; write incident/notification runbooks and status page).

---

### Record: Step 3.6 — Extended Monitoring, Status Page, Staging Parity, and Incident Runbooks (MONITORING-STATUS-001)

Date: 2026-10-15, Asia/Dhaka. Step 3.6 is DONE under `SRS 17.1.4`, `OPS-05`, `OPS-07`, `OPS-08`, `LEG-07`, and `BUILD_GUIDE.md Step 3.6`.

Context:
SRS `OPS-05` requires extending monitoring and owner alerting to all Phase 3 services (storage, backups, retention, productivity). `OPS-07` mandates staging environment parity verification. `OPS-08` requires maintaining actionable incident runbooks for provider outages, quota exhaustion, abuse waves, and data incidents. `LEG-07` requires establishing data incident notification steps with strict timelines and regulatory disclosure templates.

Decisions:
1. **Extended Health Monitoring Subsystems (`OPS-05`)**:
   - Extended `admin.getHealthStatus({ storageDir, backupDir })` in `packages/admin/index.mjs` to monitor:
     - **Storage & Files**: Active file counts, total stored bytes, quota percentage, and disk accessibility verification. Degrades to `'critical'` on disk error or $\ge 95\%$ capacity.
     - **Backups**: Backup archive count, latest backup timestamp, and backup directory accessibility.
     - **Retention**: Count of pending expired files, last automated purge timestamp, and retention lifecycle health.
     - **Productivity**: Availability of presets (`writing`, `translation`, `summary`) and Bangla evaluation status (`passed_100_percent`).
   - Unified Status Evaluation: System status reflects `ok` when all subsystems are operational; automatically degrades to `degraded` upon open circuit breakers, unresolved alerts, storage critical condition, or inaccessible backup directory; transitions to `unhealthy` if database is down.
   - Public Endpoints: Enhanced `/health` and `/api/health` to expose non-sensitive subsystem operational flags without leaking internal filesystem paths.
   - Staff Diagnostics: Protected `/admin/api/monitoring/health` requires staff session with `alert:read` permission and returns comprehensive telemetry.
2. **Phase 3 Owner Alert Dispatching (`OPS-05`)**:
   - Added helper triggers in `packages/admin/index.mjs`: `triggerStorageAlert()`, `triggerBackupAlert()`, `triggerRetentionAlert()`, and `triggerDataIncidentAlert()`.
   - Dispatches owner alerts with kind `HEALTH_DEGRADED` (and subsystem metadata) or `CAPACITY_EXHAUSTED`.
   - Emits immutable delivery records in `alert_delivery_attempts` with SHA-256 HMAC delivery proof and automatic retries.
3. **Public Status Page & Status API (`status.html`)**:
   - Route `GET /api/status`: Public status endpoint returning operational state across 5 core workspace components (`ai_router`, `file_processing`, `database`, `backups_retention`, `usage_ledger`), uptime, active incidents, and maintenance windows.
   - Assets: `apps/web/public/status.html`, `status.css`, and `status.js` (mapped in `packages/api/server.mjs` as `/status`, `/status.html`, `/status.css`, `/status.js`).
   - Features: Responsive down to 360px mobile width, WCAG 2.1 AA accessible, dark/light theme aware, pulsing status dots, and live bilingual English/Bangla switcher.
4. **Staging Environment Parity Tool (`OPS-07`)**:
   - Tool `tools/phase3/staging-check.mjs`: Automates 8 staging environment parity checks:
     1. Node.js runtime version ($\ge 20$).
     2. File storage directory isolation and write/read/unlink permissions.
     3. Backup directory isolation and write/read/unlink permissions.
     4. Database migrations 001..010 applied in `schema_migrations`.
     5. Critical database tables presence (`users`, `messages`, `providers`, `router_breakers`, `files`, `owner_alerts`, `alert_delivery_attempts`, `admin_audit_log`).
     6. Router circuit breakers baseline (zero unexpected open breakers).
     7. Extended health monitoring telemetry (all Phase 3 subsystems reporting).
     8. Incident runbooks documentation parity in `docs/RUNBOOKS/`.
   - Supports `--migrate`, `--strict`, `--json`, `--db`, `--storage-dir`, and `--backup-dir` flags.
5. **Operational Incident Runbooks & Notification Framework (`OPS-08`, `LEG-07`)**:
   - Comprehensive documentation authored in `docs/RUNBOOKS/`:
     - `README.md`: Incident Severity Matrix (SEV-1 through SEV-4), lifecycle stages (Detection ➔ Triage ➔ Containment ➔ Communication ➔ Recovery), and roles.
     - `PROVIDER_OUTAGE.md`: Circuit breaker automated response, Control Center M2 provider disable/fallback, AP-06 simulator verification, and status page notice.
     - `QUOTA_EXHAUSTION.md`: Hard token caps (`OPS-03`), fail-closed admission, capacity math review, organic vs abusive surge triage.
     - `ABUSE_WAVE.md`: PoW challenge difficulty escalation, magic-byte sniffing, CSV formula defense, Control Center M5 user moderation, and kill switches.
     - `DATA_INCIDENT_AND_NOTIFICATIONS.md`: Data incident containment (< 30 min), audit log freezing, 72-hour regulatory notification timeline, and standardized regulatory and user notification templates (`LEG-07`).
     - `BACKUP_AND_STORAGE_INCIDENT.md`: Retention unlinking, archive tampering response, SHA-256 verification, and dry-run restoration procedures.

Evidence:
- `tests/unit/phase3-monitoring-runbooks.mjs`: 5/5 unit tests PASS covering extended monitoring, alert triggers, status endpoints, staging check validation, and runbook content verification.
- `tools/phase3/staging-check.mjs --migrate`: PASS with 8/8 checks passed and clean exit code 0.
- `node --test tests/unit/phase3*.mjs`: 32/32 Phase 3 unit tests PASS (0 regressions).
- TypeScript `typecheck`: PASS (0 errors).
- ESLint `lint`: PASS (0 errors, 0 warnings).
- Prettier `phase3:format:check`: PASS (100% compliant).
- `tools/scan-secrets.ps1`: PASS (no secret findings).
- Documentation: `docs/PHASE3_REPORT.md`, `docs/BUILD_GUIDE.md`, and `docs/REQUIREMENT_TRACEABILITY.md` updated.
- Next: Step 3.7 (Run T3.1–T3.3 and full public-launch checklist).

## LAUNCH-VERIFY-001 — Phase 3 Acceptance Testing (T3.1–T3.3) and Public Launch Verification

Date: 2026-10-15.
Authorization: Owner requested Step 3.7 under canonical SRS v2.1.1 Section 17.1.4 and `docs/BUILD_GUIDE.md` Step 3.7.

Context: Phase 3 Step 3.7 requires technical verification of acceptance criteria T3.1 (safe file upload pipeline), T3.2 (retention schedules, quota limits, conversation purge), and T3.3 (AES-256-GCM encrypted backup archive creation, SHA-256 integrity, tamper rejection, and full restore). In addition, running the full public-launch checklist (bilingual status page, health telemetry, staging parity tool, 6 operational incident runbooks, Bangla evaluation quality bar, abuse defenses, and legal disclosures). Finally, enforcing an explicit STOP gate requiring technical report generation and owner acceptance sign-off before public release or Phase 6 / Phase 4 commencement.

Decisions:
1. **Acceptance Test Suite Architecture (`tests/unit/phase3-launch-verification.mjs`)**:
   - Implemented 5 rigorous subtests mapping 1:1 to SRS criteria:
     - `Subtest 1 (T3.1)`: File upload safety verification — tests valid PDF/TXT/CSV, malicious formats (PE executable, Linux ELF, Mach-O, ZIP, GZIP, 7-Zip, shell scripts, binary null bytes), 10MB size limit, zero-byte empty file, path traversal (`../../etc/passwd`, Windows reserved names `CON`, `PRN`), CSV formula injection (`=`, `@`, `+`, `-`, `\t`, `\r`), and cross-user IDOR access isolation.
     - `Subtest 2 (T3.2)`: Storage retention and quotas — active quota sum tracking, 413 quota overflow rejection, backdated file expiry, physical disk unlinking (`existsSync` false), quota decrement upon release, and soft-deleted conversation purge past grace period.
     - `Subtest 3 (T3.3)`: Encrypted backup and restoration — AES-256-GCM encrypted archive creation with Scrypt KDF, whole-system scope ($\ge 50$ database tables plus physical storage files), SHA-256 ciphertext checksum, tamper bit-flip rejection, and clean byte-for-byte target restoration.
     - `Subtest 4 (Status & Telemetry Checklist)`: Public `/api/status`, static status assets `/status` and `/status.js` with bilingual English/Bangla text, `/health` subsystem telemetry without path leaks, 8/8 staging parity check, and 6 incident runbooks in `docs/RUNBOOKS/` (including 72-hour regulatory notification timeline).
     - `Subtest 5 (Bangla, Abuse, Legal Checklist)`: 15/15 Bangla evaluation cases passing (100% vs 85% requirement), staff MFA TOTP login, instant kill switches, and 5 draft legal disclosures in `apps/web/public/legal/`.
2. **Backup Restoration Topology & Identity Handling**:
   - Refined `packages/backup/index.mjs`:
     - `RESTORE_TABLE_ORDER` reordered so foreign keys are strictly satisfied (`capacity_job_runs` before `capacity_fair_share`, `capacity_limits` before `capacity_counters`, `capacity_routes` before `capacity_reservations`, `router_requests` before `router_attempts`).
     - Added `OVERRIDING SYSTEM VALUE` support for tables with `GENERATED ALWAYS AS IDENTITY` columns (`messages`, `config_revisions`, `registry_versions`, `usage_ledger`, `capacity_allocations`, `capacity_fair_share`).
3. **Phase 3 Gate Report (`docs/PHASE3_GATE_REPORT.md`) & STOP Gate Enforcement**:
   - Generated formal Phase 3 Gate Report documenting technical results across all Phase 3 steps.
   - Enforced explicit STOP gate: Technical verification is 100% complete under local synthetic scope. Public deployment, production provider credentials, live user traffic, real payments, and transition to Phase 6 or Phase 4 remain blocked pending owner sign-off.

Evidence:
- `tests/unit/phase3-launch-verification.mjs`: 5/5 subtests PASS.
- Full Phase 3 suite (`tests/unit/phase3*.mjs`): 37/37 unit tests PASS (0 regressions).
- Staging check (`tools/phase3/staging-check.mjs --migrate`): 8/8 checks PASS.
- TypeScript `typecheck`: PASS (0 errors).
- ESLint `lint`: PASS (0 errors, 0 warnings).
- Prettier `phase3:format:check`: PASS (100% compliant).
- Secret scan (`tools/scan-secrets.ps1`): PASS (no secret findings).
- Gate Report: `docs/PHASE3_GATE_REPORT.md` created.
- STOP gate active: awaiting owner direction on legal review, release authorization, or next phase (Phase 6 Payments or Phase 4 Coding Agent).

