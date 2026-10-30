# Dependency Review

Updated: 2026-10-13. Step 0.6 public-source review is complete for 20 named components and one unspecified repository category. Each row records license evidence, release activity, security notes and a disposition. This is a candidate review, not installation approval, a complete dependency audit, qualified legal approval, or Phase 0 GO.

Scope: SRS Sections 5.2/5.4 and LEG-04, plus the supporting stack and existing bootstrap tools. D2 = 100 pilot daily active free users; D3 = BDT 1,500/month hosting ceiling. Provider, audience/region, capacity, quality, financial and legal conditions from earlier steps remain open. See [open questions](OPEN_QUESTIONS.md) and DEP-001 in [decisions](DECISIONS.md).

## How to read the review

- **CANDIDATE**: license permits consideration, subject to the stated artifact, security and compatibility checks; no runtime is approved or pinned by this label.
- **HOLD**: a specific security, license or funding condition must be resolved before adoption.
- **REFERENCE ONLY**: study patterns; any later copied code or fork needs its own exact artifact, notices and dependency review.
- **EXCLUDE**: unsuitable for the SRS reuse direction under the currently recorded conditions.
- **DEFERRED**: a later optional feature; no current installation or funding commitment.
- **KEEP LOCAL**: the existing BOOT-001 tooling scope continues; it does not grant production approval.

Versions below are review references observed on 2026-10-13, not a mutually tested stack. Dates are UTC publication dates: npm package dates for JavaScript packages, GitHub release publication dates for repository releases, and official release dates for Node/PostgreSQL/CPython. A GitHub release date can differ from npm publication; both sources are linked where applicable. Refresh the selected version before adoption rather than installing a mutable `latest` tag.

At the Step 0.6 research snapshot, no application manifests, lockfiles, containers or resolved runtime graph existed. The later LOCAL-PROTOTYPE-001 development-only graph is recorded below; no hosted runtime/container graph is approved. Research used official release metadata, tagged licenses, npm metadata and selected maintainer security disclosures. Successful repository-advisory API reads returned the counts below, with no next-page header. These are repository-published observations, not a global vulnerability count or proof of safety. Later GitHub API reads hit rate limits; official tagged raw files, public pages and vendor documentation supplied the remaining evidence. Full hosted graph/image/SBOM and advisory mapping remain **TODO-VERIFY** before adoption; unqueried feeds are not counted as zero.

