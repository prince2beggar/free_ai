# Free-First AI Workspace

A planned Bangla/English AI workspace with hosted-model chat, files, paid Micro-Passes, and a later coding workbench. **Local Phase2: Steps2.1–2.5 registry, ledger, Governor, Router and abuse are complete. Step2.6 Control Center foundation is next.** Phase1 local chat and integration preparation are implemented. Actual Google/provider verification and hosting/domain are owner-deferred; hosted acceptance remains open. Follow [the Phase2 report](docs/PHASE2_REPORT.md) for the current commands, verified local evidence and sequence.

## Start here

1. Read the [build guide](docs/BUILD_GUIDE.md) and [progress](PROGRESS.md).
2. Review [the provider matrix](docs/PROVIDER_TERMS_MATRIX.md), completed for four research candidates at Step 0.2. Provider eligibility and activation remain pending. [CAPACITY-001](docs/DECISIONS.md) records the 100-user pilot target and BDT 1,500/month hosting ceiling; target regions (D10) and intended audience ages remain unresolved.
3. Review [the sourced pricing inputs](docs/pricing_inputs.json), completed at Step 0.3. Public model prices, dated FX references and partial gateway fees are separate; unknown costs remain excluded from feasibility and pack-sale decisions.
4. Read [the capacity report](docs/CAPACITY.md), completed as conditional Step 0.4 planning. At five assumed requests/user/day, the reference bounds are 120/35/16 users for light/medium/heavy token usage; exact eligible quotas and verified 100-user support remain pending.
5. Use [the offline pack calculator](docs/PACK_CALCULATOR.md), completed at Step 0.5. Its two hypothetical examples pass; the sourced audit keeps unresolved costs blocked and issues no pack grants.
6. Read [the dependency review](docs/DEPENDENCY_REVIEW.md), completed at Step 0.6. It records licenses, release dates, security findings and dispositions for the proposed stack; adoption holds and legal checks remain explicit.
7. Read [the Step 0.7 decision records](docs/DECISIONS.md): one-VPS/Next.js/PostgreSQL/LiteLLM planning direction, conditional hosting budget comparison and deferred execution/payments. Host adoption and all-in costs remain unverified.
8. Read [the Step 0.8 evaluation report](docs/EVAL_REPORT.md): 30 language prompts/15 coding tasks and the offline harness are prepared; 43 unit/CLI tests pass. Canned results are harness diagnostics, with real quality still unknown.
9. EVAL-APPROVAL-001 records threshold approval and test limits/stop rules; account setup is owner-deferred and full Step 0.8 remains NEEDS OWNER. [The gate report](docs/PHASE0_GATE_REPORT.md) preserves hosted NO-GO pending evidence. LOCAL-PHASE1-001 covers the local 1-series; subsequent LOCAL-PHASE2-001 / SRS17.1.4 opens ordered local synthetic Phase 2 while original external gates remain open.
10. Run/check the local registry, ledger, Governor and Router using [PHASE2_REPORT](docs/PHASE2_REPORT.md), then continue Step2.6 in order. Router preview127.0.0.1:4178, ledger4177 and the persistent Phase1 chat preview remain separate. Resume [actual integration setup](docs/PHASE1_INTEGRATION_GUIDE.md) and host/domain verification later.

Recommended phase order: **0 → 1 → 2 → 3 → 6 → 4 → 5a → optional 5b → 7**. See the guide for permitted alternatives and approval checkpoints.

## Canonical project documents

- [SRS v2.1.1](srs/SRS_v2.1_AI_Workspace.md): requirements and phase commands.
- [Operating manual v1.1](protocol/AGENT_OPERATING_MANUAL.md): implementation and verification rules.
- [Requirement traceability](docs/REQUIREMENT_TRACEABILITY.md): planned owners/checks, not passing test evidence.
- [Open questions](docs/OPEN_QUESTIONS.md): missing inputs and verification work.
- [Dependency review](docs/DEPENDENCY_REVIEW.md): candidate review and bounded local adoption; hosted-stack holds remain. [Phase 1 graph evidence](docs/phase1_dependency_evidence.json) and [SBOM](docs/phase1-sbom.json) record the current local graph. Historical prototype artifacts are preserved.

`AGENTS.md` and `CLAUDE.md` are instruction entrypoints. `HANDOFF.md` preserves the next task.

## Repository layout

