import { parseCsvRows } from './extractor.mjs';

/**
 * Determine if a value is considered missing (empty, whitespace, null, na, nan).
 */
export function isMissingValue(val) {
  if (val === null || val === undefined) return true;
  const str = String(val).trim().toLowerCase();
  return (
    str === '' ||
    str === 'na' ||
    str === 'n/a' ||
    str === 'null' ||
    str === 'none' ||
    str === 'nan' ||
    str === 'undefined'
  );
}

/**
 * Infer the semantic and primitive data type of a column from sampled values.
 */
export function inferColumnType(values) {
  const nonMissing = values.filter((v) => !isMissingValue(v));
  if (nonMissing.length === 0) return 'unknown';

  let numericCount = 0;
  let booleanCount = 0;
  let dateCount = 0;

  for (const raw of nonMissing) {
    const val = String(raw).trim();

    // Check boolean
    if (/^(true|false|yes|no|1|0)$/i.test(val)) {
      booleanCount++;
    }

    // Check numeric
    if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(val)) {
      numericCount++;
    }

    // Check date (e.g. YYYY-MM-DD, YYYY/MM/DD, ISO date)
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(val) || /^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(val)) {
      const parsed = Date.parse(val);
      if (!Number.isNaN(parsed)) {
        dateCount++;
      }
    }
  }

  const threshold = 0.8; // 80% of non-missing values match
  if (numericCount / nonMissing.length >= threshold) {
    // Check if integer or float
    const allInt = nonMissing.every((v) => /^[+-]?\d+$/.test(String(v).trim()));
    return allInt ? 'integer' : 'float';
  }

  if (dateCount / nonMissing.length >= threshold) {
    return 'date';
  }

  if (booleanCount / nonMissing.length >= threshold) {
    return 'boolean';
  }

  return 'string';
}

/**
 * Calculate descriptive statistics for an array of numbers.
 */
export function computeNumericStats(numbers) {
  if (numbers.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      sum: 0,
      mean: null,
      median: null,
      variance: null,
      stdDev: null,
      q25: null,
      q75: null,
      iqr: null,
    };
  }

  const sorted = [...numbers].sort((a, b) => a - b);
  const count = sorted.length;
  const min = sorted[0];
  const max = sorted[count - 1];
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const mean = sum / count;

  // Median
  const mid = Math.floor(count / 2);
  const median = count % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  // Variance & Standard Deviation
  const variance =
    count > 1 ? sorted.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / count : 0;
  const stdDev = Math.sqrt(variance);

  // Percentiles
  const p25Index = Math.floor(count * 0.25);
  const p75Index = Math.floor(count * 0.75);
  const q25 = sorted[p25Index];
  const q75 = sorted[p75Index];
  const iqr = q75 - q25;

  return {
    count,
    min,
    max,
    sum: Number(sum.toFixed(4)),
    mean: Number(mean.toFixed(4)),
    median: Number(median.toFixed(4)),
    variance: Number(variance.toFixed(4)),
    stdDev: Number(stdDev.toFixed(4)),
    q25,
    q75,
    iqr,
  };
}

/**
 * Calculate categorical value distribution and frequency for string columns.
 */
export function computeCategoricalStats(values) {
  const frequencies = new Map();
  let validCount = 0;

  for (const v of values) {
    if (isMissingValue(v)) continue;
    validCount++;
    const key = String(v).trim();
    frequencies.set(key, (frequencies.get(key) || 0) + 1);
  }

  const sortedEntries = [...frequencies.entries()].sort((a, b) => b[1] - a[1]);
  const uniqueCount = frequencies.size;

  const topCategories = sortedEntries.slice(0, 10).map(([value, count]) => ({
    value,
    count,
    percentage: validCount > 0 ? Number(((count / validCount) * 100).toFixed(2)) : 0,
  }));

  return {
    count: validCount,
    uniqueCount,
    cardinality: uniqueCount,
    topCategories,
    mostFrequent: topCategories[0] || null,
  };
}

/**
 * Suggest optimal chart visualizations based on column types and data distributions.
 */