| Official advisory API feed read 2026-10-13 | Records returned |
|---|---|
| [LiteLLM](https://api.github.com/repos/BerriAI/litellm/security-advisories?per_page=100) | 17 |
| [Next.js](https://api.github.com/repos/vercel/next.js/security-advisories?per_page=100) | 69 |
| [Auth.js](https://api.github.com/repos/nextauthjs/next-auth/security-advisories?per_page=100) | 15 |
| [LibreChat](https://api.github.com/repos/LibreChat-AI/LibreChat/security-advisories?per_page=100) | 29 |
| [AnythingLLM](https://api.github.com/repos/Mintplex-Labs/anything-llm/security-advisories?per_page=100) | 25 |
| [Redis](https://api.github.com/repos/redis/redis/security-advisories?per_page=100) | 47 |
| [Gitleaks][GL-S], [TypeScript][TS-S], [Monaco][MO-S] | 0 each |

## Gateway, frontend and authentication

| Component / purpose | Reviewed version | License and obligations | Last release/publication | Security notes | Decision |
|---|---|---|---|---|---|
| LiteLLM gateway | v1.105.0 | MIT core with root-license exceptions for enterprise paths; retain copyright/license. The root points to a separate enterprise license; its referenced tagged path returned 404, so enterprise rights remain TODO-VERIFY. [LL-L] | 2026-10-11 [LL-R] | March 2026 compromised PyPI versions 1.82.7/1.82.8; do not use those artifacts. A later critical proxy-admin escalation advisory has multiple patched branches; the review version is above its listed affected ranges, which does not clear other findings or the supply chain. See details below. [LL-I] [LL-S] | **HOLD** adoption pending trusted artifact/digest, full graph scan, core-only scope, bounded retries and key isolation. Preserve SRS gateway direction; paid keys must never reach free routing. |
| Next.js frontend/API routes | 16.4.0 | MIT; retain license/copyright. [NJ-L] | npm 2026-10-06; GitHub 2026-10-07 [NJ-P] [NJ-R] | Critical `next/og` ImageResponse RCE patched at 16.3.6. A separate high Image Optimization SSRF advisory publishes an incomplete patch label `16.3.?`; do not invent a fixed version. Configuration and graph need verification. [NJ-S1] [NJ-S2] | **HOLD** final version adoption until the SSRF mapping/workaround and production feature use are recorded. Keep framework as a Step 0.7 proposal. |
| React frontend | 19.3.0 | MIT; copyright/license notices; react-dom and bundled server packages must be reviewed too. [RE-L] | 2026-09-09 [RE-P] [RE-R] | React Server Components disclosures include RCE and subsequent DoS/source-exposure fixes. Updating `react` alone does not establish that framework-bundled `react-server-dom-*` packages are patched. [RE-S1] [RE-S2] | **CANDIDATE** with matched React/ReactDOM/framework versions and resolved production graph/advisory checks. |
| Auth.js / next-auth Google sign-in and sessions | stable next-auth 4.24.15; npm also advertises a separate 5 beta channel | **ISC**, not MIT; retain its copyright and permission notice. [AU-L] [AU-P] | 2026-07-20 [AU-P] [AU-R] | Email-normalization bypass fixed in next-auth 4.24.15 / auth core 0.41.3; malformed-Bearer exception advisory also covers older auth core. 4.24.15 declares **optional** peer `@auth/core` 0.34.3, within a reported affected core range. No graph exists, so this is conditional, not a claim that vulnerable core is installed. [AU-S1] [AU-S2] [AU-P] | **HOLD** until stable/beta choice, optional-core use, resolver compatibility and session/OAuth tests are settled. Do not force an incompatible peer override merely to silence an audit. |
| LibreChat UI/interaction reference | v0.8.8 | MIT; copied modules need their notices, independent dependency review and own product branding. [LC-L] | GitHub publication 2026-10-01; site changelog dated 2026-09-30 [LC-R] [LC-C] | GitHub marks the reviewed release **pre-release**, despite the website's release label. Maintainer advisories include custom-endpoint SSRF and artifact-preview XSS; a fork adds the full graph and tenant boundaries to scope. [LC-S] | **REFERENCE ONLY** initially. Resolve release-channel discrepancy and exact graph before proposing a fork; reference reading does not license unrelated assets or remove attribution obligations. |

### Security findings that affect selection

LiteLLM's official March 27 incident report identifies PyPI 1.82.7/1.82.8 as compromised following a publishing/CI credential incident. Its post-incident image-signing measures do not prove that an arbitrary mirror, image or package is trusted. Verify the chosen official artifact, provenance/signature where provided, immutable digest and dependency graph before using credentials. The September critical [GHSA-7hp6-4w63-5g45][LL-S] lists affected 1.91.0–below 1.100.4, 1.101.0–below 1.101.3, 1.102.0–below 1.102.2, 1.103.0–below 1.103.1, and 1.104.0rc1–below rc2 branches. Above-range version comparison is limited to that advisory. No package or image was installed in this review. [LL-I]

Next.js [GHSA-vcvr-r3jv-pc5j][NJ-S1] reports affected `next` >=16.2.0 and <16.3.6. The separate [GHSA-cjq9-62q9-8jv4][NJ-S2] still displays `>=16.0.0 <16.3.?` and patched `16.3.?` in both API and public page observations. Its documented SSRF exposure involves attacker-controlled allow-listed remote image hosts; no `images.remotePatterns` means the app is not affected by that finding. This is a configuration option to assess in Step 0.7/1.1, not implemented protection or a blanket security clearance for 16.4.0.

React's January 26 update to its RSC follow-up disclosure lists backported fixes 19.0.4/19.1.5/19.2.4 and says earlier follow-up patches were incomplete. Check actual server-component packages and framework bundles against current disclosures, rather than copying the first React2Shell patch advice. Client-only applicability differs from a Next.js server deployment. [RE-S1] [RE-S2]

Auth.js [GHSA-7rqj-j65f-68wh][AU-S1] affects next-auth >=4.10.3 and <4.24.15, and `@auth/core` >=0.1.0 and <0.41.3. [GHSA-xmf8-cvqr-rfgj][AU-S2] additionally covers older core and the 5 beta channel before beta.32. The optional peer in 4.24.15 is not proof of an installed vulnerable dependency; the chosen integration must show whether it resolves/uses core and how every applicable advisory is addressed.

## Other UI reuse candidates from SRS Section 5.4

| Component / purpose | Reviewed version | License and obligations | Last release/publication | Security notes | Decision |
|---|---|---|---|---|---|
| AnythingLLM RAG/file UX reference | v1.17.0 | MIT; copied material retains notices and needs its own dependency review. [AL-L] | 2026-10-01 [AL-R] | Maintainer disclosures include stored raw-document path traversal and widget/private-memory exposure; a reference UI pattern does not establish secure file or tenant handling. [AL-S] | **REFERENCE ONLY**; no vector database in MVP, per SRS. No fork/dependencies installed. |
| Open WebUI | v0.12.0 | Custom Open WebUI license: BSD-style conditions **plus branding restriction**, not plain BSD-3-Clause. Branding-removal exceptions include <=50 natural persons in a rolling 30-day period, prior written permission, or a suitable enterprise license. [OW-L] | 2026-10-10 [OW-R] | Own-brand reuse already conflicts with the planned direction at 100 DAU; no full runtime/advisory audit performed for this excluded candidate. Using an old permissive tag would require a new security review, not bypass this finding. | **EXCLUDE** from the current own-brand plan. The 100-DAU target exceeds the small-user exception; only a new owner/license decision could reopen it. |
| Dify | 1.17.1 | Modified Apache 2.0 plus multi-tenant and frontend-branding conditions; one tenant is defined as one workspace. Written authorization/commercial license is required for the restricted multi-tenant use. [DF-L] | 2026-09-10 [DF-R] | License fit is blocking for the SRS reuse plan; no full graph/security clearance performed. Multi-user and multi-workspace are not interchangeable definitions. | **EXCLUDE** from the current public workspace reuse direction, as SRS specifies. Reopening needs exact architecture and written licensing evidence. |
| Unspecified free-aggregation repositories / FreeLLMAPI-style ideas | No exact repository or artifact selected | **TODO-VERIFY**; no license can be assigned to a name/category without a canonical repository and exact tag. SRS Section 5.4 is the scope source. | **TODO-VERIFY**, identity required | Personal/free keys, unsupported model claims and inherited retry logic need independent review; do not reuse credentials or assume provider permission. | **EXCLUDE** code/dependencies for now; ideas only. Identify a repository before any concrete reuse review. |

## Editors and execution candidates

| Component / purpose | Reviewed version | License and obligations | Last release/publication | Security notes | Decision |
|---|---|---|---|---|---|
| Monaco editor | 0.57.0 | MIT; preserve notices, including workers/bundled assets. [MO-L] | 2026-09-24 [MO-P] [MO-R] | Repository advisory feed returned 0; this is not a complete package audit. CSP/worker origins, untrusted rendered content and extensions require integration checks; bundle/mobile suitability is untested. [MO-S] | **CANDIDATE**, deferred implementation to Phase 4; choose against CodeMirror after 360px/keyboard, worker and performance evaluation. |
| CodeMirror editor module | `@codemirror/view` 6.43.14 | MIT confirmed in published tarball `package/LICENSE`; other state/language/extensions are distinct packages and need their own review. [CM-L] [CM-P] | 2026-10-07 [CM-P] | Current package metadata points to the maintainer's non-GitHub repository. Full module graph/advisory mapping **TODO-VERIFY**; untrusted decorations/HTML and extensions need tests. | **CANDIDATE** alternative to Monaco for Phase 4, not a completed whole-CodeMirror-stack review. |
| Pyodide browser Python | 314.0.7 | MPL-2.0 for Pyodide; CPython/WASM and optional Python packages have separate notices/licenses. Preserve MPL notices and applicable covered-source availability; do not assume every wheel is MPL or that the entire app becomes MPL. [PY-L] [PY-B] | 2026-09-14 [PY-R] | Python/JavaScript bridge and downloaded packages extend privileges. Full bundle/WASM/package advisory review **TODO-VERIFY**; use isolated execution origin without platform secrets, bounded workers/output and termination, with a reviewed package allowlist. These are required design checks, not implemented controls. | **CANDIDATE** for later Phase 5a Python-only execution after D5/license/source-distribution and isolation checks. Not a server sandbox. |
| WebContainers browser JavaScript/Node | `@webcontainer/api` 1.6.4; hosted runtime not pinned by this SDK version | MIT **SDK** license confirmed in tarball. Vendor terms separately require a commercial license for commercial for-profit production use; prototypes/POCs are distinguished. Cost recovery does not establish nonprofit eligibility. [WC-L] [WC-P] [WC-T] | SDK 2026-04-14; runtime release/provenance **TODO-VERIFY** separately [WC-P] | Hosted runtime/API, execution origin, browser compatibility and package network access need review; no full runtime security audit or service contract exists. SDK license does not grant unrestricted runtime use. | **HOLD / DEFERRED** for Phase 5a until intended-use entitlement, runtime/security evidence and price within an approved budget are recorded. No sales contact/account/license purchase authorized. |
| gVisor optional Linux server sandbox | release-20261005.0 | Apache-2.0 plus bundled third-party terms in tagged license; preserve applicable license/NOTICE/change notices. [GV-L] | 2026-10-08 [GV-R] | Official policy/model explain isolation scope; misconfiguration and host/resource controls remain operator responsibilities. Full selected binary/kernel/container graph scan **TODO-VERIFY**. [GV-S] [GV-M] | **DEFERRED** to optional funded Phase 5b, after D5/hosting decision and T5.1–T5.4. Do not run generated code on the app host. |
| Firecracker optional microVM sandbox | v1.17.0 | Apache-2.0; third-party guest/kernel/rootfs components require separate licenses/notices. [FC-L] | 2026-09-10 [FC-R] | Production guidance requires KVM, patched host/guest kernels/microcode, jailer/resource limits and one-tenant workload boundaries. Firecracker does not filter guest egress; the operator must enforce network policy. Full host/image graph review **TODO-VERIFY**. [FC-S] [FC-H] | **DEFERRED** to optional funded Phase 5b. No assumption that a BDT 1,500 hosting plan provides KVM or an affordable secure deployment. |

Published npm tarballs for CodeMirror view and WebContainer API were read in memory for their license files only; nothing was extracted to disk, installed or executed. Observed tarball SHA-256 values: CodeMirror `9afb18af93f3317f788523d0c556255d535544d5da29a0ba24daa9e8004a14e4`; WebContainer API `827e418b6d8185a133f8a14a2e0526d8a370e948d8fc0e0de2f41453049a0695`. These identify the observed research bytes, not approved runtime pins.

## Supporting stack and existing local tooling

| Component / purpose | Reviewed version | License and obligations | Last release/publication | Security notes | Decision |
|---|---|---|---|---|---|
| Node.js backend/runtime proposal | 24.21.0 LTS; current channel 26.11.1 also observed | MIT core plus bundled third-party licenses in official LICENSE. Preserve applicable notices; binary provenance must be checked separately. [NO-L] | LTS 2026-09-07; current 2026-10-07 [NO-I] [NO-R] | Official guidance recommends Active/Maintenance LTS for production. A package's minimum Node engine is not a support/security guarantee. Full selected binary/OS/dependency scan **TODO-VERIFY**. [NO-C] | **CANDIDATE** supported LTS direction; final version/image/host compatibility belongs in Step 0.7/1.1. No installation. |
| TypeScript compiler/toolchain | 7.0.2 | Apache-2.0; preserve license/NOTICE where present and change notices. [TS-L] | npm 2026-07-08; GitHub 2026-08-20 [TS-P] [TS-R] | Repository advisory feed returned 0, not a toolchain-wide audit. Major-version framework/plugin/compiler compatibility is untested; inspect actual resolved package and build tools. [TS-S] | **CANDIDATE** TypeScript direction; do not select latest major automatically before scaffold compatibility checks. |
| PostgreSQL database / possible durable queue | 18.6 | PostgreSQL License, permissive copyright/permission notice; extensions and hosted-plan terms reviewed separately. [PG-L] | 2026-08-13 [PG-R]; supported current minor in official version table [PG-V] | 18.6 includes security fixes and post-update configuration/data cleanup guidance, including logical-output-plugin allowlisting. Check exact host/driver/extensions, patch policy, least-privilege roles and backups; no database exists yet. [PG-R] | **CANDIDATE** database; evaluate the SRS PostgreSQL queue alternative in Step 0.7 before adding another service. Hosting cost/availability remains unverified. |
| Redis optional cache/queue | 8.10.2 | Redis 8 is offered under **RSALv2 / SSPLv1 / AGPLv3** choices, with additional third-party notices. Do not apply the old BSD label to Redis 8; choose/review applicable terms and any hosted contract. [RD-L] | 2026-09-17 [RD-R] | RESTORE RCE advisory reports affected versions `All`, patched `TBD`; official workaround restricts RESTORE by ACL. This unresolved mapping is not cleared by the latest release number; graph/configuration evidence is required. [RD-S] | **HOLD** pending license choice and security/host-cost mapping. PostgreSQL queue remains an SRS-permitted option; no substitute or final queue selected here. |
| Gitleaks local secret scanner | 8.30.1 Windows x64 | MIT; tagged and bundled license retained. [GL-L] | 2026-03-21 [GL-R] | Official archive/executable hashes pinned and verified at bootstrap; repository advisory feed returned 0 on 2026-10-13, not a vulnerability-free claim. CI/history and future artifact scans remain Phase 1 work. [GL-S] | **KEEP LOCAL**, existing BOOT-001 scope. Pins and installer/scan behavior unchanged. |
| Existing CPython for offline tools | installed 3.11.9; reviewed same-series security release 3.11.17 | PSF license and bundled notices; exact distribution contents matter. The calculator uses only stdlib. [CP-L] | installed release 2024-04-02 [CP-R]; newer security release 2026-10-01 [CP-S] | 3.11.9 is superseded; 3.11.17 includes archive/TLS and other fixes and the series now supplies source-only security releases. Current local interpreter must not be treated as a production/CI security pin. No application service or archive extraction is implemented by the calculator. [CP-S] | **KEEP LOCAL** for existing bounded offline calculator; **HOLD** production/CI reuse of this stale interpreter. Select a supported patched distribution before future deployment or untrusted-file handling; no machine-wide upgrade performed. |

## Adoption checklist and next step

### LOCAL-PHASE1-001 local database and identity verification — 2026-10-13

The owner authorized the remaining local 1-series with recommended defaults and no intermediate questions. No Docker/Postgres executable is present in the current command path. Adopt **@electric-sql/pglite 0.5.9** for embedded PostgreSQL local schema/persistence and disposable SQL migration tests, and **jose 6.2.12** for standards-based Google ID-token signature/issuer/audience/time/nonce verification with injected test JWKS. Both exact packages have no declared runtime dependencies. Official npm tarballs match their SHA-512 integrity; bundled LICENSE files were inspected before installation. PGlite's Apache-2.0 package and PostgreSQL/WASM notices are retained; JOSE is MIT. This is local adoption, not approval of hosted multi-process PostgreSQL capacity or live Google/provider traffic.

Sources read 2026-10-13: [PGlite exact npm metadata](https://registry.npmjs.org/@electric-sql%2fpglite/0.5.9), [API](https://pglite.dev/docs/api), [Node filesystems](https://pglite.dev/docs/filesystems), [maintainer repository](https://github.com/electric-sql/pglite); [JOSE exact npm metadata](https://registry.npmjs.org/jose/6.2.12), [maintainer verification docs](https://github.com/panva/jose); [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect). Locked installation disabled lifecycle scripts and used verified HTTPS/system CAs. All 82 registry packages match official exact-version integrity/license metadata; licenses are MIT 55, Apache-2.0 15, BSD-2-Clause 6, BSD-3-Clause 1, ISC 4 and BlueOak-1.0.0 1. [Phase 1 graph evidence](phase1_dependency_evidence.json) and [SBOM](phase1-sbom.json) preserve the current inventory; npm audit explicitly including dev reported found 0 vulnerabilities. This is advisory-response evidence, not a complete OS/WASM/binary security audit. The historical prototype inventory below remains unchanged. Other hosted-stack/deployment/license holds remain.

### LOCAL-PROTOTYPE-001 development tooling - historical Step 1.1 evidence

The owner-approved local-only Step 1.1 exception adopts a static strict-TypeScript preview and a Node standard-library loopback server. No Next.js, auth, database, LiteLLM or execution component is installed; existing hosted-stack holds remain. Public development-package retrieval is within the approved scope. Exact official metadata was re-read October 13 before installation; install with lifecycle scripts disabled, then inspect the resolved license graph and npm advisory results before running tools. This is bounded development adoption, not hosted-product security/legal clearance.

| Artifact | Pin / role | License evidence and source | Scope/control |
|---|---|---|---|
| Node.js Windows x64 archive | 24.21.0 LTS, repository-local runtime | Official [download page](https://nodejs.org/en/download) and [SHA-256 manifest](https://nodejs.org/dist/v24.21.0/SHASUMS256.txt); MIT core plus bundled notices retained in archive | SHA-256 pinned in tools/prototype-toolchain.json; use local .tools runtime rather than old host 22.13.1; no global install |
| TypeScript | 5.9.3, development compiler | [Exact official npm metadata](https://registry.npmjs.org/typescript/5.9.3), Apache-2.0; JS compiler has no runtime/optional dependency graph | Intentional stable compiler pin for the small static ES2022 client; the 7.0.2 research reference was not mandatory adoption |
| Prettier | 3.9.10, development formatter | [Exact npm metadata](https://registry.npmjs.org/prettier/3.9.10), MIT; no declared dependencies | Format only owned prototype files; no whole-spec/research reformat |
| ESLint | 10.12.0, development JS lint | [Exact npm metadata](https://registry.npmjs.org/eslint/10.12.0), MIT; transitive graph captured in lockfile/SBOM | Lint Node scripts/tests; TypeScript strict/no-unused checks cover typed browser source. Inspect graph/advisories before execution |
| Playwright Core | 1.64.0, development browser verification | [Exact npm metadata](https://registry.npmjs.org/playwright-core/1.64.0), Apache-2.0; no declared dependencies; published provenance reference | Use existing Microsoft Edge in a separate test context, no bundled browser download, no production browser automation or generated-code execution |

Official usage docs read: [Node HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html), [ESLint flat configuration](https://eslint.org/docs/latest/use/configure/configuration-files), [Prettier installation](https://prettier.io/docs/install), [Playwright existing Edge channel](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge). Registry integrity/provenance fields are observations; verification results and resolved graph are recorded with Step 1.1, not inferred from these fields. No full-audit or zero-vulnerability guarantee is made.

Executed adoption evidence: four direct tarball SHA-512 values match official registry metadata and bundled license files were inspected in memory. The reviewed Node ZIP matches its official pinned SHA-256. Installation is locked, explicitly includes dev dependencies and disables lifecycle scripts; wrapper overrides inherited TLS-disable settings, uses the system CA store and a fresh verified cache. All **80 registry packages** match official HTTPS metadata for version, integrity and declared license. License inventory: MIT 54, Apache-2.0 14, BSD-2-Clause 6, BSD-3-Clause 1, ISC 4 and BlueOak-1.0.0 1; bundled notices remain in installed artifacts. [Graph evidence](prototype_dependency_evidence.json), [CycloneDX SBOM](prototype-sbom.json) and package-lock.json capture the graph. `tools/prototype.ps1 -Task audit` reports **found 0 vulnerabilities** in this npm advisory response; this does not clear the held hosted stack or establish complete vulnerability coverage.

Step 0.7 should first compare hosting/stack choices within the recorded budget, keeping optional editors/execution deferred. Carry the holds into decision records rather than assuming all listed versions compose a supported stack. Candidate research is complete even where adoption is held; legal approval and a complete actual dependency graph remain gates.

Before installing/reusing a selected application artifact:

1. Record canonical repository/package, chosen exact version/commit, production versus development role and approved scope; refresh release/license/advisory sources.
2. Resolve DEP-COMPAT and material security mappings, especially Next.js image behavior and Auth.js optional peers. Use the appropriate supported runtime and prove integration behavior.
3. Capture lockfiles, immutable image/artifact hashes and available provenance; inventory transitive, vendored, browser/WASM, guest/kernel and optional packages. Generate/review SBOM and applicable dependency/container scans under SEC-06; do not treat a root license or zero feed records as full coverage.
4. Preserve license/copyright/NOTICE files and modified-file notices, and provide applicable covered source. Confirm enterprise, hosted-runtime, branding and multi-tenant rights with the owner/advisor. No contact or commercial commitment is included in this review.
5. Record disposition of applicable findings, isolating secrets, sessions, retries, rendering, file/network access and execution origins. Recheck before the Phase 0 decision and before release; owner phase/provider/payment/deployment approvals remain separate.

These follow-ups are tracked as DEP-ARTIFACTS, DEP-LICENSE, DEP-COMPAT and DEP-RUNTIME in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md). They do not block unrelated Step 0.7 public-source planning, but they block the affected adoption or release claim.

## Official sources

All sources below were read 2026-10-13 unless otherwise stated. Tagged license files apply to the reviewed references; mutable registry/release/documentation pages need refreshing for adoption. Primary-source links are grouped by component and cited above. The LiteLLM enterprise license path returned 404 and is explicitly unverified, not listed as a successful source.

[LL-L]: https://raw.githubusercontent.com/BerriAI/litellm/v1.105.0/LICENSE
[LL-R]: https://github.com/BerriAI/litellm/releases/tag/v1.105.0
[LL-S]: https://github.com/BerriAI/litellm/security/advisories/GHSA-7hp6-4w63-5g45
[LL-I]: https://docs.litellm.ai/blog/security-townhall-updates
[NJ-L]: https://raw.githubusercontent.com/vercel/next.js/v16.4.0/license.md
[NJ-P]: https://registry.npmjs.org/next
[NJ-R]: https://github.com/vercel/next.js/releases/tag/v16.4.0
[NJ-S1]: https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j
[NJ-S2]: https://github.com/vercel/next.js/security/advisories/GHSA-cjq9-62q9-8jv4
[RE-L]: https://raw.githubusercontent.com/facebook/react/v19.3.0/LICENSE
[RE-P]: https://registry.npmjs.org/react
[RE-R]: https://github.com/facebook/react/releases/tag/v19.3.0
[RE-S1]: https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components
[RE-S2]: https://react.dev/blog/2025/12/11/denial-of-service-and-source-code-exposure-in-react-server-components
[AU-L]: https://raw.githubusercontent.com/nextauthjs/next-auth/next-auth%404.24.15/LICENSE
[AU-P]: https://registry.npmjs.org/next-auth
[AU-R]: https://github.com/nextauthjs/next-auth/releases/tag/next-auth%404.24.15
[AU-S1]: https://github.com/nextauthjs/next-auth/security/advisories/GHSA-7rqj-j65f-68wh
[AU-S2]: https://github.com/nextauthjs/next-auth/security/advisories/GHSA-xmf8-cvqr-rfgj
[LC-L]: https://raw.githubusercontent.com/LibreChat-AI/LibreChat/v0.8.8/LICENSE
[LC-R]: https://github.com/LibreChat-AI/LibreChat/releases/tag/v0.8.8
[LC-C]: https://www.librechat.ai/changelog
[LC-S]: https://github.com/LibreChat-AI/LibreChat/security/advisories/GHSA-gc9r-88c3-7qhq
[AL-L]: https://raw.githubusercontent.com/Mintplex-Labs/anything-llm/v1.17.0/LICENSE
[AL-R]: https://github.com/Mintplex-Labs/anything-llm/releases/tag/v1.17.0
[AL-S]: https://github.com/Mintplex-Labs/anything-llm/security/advisories/GHSA-3f4c-xj8r-h4cr
[OW-L]: https://raw.githubusercontent.com/open-webui/open-webui/v0.12.0/LICENSE
[OW-R]: https://github.com/open-webui/open-webui/releases/tag/v0.12.0
[DF-L]: https://raw.githubusercontent.com/langgenius/dify/1.17.1/LICENSE
[DF-R]: https://github.com/langgenius/dify/releases/tag/1.17.1
[MO-L]: https://raw.githubusercontent.com/microsoft/monaco-editor/v0.57.0/LICENSE.txt
[MO-P]: https://registry.npmjs.org/monaco-editor
[MO-R]: https://github.com/microsoft/monaco-editor/releases/tag/v0.57.0
[MO-S]: https://api.github.com/repos/microsoft/monaco-editor/security-advisories?per_page=100
[CM-L]: https://registry.npmjs.org/@codemirror/view/-/view-6.43.14.tgz
[CM-P]: https://registry.npmjs.org/%40codemirror%2Fview
[PY-L]: https://raw.githubusercontent.com/pyodide/pyodide/314.0.7/LICENSE
[PY-R]: https://github.com/pyodide/pyodide/releases/tag/314.0.7
[PY-B]: https://pyodide.org/en/stable/usage/downloading-and-deploying.html
[WC-L]: https://registry.npmjs.org/@webcontainer/api/-/api-1.6.4.tgz
[WC-P]: https://registry.npmjs.org/%40webcontainer%2Fapi
[WC-T]: https://webcontainers.io/enterprise
[GV-L]: https://raw.githubusercontent.com/google/gvisor/release-20261005.0/LICENSE
[GV-R]: https://github.com/google/gvisor/releases/tag/release-20261005.0
[GV-S]: https://raw.githubusercontent.com/google/gvisor/release-20261005.0/SECURITY.md
[GV-M]: https://gvisor.dev/docs/architecture_guide/security/
[FC-L]: https://raw.githubusercontent.com/firecracker-microvm/firecracker/v1.17.0/LICENSE
[FC-R]: https://github.com/firecracker-microvm/firecracker/releases/tag/v1.17.0
[FC-S]: https://raw.githubusercontent.com/firecracker-microvm/firecracker/v1.17.0/SECURITY.md
[FC-H]: https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/docs/prod-host-setup.md
[NO-L]: https://raw.githubusercontent.com/nodejs/node/v24.21.0/LICENSE
[NO-R]: https://nodejs.org/en/blog/release/v24.21.0
[NO-I]: https://nodejs.org/dist/index.json
[NO-C]: https://nodejs.org/en/about/previous-releases
[TS-L]: https://raw.githubusercontent.com/microsoft/TypeScript/v7.0.2/LICENSE.txt
[TS-P]: https://registry.npmjs.org/typescript
[TS-R]: https://github.com/microsoft/TypeScript/releases/tag/v7.0.2
[TS-S]: https://api.github.com/repos/microsoft/TypeScript/security-advisories?per_page=100
[PG-L]: https://www.postgresql.org/about/licence/
[PG-R]: https://www.postgresql.org/docs/release/18.6/
[PG-V]: https://www.postgresql.org/support/versioning/
[RD-L]: https://raw.githubusercontent.com/redis/redis/8.10.2/LICENSE.txt
[RD-R]: https://github.com/redis/redis/releases/tag/8.10.2
[RD-S]: https://github.com/redis/redis/security/advisories/GHSA-c8h9-259x-jff4
[GL-L]: https://raw.githubusercontent.com/gitleaks/gitleaks/v8.30.1/LICENSE
[GL-R]: https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1
[GL-S]: https://api.github.com/repos/gitleaks/gitleaks/security-advisories?per_page=100
[CP-L]: https://docs.python.org/3.11/license.html
[CP-R]: https://www.python.org/downloads/release/python-3119/
[CP-S]: https://www.python.org/downloads/release/python-31117/

## Preserved Step 0.1 tool provenance

The original 2026-10-12 bootstrap evidence remains valid within its recorded scope. Step 0.6 adds the public advisory observation above; it does not alter the existing tool pins.

| Component | Exact version | License evidence | Release date | Security evidence / open checks | Decision |
|---|---|---|---|---|---|
| Gitleaks CLI, Windows x64 | 8.30.1 | MIT; tagged official LICENSE read and bundled license retained | 2026-03-21, official release API | Official archive SHA-256 matched; executable hash pinned; local version checked. Repository advisory observation updated above; complete binary/CI dependency review remains TODO-VERIFY. No vulnerability-free claim | Accepted for local development secret scanning within the requested bootstrap; no application runtime dependency |

Sources read 2026-10-12:

- [Pinned release](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1)
- [Official release metadata](https://api.github.com/repos/gitleaks/gitleaks/releases/tags/v8.30.1)
- [Tagged MIT license](https://raw.githubusercontent.com/gitleaks/gitleaks/v8.30.1/LICENSE)
- [Published checksums](https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_checksums.txt)
- [Configuration/CLI documentation](https://github.com/gitleaks/gitleaks/tree/v8.30.1); installed `version` and `dir --help` also inspected.

Archive SHA-256: `d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e`.
Executable SHA-256: `17157e2ee8b76fc8b1d8bee607a250e34b8a8023c8bc81822d4b5ee4d78fcb7c`.

Scope: development-machine tooling, stored under ignored `.tools`; no paid APIs, provider traffic, application execution, or system-wide installation. The tool manifest and scripts permit reproducible verification. Product licenses and legal obligations remain separate Phase 0 evidence.
