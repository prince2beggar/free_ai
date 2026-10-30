import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';
import {
  createFileService,
  analyzeCsv,
  queryCsv,
  computeNumericStats,
  computeCategoricalStats,
  suggestCharts,
  inferColumnType,
  isMissingValue,
} from '../../packages/files/index.mjs';
import { createDatabase, migrateUp, seedSynthetic } from '../../packages/db/index.mjs';
import { createApp } from '../../packages/api/server.mjs';
import { loadConfig } from '../../packages/api/config.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

// Known deterministic benchmark dataset
// 8 rows, 6 columns: name (string), department (categorical), salary (integer), score (float), hire_date (date), active (boolean)
// Deliberate missing values:
// Row 4 (David): score is empty ""
// Row 6 (Frank): salary is "NA"
// Row 7 (Grace): department is "   " (whitespace)
const SAMPLE_CSV = [
  'name,department,salary,score,hire_date,active',
  'Alice,Engineering,100000,95.5,2022-01-15,true',
  'Bob,Engineering,120000,88.0,2021-03-10,true',
  'Charlie,Marketing,80000,92.0,2023-05-01,false',
  'David,Marketing,90000,,2022-11-20,true',
  'Eve,Design,85000,89.5,2020-08-14,true',
  'Frank,Design,NA,78.5,2024-02-01,false',
  'Grace,   ,70000,84.0,2023-09-12,true',
  'Heidi,Engineering,110000,91.0,2019-06-30,true',
].join('\n');

test('CSV Analysis: Primitive helpers (isMissingValue, inferColumnType)', () => {
  assert.equal(isMissingValue(''), true);
  assert.equal(isMissingValue('   '), true);
  assert.equal(isMissingValue('NA'), true);
  assert.equal(isMissingValue('n/a'), true);
  assert.equal(isMissingValue('NaN'), true);
  assert.equal(isMissingValue('null'), true);
  assert.equal(isMissingValue('undefined'), true);
  assert.equal(isMissingValue(null), true);
  assert.equal(isMissingValue(undefined), true);
  assert.equal(isMissingValue('hello'), false);
  assert.equal(isMissingValue('0'), false);
  assert.equal(isMissingValue('false'), false);

  assert.equal(inferColumnType(['10', '20', '30']), 'integer');
  assert.equal(inferColumnType(['10.5', '20.2', '30.1']), 'float');
  assert.equal(inferColumnType(['true', 'false', 'true']), 'boolean');
  assert.equal(inferColumnType(['2022-01-15', '2023-05-01']), 'date');
  assert.equal(inferColumnType(['Engineering', 'Marketing', 'Design']), 'string');
});

test('CSV Analysis: computeNumericStats deterministic calculations', () => {
  // Numbers: 10, 20, 30, 40, 50
  const stats = computeNumericStats([10, 20, 30, 40, 50]);
  assert.equal(stats.count, 5);
  assert.equal(stats.min, 10);
  assert.equal(stats.max, 50);
  assert.equal(stats.sum, 150);
  assert.equal(stats.mean, 30);
  assert.equal(stats.median, 30);
  assert.equal(stats.q25, 20);
  assert.equal(stats.q75, 40);
  assert.equal(stats.iqr, 20);
  // Variance: ((10-30)^2 + (20-30)^2 + 0 + (40-30)^2 + (50-30)^2) / 5 = (400 + 100 + 0 + 100 + 400) / 5 = 1000 / 5 = 200
  assert.equal(stats.variance, 200);
  assert.equal(stats.stdDev, 14.1421);
});

test('CSV Analysis: computeCategoricalStats deterministic distributions', () => {
  const cats = computeCategoricalStats(['A', 'B', 'A', 'C', 'A', 'B']);
  assert.equal(cats.count, 6);
  assert.equal(cats.uniqueCount, 3);
  assert.equal(cats.mostFrequent.value, 'A');
  assert.equal(cats.topCategories[0].value, 'A');
  assert.equal(cats.topCategories[0].count, 3);
  assert.equal(cats.topCategories[1].value, 'B');
  assert.equal(cats.topCategories[1].count, 2);
  assert.equal(cats.topCategories[2].value, 'C');
  assert.equal(cats.topCategories[2].count, 1);
});

