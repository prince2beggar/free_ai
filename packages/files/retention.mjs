import { deleteFileFromStorage } from './storage.mjs';

/**
 * Calculate user's active file storage consumption against configured quota.
 */
export async function getUserStorageUsage({ db, userId, maxUserStorageBytes = 52428800 }) {
  if (!userId || typeof userId !== 'string') {
    throw new Error('Valid userId is required for storage usage calculation');
  }

  const query = `
    SELECT
      COALESCE(SUM(size_bytes), 0) AS total_bytes,
      COUNT(*) AS file_count
    FROM files
    WHERE user_id = $1 AND deleted_at IS NULL;
  `;

  const res = await db.query(query, [userId]);
  const row = res.rows[0] || { total_bytes: 0, file_count: 0 };
  const usedBytes = Number(row.total_bytes);
  const fileCount = Number(row.file_count);
  const quotaBytes = Number(maxUserStorageBytes);
  const remainingBytes = Math.max(0, quotaBytes - usedBytes);
  const usagePercent = quotaBytes > 0 ? Number(((usedBytes / quotaBytes) * 100).toFixed(2)) : 0;

  return {
    userId,
    usedBytes,
    fileCount,
    quotaBytes,
    remainingBytes,
    usagePercent,
    isQuotaExceeded: usedBytes >= quotaBytes,
  };
}

/**
 * Run comprehensive retention and deletion cleanup.
 * Enforces FILE-05, PRIV-05, and T3.2:
 * 1. Expires un-deleted files older than fileRetentionDays
 * 2. Unlinks physical files from disk
 * 3. Permanently purges soft-deleted files past softDeleteGraceDays
 * 4. Cleans up expired/deleted conversations and messages
 */
export async function runRetentionJob({
  db,
  storageBaseDir,
  fileRetentionDays = 30,
  softDeleteGraceDays = 7,
  conversationRetentionDays = 30,
  dryRun = false,
} = {}) {
  const now = new Date();
  const summary = {
    startedAt: now.toISOString(),
    dryRun,
    filesExpired: 0,
    filesPurged: 0,
    diskBytesFreed: 0,
    conversationsPurged: 0,
    errors: [],
  };

  // Convert retention periods to millisecond cutoffs for exact testing & production precision
  const fileCutoffMs = now.getTime() - Number(fileRetentionDays) * 86400000;
  const fileCutoffDate = new Date(fileCutoffMs).toISOString();

  const graceCutoffMs = now.getTime() - Number(softDeleteGraceDays) * 86400000;
  const graceCutoffDate = new Date(graceCutoffMs).toISOString();

  const convCutoffMs = now.getTime() - Number(conversationRetentionDays) * 86400000;
  const convCutoffDate = new Date(convCutoffMs).toISOString();

  // Phase 1: Expire active files older than fileRetentionDays
  const expiredQuery = `
    SELECT id, user_id, storage_path, size_bytes
    FROM files
    WHERE deleted_at IS NULL AND created_at < $1
    ORDER BY created_at ASC;
  `;
  const expiredRes = await db.query(expiredQuery, [fileCutoffDate]);
  const expiredFiles = expiredRes.rows;

  if (expiredFiles.length > 0 && !dryRun) {
    for (const file of expiredFiles) {
      try {
        // Soft delete in database
        await db.query(
          `UPDATE files SET deleted_at = CURRENT_TIMESTAMP, status = 'deleted' WHERE id = $1 AND user_id = $2;`,
          [file.id, file.user_id],
        );
        summary.filesExpired++;

        // Unlink physical file from disk storage immediately upon expiry
        if (storageBaseDir && file.storage_path) {
          const unlinked = await deleteFileFromStorage({
            storageBaseDir,
            userId: file.user_id,
            relativePath: file.storage_path,
          });
          if (unlinked) {
            summary.diskBytesFreed += Number(file.size_bytes);
          }
        }
      } catch (err) {
        summary.errors.push({
          fileId: file.id,
          operation: 'expire_file',
          message: err.message,
        });
      }
    }
  } else if (dryRun) {
    summary.filesExpired = expiredFiles.length;
  }

  // Phase 2: Permanently purge soft-deleted files past softDeleteGraceDays
  const purgeQuery = `
    SELECT id, user_id, storage_path, size_bytes
    FROM files
    WHERE deleted_at IS NOT NULL AND deleted_at < $1
    ORDER BY deleted_at ASC;
  `;
  const purgeRes = await db.query(purgeQuery, [graceCutoffDate]);
  const filesToPurge = purgeRes.rows;

  if (filesToPurge.length > 0 && !dryRun) {
    for (const file of filesToPurge) {
      try {
        // Ensure disk removal
        if (storageBaseDir && file.storage_path) {
          const unlinked = await deleteFileFromStorage({
            storageBaseDir,
            userId: file.user_id,
            relativePath: file.storage_path,
          });
          if (unlinked) {
            summary.diskBytesFreed += Number(file.size_bytes);
          }
        }
        // Permanently remove row from database
        await db.query('DELETE FROM files WHERE id = $1 AND user_id = $2;', [
          file.id,
          file.user_id,
        ]);
        summary.filesPurged++;
      } catch (err) {
        summary.errors.push({
          fileId: file.id,
          operation: 'purge_file',
          message: err.message,
        });
      }
    }
  } else if (dryRun) {
    summary.filesPurged = filesToPurge.length;
  }

  // Phase 3: Expire & purge stale conversations (PRIV-05)
  // Conversations marked deleted past grace period, or active conversations older than conversationRetentionDays
  const convQuery = `
    SELECT id, user_id
    FROM conversations
    WHERE (deleted_at IS NOT NULL AND deleted_at < $1)
       OR (deleted_at IS NULL AND created_at < $2);
  `;
  const convRes = await db.query(convQuery, [graceCutoffDate, convCutoffDate]);
  const convsToPurge = convRes.rows;

  if (convsToPurge.length > 0 && !dryRun) {
    for (const conv of convsToPurge) {
      try {
        await db.query('DELETE FROM messages WHERE conversation_id = $1 AND user_id = $2;', [
          conv.id,
          conv.user_id,
        ]);
        await db.query(
          `DELETE FROM routing_records
           WHERE user_id = $2 AND request_id IN (
             SELECT id FROM chat_requests WHERE conversation_id = $1 AND user_id = $2
           );`,
          [conv.id, conv.user_id],
        );
        await db.query('DELETE FROM chat_requests WHERE conversation_id = $1 AND user_id = $2;', [
          conv.id,
          conv.user_id,
        ]);
        await db.query('DELETE FROM conversations WHERE id = $1 AND user_id = $2;', [
          conv.id,
          conv.user_id,
        ]);
        summary.conversationsPurged++;
      } catch (err) {
        summary.errors.push({
          conversationId: conv.id,
          operation: 'purge_conversation',
          message: err.message,
        });
      }
    }
  } else if (dryRun) {
    summary.conversationsPurged = convsToPurge.length;
  }

  summary.completedAt = new Date().toISOString();
  summary.durationMs = new Date(summary.completedAt) - new Date(summary.startedAt);
  summary.success = summary.errors.length === 0;

  return summary;
}