export function suggestCharts(columns, rowCount) {
  const suggestions = [];

  const numericCols = columns.filter(
    (c) => c.inferredType === 'integer' || c.inferredType === 'float',
  );
  const dateCols = columns.filter((c) => c.inferredType === 'date');
  const catCols = columns.filter(
    (c) => c.inferredType === 'string' || c.inferredType === 'boolean',
  );

  // 1. Time-series Line Chart: Date vs Numeric
  if (dateCols.length > 0 && numericCols.length > 0) {
    const dateCol = dateCols[0];
    const numCol = numericCols[0];
    suggestions.push({
      chartType: 'line',
      title: `${numCol.name} over Time (${dateCol.name})`,
      xAxis: dateCol.name,
      yAxis: numCol.name,
      rationale: `Temporal trend visualization showing how ${numCol.name} changes across ${dateCol.name}.`,
      priority: 1,
    });
  }

  // 2. Categorical Comparison Bar Chart: Categorical vs Numeric
  if (catCols.length > 0 && numericCols.length > 0) {
    // Choose categorical with reasonable cardinality (<= 25)
    const bestCat =
      catCols.find((c) => c.stats?.uniqueCount && c.stats.uniqueCount <= 25) || catCols[0];
    const bestNum = numericCols[0];
    suggestions.push({
      chartType: 'bar',
      title: `${bestNum.name} by ${bestCat.name}`,
      xAxis: bestCat.name,
      yAxis: bestNum.name,
      rationale: `Compares metric ${bestNum.name} across different ${bestCat.name} categories.`,
      priority: 2,
    });
  }

  // 3. Scatter Plot / Correlation: Two Numeric Columns
  if (numericCols.length >= 2) {
    suggestions.push({
      chartType: 'scatter',
      title: `${numericCols[0].name} vs ${numericCols[1].name} Correlation`,
      xAxis: numericCols[0].name,
      yAxis: numericCols[1].name,
      rationale: `Examines correlation and distribution between numerical features ${numericCols[0].name} and ${numericCols[1].name}.`,
      priority: 3,
    });
  }

  // 4. Distribution / Composition Pie or Donut Chart: Low-cardinality categorical
  const pieCandidate = catCols.find((c) => c.stats?.uniqueCount >= 2 && c.stats.uniqueCount <= 7);
  if (pieCandidate) {
    suggestions.push({
      chartType: 'pie',
      title: `Composition of ${pieCandidate.name}`,
      categoryAxis: pieCandidate.name,
      rationale: `Displays proportional breakdown of ${pieCandidate.name} across its ${pieCandidate.stats.uniqueCount} distinct groups.`,
      priority: 4,
    });
  }

  // 5. Histogram / Single Variable Distribution
  if (numericCols.length > 0 && rowCount >= 10) {
    suggestions.push({
      chartType: 'histogram',
      title: `Distribution of ${numericCols[0].name}`,
      xAxis: numericCols[0].name,
      rationale: `Shows statistical frequency distribution, skewness, and spread of ${numericCols[0].name}.`,
      priority: 5,
    });
  }

  return suggestions;
}

/**
 * Comprehensive analysis of a CSV dataset: structure, missing values, statistics, and chart suggestions.
 */
export function analyzeCsv(rawCsvText) {
  if (typeof rawCsvText !== 'string' || rawCsvText.trim().length === 0) {
    const err = new Error('CSV text is empty or invalid');
    err.code = 'INVALID_CSV';
    throw err;
  }

  const rows = parseCsvRows(rawCsvText);
  if (rows.length === 0) {
    const err = new Error('No data rows found in CSV');
    err.code = 'EMPTY_CSV';
    throw err;
  }

  const headers = rows[0].map((h, i) => (h && h.trim().length > 0 ? h.trim() : `Column_${i + 1}`));
  const dataRows = rows.slice(1);
  const rowCount = dataRows.length;
  const columnCount = headers.length;

  let totalMissing = 0;
  const rowsWithMissingSet = new Set();

  // Column profiling
  const columns = headers.map((name, colIdx) => {
    const values = dataRows.map((r) => r[colIdx] ?? '');
    let missingCount = 0;

    values.forEach((v, rowIdx) => {
      if (isMissingValue(v)) {
        missingCount++;
        totalMissing++;
        rowsWithMissingSet.add(rowIdx + 1);
      }
    });

    const missingPercentage =
      rowCount > 0 ? Number(((missingCount / rowCount) * 100).toFixed(2)) : 0;
    const inferredType = inferColumnType(values);

    let stats = null;
    if (inferredType === 'integer' || inferredType === 'float') {
      const numbers = values
        .filter((v) => !isMissingValue(v))
        .map((v) => Number(v))
        .filter((n) => !Number.isNaN(n));
      stats = computeNumericStats(numbers);
    } else {
      stats = computeCategoricalStats(values);
    }

    return {
      name,
      index: colIdx,
      inferredType,
      missingCount,
      missingPercentage,
      stats,
    };
  });

  const chartSuggestions = suggestCharts(columns, rowCount);

  return {
    summary: {
      totalRows: rowCount,
      totalColumns: columnCount,
      headers,
      preview: dataRows.slice(0, 5),
    },
    missingValues: {
      totalMissing,
      rowsWithMissing: rowsWithMissingSet.size,
      missingRowsPercentage:
        rowCount > 0 ? Number(((rowsWithMissingSet.size / rowCount) * 100).toFixed(2)) : 0,
      columnBreakdown: columns.map((c) => ({
        column: c.name,
        missingCount: c.missingCount,
        missingPercentage: c.missingPercentage,
      })),
    },
    columns,
    chartSuggestions,
  };
}

