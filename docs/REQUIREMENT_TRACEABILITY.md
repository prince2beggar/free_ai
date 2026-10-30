# Requirement Traceability

Updated: 2026-10-13. Canonical requirements: [SRS v2.1.1](../srs/SRS_v2.1_AI_Workspace.md).

All verification IDs below are ownership/planning references, not blanket passing evidence. Actual scoped local Phase 1 results and remaining original release checks are mapped in [PHASE1_REPORT.md](PHASE1_REPORT.md), dated 2026-10-13. Before implementing a step, turn each owned acceptance criterion into a meaningful automated test or recorded manual check. Append actual command, result, evidence path, and date to PROGRESS. Phase smoke tests do not replace requirement-level checks.

Priority is relative to the assigned phase. Multiple ownership steps identify staged delivery or repeated checks. REG-01/05: Ph0 review then Ph2 runtime gate. FILE-01/02: Ph3 documents then Ph4 ZIP. ABUSE-05: optional Ph5b L3 gate and Ph6 purchase checks. NFR targets apply to every shipped surface, including admin at 4.8 and billing at 6.9; initial/agent owners do not exempt later releases. SEC/AUP/LEG checks are mandatory even where the SRS table has no AC column.

| Requirement | Phase | Priority | Implementation/check owner | Planned verification |
|---|---|---|---|---|
| AUTH-01 | Ph1 | P0 | 1.3 | AC-AUTH-01: verify the SRS criterion/target and negative cases |
| AUTH-02 | Ph1 | P0 | 1.3 | AC-AUTH-02: verify the SRS criterion/target and negative cases |
| AUTH-03 | Ph1 | P0 | 1.3 | AC-AUTH-03: verify the SRS criterion/target and negative cases |
| AUTH-04 | Ph1 | P0 | 1.3 | AC-AUTH-04: verify the SRS criterion/target and negative cases |
| AUTH-05 | Ph2 | P0 | 2.5 | AC-AUTH-05: new users trust0; current configurable request/token/concurrency limits across free/paid routes PASS locally |
| AUTH-06 | Ph6 | P1 | 6.4 | AC-AUTH-06: verify the SRS criterion/target and negative cases |
| AUTH-07 | Ph1 | P0 | 1.7 | AC-AUTH-07: verify the SRS criterion/target and negative cases |
| REG-01 | Ph0 | P0 | 0.2 / 2.1 | AC-REG-01: verify the SRS criterion/target and negative cases |
| REG-02 | Ph2 | P0 | 2.1 | AC-REG-02: verify the SRS criterion/target and negative cases |
| REG-03 | Ph1 | P0 | 1.4 | AC-REG-03: verify the SRS criterion/target and negative cases |
| REG-04 | Ph4 | P1 | 4.8 | AC-REG-04: verify the SRS criterion/target and negative cases |
| REG-05 | Ph0 | P0 | 0.2 / 2.1 | AC-REG-05: verify the SRS criterion/target and negative cases |
| ROUTE-01 | Ph1 | P0 | 1.4 | AC-ROUTE-01: verify the SRS criterion/target and negative cases |
| ROUTE-02 | Ph2 | P0 | 2.4 | AC-ROUTE-02: local capability/class/language/context filtering and strict fallback/pinned negatives PASS; PHASE2_REPORT Step2.4; actual model evidence open |
| ROUTE-03 | Ph2 | P0 | 2.4 | AC-ROUTE-03: free preference, exact funded paid fixture and zero-balance/no-dispatch checks PASS; no real paid call |
| ROUTE-04 | Ph2 | P0 | 2.4 | AC-ROUTE-04: every synthetic attempt joins Governor and ledger in one transaction; exhaustion/expiry/cancel rollback PASS |
| ROUTE-05 | Ph2 | P0 | 2.9 | AC-ROUTE-05: local private mode strictly excludes may_train providers (TRAINING_POLICY_FORBIDDEN); manual/pinned cannot override; fallback preserves sensitivity; tests/unit/phase2-private-routing.mjs PASS |
| ROUTE-06 | Ph1 | P0 | 1.6 | AC-ROUTE-06: verify the SRS criterion/target and negative cases |
| ROUTE-07 | Ph2 | P0 | 2.9 | AC-ROUTE-07: free route using may_train provider triggers trainingNoticeRequired: true; once-per-session tracking with /api/privacy/training-notice endpoints; tests/unit/phase2-private-routing.mjs PASS |
| ROUTE-08 | Ph4 | P1 | 4.8 | AC-ROUTE-08: verify the SRS criterion/target and negative cases |
| ROUTE-09 | Ph2 | P0 | 2.4 | AC-ROUTE-09: immutable policy versions, prepared snapshot and staff read-only/no-call simulator PASS; staff web/MFA2.6 and simulator UI2.8 remain future |
| ROUTE-10 | Ph2 | P0 | 2.4 | AC-ROUTE-10: one retry/one fallback defaults, durable shared original/retry/regenerate budget and restart PASS |
| ROUTE-11 | Ph2 | P0 | 2.4 | AC-ROUTE-11: provider/model failure-window/cool-off and stopped-user exclusion regressions PASS |
| ROUTE-12 | Ph2 | P0 | 2.4 | AC-ROUTE-12: partial output causes no automatic resend; live/saved separate attempts and model-change banner browser PASS |
| ROUTE-13 | Ph2 | P0 | 2.4 | AC-ROUTE-13: safe no-eligible/capacity/funding/context refusals with known reset and alternatives PASS; unknown timing never fabricated |
| ROUTE-14 | Ph2 | P0 | 2.4 | AC-ROUTE-14: every prepared decision captures candidates/reasons/policy; actual chosen attempts/provenance and minimal trusted inspection PASS |
| QUOTA-01 | Ph2 | P0 | 2.2 | AC-QUOTA-01: verify the SRS criterion/target and negative cases |
| QUOTA-02 | Ph1 | P0 | 1.7 | AC-QUOTA-02: verify the SRS criterion/target and negative cases |
| QUOTA-03 | Ph2 | P0 | 2.2 | AC-QUOTA-03: verify the SRS criterion/target and negative cases |
| QUOTA-04 | Ph2 | P0 | 2.2 | AC-QUOTA-04: verify the SRS criterion/target and negative cases |
| QUOTA-05 | Ph2 | P0 | 2.2 | AC-QUOTA-05: verify the SRS criterion/target and negative cases |
| QUOTA-06 | Ph2 | P0 | 2.3 | AC-QUOTA-06: local concurrent all-scope/window and reset rollback checks PASS; PHASE2_REPORT Steps2.3/2.4 include joint chat/ledger admission; actual capacity unknown |
| QUOTA-07 | Ph2 | P0 | 2.3 | AC-QUOTA-07: exact token fair share, shared-tree aggregation, request conversion/shrink/zero-user checks PASS; PHASE2_REPORT Step2.3; real quota evidence pending |
| QUOTA-08 | Ph6 | P1 | 6.2 | AC-QUOTA-08: verify the SRS criterion/target and negative cases |
| QUOTA-09 | Ph4 | P1 | 4.8 | AC-QUOTA-09: verify the SRS criterion/target and negative cases |
| QUOTA-10 | Ph4 | P0 | 4.2 | AC-QUOTA-10: verify the SRS criterion/target and negative cases |
| QUOTA-11 | Ph6 | P0 | 6.2 | AC-QUOTA-11: verify the SRS criterion/target and negative cases |
| CHAT-01 | Ph1 | P0 | 1.5 | AC-CHAT-01: verify the SRS criterion/target and negative cases |
| CHAT-02 | Ph1 | P0 | 1.5 | AC-CHAT-02: verify the SRS criterion/target and negative cases |
| CHAT-03 | Ph2 | P0 | 2.4 | AC-CHAT-03: optional Auto/manual/free-only and four task presets change eligible/ranked routing; mobile browser and routing-off regression PASS |
| CHAT-04 | Ph2 | P0 | 2.4 | AC-CHAT-04: known synthetic tokenizer includes system/history/output reserve; trim whole old turns, protect newest, refuse impossible/unknown context PASS; no summary model call |
| CHAT-05 | Ph2 | P0 | 2.4 | AC-CHAT-05: stop plus owned retry/regenerate share durable budget; source prompt/IDOR, unknown holds and pretransport refund checks PASS |
| CHAT-06 | Ph1 | P0 | 1.5 | AC-CHAT-06: verify the SRS criterion/target and negative cases |
| CHAT-07 | Ph1 | P0 | 1.5 | AC-CHAT-07: verify the SRS criterion/target and negative cases |
| WRITE-01 | Ph3 | P0 | 3.1 | AC-WRITE-01: drafting, rewriting, grammar, and 7 tone presets verified in packages/productivity/ and tests/unit/phase3-productivity-presets.mjs (PASS) |
| WRITE-02 | Ph3 | P0 | 3.1 | AC-WRITE-02: bidirectional English/Bengali translation; 15/15 Bangla evaluation cases (BN01-BN15) PASS (100% vs 85% configured quality bar) |
| WRITE-03 | Ph3 | P0 | 3.1 | AC-WRITE-03: executive, bullet points, TL;DR, and ELI5 simplified explanation presets on arbitrary text verified in tests/unit/phase3-productivity-presets.mjs (PASS) |
| WRITE-04 | Ph3 | P1 | 3.1 | AC-WRITE-04: structured output (Markdown tables, hierarchical outlines, schema-validated JSON) verified with negative tests (PASS) |
| WRITE-05 | Ph3 | P0 | 3.1 | AC-WRITE-05: input limits enforcement with INPUT_EXCEEDS_LIMIT clear explanation and section-by-section chunking verified (PASS) |
| FILE-01 | Ph3 | P0 | 3.2 / 4.1 | AC-FILE-01: supported types PDF, TXT, CSV accepted; unsupported formats and executables safely refused (PASS) |
| FILE-02 | Ph3 | P0 | 3.2 / 4.1 | AC-FILE-02: magic bytes sniffing, size checks (10MB limit), filename path traversal protection, and T3.1 hostile file refusal verified (PASS) |
| FILE-03 | Ph3 | P0 | 3.2 | AC-FILE-03: safe text extraction for PDF, TXT, CSV, formula injection defense, and token estimation verified (PASS) |
| FILE-04 | Ph3 | P1 | 3.3 | AC-FILE-04: CSV summary profiling, missing-value analysis, numeric/categorical statistics, chart suggestions, and natural language queries verified in tests/unit/phase3-csv-analysis.mjs (PASS) |
| FILE-05 | Ph3 | P0 | 3.4 | AC-FILE-05: configurable file retention schedule, automated expiry, disk unlinking, and user storage quota enforcement verified in tests/unit/phase3-retention.mjs (PASS) |
| FILE-06 | Ph3 | P0 | 3.2 | AC-FILE-06: per-user storage isolation and IDOR access/download/delete prevention verified (PASS) |
| FILE-07 | Ph3 | P1 | 3.2 | AC-FILE-07: section-by-section flow for documents over limits with CSV header preservation verified (PASS) |
| SEARCH-01 | Ph4 | P1 | 4.7 | AC-SEARCH-01: verify the SRS criterion/target and negative cases |
| SEARCH-02 | Ph4 | P1 | 4.7 | AC-SEARCH-02: verify the SRS criterion/target and negative cases |
| SEARCH-03 | Ph4 | P1 | 4.7 | AC-SEARCH-03: verify the SRS criterion/target and negative cases |
| SEARCH-04 | Ph4 | P0 | 4.7 | AC-SEARCH-04: verify the SRS criterion/target and negative cases |
| AGENT-01 | Ph4 | P0 | 4.2 | AC-AGENT-01: verify the SRS criterion/target and negative cases |
| AGENT-02 | Ph4 | P0 | 4.4 | AC-AGENT-02: verify the SRS criterion/target and negative cases |
| AGENT-03 | Ph4 | P0 | 4.2 | AC-AGENT-03: verify the SRS criterion/target and negative cases |
| AGENT-04 | Ph4 | P0 | 4.2 | AC-AGENT-04: verify the SRS criterion/target and negative cases |
| AGENT-05 | Ph4 | P0 | 4.2 | AC-AGENT-05: verify the SRS criterion/target and negative cases |
| AGENT-06 | Ph4 | P0 | 4.2 | AC-AGENT-06: verify the SRS criterion/target and negative cases |
| AGENT-07 | Ph4 | P0 | 4.4 | AC-AGENT-07: verify the SRS criterion/target and negative cases |
| AGENT-08 | Ph4 | P0 | 4.2 | AC-AGENT-08: verify the SRS criterion/target and negative cases |
| AGENT-09 | Ph4 | P0 | 4.4 | AC-AGENT-09: verify the SRS criterion/target and negative cases |
| AGENT-10 | Ph4 | P0 | 4.5 | AC-AGENT-10: verify the SRS criterion/target and negative cases |
| AGENT-11 | Ph4 | P0 | 4.5 | AC-AGENT-11: verify the SRS criterion/target and negative cases |
| AGENT-12 | Ph4 | P0 | 4.5 | AC-AGENT-12: verify the SRS criterion/target and negative cases |
| AGENT-13 | Ph4 | P0 | 4.3 | AC-AGENT-13: verify the SRS criterion/target and negative cases |
| AGENT-14 | Ph5 | P0 | 5a.2 | AC-AGENT-14: verify the SRS criterion/target and negative cases |
| AGENT-15 | Ph4 | P0 | 4.3 | AC-AGENT-15: verify the SRS criterion/target and negative cases |
| AGENT-16 | Ph5 | P1 | 5a.3 | AC-AGENT-16: verify the SRS criterion/target and negative cases |
| AGENT-17 | Ph5 | P1 | 5a.3 | AC-AGENT-17: verify the SRS criterion/target and negative cases |
| AGENT-18 | Ph5 | P1 | 5a.3 | AC-AGENT-18: verify the SRS criterion/target and negative cases |
| AGENT-19 | Ph4 | P0 | 4.1 | AC-AGENT-19: verify the SRS criterion/target and negative cases |
| AGENT-20 | Ph4 | P0 | 4.5 | AC-AGENT-20: verify the SRS criterion/target and negative cases |
| SBX-01 | Ph5a | P1 | 5a.1 | AC-SBX-01: verify the SRS criterion/target and negative cases |
| SBX-02 | Ph5b | P1 | 5b.1 | AC-SBX-02: verify the SRS criterion/target and negative cases |
| SBX-03 | Ph5b | P1 | 5b.1 | AC-SBX-03: verify the SRS criterion/target and negative cases |
| SBX-04 | Ph5b | P1 | 5b.1 | AC-SBX-04: verify the SRS criterion/target and negative cases |
| SBX-05 | Ph5b | P1 | 5b.1 | AC-SBX-05: verify the SRS criterion/target and negative cases |
| SBX-06 | Ph5b | P1 | 5b.1 | AC-SBX-06: verify the SRS criterion/target and negative cases |
| SBX-07 | Ph5b | P1 | 5b.1 | AC-SBX-07: verify the SRS criterion/target and negative cases |
| SBX-08 | Ph4 | P0 | 4.3 | AC-SBX-08: verify the SRS criterion/target and negative cases |
| WB-01 | Ph4 | P0 | 4.6 | AC-WB-01: verify the SRS criterion/target and negative cases |
| WB-02 | Ph4 | P0 | 4.6 | AC-WB-02: verify the SRS criterion/target and negative cases |
| WB-03 | Ph4 | P0 | 4.6 | AC-WB-03: verify the SRS criterion/target and negative cases |
| WB-04 | Ph5 | P1 | 5a.3 | AC-WB-04: verify the SRS criterion/target and negative cases |
| WB-05 | Ph5 | P1 | 5a.2 | AC-WB-05: verify the SRS criterion/target and negative cases |
| WB-06 | Ph5a | P1 | 5a.1 | AC-WB-06: verify the SRS criterion/target and negative cases |
| WB-07 | Ph4 | P0 | 4.6 | AC-WB-07: verify the SRS criterion/target and negative cases |
| PAY-01 | Ph6 | P0 | 6.1 | AC-PAY-01: verify the SRS criterion/target and negative cases |
| PAY-02 | Ph6 | P0 | 6.1 | AC-PAY-02: verify the SRS criterion/target and negative cases |
| PAY-03 | Ph6 | P0 | 6.1 | AC-PAY-03: verify the SRS criterion/target and negative cases |
| PAY-04 | Ph6 | P0 | 6.3 | AC-PAY-04: verify the SRS criterion/target and negative cases |
| PAY-05 | Ph6 | P0 | 6.2 | AC-PAY-05: verify the SRS criterion/target and negative cases |
| PAY-06 | Ph6 | P0 | 6.2 | AC-PAY-06: verify the SRS criterion/target and negative cases |
| PAY-07 | Ph6 | P0 | 6.1 | AC-PAY-07: verify the SRS criterion/target and negative cases |
| PAY-08 | Ph6 | P0 | 6.5 | AC-PAY-08: verify the SRS criterion/target and negative cases |
| PAY-09 | Ph6 | P0 | 6.3 | AC-PAY-09: verify the SRS criterion/target and negative cases |
| PAY-10 | Ph6 | P0 | 6.1 | AC-PAY-10: verify the SRS criterion/target and negative cases |
| PAY-11 | Ph6 | P0 | 6.4 | AC-PAY-11: verify the SRS criterion/target and negative cases |
| PAY-12 | Ph6 | P0 | 6.4 | AC-PAY-12: verify the SRS criterion/target and negative cases |
| PAY-13 | Ph6 | P0 | 6.4 | AC-PAY-13: verify the SRS criterion/target and negative cases |
| PAY-14 | Ph6 | P0 | 6.2 | AC-PAY-14: verify the SRS criterion/target and negative cases |
| PAY-15 | Ph6 | P0 | 6.7 | AC-PAY-15: verify the SRS criterion/target and negative cases |
| PAY-16 | Ph6 | P1 | 6.6 | AC-PAY-16: verify the SRS criterion/target and negative cases |
| PAY-17 | Ph6 | P1 | 6.6 | AC-PAY-17: verify the SRS criterion/target and negative cases |
| PAY-18 | Ph6 | P2 | 6.2 | AC-PAY-18: verify the SRS criterion/target and negative cases |
| PAY-19 | Ph6 | P1 | 6.4 | AC-PAY-19: verify the SRS criterion/target and negative cases |
| PAY-20 | Ph6 | P1 | 6.1 | AC-PAY-20: verify the SRS criterion/target and negative cases |
| PAY-21 | Ph7 | P2 | 7.5 | AC-PAY-21: verify the SRS criterion/target and negative cases |
| PRIV-01 | Ph1 | P0 | 1.8 | AC-PRIV-01: verify the SRS criterion/target and negative cases |
| PRIV-02 | Ph1 | P0 | 1.8 | AC-PRIV-02: verify the SRS criterion/target and negative cases |
| PRIV-03 | Ph2 | P0 | 2.9 | AC-PRIV-03: private mode restricts routing to no_training/synthetic_only providers regardless of capacity; private requests never reach may_train providers; tests/unit/phase2-private-routing.mjs PASS |
| PRIV-04 | Ph1 | P0 | 1.5 | AC-PRIV-04: verify the SRS criterion/target and negative cases |
| PRIV-05 | Ph3 | P0 | 3.4 | AC-PRIV-05: configurable retention for conversations and files, soft-delete grace period, permanent purge, and user-triggered deletion verified (PASS) |
| PRIV-06 | Ph3 | P0 | 3.2 | AC-PRIV-06: upload privacy warning against secrets/passwords shown on upload and in API metadata (PASS) |
| PRIV-07 | Ph4 | P1 | 4.8 | AC-PRIV-07: verify the SRS criterion/target and negative cases |
| PRIV-08 | Ph6 | P1 | 6.4 | AC-PRIV-08: verify the SRS criterion/target and negative cases |
| SEC-01 | Ph1 | P0 | 1.4 | AC-SEC-01: verify the SRS criterion/target and negative cases |
| SEC-02 | Ph1 | P0 | 1.5 | AC-SEC-02: verify the SRS criterion/target and negative cases |
| SEC-03 | Ph1 | P0 | 1.5 | AC-SEC-03: verify the SRS criterion/target and negative cases |
| SEC-04 | Ph1 | P0 | 1.7 | AC-SEC-04: verify the SRS criterion/target and negative cases |
| SEC-05 | Ph1 | P0 | 1.9 | AC-SEC-05: verify the SRS criterion/target and negative cases |
| SEC-06 | Ph1 | P0 | 1.9 | AC-SEC-06: verify the SRS criterion/target and negative cases |
| SEC-07 | Ph1 | P0 | 1.9 | AC-SEC-07: verify the SRS criterion/target and negative cases |
| SEC-08 | Ph4 | P0 | 4.7 | AC-SEC-08: verify the SRS criterion/target and negative cases |
| SEC-09 | Ph6 | P0 | 6.3 | AC-SEC-09: verify the SRS criterion/target and negative cases |
| SEC-10 | Ph3 | P0 | 3.5 | AC-SEC-10: AES-256-GCM encrypted backup archive creation, SHA-256 integrity, tamper rejection, and full restore verified PASS in tests/unit/phase3-backup.mjs (T3.3) |
| ABUSE-01 | Ph2 | P0 | 2.5 | AC-ABUSE-01: configurable monotonic0–3 tiers, age/contact/good-behavior evidence, current attempt limits and revocation PASS locally |
| ABUSE-02 | Ph2 | P0 | 2.5 | AC-ABUSE-02: signup/burst rules, source/purpose/nonce/TTL/single-use proof and explicit UI retry PASS; synthetic equivalent does not verify a human |
| ABUSE-03 | Ph2 | P0 | 2.5 | AC-ABUSE-03: device/IP-range HMAC, canonical addresses, minimal persistent cluster alerts PASS; Control Center screens/delivery2.8 pending |
| ABUSE-04 | Ph2 | P0 | 2.5 | AC-ABUSE-04: durable device/IP/day caps, atomic rollback, replay/reset/deletion/restart/wrong-key boundaries PASS locally |
| ABUSE-05 | Ph5 | P1 | 5b.1 / 6.3 | AC-ABUSE-05: verify the SRS criterion/target and negative cases |
| ABUSE-06 | Ph4 | P1 | 4.8 | AC-ABUSE-06: verify the SRS criterion/target and negative cases |
| ABUSE-07 | Ph2 | P0 | 2.5 | AC-ABUSE-07: trusted current-role suspend/throttle/ban, bounded reasons, immutable audit/replay, expiry/session/in-flight closure PASS; staff HTTP/MFA2.6 pending |
| AGSEC-01 | Ph4 | P0 | 4.3 | AC-AGSEC-01: verify the SRS criterion/target and negative cases |
| AGSEC-02 | Ph4 | P0 | 4.3 | AC-AGSEC-02: verify the SRS criterion/target and negative cases |
| AGSEC-03 | Ph5 | P1 | 5a.2 | AC-AGSEC-03: verify the SRS criterion/target and negative cases |
| AGSEC-04 | Ph4 | P0 | 4.3 | AC-AGSEC-04: verify the SRS criterion/target and negative cases |
| AGSEC-05 | Ph5 | P0 | 5a.2 | AC-AGSEC-05: verify the SRS criterion/target and negative cases |
| AUP-01 | Ph1 | P0 | 1.8 | AC-AUP-01: verify the SRS criterion/target and negative cases |
| AUP-02 | Ph4 | P0 | 4.3 | AC-AUP-02: verify the SRS criterion/target and negative cases |
| AUP-03 | Ph4 | P1 | 4.8 | AC-AUP-03: verify the SRS criterion/target and negative cases |
| AUP-04 | Ph5 | P0 | 5a.1 | AC-AUP-04: verify the SRS criterion/target and negative cases |
| AP-01 | Ph2 | P0 | 2.6 | AC-AP-01: separate /admin and /admin/api/* scope; non-staff sessions receive 403 ADMIN_FORBIDDEN in unit & browser integration PASS |
| AP-02 | Ph2 | P0 | 2.6 | AC-AP-02: RBAC with 4 system roles and custom roles; permission hierarchy and 403 INSUFFICIENT_PERMISSIONS checks PASS |
| AP-03 | Ph2 | P0 | 2.6 | AC-AP-03: config revisions append-only immutability and one-click rollback for kill switches and routing policies PASS (T2.6) |
| AP-04 | Ph2 | P0 | 2.6 | AC-AP-04: RFC 6238 TOTP MFA for staff accounts; step-up session elevation and 403 MFA_REQUIRED checks PASS (T2.7) |
| AP-05 | Ph2 | P0 | 2.6 | AC-AP-05: append-only admin_audit_log with trigger rejecting UPDATE/DELETE/TRUNCATE PASS |
| AP-06 | Ph2 | P0 | 2.7 / 2.8 | AC-AP-06: routing simulator endpoint (/admin/api/routing/simulate) dry-run with prompt, language, presets, and model score/cost evaluation PASS (Step 2.7) |
| AP-07 | Ph6 | P1 | 6.8 | AC-AP-07: verify the SRS criterion/target and negative cases |
| AP-08 | Ph6 | P0 | 6.1 | AC-AP-08: verify the SRS criterion/target and negative cases |
| AP-09 | Ph2 | P0 | 2.6 | AC-AP-09: hierarchical kill switches (all_ai, provider:*, model:*); immediate 503 KILL_SWITCH_ACTIVE and chat blocking PASS (T2.5) |
| AP-10 | Ph4 | P1 | 2.7 / 4.8 | AC-AP-10: CSV export of audit log with mandatory immutable AUDIT_LOG_EXPORTED audit entry PASS (Step 2.7) |
| AP-11 | Ph4 | P1 | 4.8 | AC-AP-11: verify the SRS criterion/target and negative cases |
| OPS-01 | Ph1 | P0 | 1.1 / 1.10 | AC-OPS-01: verify the SRS criterion/target and negative cases |
| OPS-02 | Ph1 | P0 | 1.7 | AC-OPS-02: verify the SRS criterion/target and negative cases |
| OPS-03 | Ph1 | P0 | 0.7 / 1.10 | AC-OPS-03: verify the SRS criterion/target and negative cases |
| OPS-04 | Ph3 | P0 | 3.5 | AC-OPS-04: daily encrypted backups, tamper rejection, CLI tooling (tools/phase3/backup.mjs), and clean restore test report verified PASS in tests/unit/phase3-backup.mjs (T3.3) |
| OPS-05 | Ph2 / Ph3 | P0 | 2.8 / 3.6 | AC-OPS-05: Phase 3 health monitoring extended to storage, backups, retention, and productivity presets; public /health, /api/health, /api/status, and staff /admin/api/monitoring/health endpoints verified; owner alert triggers (storage, backup, retention, data incident) with HMAC delivery proof and retries PASS in tests/unit/phase3-monitoring-runbooks.mjs |
| OPS-06 | Ph2 | P0 | 2.4 / 2.8 | AC-OPS-06: verify the SRS criterion/target and negative cases |
| OPS-07 | Ph3 | P1 | 3.6 | AC-OPS-07: staging environment mirror parity tool (tools/phase3/staging-check.mjs) automated 8 checks (runtime, storage isolation, backup isolation, migrations 001..010, core tables, breakers baseline, telemetry, runbooks parity) verified 8/8 PASS |
| OPS-08 | Ph3 | P0 | 3.6 | AC-OPS-08: comprehensive incident runbook suite (README.md, PROVIDER_OUTAGE.md, QUOTA_EXHAUSTION.md, ABUSE_WAVE.md, DATA_INCIDENT_AND_NOTIFICATIONS.md, BACKUP_AND_STORAGE_INCIDENT.md) authored in docs/RUNBOOKS/ and verified PASS in tests/unit/phase3-monitoring-runbooks.mjs |
| OPS-09 | Ph1 | P0 | 1.1 | AC-OPS-09: verify the SRS criterion/target and negative cases |
| NFR-01 | Each shipped phase | Release target | 2.10 | AC-NFR-01: Phase 2 local test suite (203 unit + 9 browser) PASS; 100% verified locally |
| NFR-02 | Each shipped phase | Release target | 1.10 | AC-NFR-02: verify the SRS criterion/target and negative cases |
| NFR-03 | Each shipped phase | Release target | 1.6 / 4.6 | AC-NFR-03: verify the SRS criterion/target and negative cases |
| NFR-04 | Each shipped phase | Release target | 2.8 | AC-NFR-04: verify the SRS criterion/target and negative cases |
| NFR-05 | Each shipped phase | Release target | 2.2 / 6.3 | AC-NFR-05: verify the SRS criterion/target and negative cases |
| NFR-06 | Each shipped phase | Release target | 1.6 / 4.6 | AC-NFR-06: verify the SRS criterion/target and negative cases |
| NFR-07 | Each shipped phase | Release target | 1.6 / 4.6 | AC-NFR-07: verify the SRS criterion/target and negative cases |
| NFR-08 | Each shipped phase | Release target | 1.6 / 4.6 | AC-NFR-08: verify the SRS criterion/target and negative cases |
| NFR-09 | Each shipped phase | Release target | 2.10 / 4.9 | AC-NFR-09: Phase 2 zero mutation during dry runs, append-only logs, full auditability |
| NFR-10 | Each shipped phase | Release target | 1.5 | AC-NFR-10: verify the SRS criterion/target and negative cases |
| NFR-11 | Each shipped phase | Release target | 1.1 | AC-NFR-11: verify the SRS criterion/target and negative cases |
| NFR-12 | Each shipped phase | Release target | 1.6 | AC-NFR-12: verify the SRS criterion/target and negative cases |
| LEG-01 | Ph1 | P0 | 1.8 | AC-LEG-01: verify the SRS criterion/target and negative cases |
| LEG-02 | Ph0 | P0 | 0.7 | AC-LEG-02: verify the SRS criterion/target and negative cases |
| LEG-03 | Ph0 | P0 | 0.2 | AC-LEG-03: verify the SRS criterion/target and negative cases |
| LEG-04 | Ph0 | P0 | 0.6 | AC-LEG-04: verify the SRS criterion/target and negative cases |
| LEG-05 | Ph1 | P0 | 1.8 | AC-LEG-05: verify the SRS criterion/target and negative cases |
| LEG-06 | Ph6 | P0 | 6.3 | AC-LEG-06: verify the SRS criterion/target and negative cases |
| LEG-07 | Ph3 | P0 | 3.6 | AC-LEG-07: data-incident response procedure defines containment (< 30 min), audit log freezing, 72-hour regulatory notification timeline, and standardized regulatory and user notification templates in docs/RUNBOOKS/DATA_INCIDENT_AND_NOTIFICATIONS.md; verified PASS in tests/unit/phase3-monitoring-runbooks.mjs |

## Control Center module coverage

Module checks use SRS 12.3 capabilities and global AP rules. Planned IDs are not executed evidence. M9 sandbox fleet functions remain deferred when Ph5b is skipped.

| Module | Owner | Planned verification |
|---|---|---|
| M1 | 2.7 | DONE locally: live metrics overview dashboard aggregation PASS (Step 2.7) |
| M2 | 2.7 | DONE locally: providers lifecycle, test-call, and config rollback PASS (Step 2.7) |
| M3 | 2.7 | DONE locally: models lifecycle, CU rates, and config rollback PASS (Step 2.7) |
| M4 | 2.7 | DONE locally: routing policies, AP-06 simulator dry-run, breakers, and capacity views PASS (Step 2.7) |
| M5 | 2.7 | DONE locally: users search, moderation, tier, and ledger balance adjustments PASS (Step 2.7) |
| M6 | 2.7 | DONE locally: staff MFA reset and staff activity audit logging PASS (Step 2.7) |
| M7 | 6.1 | AC-M7: actions, permissions, audit, errors, mobile applicability |
| M8 | 6.5 / 6.6 | AC-M8: actions, permissions, audit, errors, mobile applicability |
| M9 | 4.8 / 5b.1 | AC-M9: actions, permissions, audit, errors, mobile applicability |
| M10 | 3.4 | AC-M10: actions, permissions, audit, errors, mobile applicability |
| M11 | 2.7 | DONE locally: abuse alerts and moderation queue views PASS (Step 2.7) |
| M12 | 4.8 | AC-M12: actions, permissions, audit, errors, mobile applicability |
| M13 | 2.7 | DONE locally: fast-acting kill switches and platform toggles PASS (Step 2.6 / 2.7) |
| M14 | 2.7 | DONE locally: write-only secrets vault, rotation, and emergency revocation PASS (Step 2.7) |
| M15 | 4.8 | AC-M15: actions, permissions, audit, errors, mobile applicability |
| M16 | 2.7 | DONE locally: searchable audit log and AP-10 CSV export with audit logging PASS (Step 2.7) |
| M17 | 4.8 | AC-M17: actions, permissions, audit, errors, mobile applicability |
| M18 | 4.8 | AC-M18: actions, permissions, audit, errors, mobile applicability |
| M19 | 4.8 | AC-M19: actions, permissions, audit, errors, mobile applicability |
| M20 | 6.8 | AC-M20: actions, permissions, audit, errors, mobile applicability |
| M21 | 6.8 | AC-M21: actions, permissions, audit, errors, mobile applicability |
| M22 | 7.3 | AC-M22: actions, permissions, audit, errors, mobile applicability |
| M23 | 7.4 | AC-M23: actions, permissions, audit, errors, mobile applicability |

## Additional contract checks

- AC-LOCAL-PROTOTYPE: SRS 17.1.1 / LOCAL-PROTOTYPE-001 scopes Step 1.1 only; synthetic English/Bangla UI, memory-only messages, local start/build/types/lint/formatter/tests, loopback/Host/Origin/asset boundaries and no provider traffic. Original hosted-stack acceptance and all later requirements remain planned/unmet.

- AC-LOCAL-PHASE1: subsequent SRS 17.1.2 / LOCAL-PHASE1-001 extends implementation to local Steps 1.2–1.10 with synthetic persistent owned chat, migrations, sessions/OIDC test contracts, SSE/cancellation/limits/provenance/legal/security and loopback staging. Actual 87-test and manual smoke evidence, original T1.1–T1.4 mapping, audit-expiry/review limits and external NOT RUN checks are in PHASE1_REPORT. Local technical DONE does not close hosted Phase 1 or open Phase 2.

- AC-P1-PREHOST: SRS 17.1.3 / P1-PREHOST-001 prepares actual Google route/configuration and scoped fixed-suite Groq transport before owner host/domain setup. PHASE1_REPORT records 97 unique passing tests, reused auth/adapter coverage, independent finding closures, request-log privacy and draft-v2 disclosure. PHASE1_INTEGRATION_GUIDE supplies concrete setup; actual account/credentials/model/tokenization/legal and hosted acceptance remain unverified, not promoted from fixtures.

- AC-LOCAL-PHASE2: SRS 17.1.4 / LOCAL-PHASE2-001 authorizes ordered local Steps 2.1–2.10. Steps 2.1–2.10 are completely implemented and verified locally; [PHASE2_REPORT](PHASE2_REPORT.md) records 203 Phase 2 unit tests and 9 browser integration tests PASS (212 total automated tests). Acceptance tests T2.1–T2.9 all PASS. STOP: owner accepts admin/router behavior; live/hosted gates remain open.

- AC-LEDGER-CONTRACT: Step2.2 local synthetic evidence in PHASE2_REPORT verifies standalone/parent signed examples, zero-funded positive-cost dispatch denial with zero-cost routing preserved, duplicate/concurrent settlement, unknown pending/deadline estimates, one late adjustment, exact rounding, owned token/time/refusal/history views and opt-in migration/restart. Step2.4 adds joint Router/capacity/chat accounting, zero-use pretransport correction and deleted-chat minimal reconciliation holds. Real traffic and full Phase2 acceptance remain future.
- AC-GOVERNOR-CONTRACT: Step2.3 local QUOTA-06/07 and component T2.1/T2.9 simulations in [PHASE2_REPORT](PHASE2_REPORT.md):46 Governor checks verify all provider/account/model request/token/window limits, exact safety factors, canonical ownership, atomic reset rebinding/final freshness, durable uncertainty/correction, staff/owned authorization, closure capacity and daily token policy. Step2.4 enforces that policy with joint chat/ledger admission and atomically keyed local-day maintenance. Actual provider capacity and full T2 acceptance remain future evidence.
- AC-ROUTER-CONTRACT: Step2.4 maps ROUTE-02/03/04/09–14 and CHAT-03/04/05 to41 Router tests and4 Router browser checks: capability/context/funding, immutable policy snapshots and dry run, every-attempt joint accounting, durable retry families, breakers, separate partial attempts, owned provenance and restart/deletion/correction. Local synthetic T2.2/T2.3 PASS; other joint component checks do not close Step2.10. Router96.62% line coverage and independent cancellation/breaker/policy/midnight findings are closed; staff UI/MFA/private/abuse and live/hosted gates remain at owning steps.
- AC-PACK-REACHABILITY: full input/output allowances usable under duration, RPM, request sizes, concurrency, and window constraints; temporary throttles retain entitlement.
- AC-PACK-SNAPSHOT: purchased terms immutable through repricing; price-rise coverage explicitly funded or refund policy applied.
- AC-PROVIDER-SHARED-POOL: shared account/model quotas counted once and atomically reserved under concurrent load.
- AC-APPROVAL-SCOPE: test credentials/traffic, limited payment pilot, wider rollout, public launch, sandbox activation each use prior scoped authorization.
- AC-INSTRUCTION-TRUST: imports disabled, exact version authorized, changes require renewed approval, no platform-policy override.

- AC-ABUSE-CONTRACT: migration007 up/down/reapply, stable-key file reopen, cluster test traffic, concurrent caps, proof binding/replay/expiry, trusted moderation/revoked replay, all-route/deletion-safe token settlement and outer-commit minute/TTL rollback are executed local evidence. API/body/forwarded-source overrides and cross-user access fail. Existing Phase1/Router abuse-off contracts pass. Public anti-bot effectiveness, pseudonym retention and hosted key lifecycle remain open; no duplicate SRS or actual CAPTCHA claim.

- AC-SIMULATOR-ALERTS-CONTRACT: Step 2.8 maps AP-06, OPS-05, and OPS-06 to 6 unit tests in `tests/unit/phase2-simulator-alerts.mjs`. AP-06 proves zero-mutation dry-run simulation evaluating prompt, language, presets, tier filtering, and open circuit breakers. OPS-05 verifies system/component health reporting across `/health`, `/api/health`, and `/admin/api/monitoring/health` with degraded status on open breakers, plus owner alert creation with append-only delivery attempts, delivery proof, HMAC dispatch, and retry mechanisms. OPS-06 chaos test proves fault isolation during provider outage: transparent initial fallback, circuit breaker trip to OPEN state upon reaching failure threshold, clean 503 `NO_ELIGIBLE_MODELS` admission rejection without network dispatch overhead, full health degradation tracking, undisturbed admin/auth/audit functionality, and automatic traffic recovery upon cooldown expiry.


- AC-PHASE2-ACCEPTANCE: Step 2.10 verifies T2.1–T2.9 across all Phase 2 subsystems. T2.1 provider pool exhaustion refusal; T2.2 zero balance paid route refusal; T2.3 durable retry budget; T2.4 concurrent ledger sum-of-rows; T2.5 kill switches instant block; T2.6 config revisions rollback; T2.7 admin scope isolation & MFA enforcement; T2.8 cancellation hold retention & late correction; T2.9 shared pool concurrent isolation. All 212 automated tests pass; types, lint, formatting, and secret scan pass.

- AC-PHASE3-LAUNCH-VERIFICATION: Step 3.7 verifies T3.1–T3.3 and the full public launch checklist across all Phase 3 subsystems.
  - **T3.1 Safe file upload pipeline**: accepts valid PDF, TXT, CSV up to 10MB; rejects executables (`MZ`, `ELF`, `Mach-O`), archives (`ZIP`, `GZIP`, `7-Zip`, `RAR`), scripts (`#!/`), binary null bytes in text, oversized files, and 0-byte empty files; escapes formula triggers (`=`, `@`, `+`, `-`, `\t`, `\r`) with single quote in CSV; sanitizes filenames against path traversal (`../../etc/passwd`, Windows reserved device names); partitions physical storage per user (`users/<userId>/`); returns 404 for IDOR attempts on another user's file.
  - **T3.2 Retention and storage quotas**: enforces per-user active storage quotas on upload (HTTP 413 `QUOTA_EXCEEDED`); automated retention job expires files past retention window; physically unlinks files from disk storage (`existsSync` is false); decrements active storage quota back to baseline; permanently purges soft-deleted conversations past grace period.
  - **T3.3 Encrypted backup and full restore**: creates AES-256-GCM encrypted backup archive containing all 50+ database tables and user storage files using Scrypt KDF; verifies SHA-256 ciphertext checksum; rejects bit-flipped tampered ciphertext and corrupted authentication tags (`checksum mismatch` / `AUTHENTICATION_FAILED`); cleanly restores database tables and physical files byte-for-byte to a fresh target database and directory, handling `GENERATED ALWAYS AS IDENTITY` column overrides and respecting foreign key dependency topology.
  - **Public Launch Checklist**: validates public bilingual status page (`/status`, `/status.js`) and status API (`GET /api/status`) reporting 5 core workspace components; verifies extended health telemetry (`OPS-05`); validates staging parity check (`tools/phase3/staging-check.mjs`) passing 8/8 checks; verifies 6 operational incident runbooks in `docs/RUNBOOKS/` (including 72-hour regulatory notification timeline); verifies Bangla evaluation quality bar (15/15 cases PASS = 100% vs 85% requirement); verifies abuse defenses and staff MFA kill switches; confirms presence of draft legal disclosures (`LEG-01`..`05`) in `apps/web/public/legal/`.
  - **Audit & Gate Evidence**: 37/37 Phase 3 unit tests PASS (`node --test tests/unit/phase3*.mjs`); `docs/PHASE3_GATE_REPORT.md` recorded; explicit STOP gate enforced awaiting owner sign-off.