| Directory | Planned purpose |
|---|---|
| `apps/web`, `apps/api`, `apps/admin` | User UI, API, and staff Control Center |
| `packages/router`, `packages/ledger` | Routing/capacity and usage accounting |
| `packages/agent`, `packages/sandbox` | Later agent and isolated execution adapters |
| `tests/unit`, `tests/integration`, `tests/security`, `tests/eval` | Future application tests and real-model evaluations |
| `docs/RUNBOOKS` | Future operating procedures |
| `tools` | Local bootstrap tooling and the offline pack calculator |

`apps/web` contains the typed client; `packages/db`, `packages/api` and `packages/gateway` contain the local database, sessions/API/limits and synthetic gateway. `packages/registry`, `packages/ledger` and `packages/governor` implement Phase2 trusted registry, exact signed accounting and shared quota admission; isolated local launchers are under `tools/phase2`. The npm workspace has pinned dependencies and a lockfile. The remaining `.gitkeep` folders preserve future modules. Real external sign-in/providers, compose and hosted deployment remain pending; `.github/workflows/phase1-local.yml` is configured but has not run remotely.

## Run local Phase 1 — Windows

The local tools/dependencies are installed in this workspace. From `D:\free_ai`, start the preview:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase1
```

Open **http://127.0.0.1:4174** after starting that command. The currently updated isolated preview runs at **http://127.0.0.1:4176**. Select **Demo Alpha** or **Demo Beta**, accept the local draft terms, and use sample text. These are shared synthetic identities, not private accounts. Stop your terminal launcher with Ctrl+C. No provider key is needed for this default mode. The app never loads `.env`; non-loopback settings and arbitrary real-model chat remain disabled. If the port is occupied, set `$env:PHASE1_PORT = '4176'` for your new launcher and use that port after stopping any existing launcher on it.

For optional Google test mode on port 4175 and the separate fixed-suite provider test, follow [the integration guide](docs/PHASE1_INTEGRATION_GUIDE.md). Google mode requires a complete explicit Web-client configuration, disables shared demo sign-in and uses a separate ignored database. Actual account setup and real verification remain required; ordinary chat stays synthetic.

Chats and hashed sessions persist under ignored `.phase1-local/database`; do not run two launchers against that directory. Account deletion removes chat content and revokes sessions, but retains minimal audit/usage evidence. Automatic audit/usage expiry is deferred; 5,000 audit/2,000 usage-row admission caps stop new mutations before unbounded growth and preserve logout/deletion capacity. Keep this data synthetic. The original memory-only preview is still available with `-Task dev` on port 4173.

For a fresh checkout, first run `tools/install-prototype-node.ps1` with the same PowerShell flags, then `tools/prototype.ps1 -Task install`. The wrapper uses checksum-pinned repository-local Node, verified HTTPS/system certificates, dev dependencies and disabled install lifecycle scripts; it does not change global Node/npm or execution policy.

Checks, using the same PowerShell flags: `-Task phase1-check`, `-Task phase1-browser` (existing Microsoft Edge), `-Task phase1-coverage`, `-Task phase1-readiness`, `-Task audit`, and `-Task phase1-sbom`. Also run `python -B -m unittest discover -s tests/unit -p 'test_*.py'` and `-Task browser` for the preserved offline tools/original preview. Phase 1 recorded **97 unique passing tests**; Step 2.1 adds **13 passing registry tests** through `-Task phase2-check`. Coverage and repeated checks do not add tests to these counts; unchanged Python/browser evidence was not rerun for the registry change. Browser captures are under ignored `.tools/phase1-preview`; tests stop their ephemeral servers. The wrapper uses the reviewed local runtime; global Node 22.13.1 is not the chosen runtime.

## Run local Step2.2 ledger — Windows

The verified synthetic ledger preview is **http://127.0.0.1:4177**. Demo Alpha shows the saved100CU/20CU/12CU accounting example as88 remaining input tokens; Demo Beta has no allowance. This fixture is separate from Phase1 data and ordinary canned-chat counters. The separate Step2.4 Router preview below couples its own chat, ledger and Governor. No real provider or payment runs.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-ledger
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2
```

