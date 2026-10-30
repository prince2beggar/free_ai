import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateFileUpload, sanitizeFilename } from './validator.mjs';
import {
  extractTextFromPdf,
  extractTextFromTxt,
  extractTextFromCsv,
  estimateTokens,
  chunkIntoSections,
} from './extractor.mjs';
import {
  saveFileToStorage,
  readFileFromStorage,
  deleteFileFromStorage,
  purgeUserStorage,
} from './storage.mjs';
import {
  analyzeCsv as runCsvAnalysis,
  queryCsv as runCsvQuery,
  computeNumericStats,
  computeCategoricalStats,
  suggestCharts,
} from './analyzer.mjs';
import { getUserStorageUsage, runRetentionJob } from './retention.mjs';

const defaults = JSON.parse(await readFile(new URL('./defaults.json', import.meta.url), 'utf8'));

export function createFileService({ db, storageDir = '.phase3-local/files', options = {} } = {}) {
  const config = {
    ...defaults,
    ...options,
  };

  return {
    config,

    getPrivacyWarning() {
      return config.warningMessage;
    },

    async upload({ userId, filename, buffer, mimeType = null }) {
      if (!userId || typeof userId !== 'string') {
        const err = new Error('Valid userId is required');
        err.code = 'INVALID_USER';
        throw err;
      }

      const validation = validateFileUpload({
        filename,
        buffer,
        declaredMimeType: mimeType,
        maxSizeBytes: config.maxFileSizeBytes,
        allowedMimeTypes: config.allowedMimeTypes,
      });

      // Enforce per-user storage quota (FILE-05, PRIV-05)
      const maxUserStorageBytes = config.maxUserStorageBytes || 52428800;
      const currentUsage = await getUserStorageUsage({
        db,
        userId,
        maxUserStorageBytes,
      });

      if (currentUsage.usedBytes + buffer.length > maxUserStorageBytes) {
        const err = new Error(
          `User storage quota exceeded. Used ${currentUsage.usedBytes} of ${maxUserStorageBytes} bytes (attempted: ${buffer.length} bytes).`,
        );
        err.code = 'STORAGE_QUOTA_EXCEEDED';
        err.status = 413;
        throw err;
      }

      const fileId = `file_${randomUUID().replace(/-/g, '')}`;
      const sha256 = createHash('sha256').update(buffer).digest('hex');

      let extractionResult;
      const metadata = {
        originalFilename: filename,
        sanitizedFilename: validation.sanitizedFilename,
        warning: null,
      };

      if (validation.effectiveMimeType === 'application/pdf') {
        extractionResult = extractTextFromPdf(buffer, config.maxExtractedChars);
        metadata.pageCount = extractionResult.pageCount;
      } else if (validation.effectiveMimeType === 'text/csv') {
        extractionResult = extractTextFromCsv(buffer, config.maxExtractedChars);
        metadata.rowCount = extractionResult.rowCount;
        metadata.columnCount = extractionResult.columnCount;
        metadata.headers = extractionResult.headers;
        metadata.hasFormulaPrefix = extractionResult.hasFormulaPrefix;
        metadata.warning = extractionResult.warning;
      } else {
        extractionResult = extractTextFromTxt(buffer, config.maxExtractedChars);
        metadata.lineCount = extractionResult.lineCount;
      }

      if (extractionResult.isTruncated) {
        metadata.truncated = true;
      }

      const estimatedTokens = estimateTokens(
        extractionResult.text,
        config.tokenEstimationFactor || 3.5,
      );

      // Save physical file to isolated disk storage
      const storageRecord = await saveFileToStorage({
        storageBaseDir: storageDir,
        userId,
        fileId,
        sanitizedFilename: validation.sanitizedFilename,
        buffer,
      });

      // Persist metadata in database
      const query = `
        INSERT INTO files (
          id, user_id, filename, sanitized_name, mime_type, size_bytes,
          sha256, storage_path, extracted_text, text_chars, estimated_tokens,
          status, metadata, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          'ready', $12, CURRENT_TIMESTAMP
        )
        RETURNING
          id, user_id, filename, sanitized_name, mime_type, size_bytes,
          sha256, text_chars, estimated_tokens, status, metadata, created_at;
      `;

      const values = [
        fileId,
        userId,
        filename.slice(0, 255),
        validation.sanitizedFilename,
        validation.effectiveMimeType,
        buffer.length,
        sha256,
        storageRecord.relativePath,
        extractionResult.text,
        extractionResult.text.length,
        estimatedTokens,
        JSON.stringify(metadata),
      ];

      const res = await db.query(query, values);
      const row = res.rows[0];

      return {
        ...row,
        storage_path: storageRecord.relativePath,
        size_bytes: Number(row.size_bytes),
        extracted_text: extractionResult.text,
        privacy_warning: config.warningMessage,
      };
    },

    async getFile({ userId, fileId, includeExtractedText = false }) {
      if (!userId || !fileId) return null;

      const textField = includeExtractedText ? ', extracted_text' : '';
      const query = `
        SELECT
          id, user_id, filename, sanitized_name, mime_type, size_bytes,
          sha256, storage_path, text_chars, estimated_tokens, status,
          metadata, created_at, deleted_at ${textField}
        FROM files
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL;
      `;

      const res = await db.query(query, [fileId, userId]);
      if (res.rows.length === 0) return null;

      const row = res.rows[0];
      return {
        ...row,
        size_bytes: Number(row.size_bytes),
      };
    },

    async downloadFile({ userId, fileId }) {
      const fileRecord = await this.getFile({ userId, fileId });
      if (!fileRecord) {
        const err = new Error('File not found or access denied');
        err.code = 'FILE_NOT_FOUND';
        throw err;
      }

      const buffer = await readFileFromStorage({
        storageBaseDir: storageDir,
        userId,
        relativePath: fileRecord.storage_path,
      });

      return {
        file: fileRecord,
        buffer,
      };
    },

    async listFiles({ userId, limit = 50, offset = 0 } = {}) {
      if (!userId) return [];

      const query = `
        SELECT
          id, user_id, filename, sanitized_name, mime_type, size_bytes,
          sha256, text_chars, estimated_tokens, status, metadata, created_at
        FROM files
        WHERE user_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3;
      `;

      const res = await db.query(query, [userId, limit, offset]);
      return res.rows.map((r) => ({
        ...r,
        size_bytes: Number(r.size_bytes),
      }));
    },

    async deleteFile({ userId, fileId }) {
      const fileRecord = await this.getFile({ userId, fileId });
      if (!fileRecord) {
        return false;
      }

      // Mark deleted in database
      await db.query(
        `UPDATE files SET deleted_at = CURRENT_TIMESTAMP, status = 'deleted' WHERE id = $1 AND user_id = $2;`,
        [fileId, userId],
      );

      // Remove from disk storage
      try {
        await deleteFileFromStorage({
          storageBaseDir: storageDir,
          userId,
          relativePath: fileRecord.storage_path,
        });
      } catch {
        // Disk removal best-effort if record is already deleted
      }

      return true;
    },

    async getSections({ userId, fileId, maxTokensPerSection = null }) {
      const fileRecord = await this.getFile({ userId, fileId, includeExtractedText: true });
      if (!fileRecord) {
        const err = new Error('File not found or access denied');
        err.code = 'FILE_NOT_FOUND';
        throw err;
      }

      const sectionLimit = maxTokensPerSection || config.defaultSectionTokenLimit || 1000;
      const sections = chunkIntoSections(fileRecord.extracted_text, {
        maxTokensPerSection: sectionLimit,
        tokenFactor: config.tokenEstimationFactor || 3.5,
        mimeType: fileRecord.mime_type,
      });

      return {
        fileId,
        filename: fileRecord.filename,
        totalSections: sections.length,
        totalTokens: fileRecord.estimated_tokens,
        sections,
      };
    },

    async analyzeCsv({ userId, fileId }) {
      const fileRecord = await this.getFile({ userId, fileId, includeExtractedText: true });
      if (!fileRecord) {
        const err = new Error('File not found or access denied');
        err.code = 'FILE_NOT_FOUND';
        throw err;
      }
      if (fileRecord.mime_type !== 'text/csv') {
        const err = new Error('File is not a CSV document');
        err.code = 'NOT_CSV_FILE';
        throw err;
      }
      const analysis = runCsvAnalysis(fileRecord.extracted_text);
      return {
        fileId,
        filename: fileRecord.filename,
        ...analysis,
      };
    },

    async queryCsv({ userId, fileId, question }) {
      const fileRecord = await this.getFile({ userId, fileId, includeExtractedText: true });
      if (!fileRecord) {
        const err = new Error('File not found or access denied');
        err.code = 'FILE_NOT_FOUND';
        throw err;
      }
      if (fileRecord.mime_type !== 'text/csv') {
        const err = new Error('File is not a CSV document');
        err.code = 'NOT_CSV_FILE';
        throw err;
      }
      const queryResult = runCsvQuery(fileRecord.extracted_text, question);
      return {
        fileId,
        filename: fileRecord.filename,
        ...queryResult,
      };
    },

    async purgeUserFiles(userId) {
      if (!userId) return false;
      await db.query(
        `UPDATE files SET deleted_at = CURRENT_TIMESTAMP, status = 'deleted' WHERE user_id = $1;`,
        [userId],
      );
      return purgeUserStorage({ storageBaseDir: storageDir, userId });
    },

    async getStorageUsage({ userId }) {
      if (!userId || typeof userId !== 'string') {
        const err = new Error('Valid userId is required');
        err.code = 'INVALID_USER';
        throw err;
      }
      return getUserStorageUsage({
        db,
        userId,
        maxUserStorageBytes: config.maxUserStorageBytes || 52428800,
      });
    },

    async runRetentionJob(options = {}) {
      return runRetentionJob({
        db,
        storageBaseDir: storageDir,
        fileRetentionDays:
          options.fileRetentionDays ?? config.fileRetentionDays ?? config.retentionDays ?? 30,
        softDeleteGraceDays: options.softDeleteGraceDays ?? config.softDeleteGraceDays ?? 7,
        conversationRetentionDays:
          options.conversationRetentionDays ?? config.conversationRetentionDays ?? 30,
        dryRun: options.dryRun ?? false,
      });
    },
  };
}

export { sanitizeFilename, validateFileUpload, sniffContentType } from './validator.mjs';
export {
  extractTextFromPdf,
  extractTextFromTxt,
  extractTextFromCsv,
  estimateTokens,
  chunkIntoSections,
} from './extractor.mjs';
export {
  analyzeCsv,
  queryCsv,
  computeNumericStats,
  computeCategoricalStats,
  suggestCharts,
  inferColumnType,
  isMissingValue,
} from './analyzer.mjs';
export { getUserStorageUsage, runRetentionJob } from './retention.mjs';
