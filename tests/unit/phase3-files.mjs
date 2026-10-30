import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';
import {
  createFileService,
  sanitizeFilename,
  validateFileUpload,
  sniffContentType,
  extractTextFromPdf,
  extractTextFromTxt,
  extractTextFromCsv,
  estimateTokens,
  chunkIntoSections,
} from '../../packages/files/index.mjs';
import {
  createDatabase,
  migrateUp,
  seedSynthetic,
  SYNTHETIC_SEED,
} from '../../packages/db/index.mjs';
import { createApp } from '../../packages/api/server.mjs';
import { loadConfig } from '../../packages/api/config.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const testStorageBase = resolve(repoRoot, '.phase3-test-files-' + Date.now());

// Helper: build a minimal valid PDF buffer with text stream
function createSamplePdf(text) {
  const streamContent = `BT\n/F1 12 Tf\n(${text}) Tj\nET`;
  const streamLen = Buffer.byteLength(streamContent);
  const pdfString = [
    '%PDF-1.4',
    '1 0 obj',
    '<< /Type /Catalog /Pages 2 0 R >>',
    'endobj',
    '2 0 obj',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    'endobj',
    '3 0 obj',
    '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
    'endobj',
    '4 0 obj',
    `<< /Length ${streamLen} >>`,
    'stream',
    streamContent,
    'endstream',
    'endobj',
    'xref',
    '0 5',
    '0000000000 65535 f ',
    'trailer',
    '<< /Root 1 0 R /Size 5 >>',
    'startxref',
    '300',
    '%%EOF',
  ].join('\n');
  return Buffer.from(pdfString, 'utf8');
}

test('FILE-01 & FILE-02: Content sniffing and safe format acceptance/rejection (T3.1)', () => {
  // 1. Valid PDF recognized by magic bytes
  const pdfBuffer = createSamplePdf('Sample valid document');
  assert.equal(sniffContentType(pdfBuffer), 'application/pdf');

  // 2. Valid plain text recognized
  const txtBuffer = Buffer.from('Simple plain text file contents without binaries.', 'utf8');
  assert.equal(sniffContentType(txtBuffer), 'text/plain');

  // 3. Reject Windows PE executable (MZ)
  const peBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
  assert.throws(() => sniffContentType(peBuffer), /Forbidden file format.*Windows PE/);

  // 4. Reject Linux ELF executable
  const elfBuffer = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
  assert.throws(() => sniffContentType(elfBuffer), /Forbidden file format.*ELF/);

  // 5. Reject ZIP archive (ZIP deferred to Ph4, DOCX deferred)
  const zipBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
  assert.throws(() => sniffContentType(zipBuffer), /Forbidden file format.*ZIP Archive/);

  // 6. Reject GZIP archive
  const gzipBuffer = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);
  assert.throws(() => sniffContentType(gzipBuffer), /Forbidden file format.*GZIP/);

  // 7. Reject 7-Zip archive
  const sevenZipBuffer = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
  assert.throws(() => sniffContentType(sevenZipBuffer), /Forbidden file format.*7-Zip/);

  // 8. Reject executable shebang script
  const scriptBuffer = Buffer.from('#!/usr/bin/env bash\necho malicious', 'utf8');
  assert.throws(() => sniffContentType(scriptBuffer), /Executable script content detected/);

  // 9. Reject null byte in text content
  const nullByteTxt = Buffer.from('Valid text start\x00evil payload', 'binary');
  assert.throws(() => sniffContentType(nullByteTxt), /Binary file or null byte detected/);

  // 10. Reject empty buffer
  assert.throws(() => sniffContentType(Buffer.alloc(0)), /File content is empty/);
});

test('FILE-02: Path traversal sanitization and reserved filename protection', () => {
  // Unix path traversal
  assert.equal(sanitizeFilename('../../../../etc/passwd'), 'passwd');

  // Windows backslash path traversal
  assert.equal(sanitizeFilename('..\\..\\windows\\system32\\calc.exe'), 'calc.exe');

  // Control characters and null bytes stripped
  assert.equal(sanitizeFilename('report\x00\x1f.pdf'), 'report.pdf');

  // Dangerous punctuation replaced
  assert.equal(sanitizeFilename('my$bad*file:name?.csv'), 'my_bad_file_name_.csv');

  // Windows reserved devices (CON, PRN, AUX, NUL)
  const conSanitized = sanitizeFilename('CON.txt');
  assert.ok(!conSanitized.toLowerCase().startsWith('con.'));

  const nulSanitized = sanitizeFilename('NUL');
  assert.ok(!nulSanitized.toLowerCase().startsWith('nul'));

  // Leading/trailing spaces/dots stripped
  assert.equal(sanitizeFilename('  ...report.pdf  '), 'report.pdf');

  // Empty name throws
  assert.throws(() => sanitizeFilename(''), /Filename must be a non-empty string/);
  assert.throws(() => sanitizeFilename('   '), /Filename must be a non-empty string/);
});