test('CSV Analysis: analyzeCsv on benchmark dataset', () => {
  const result = analyzeCsv(SAMPLE_CSV);

  // 1. Summary
  assert.equal(result.summary.totalRows, 8);
  assert.equal(result.summary.totalColumns, 6);
  assert.deepEqual(result.summary.headers, [
    'name',
    'department',
    'salary',
    'score',
    'hire_date',
    'active',
  ]);
  assert.equal(result.summary.preview.length, 5);

  // 2. Missing values
  // Missing items: David score (1), Frank salary (1), Grace department (1) => total 3
  assert.equal(result.missingValues.totalMissing, 3);
  assert.equal(result.missingValues.rowsWithMissing, 3);

  const deptMissing = result.missingValues.columnBreakdown.find((c) => c.column === 'department');
  assert.equal(deptMissing.missingCount, 1);

  const salMissing = result.missingValues.columnBreakdown.find((c) => c.column === 'salary');
  assert.equal(salMissing.missingCount, 1);

  const scoreMissing = result.missingValues.columnBreakdown.find((c) => c.column === 'score');
  assert.equal(scoreMissing.missingCount, 1);

  // 3. Column analysis & types
  const colMap = new Map(result.columns.map((c) => [c.name, c]));
  assert.equal(colMap.get('name').inferredType, 'string');
  assert.equal(colMap.get('department').inferredType, 'string');
  assert.equal(colMap.get('salary').inferredType, 'integer');
  assert.equal(colMap.get('score').inferredType, 'float');
  assert.equal(colMap.get('hire_date').inferredType, 'date');
  assert.equal(colMap.get('active').inferredType, 'boolean');

  // Salary numeric stats (7 present values: 100000, 120000, 80000, 90000, 85000, 70000, 110000)
  // Sorted: 70000, 80000, 85000, 90000, 100000, 110000, 120000
  // Sum = 655000, Count = 7, Mean = 655000 / 7 = 93571.4286, Min = 70000, Max = 120000, Median = 90000
  const salStats = colMap.get('salary').stats;
  assert.ok(salStats);
  assert.equal(salStats.count, 7);
  assert.equal(salStats.min, 70000);
  assert.equal(salStats.max, 120000);
  assert.equal(salStats.sum, 655000);
  assert.equal(salStats.mean, 93571.4286);
  assert.equal(salStats.median, 90000);

  // Score numeric stats (7 present values: 95.5, 88.0, 92.0, 89.5, 78.5, 84.0, 91.0)
  // Sorted: 78.5, 84.0, 88.0, 89.5, 91.0, 92.0, 95.5
  // Sum = 618.5, Count = 7, Mean = 88.3571, Min = 78.5, Max = 95.5, Median = 89.5
  const scoreStats = colMap.get('score').stats;
  assert.ok(scoreStats);
  assert.equal(scoreStats.count, 7);
  assert.equal(scoreStats.min, 78.5);
  assert.equal(scoreStats.max, 95.5);
  assert.equal(scoreStats.sum, 618.5);
  assert.equal(scoreStats.mean, 88.3571);
  assert.equal(scoreStats.median, 89.5);

  // Department categorical stats
  const deptStats = colMap.get('department').stats;
  assert.ok(deptStats);
  assert.equal(deptStats.count, 7);
  assert.equal(deptStats.mostFrequent.value, 'Engineering');

  // 4. Chart Suggestions
  assert.ok(result.chartSuggestions.length >= 2);
  const chartTypes = result.chartSuggestions.map((c) => c.chartType);
  assert.ok(chartTypes.includes('bar'));
  assert.ok(
    chartTypes.includes('line') ||
      chartTypes.includes('scatter') ||
      chartTypes.includes('pie') ||
      chartTypes.includes('histogram'),
  );

  const directCharts = suggestCharts(result.columns, 8);
  assert.ok(directCharts.length >= 2);
});

