# Operational Incident Runbooks & Notification Framework

| Metadata | Details |
|---|---|
| **System** | Free AI Workspace |
| **Requirements** | SRS `OPS-08`, `LEG-07`, `OPS-05`, `OPS-07` |
| **Status** | Reviewed and Operational for Public Release |
| **Scope** | Operational incident management, triage, mitigation, notification, and recovery |
| **Location** | `docs/RUNBOOKS/` |

---

## 1. Purpose and Philosophy

This incident management framework provides structured, actionable operating procedures for system operators, incident commanders, and support personnel. The goal is to:
1. **Minimize user impact**: Rapid detection, automated containment, and graceful degradation.
2. **Preserve data integrity**: Transactional persistence, append-only immutable audit logs, and zero silent data loss.
3. **Maintain transparency**: Honest, timely status updates on the public Status Page (`/status`) without disclosing confidential or security-sensitive details.
4. **Comply with legal obligations**: Structured data-incident notification workflows adhering to Bangladesh privacy laws and regulatory guidelines within 72 hours (`LEG-07`).

---

## 2. Incident Severity Matrix

Incidents are classified into four severity tiers based on scope, safety risk, and user impact:

| Severity | Definition | Target Triage | Escalation Path | Status Page Action |
|---|---|---|---|---|
| **SEV-1 (Critical)** | Total platform outage, active security breach, data corruption or loss, uncontrolled spend/token leakage, complete database failure | < 15 minutes | Immediate page to System Owner; assemble Incident Response team | Post "System Outage" banner within 15 min; update every 30 min |
| **SEV-2 (Major)** | Major subsystem failure with degraded fallback (e.g., primary provider outage, backup job failure, storage quota > 80%, abnormal abuse cluster) | < 30 minutes | Alert on-call operator; notify System Owner | Post "Degraded Performance" notice within 30 min |
| **SEV-3 (Moderate)** | Non-critical feature impairment (e.g. single preset formatting issue, isolated rate-limit false positive, non-blocking telemetry warning) | < 2 hours | Next-business-hour triage or scheduled maintenance queue | Internal tracking; status page note if visible to > 10% users |
| **SEV-4 (Minor)** | Minor cosmetic or documentation issues, non-functional typos, routine enhancement requests | Next sprint | Standard issue tracker | No status page update required |

---

## 3. Incident Lifecycle Workflow

Every incident progresses through five mandatory stages:

```
[1. Detection & Alerting] ➔ [2. Triage & Declaration] ➔ [3. Containment & Mitigation] ➔ [4. Communication & Logging] ➔ [5. Recovery & Post-Mortem]
```

### 3.1 Detection & Alerting
- Automated detection via `/health`, `/api/health`, and `/admin/api/monitoring/health`.
- System triggers append-only owner alerts (`owner_alerts`) with delivery proof (`alert_delivery_attempts`).
- Anomaly alerts from Abuse subsystem (`ABUSE_CLUSTER`), Router circuit breakers (`CIRCUIT_BREAKER_OPEN`), and Capacity Governor (`CAPACITY_EXHAUSTED`).

### 3.2 Triage & Declaration
- Incident Commander (Owner or designated Operator) assesses scope and declares severity level.
- Open incident log in Admin Control Center or incident documentation.

### 3.3 Containment & Mitigation
- Follow the corresponding runbook for step-by-step mitigation.
- If necessary to prevent cascading harm, activate hierarchical kill switches (`file_uploads`, `free_tier`, `all_ai`).

### 3.4 Communication & Logging
- Update the public Status Page (`/status`) using honest, clear descriptions.
- For personal data incidents, initiate legal notification procedures per `LEG-07`.

### 3.5 Recovery & Post-Mortem
- Verify normal operation across all health probes and staging parity checks (`tools/phase3/staging-check.mjs`).
- Complete a blameless post-mortem within 5 business days, recording root cause, corrective actions, and prevention improvements.

---

## 4. Runbook Directory

| Runbook File | Scenario & Scope | Key Triggers & Tools |
|---|---|---|
| [`PROVIDER_OUTAGE.md`](PROVIDER_OUTAGE.md) | Upstream provider outage, high latency, or API failure | Circuit breaker trips (`CIRCUIT_BREAKER_OPEN`), Admin M2 Provider toggle, AP-06 routing simulator |
| [`QUOTA_EXHAUSTION.md`](QUOTA_EXHAUSTION.md) | Shared token pool depletion or daily request limit spikes | `CAPACITY_EXHAUSTED` alert, Capacity Dashboard (M4), token bucket replenishment |
| [`ABUSE_WAVE.md`](ABUSE_WAVE.md) | Coordinated burst, prompt injection wave, or scraping attack | `ABUSE_CLUSTER` alert, PoW challenge difficulty escalation, Admin M5 user moderation, kill switches |
| [`DATA_INCIDENT_AND_NOTIFICATIONS.md`](DATA_INCIDENT_AND_NOTIFICATIONS.md) | Unauthorized access, data leakage, PII exposure, storage corruption | `LEG-07`, 72-hour regulatory notification, affected user notices, forensic audit freeze |
| [`BACKUP_AND_STORAGE_INCIDENT.md`](BACKUP_AND_STORAGE_INCIDENT.md) | Backup failure, archive corruption, storage quota exhaustion | `BACKUP_FAILED`, `tools/phase3/backup.mjs`, `tools/phase3/retention.mjs`, disk unlinking |

---

## 5. Contact & Escalation Roster

- **System Owner & Lead Operator**: Local administrative authority (`SYNTHETIC_SEED.userA` in local synthetic scope).
- **Compliance & Legal Advisor**: Local legal counsel for Bangladesh Data Protection and consumer regulations (`LEG-02`, `LEG-07`).
- **Emergency Action**: In case of active system compromise or runaway cost risk, activate Emergency Kill Switch immediately via CLI or Control Center.