test('FILE-02: validateFileUpload rejects oversized, empty, and spoofed files (T3.1)', () => {
  const maxBytes = 1000;

  // Oversized rejection
  const bigBuffer = Buffer.alloc(1500, 0x41);
  assert.throws(
    () => validateFileUpload({ filename: 'test.txt', buffer: bigBuffer, maxSizeBytes: maxBytes }),
    (err) => err.code === 'FILE_TOO_LARGE',
  );

  // Empty file rejection
  assert.throws(
    () =>
      validateFileUpload({
        filename: 'empty.txt',
        buffer: Buffer.alloc(0),
        maxSizeBytes: maxBytes,
      }),
    (err) => err.code === 'FILE_EMPTY',
  );

  // Spoofed extension: named .pdf but contains Windows executable magic bytes
  const fakePdf = Buffer.from([0x4d, 0x5a, 0x00, 0x00]);
  assert.throws(
    () =>
      validateFileUpload({
        filename: 'invoice.pdf',
        buffer: fakePdf,
        declaredMimeType: 'application/pdf',
      }),
    /Forbidden file format/,
  );

  // Spoofed mime: declared application/pdf but actual content is text
  const plainText = Buffer.from('Just plain text without PDF header', 'utf8');
  assert.throws(
    () =>
      validateFileUpload({
        filename: 'fake.pdf',
        buffer: plainText,
        declaredMimeType: 'application/pdf',
      }),
    (err) => err.code === 'MIME_TYPE_MISMATCH',
  );
});

test('FILE-03: Safe text extraction and formula injection defense in CSV', () => {
  // Plain CSV extraction
  const cleanCsv = Buffer.from('Name,Age,Dept\nAlice,30,Security\nBob,25,Engineering', 'utf8');
  const cleanResult = extractTextFromCsv(cleanCsv);
  assert.equal(cleanResult.rowCount, 3);
  assert.equal(cleanResult.columnCount, 3);
  assert.deepEqual(cleanResult.headers, ['Name', 'Age', 'Dept']);
  assert.equal(cleanResult.hasFormulaPrefix, false);
  assert.equal(cleanResult.warning, null);

  // CSV with formula injection attempts (=, @, +, -, \t)
  const hostileCsv = Buffer.from(
    'Name,Payload,Amount\n' +
      'Attacker,"=cmd|/C calc!A0",+100\n' +
      'Admin,"@SUM(1,2)",-50\n' +
      'TabUser,"\tmalicious",25\n',
    'utf8',
  );
  const hostileResult = extractTextFromCsv(hostileCsv);
  assert.equal(hostileResult.hasFormulaPrefix, true);
  assert.ok(hostileResult.warning.includes('formula trigger characters'));
  // Formulas are safely escaped with single quote in extracted text
  assert.ok(hostileResult.text.includes("'=cmd|/C calc!A0"));
  assert.ok(hostileResult.text.includes("'@SUM(1,2)"));
  assert.ok(hostileResult.text.includes("'\tmalicious"));
  // Simple numbers like +100 and -50 remain numbers
  assert.ok(hostileResult.text.includes('+100'));
  assert.ok(hostileResult.text.includes('-50'));

  // PDF text extraction
  const pdfBuffer = createSamplePdf('Bengali and English translation test string.');
  const pdfResult = extractTextFromPdf(pdfBuffer);
  assert.ok(pdfResult.text.includes('Bengali and English translation test string.'));
  assert.equal(pdfResult.pageCount, 1);

  // Plain text extraction
  const txtBuffer = Buffer.from('Line 1\r\nLine 2\r\nLine 3', 'utf8');
  const txtResult = extractTextFromTxt(txtBuffer);
  assert.equal(txtResult.lineCount, 3);
  assert.ok(txtResult.text.includes('Line 1\nLine 2\nLine 3'));

  // Token estimation
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd', 4), 1);
  assert.equal(estimateTokens('abcdefgh', 4), 2);
});