test('CSV Query: Natural-language and aggregation questions on benchmark CSV', () => {
  // 1. Row count query
  const qRows = queryCsv(SAMPLE_CSV, 'How many rows are there?');
  assert.equal(qRows.operation, 'count_rows');
  assert.ok(qRows.answer.includes('8'));

  // 2. Metric query: average salary
  const qAvgSal = queryCsv(SAMPLE_CSV, 'What is the average salary?');
  assert.equal(qAvgSal.operation, 'aggregate_average');
  assert.ok(qAvgSal.answer.includes('93571.4286'));
  assert.equal(qAvgSal.column, 'salary');

  // 3. Metric query: total salary
  const qSumSal = queryCsv(SAMPLE_CSV, 'What is the total salary sum?');
  assert.equal(qSumSal.operation, 'aggregate_sum');
  assert.ok(qSumSal.answer.includes('655000'));

  // 4. Metric query: highest score
  const qMaxScore = queryCsv(SAMPLE_CSV, 'What is the maximum score?');
  assert.equal(qMaxScore.operation, 'aggregate_max');
  assert.ok(qMaxScore.answer.includes('95.5'));

  // 5. Group by query: average salary by department
  const qGroupBy = queryCsv(SAMPLE_CSV, 'Average salary by department');
  assert.equal(qGroupBy.operation, 'groupBy_average');
  assert.equal(qGroupBy.targetColumn, 'salary');
  assert.equal(qGroupBy.groupByColumn, 'department');
  assert.ok(qGroupBy.result.length >= 2);
  // Engineering: (100000 + 120000 + 110000) / 3 = 110000
  const engRow = qGroupBy.result.find((d) => d.department === 'Engineering');
  assert.ok(engRow);
  assert.equal(engRow.average_salary, 110000);

  // 6. Top N records
  const qTop = queryCsv(SAMPLE_CSV, 'Show top 3 by salary');
  assert.equal(qTop.operation, 'top_n');
  assert.equal(qTop.result.length, 3);
  assert.equal(qTop.result[0].name, 'Bob'); // 120000
  assert.equal(qTop.result[1].name, 'Heidi'); // 110000
  assert.equal(qTop.result[2].name, 'Alice'); // 100000

  // 7. Missing values inquiry
  const qMissing = queryCsv(SAMPLE_CSV, 'Are there missing values in salary?');
  assert.equal(qMissing.operation, 'missing_check');
  assert.ok(qMissing.answer.includes('1 missing values'));

  // 8. General question fallback
  const qGeneral = queryCsv(SAMPLE_CSV, 'Describe this dataset');
  assert.equal(qGeneral.operation, 'general_summary');
  assert.ok(qGeneral.answer.includes('8 rows'));
});