/**
 * Natural language and structured query execution on CSV dataset.
 * Supports filters, aggregations (avg, sum, min, max, count), sorting/top N, and column lookups.
 */
export function queryCsv(rawCsvText, queryInput) {
  const analysis = analyzeCsv(rawCsvText);
  const rows = parseCsvRows(rawCsvText);
  const headers = analysis.summary.headers;
  const dataRows = rows.slice(1);

  const question =
    typeof queryInput === 'string' ? queryInput.trim() : (queryInput.question ?? '').trim();
  const lowerQ = question.toLowerCase();

  // Find referenced columns in query
  const matchedCols = headers.filter((h) => lowerQ.includes(h.toLowerCase()));
  const numCols = analysis.columns.filter(
    (c) => c.inferredType === 'integer' || c.inferredType === 'float',
  );

  // Case 1: Missing values questions ("how many missing values?", "missing values in <column>")
  if (lowerQ.includes('missing') || lowerQ.includes('null') || lowerQ.includes('empty')) {
    if (matchedCols.length > 0) {
      const colMeta = analysis.columns.find(
        (c) => c.name.toLowerCase() === matchedCols[0].toLowerCase(),
      );
      return {
        question,
        operation: 'missing_check',
        answer: `Column "${colMeta.name}" has ${colMeta.missingCount} missing values (${colMeta.missingPercentage}%).`,
        result: {
          column: colMeta.name,
          missingCount: colMeta.missingCount,
          missingPercentage: colMeta.missingPercentage,
        },
      };
    }
    return {
      question,
      operation: 'missing_check',
      answer: `The dataset has a total of ${analysis.missingValues.totalMissing} missing values across ${analysis.missingValues.rowsWithMissing} rows (${analysis.missingValues.missingRowsPercentage}% of all rows).`,
      result: analysis.missingValues,
    };
  }

  // Case 2: Group By Aggregations ("average salary by department", "sum revenue by region", "count by role")
  const groupByMatch = lowerQ.match(
    /(average|avg|mean|sum|total|count|min|max)\s+([a-zA-Z0-9_\- ]+?)\s+(?:by|per|for each)\s+([a-zA-Z0-9_\- ]+)/i,
  );
  if (groupByMatch) {
    const aggOp = groupByMatch[1].toLowerCase();
    const rawTargetCol = groupByMatch[2].trim();
    const rawGroupCol = groupByMatch[3].trim();

    const targetCol =
      headers.find((h) => h.toLowerCase() === rawTargetCol.toLowerCase()) ||
      headers.find((h) => rawTargetCol.toLowerCase().includes(h.toLowerCase()));
    const groupCol =
      headers.find((h) => h.toLowerCase() === rawGroupCol.toLowerCase()) ||
      headers.find((h) => rawGroupCol.toLowerCase().includes(h.toLowerCase()));

    if (groupCol) {
      const groupIdx = headers.indexOf(groupCol);
      const targetIdx = targetCol ? headers.indexOf(targetCol) : -1;

      const groups = new Map();
      for (const row of dataRows) {
        const groupVal = (row[groupIdx] ?? 'Unknown').trim();
        if (!groups.has(groupVal)) groups.set(groupVal, []);
        if (targetIdx !== -1) {
          const num = Number(row[targetIdx]);
          if (!Number.isNaN(num) && !isMissingValue(row[targetIdx])) {
            groups.get(groupVal).push(num);
          }
        } else {
          groups.get(groupVal).push(1);
        }
      }

      const results = [];
      for (const [key, nums] of groups.entries()) {
        let val = 0;
        if (aggOp === 'average' || aggOp === 'avg' || aggOp === 'mean') {
          val =
            nums.length > 0
              ? Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2))
              : 0;
        } else if (aggOp === 'sum' || aggOp === 'total') {
          val = Number(nums.reduce((a, b) => a + b, 0).toFixed(2));
        } else if (aggOp === 'min') {
          val = nums.length > 0 ? Math.min(...nums) : 0;
        } else if (aggOp === 'max') {
          val = nums.length > 0 ? Math.max(...nums) : 0;
        } else {
          val = nums.length;
        }
        results.push({ [groupCol]: key, [targetCol ? `${aggOp}_${targetCol}` : 'count']: val });
      }

      const formatted = results.map((r) => `${r[groupCol]}: ${Object.values(r)[1]}`).join(', ');
      return {
        question,
        operation: `groupBy_${aggOp}`,
        targetColumn: targetCol,
        groupByColumn: groupCol,
        answer: `${aggOp.toUpperCase()} of ${targetCol || 'records'} by ${groupCol}: ${formatted}`,
        result: results,
      };
    }
  }

  // Case 3: Summary / Aggregation on single column ("average age", "total revenue", "max score")
  const aggKeywords = [
    { name: 'average', aliases: ['average', 'avg', 'mean'] },
    { name: 'sum', aliases: ['sum', 'total'] },
    { name: 'max', aliases: ['highest', 'max', 'maximum', 'greatest', 'most'] },
    { name: 'min', aliases: ['lowest', 'min', 'minimum', 'least'] },
  ];

  for (const { name: aggName, aliases } of aggKeywords) {
    if (aliases.some((a) => lowerQ.includes(a))) {
      // Find which numeric column is targeted
      const targetCol =
        matchedCols.find((c) => {
          const meta = analysis.columns.find((col) => col.name === c);
          return meta && (meta.inferredType === 'integer' || meta.inferredType === 'float');
        }) || numCols[0]?.name;

      if (targetCol) {
        const colMeta = analysis.columns.find((c) => c.name === targetCol);
        if (colMeta && colMeta.stats) {
          let value = null;
          let label = aggName;
          if (aggName === 'average') value = colMeta.stats.mean;
          else if (aggName === 'sum') value = colMeta.stats.sum;
          else if (aggName === 'max') value = colMeta.stats.max;
          else if (aggName === 'min') value = colMeta.stats.min;

          return {
            question,
            operation: `aggregate_${aggName}`,
            column: targetCol,
            answer: `The ${label} of ${targetCol} is ${value}. (Range: ${colMeta.stats.min} to ${colMeta.stats.max}, count: ${colMeta.stats.count})`,
            result: {
              column: targetCol,
              metric: aggName,
              value,
              stats: colMeta.stats,
            },
          };
        }
      }
    }
  }

  // Case 4: Row count / size ("how many rows?", "how many records?", "how many employees?")
  if (lowerQ.includes('how many') || lowerQ.includes('total rows') || lowerQ.includes('count')) {
    return {
      question,
      operation: 'count_rows',
      answer: `The dataset contains ${analysis.summary.totalRows} data rows and ${analysis.summary.totalColumns} columns (${headers.join(', ')}).`,
      result: {
        totalRows: analysis.summary.totalRows,
        totalColumns: analysis.summary.totalColumns,
        headers,
      },
    };
  }

  // Case 5: Top N / Bottom N ("top 3 customers", "highest 5 scores")
  const topMatch = lowerQ.match(/(?:top|highest|first)\s+(\d+)\s*(?:by\s+([a-zA-Z0-9_\-]+))?/i);
  if (topMatch) {
    const limitN = parseInt(topMatch[1], 10);
    const orderColName =
      topMatch[2] || (matchedCols.length > 0 ? matchedCols[0] : numCols[0]?.name);
    const orderIdx = orderColName ? headers.indexOf(orderColName) : -1;

    if (orderIdx !== -1) {
      const sortedRows = [...dataRows].sort((a, b) => {
        const valA = a[orderIdx];
        const valB = b[orderIdx];
        const isMissA = isMissingValue(valA);
        const isMissB = isMissingValue(valB);
        if (isMissA && isMissB) return 0;
        if (isMissA) return 1;
        if (isMissB) return -1;
        const nA = Number(valA);
        const nB = Number(valB);
        if (!Number.isNaN(nA) && !Number.isNaN(nB)) return nB - nA;
        return String(valB ?? '').localeCompare(String(valA ?? ''));
      });

      const topRows = sortedRows.slice(0, limitN).map((r) => {
        const obj = {};
        headers.forEach((h, i) => (obj[h] = r[i] ?? ''));
        return obj;
      });

      return {
        question,
        operation: 'top_n',
        orderColumn: orderColName,
        limit: limitN,
        answer: `Top ${limitN} records ordered by ${orderColName}:`,
        result: topRows,
      };
    }
  }

  // Fallback: Default Summary Overview
  return {
    question,
    operation: 'general_summary',
    answer: `Dataset overview: ${analysis.summary.totalRows} rows across ${analysis.summary.totalColumns} columns (${headers.join(', ')}). Total missing values: ${analysis.missingValues.totalMissing}. Available chart types: ${analysis.chartSuggestions.map((c) => c.chartType).join(', ')}.`,
    result: {
      summary: analysis.summary,
      columns: analysis.columns.map((c) => ({
        name: c.name,
        type: c.inferredType,
        missing: c.missingCount,
      })),
      chartSuggestions: analysis.chartSuggestions,
    },
  };
}