test('FILE-07: Section-by-section flow for oversized documents', () => {
  // Short text returns single complete document section
  const shortText = 'Short document within token budget.';
  const single = chunkIntoSections(shortText, { maxTokensPerSection: 100 });
  assert.equal(single.length, 1);
  assert.equal(single[0].title, 'Complete Document');
  assert.equal(single[0].content, shortText);

  // Long text split into sequential sections
  const paragraphs = Array.from(
    { length: 15 },
    (_, i) => `Paragraph ${i + 1}: detailed explanation of system requirements and operations.`,
  ).join('\n\n');

  const sections = chunkIntoSections(paragraphs, {
    maxTokensPerSection: 30, // low threshold to force multiple sections
    tokenFactor: 3.5,
  });
  assert.ok(sections.length > 1, 'Should create multiple sections');
  assert.equal(sections[0].sectionIndex, 1);
  assert.equal(sections[1].sectionIndex, 2);
  for (const s of sections) {
    assert.ok(s.tokenCount > 0);
    assert.ok(s.charCount > 0);
    assert.ok(s.content.length > 0);
  }

  // CSV sectioning preserves the header on every batch!
  const csvLines = ['ID,Name,Role'];
  for (let i = 1; i <= 20; i++) {
    csvLines.push(`${i},User${i},Developer`);
  }
  const csvContent = csvLines.join('\n');
  const csvSections = chunkIntoSections(csvContent, {
    maxTokensPerSection: 20,
    tokenFactor: 3.5,
    mimeType: 'text/csv',
  });
  assert.ok(csvSections.length > 1, 'CSV should split into multiple row batches');
  for (const sec of csvSections) {
    // Every section MUST begin with the CSV header
    assert.ok(sec.content.startsWith('ID,Name,Role'), 'Each section must preserve CSV header');
  }
});

test('FILE-06 & PRIV-05: FileService upload, per-user isolation, and IDOR prevention', async (t) => {
  const db = await createDatabase();
  await migrateUp(db, { throughVersion: 10 });
  await seedSynthetic(db);

  const fileService = createFileService({
    db,
    storageDir: testStorageBase,
  });

  t.after(async () => {
    await rm(testStorageBase, { recursive: true, force: true });
    await db.close();
  });

  const userA = SYNTHETIC_SEED.userA;
  const userB = SYNTHETIC_SEED.userB;

  // 1. User A uploads valid PDF
  const pdfBuffer = createSamplePdf('User A Confidential Project Strategy');
  const uploadA = await fileService.upload({
    userId: userA,
    filename: 'strategy.pdf',
    buffer: pdfBuffer,
    mimeType: 'application/pdf',
  });

  assert.ok(uploadA.id);
  assert.equal(uploadA.user_id, userA);
  assert.equal(uploadA.sanitized_name, 'strategy.pdf');
  assert.equal(uploadA.mime_type, 'application/pdf');
  assert.ok(uploadA.extracted_text.includes('User A Confidential Project Strategy'));
  assert.ok(uploadA.privacy_warning.includes('Warning: Do not upload secrets'));

  // 2. User A uploads valid CSV
  const csvBuffer = Buffer.from('Metric,Value\nRevenue,1000\nCost,400', 'utf8');
  const uploadCsv = await fileService.upload({
    userId: userA,
    filename: 'metrics.csv',
    buffer: csvBuffer,
    mimeType: 'text/csv',
  });
  assert.ok(uploadCsv.id);

  // 3. User A can list their files
  const listA = await fileService.listFiles({ userId: userA });
  assert.equal(listA.length, 2);
  assert.ok(listA.some((f) => f.id === uploadA.id));
  assert.ok(listA.some((f) => f.id === uploadCsv.id));

  // 4. User B cannot see User A's files in listing (Isolation)
  const listB = await fileService.listFiles({ userId: userB });
  assert.equal(listB.length, 0);

  // 5. IDOR test: User B cannot get User A's file by ID
  const idorGet = await fileService.getFile({ userId: userB, fileId: uploadA.id });
  assert.equal(idorGet, null, 'User B must not be able to retrieve User A file');

  // 6. IDOR test: User B cannot download User A's file
  await assert.rejects(
    () => fileService.downloadFile({ userId: userB, fileId: uploadA.id }),
    (err) => err.code === 'FILE_NOT_FOUND',
  );

  // 7. IDOR test: User B cannot get sections of User A's file
  await assert.rejects(
    () => fileService.getSections({ userId: userB, fileId: uploadA.id }),
    (err) => err.code === 'FILE_NOT_FOUND',
  );

  // 8. IDOR test: User B cannot delete User A's file
  const idorDelete = await fileService.deleteFile({ userId: userB, fileId: uploadA.id });
  assert.equal(idorDelete, false, 'User B delete of User A file must fail');

  // Verify file still exists for User A
  const stillExistsA = await fileService.getFile({ userId: userA, fileId: uploadA.id });
  assert.ok(stillExistsA, 'User A file must still exist after unauthorized delete attempt');

  // 9. User A can get sections (FILE-07)
  const sectionsA = await fileService.getSections({ userId: userA, fileId: uploadA.id });
  assert.equal(sectionsA.fileId, uploadA.id);
  assert.ok(sectionsA.totalSections >= 1);
  assert.ok(sectionsA.sections[0].content.includes('User A Confidential'));

  // 10. User A can download their own file
  const downloadA = await fileService.downloadFile({ userId: userA, fileId: uploadA.id });
  assert.equal(downloadA.file.id, uploadA.id);
  assert.equal(downloadA.buffer.length, pdfBuffer.length);

  // 11. User A deletes their file (PRIV-05)
  const deleteA = await fileService.deleteFile({ userId: userA, fileId: uploadA.id });
  assert.equal(deleteA, true);

  // File is marked deleted in database and no longer returned
  const afterDeleteA = await fileService.getFile({ userId: userA, fileId: uploadA.id });
  assert.equal(afterDeleteA, null);
});