test('HTTP API: GET /api/files/:id/analysis and POST /api/files/:id/query (T3.3)', async (t) => {
  const db = await createDatabase();
  await migrateUp(db, { throughVersion: 10 });
  await seedSynthetic(db);

  const config = await loadConfig({}, { port: 0, limits: { chunkDelayMs: 0 } });
  const testStorageBase = resolve(repoRoot, '.phase3-test-csv-' + Date.now());

  const fileService = createFileService({
    db,
    storageDir: testStorageBase,
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
    await rm(testStorageBase, { recursive: true, force: true });
    await db.close();
  });

  // Helper: Sign in
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

    const csrfMatch = loginCookies.match(/local_csrf=([a-zA-Z0-9_-]+)/);
    const csrfToken = csrfMatch ? csrfMatch[1] : data.csrfToken;

    return {
      cookies: loginCookies,
      csrfToken,
    };
  }

  // 1. Sign in as User A
  const clientA = await signIn('demo-alpha');

  // 2. Upload CSV file as User A
  const uploadRes = await fetch(base + '/api/files/upload', {
    method: 'POST',
    headers: {
      Cookie: clientA.cookies,
      Origin: base,
      'X-CSRF-Token': clientA.csrfToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename: 'employees.csv',
      contentBase64: Buffer.from(SAMPLE_CSV, 'utf8').toString('base64'),
    }),
  });
  assert.equal(uploadRes.status, 201);
  const uploadJson = await uploadRes.json();
  const fileId = uploadJson.file.id;
  assert.ok(fileId);

  // 3. User A requests GET /api/files/:id/analysis
  const analysisRes = await fetch(base + `/api/files/${fileId}/analysis`, {
    headers: { Cookie: clientA.cookies },
  });
  assert.equal(analysisRes.status, 200);
  const analysisJson = await analysisRes.json();
  assert.equal(analysisJson.fileId, fileId);
  assert.equal(analysisJson.summary.totalRows, 8);
  assert.equal(analysisJson.summary.totalColumns, 6);
  assert.equal(analysisJson.missingValues.totalMissing, 3);
  assert.ok(analysisJson.columns.length === 6);
  assert.ok(analysisJson.chartSuggestions.length >= 2);

  // 4. User A requests POST /api/files/:id/query with valid question
  const queryRes = await fetch(base + `/api/files/${fileId}/query`, {
    method: 'POST',
    headers: {
      Cookie: clientA.cookies,
      Origin: base,
      'X-CSRF-Token': clientA.csrfToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ question: 'average salary by department' }),
  });
  assert.equal(queryRes.status, 200);
  const queryJson = await queryRes.json();
  assert.equal(queryJson.fileId, fileId);
  assert.equal(queryJson.operation, 'groupBy_average');
  assert.ok(queryJson.answer.includes('Engineering'));

  // 5. Query validation error: empty question -> 400
  const emptyQueryRes = await fetch(base + `/api/files/${fileId}/query`, {
    method: 'POST',
    headers: {
      Cookie: clientA.cookies,
      Origin: base,
      'X-CSRF-Token': clientA.csrfToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ question: '   ' }),
  });
  assert.equal(emptyQueryRes.status, 400);

  // 6. Non-CSV file rejection: Upload a TXT file and request analysis/query -> 400 NOT_CSV_FILE
  const txtContent = Buffer.from('Just plain text without csv structure.\nSecond line.', 'utf8');
  const txtUploadRes = await fetch(base + '/api/files/upload', {
    method: 'POST',
    headers: {
      Cookie: clientA.cookies,
      Origin: base,
      'X-CSRF-Token': clientA.csrfToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename: 'notes.txt',
      contentBase64: txtContent.toString('base64'),
    }),
  });
  assert.equal(txtUploadRes.status, 201);
  const txtFileId = (await txtUploadRes.json()).file.id;

  const txtAnalysisRes = await fetch(base + `/api/files/${txtFileId}/analysis`, {
    headers: { Cookie: clientA.cookies },
  });
  assert.equal(txtAnalysisRes.status, 400);
  const txtAnalysisErr = await txtAnalysisRes.json();
  assert.equal(txtAnalysisErr.error.code, 'NOT_CSV_FILE');

  const txtQueryRes = await fetch(base + `/api/files/${txtFileId}/query`, {
    method: 'POST',
    headers: {
      Cookie: clientA.cookies,
      Origin: base,
      'X-CSRF-Token': clientA.csrfToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ question: 'how many rows' }),
  });
  assert.equal(txtQueryRes.status, 400);
  const txtQueryErr = await txtQueryRes.json();
  assert.equal(txtQueryErr.error.code, 'NOT_CSV_FILE');

  // 7. IDOR Protection: User B tries to analyze or query User A's CSV file -> 404
  const clientB = await signIn('demo-beta');

  const idorAnalysisRes = await fetch(base + `/api/files/${fileId}/analysis`, {
    headers: { Cookie: clientB.cookies },
  });
  assert.equal(idorAnalysisRes.status, 404);

  const idorQueryRes = await fetch(base + `/api/files/${fileId}/query`, {
    method: 'POST',
    headers: {
      Cookie: clientB.cookies,
      Origin: base,
      'X-CSRF-Token': clientB.csrfToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ question: 'average salary by department' }),
  });
  assert.equal(idorQueryRes.status, 404);

  // 8. Unauthenticated request -> 401
  const unauthRes = await fetch(base + `/api/files/${fileId}/analysis`);
  assert.equal(unauthRes.status, 401);
});