The first command replays the persisted example; the second starts the loopback preview after a build. The preview is currently running: do not start another launcher against `.phase2-local/ledger-database` while its lock is active. See [PHASE2_REPORT](docs/PHASE2_REPORT.md) for commands, safe shutdown/lock handling and the46 Phase2+52 regression+2 browser passes. Ledger coverage98.68% lines/86.91% branches/100% functions reuses33 checks; arithmetic100%. Independent source review findings are closed. Original live/hosted phase acceptance remains open.

## Run local Step 2.3 Governor — Windows

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-governor
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-check
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-governor-coverage
```

The CLI replays two synthetic requests through a shared provider/account pool and prints counters plus a saved daily token policy. Its separate ignored `.phase2-local/governor-database` explicitly uses migration5 and an exclusive launcher lock. It grants no ledger funds and makes no provider calls. The verified example consumes 2 requests/40 tokens and computes a399-token policy from configured synthetic quotas. Final checks passed92 Phase2+52 regression tests; Governor coverage99.50% lines. [PHASE2_REPORT](docs/PHASE2_REPORT.md) records independent review, reset/expiry rollback, persistence and remaining scope. Step2.4 now connects Governor, ledger and chat in its separate fixture.

## Run local Step 2.4 Router — Windows

The verified synthetic Router preview is **http://127.0.0.1:4178**. Select Demo Alpha to try Auto, manual model choice, free-only, four task presets, context trimming, stop and budgeted retry/regenerate. Saved replies identify every actual synthetic attempt. Alpha has a toy100CU pack; Beta has only free routes. No external provider is called.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-router
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-router-preview
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-router-coverage
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-router-browser
```

The preview is currently running against ignored `.phase2-local/router-database`, migration6 and an exclusive launcher lock; do not start another opener while it is active. Run database/browser suites serially on this machine. Step2.4 verification passed191 unique checks:133 Phase2,52 regression and6 browser; Router coverage96.62% lines. Independent findings, disk replay and actual authenticated preview checks are closed in [PHASE2_REPORT](docs/PHASE2_REPORT.md). Step2.5 is now complete locally in its separate fixture below; full live/hosted acceptance remains open.

## Run local Step 2.5 Abuse — Windows

The verified synthetic preview is **http://127.0.0.1:4179**. Accept the local notices, click Complete local verification, then choose Demo Alpha or Beta. Owned account status shows trust and configured limits. Suspicious bursts require fresh local work and an explicit retry. This proof-of-work does not verify a unique human.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-abuse
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-abuse-preview
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-abuse-coverage
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase2-abuse-browser
```

The active preview owns ignored `.phase2-local/abuse-database`, migration7 and its exclusive lock. Do not open the database or start a second launcher while active. Keep its durable local HMAC key safely backed up; missing or replaced keys refuse existing data. DB/browser suites run serially on this host. 166 Phase2 + 52 regression + 9 browser checks PASS (227 unique); Abuse 98.86% lines/84.8% branches/100% functions; independent fixes, disk replay/lock and authenticated preview evidence are in [PHASE2_REPORT](docs/PHASE2_REPORT.md). Synthetic rates, quotas, paid labels and toy funds establish no actual free-service capacity or spending. Staff MFA/UI2.6 and cluster alert screens/delivery2.8 follow later.

## Environment template

[.env.example](.env.example) contains empty variable values only. When an authorized step needs local configuration, copy it to ignored `.env` and supply values through approved secret storage. Replace the provider `NAME` placeholder only after choosing an approved registry provider. Paid credentials remain disabled until scoped approval. Never commit real credentials, uploaded files, workspaces, or backups.

## Local secret scanning — Windows x64

Git and Windows PowerShell are required for bootstrap tooling. Gitleaks **8.30.1** is pinned in [the tool manifest](tools/gitleaks-version.json); official release checksums are recorded and the executable stays in ignored `.tools`.

From the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\install-gitleaks.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\scan-secrets.ps1
```

The installer downloads only the pinned official release if it is absent. It verifies archive and executable hashes. The scanner checks working-tree files, including new/untracked source and environment files, uses built-in rules, redacts results, and returns a nonzero exit code on findings/errors. Only Git internals and the external tool distribution are excluded. It does not upload project content. The configured Phase 1 workflow also scans the working tree with checksum-pinned Linux Gitleaks; remote CI/history execution remains pending until development history and an authorized remote exist.

Configuration and command behavior follow the [official Gitleaks documentation](https://github.com/gitleaks/gitleaks/tree/v8.30.1) and [pinned release](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1), checked 2026-10-12. Tool review records scope and remaining security checks.