test('HTTP API: Upload, list, get, download, sections, delete, warnings and IDOR checks', async (t) => {
  const db = await createDatabase();
  await migrateUp(db, { throughVersion: 10 });
  await seedSynthetic(db);

  const config = await loadConfig({}, { port: 0, limits: { chunkDelayMs: 0 } });

  const apiStorageDir = resolve(repoRoot, '.phase3-test-api-files-' + Date.now());
  const fileService = createFileService({
    db,
    storageDir: apiStorageDir,
  });

  const server = createApp({
    db,
    config,
    files: fileService,
  });

  await server.ready;
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const base = 'http://127.0.0.1:' + server.address().port;

  t.after(async () => {
    await server.shutdown();
    await rm(apiStorageDir, { recursive: true, force: true });
    await db.close();
  });

  async function signIn(identity) {
    const bootstrap = await fetch(base + '/api/bootstrap');
    const data = await bootstrap.json();
    const cookie = bootstrap.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    const login = await fetch(base + '/api/auth/local', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: base,
        'X-CSRF-Token': data.csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ identity, acceptedLegalVersion: data.legalVersion }),
    });
    assert.equal(login.status, 200);
    const loginCookies = login.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');

    // Extract csrf token from cookie
    const csrfMatch = loginCookies.match(/local_csrf=([a-zA-Z0-9_-]+)/);
    const csrfToken = csrfMatch ? csrfMatch[1] : data.csrfToken;

    return {
      cookies: loginCookies,
      csrfToken,
      bootstrapData: data,
    };
  }

  // Check bootstrap includes filesEnabled and privacy warning (PRIV-06)
  const clientA = await signIn('demo-alpha');
  assert.equal(clientA.bootstrapData.filesEnabled, true);
  assert.ok(clientA.bootstrapData.filePrivacyWarning.includes('Warning: Do not upload secrets'));

  // Check /api/files/warning returns privacy notice
  const warningRes = await fetch(base + '/api/files/warning', {
    headers: { Cookie: clientA.cookies },
  });
  assert.equal(warningRes.status, 200);
  const warningJson = await warningRes.json();
  assert.ok(warningJson.warning.includes('Warning: Do not upload secrets'));

  // 1. Upload without auth returns 401
  const unauthUpload = await fetch(base + '/api/files/upload', {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: 'test.txt',
      contentBase64: Buffer.from('hi').toString('base64'),
    }),
  });
  assert.equal(unauthUpload.status, 401);

  // 2. User A uploads PDF file via JSON base64
  const pdfBytes = createSamplePdf('HTTP API PDF upload text test.');
  const uploadRes = await fetch(base + '/api/files/upload', {
    method: 'POST',
    headers: {
      Cookie: clientA.cookies,
      Origin: base,
      'X-CSRF-Token': clientA.csrfToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename: 'sample_doc.pdf',
      contentBase64: pdfBytes.toString('base64'),
      mimeType: 'application/pdf',
    }),
  });
  assert.equal(uploadRes.status, 201);
  const uploadJson = await uploadRes.json();
  assert.equal(uploadJson.ok, true);
  assert.ok(uploadJson.file.id);
  assert.equal(uploadJson.file.sanitized_name, 'sample_doc.pdf');
  const fileId = uploadJson.file.id;

  // 3. User A lists files
  const listRes = await fetch(base + '/api/files', {
    headers: { Cookie: clientA.cookies },
  });
  assert.equal(listRes.status, 200);
  const listJson = await listRes.json();
  assert.equal(listJson.files.length, 1);
  assert.equal(listJson.files[0].id, fileId);

  // 4. User A gets file details
  const getRes = await fetch(base + `/api/files/${fileId}`, {
    headers: { Cookie: clientA.cookies },
  });
  assert.equal(getRes.status, 200);
  const getJson = await getRes.json();
  assert.equal(getJson.file.id, fileId);
  assert.ok(getJson.file.extracted_text.includes('HTTP API PDF upload text test.'));

  // 5. User A gets sections (FILE-07)
  const sectionsRes = await fetch(base + `/api/files/${fileId}/sections`, {
    headers: { Cookie: clientA.cookies },
  });
  assert.equal(sectionsRes.status, 200);
  const sectionsJson = await sectionsRes.json();
  assert.equal(sectionsJson.fileId, fileId);
  assert.ok(sectionsJson.sections.length >= 1);

  // 6. User A downloads file
  const downloadRes = await fetch(base + `/api/files/${fileId}/download`, {
    headers: { Cookie: clientA.cookies },
  });
  assert.equal(downloadRes.status, 200);
  assert.equal(downloadRes.headers.get('Content-Type'), 'application/pdf');
  const downloadedBytes = Buffer.from(await downloadRes.arrayBuffer());
  assert.equal(downloadedBytes.length, pdfBytes.length);

  // 7. User B signs in -> IDOR tests
  const clientB = await signIn('demo-beta');

  // User B lists files -> empty
  const listResB = await fetch(base + '/api/files', {
    headers: { Cookie: clientB.cookies },
  });
  assert.equal(listResB.status, 200);
  assert.equal((await listResB.json()).files.length, 0);

  // User B attempts to GET User A's file -> 404
  const idorGet = await fetch(base + `/api/files/${fileId}`, {
    headers: { Cookie: clientB.cookies },
  });
  assert.equal(idorGet.status, 404);

  // User B attempts to DOWNLOAD User A's file -> 404
  const idorDownload = await fetch(base + `/api/files/${fileId}/download`, {
    headers: { Cookie: clientB.cookies },
  });
  assert.equal(idorDownload.status, 404);

  // User B attempts to GET SECTIONS of User A's file -> 404
  const idorSections = await fetch(base + `/api/files/${fileId}/sections`, {
    headers: { Cookie: clientB.cookies },
  });
  assert.equal(idorSections.status, 404);

  // User B attempts to DELETE User A's file -> 404
  const idorDelete = await fetch(base + `/api/files/${fileId}`, {
    method: 'DELETE',
    headers: {
      Cookie: clientB.cookies,
      Origin: base,
      'X-CSRF-Token': clientB.csrfToken,
    },
  });
  assert.equal(idorDelete.status, 404);

  // 8. User A deletes their file
  const deleteRes = await fetch(base + `/api/files/${fileId}`, {
    method: 'DELETE',
    headers: {
      Cookie: clientA.cookies,
      Origin: base,
      'X-CSRF-Token': clientA.csrfToken,
    },
  });
  assert.equal(deleteRes.status, 200);
  assert.equal((await deleteRes.json()).deleted, true);

  // Now file is 404 for User A as well
  const afterDeleteRes = await fetch(base + `/api/files/${fileId}`, {
    headers: { Cookie: clientA.cookies },
  });
  assert.equal(afterDeleteRes.status, 404);
});
