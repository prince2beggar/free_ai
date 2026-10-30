# Incident Runbook: Data Security Incident & Notification Procedures

| Metadata | Details |
|---|---|
| **Incident ID** | `RUNBOOK-LEG-07-DATA` |
| **Requirements** | SRS `LEG-07`, `PRIV-05`, `PRIV-06`, `SEC-10`, `OPS-04`, `LEG-02` |
| **Severity Level** | SEV-1 (Critical Security & Compliance Event) |
| **Governing Framework** | Bangladesh Data Protection Legal Principles & International Best Practices |

---

## 1. Scope & Incident Classification

This procedure governs any confirmed or suspected event involving:
1. **Unauthorized Access / Data Exfiltration**: Breach of user conversation history, files, or authentication tokens.
2. **Data Integrity Failure**: Malicious or accidental modification of database records or ledger entries.
3. **Catastrophic Data Loss**: Corruption or unrecoverable deletion of active user state without authorized purge.
4. **Credential / Key Leakage**: Compromise of server secrets, encryption passphrases, or admin TOTP secrets.

---

## 2. Phase 1: Immediate Containment (< 30 Minutes)

When a data incident is detected or reported:

### Action 1: Activate Emergency Kill Switch
Immediately halt external inference and authenticated session processing to stop potential data exfiltration:
```http
POST /admin/api/kill-switches/all_ai
Content-Type: application/json
X-CSRF-Token: {csrfToken}

{
  "active": true,
  "reason": "Emergency containment: active data incident investigation"
}
```

### Action 2: Rotate All Administrative Credentials & Master Keys (Control Center M14)
- Revoke and rotate write-only secrets vault references.
- Invalidate all active staff sessions: `POST /admin/api/auth/logout`.
- Force TOTP MFA secret reset for all staff accounts.

### Action 3: Freeze Forensic State & Audit Logs
- In accordance with append-only database triggers (`audit_events`, `admin_audit_log`, `usage_events`), all historical audit entries are immutable and preserved.
- Take an immediate point-in-time snapshot of the database and file storage directory:
  ```bash
  # Create emergency diagnostic snapshot
  node tools/phase3/backup.mjs create --passphrase "$EMERGENCY_PASSPHRASE" --out emergency-snapshot.enc
  ```
- Do NOT delete, truncate, or overwrite any log files or database tables.

---

## 3. Phase 2: Forensic Investigation & Impact Assessment (< 24 Hours)

The Incident Commander and designated technical investigator must determine:
1. **Nature of Compromise**: Did the incident affect data at rest, data in transit, or application memory?
2. **Affected Data Categories**:
   - User identity metadata (synthetic fixture IDs, emails, hashed IP addresses).
   - User content (chat messages, uploaded PDF/TXT/CSV files).
   - System metadata (routing policies, ledger entries).
3. **Number of Impacted Individuals**: Enumerate distinct `user_id` values associated with exposed records.
4. **Root Cause Analysis**: Identify code vulnerability, misconfiguration, or external threat vector.

---

## 4. Phase 3: Regulatory & Legal Notification Workflow (< 72 Hours)

Under SRS `LEG-07` and applicable data protection regulations:

### 4.1 Regulatory Authority Notification
If personal data, user conversations, or credentials were compromised:
- Formal written notification must be submitted to the relevant regulatory authority within **72 hours** of becoming aware of the incident.
- **Mandatory Information Required**:
  1. Nature of the personal data breach including categories and approximate number of data subjects.
  2. Name and contact details of the Data Protection Officer / System Owner.
  3. Description of the likely consequences of the breach.
  4. Description of measures taken or proposed to be taken to address and mitigate the breach.

#### Template: Regulatory Authority Incident Notification
```text
FORMAL NOTICE OF DATA SECURITY INCIDENT
Date: [YYYY-MM-DD]
To: [Regulatory Authority / Data Protection Commission]
From: Free AI Workspace Operations & Legal Administration
Contact: [admin@example.invalid]

1. INCIDENT DESCRIPTION:
On [YYYY-MM-DD at HH:MM UTC], our monitoring systems identified [brief description, e.g., unauthorized access to an isolated file storage cache]. Containment protocols were initiated within [XX] minutes, including emergency session termination and key rotation.

2. AFFECTED POPULATION & DATA:
- Number of affected accounts: [XX]
- Categories of data involved: [e.g., text transcripts of synthetic chat queries, uploaded CSV filenames].
- Sensitive data involved: Zero passwords or payment credentials were exposed (payment credentials are never collected or stored).

3. CONTAINMENT & REMEDIATION ACTIONS TAKEN:
- Emergency kill switches activated immediately upon detection.
- All session tokens and cryptographic secrets revoked and rotated.
- Full forensic backup archive generated and isolated for audit.
- Vulnerability patched and verified via automated regression suite.

4. USER NOTIFICATIONS:
Affected users are being notified via electronic communication within 72 hours with guidance on protective measures.

Signed,
System Owner & Incident Commander
Free AI Workspace
```

---

## 5. Phase 4: Affected User Notification Workflow (< 72 Hours)

Where a breach is likely to result in a risk to the rights and privacy of users:
- Direct electronic notification must be dispatched to affected individuals without undue delay.
- The notification must use clear, plain language, avoiding evasive technical jargon.

#### Template: Affected User Notification Notice
```text
Subject: Important Security Notice Regarding Your Free AI Workspace Account

Dear Free AI Workspace User,

We are writing to inform you of a recent security incident that may have affected information associated with your account. We take your privacy and data security with the utmost seriousness and want to provide you with clear facts and steps taken.

WHAT HAPPENED:
On [YYYY-MM-DD], we identified [unauthorized access / a data configuration error] affecting our document processing cache. We immediately contained the issue within 30 minutes by disabling affected endpoints and rotating all security keys.

WHAT INFORMATION WAS INVOLVED:
The information potentially accessed includes:
- [List specific items, e.g., files uploaded between Date and Date, conversation titles].
This incident did NOT involve passwords, credit cards, or financial information, as our platform never stores payment information.

WHAT WE HAVE DONE:
1. Contained the incident and eliminated the vulnerability.
2. Verified the integrity of all database records and file archives.
3. Added enhanced monitoring and verification guards to prevent recurrence.
4. Reported this event to the relevant data protection authorities.

WHAT YOU CAN DO:
- As a precaution, we recommend reviewing your saved conversations and deleting any documents no longer needed via your Account Controls.
- If you entered sensitive or third-party content in prior chats, please contact our support team.

FOR MORE INFORMATION:
If you have any questions or require assistance, please visit our Status Page at /status or contact us directly at [support@example.invalid].

Sincerely,
The Free AI Workspace Security Team
```

---

## 6. Phase 5: Restoration & Remediation

1. **Verify Integrity of Clean Backup**:
   Run archive verification using the Phase 3 backup tooling:
   ```bash
   node tools/phase3/backup.mjs verify --archive .phase3-local/backups/latest.enc --passphrase "$PASSPHRASE"
   ```
2. **Execute Full Restore (if data corrupted)**:
   ```bash
   node tools/phase3/backup.mjs restore --archive .phase3-local/backups/latest.enc --passphrase "$PASSPHRASE"
   ```
3. **Verify Staging Parity**:
   ```bash
   node tools/phase3/staging-check.mjs --strict
   ```
4. **Publish Post-Mortem**: Document root cause, corrective actions, and prevention improvements in `docs/LESSONS.md`.
