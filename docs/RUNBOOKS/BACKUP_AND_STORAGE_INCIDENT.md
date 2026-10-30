# Incident Runbook: Backup Failure & Storage Quota Incidents

| Metadata | Details |
|---|---|
| **Incident ID** | `RUNBOOK-OPS-04-BACKUP` |
| **Requirements** | SRS `OPS-04`, `SEC-10`, `FILE-05`, `PRIV-05`, `T3.2`, `T3.3` |
| **Severity Level** | SEV-2 (Storage Quota Warning / Single Backup Miss) / SEV-1 (Storage Exhaustion / Corrupted Archives) |
| **Subsystem** | Backup Service (`packages/backup`), File Storage (`packages/files`), Retention Daemon |

---

## 1. Trigger Conditions & Detection

1. **Backup Creation Failure**: The daily automated backup job fails or aborts unexpectedly (`BACKUP_FAILED`).
2. **Integrity Verification Failure**: Checksum verification fails on an existing archive (SHA-256 hash mismatch or AES-256-GCM authentication tag error).
3. **Storage Quota Warning**: Total stored file bytes exceed 80% of configured system capacity (default 80 MB / 100 MB).
4. **Storage Critical Alert**: Total stored file bytes exceed 95% of configured system capacity or disk reports `ENOSPC`.
5. **Retention Daemon Failure**: Scheduled retention unlinking job terminates with an error or fails to run for > 48 hours.

---

## 2. Automated Defensive Behavior

- **Zero Overwrite on Failed Backups**: If an error occurs during database table extraction or compression, the incomplete archive is discarded. Prior valid backups are never overwritten.
- **Fail-Safe Storage Admission Guard**: When user or system file quota is reached, subsequent upload attempts fail immediately with HTTP 413 `FILE_TOO_LARGE` or `STORAGE_QUOTA_EXCEEDED` before writing to disk (`FILE-05`).
- **Hard Retention Purge Cascades**: Conversation deletion automatically cascades to soft-delete associated files, queuing them for physical disk unlinking upon expiry (`PRIV-05`).

---

## 3. Storage Quota Exhaustion Remediation

If `/health` or `/admin/api/monitoring/health` reports `storage.status: "warning"` or `"critical"`:

### Step 1: Run Immediate Retention Purge
Execute the retention CLI tool to unlink soft-deleted files and clean up expired conversation attachments:
```bash
# Run manual retention sweep with forced unlinking
node tools/phase3/retention.mjs --force
```

### Step 2: Inspect Per-User Storage Footprint
In the database, identify accounts with high storage utilization:
```sql
SELECT user_id, count(*) as file_count, sum(size_bytes) as total_bytes
FROM files
WHERE deleted_at IS NULL
GROUP BY user_id
ORDER BY total_bytes DESC LIMIT 10;
```

### Step 3: Notify Heavy Users or Adjust User Quotas
- If specific users store orphaned or oversized test files, request manual cleanup via their Account Controls.
- If system capacity requires permanent expansion, adjust `FILE_MAX_STORAGE_BYTES` in system configuration following owner approval.

---

## 4. Backup Failure & Archive Corruption Remediation

### Scenario A: Automated Daily Backup Failed
1. Inspect the last error in admin monitoring or system logs.
2. Verify available disk space in the backup directory:
   ```bash
   node -e "const fs = require('fs'); console.log(fs.statSync('.phase3-local/backups'));"
   ```
3. Execute a manual backup run with verbose output:
   ```bash
   node tools/phase3/backup.mjs create --passphrase "$BACKUP_PASSPHRASE"
   ```
4. Verify the newly generated archive:
   ```bash
   node tools/phase3/backup.mjs verify --archive .phase3-local/backups/latest.enc --passphrase "$BACKUP_PASSPHRASE"
   ```

### Scenario B: Archive Verification Failure (Tampering / Bit Rot)
1. If verification fails with `INVALID_BACKUP_PASSPHRASE` or `CHECKSUM_MISMATCH`:
   - Confirm the passphrase supplied matches the scrypt key derivation credentials.
   - Do NOT attempt to restore a corrupted archive over an active production database.
2. Locate the previous day's verified backup archive (`.phase3-local/backups/backup-YYYY-MM-DD-*.enc`).
3. Verify the previous archive's SHA-256 integrity:
   ```bash
   node tools/phase3/backup.mjs verify --archive .phase3-local/backups/backup-previous.enc --passphrase "$BACKUP_PASSPHRASE"
   ```
4. Once verified, execute a dry-run restore to validate schema restoration:
   ```bash
   node tools/phase3/backup.mjs restore --archive .phase3-local/backups/backup-previous.enc --passphrase "$BACKUP_PASSPHRASE" --dry-run
   ```

---

## 5. Post-Incident Verification Checklist

- [ ] `node tools/phase3/staging-check.mjs` executes cleanly with 100% checks passing.
- [ ] `/health` returns `storage.status: "ok"` and `backups.status: "ok"`.
- [ ] Storage directory and backup directory permissions are verified.
- [ ] Clean backup archive is safely cataloged and verified.
