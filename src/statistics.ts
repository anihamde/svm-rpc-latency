import { Statistics, TransactionResult } from './types';

export function calculateStatistics(values: number[]): Statistics {
  if (values.length === 0) {
    return {
      count: 0,
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      p95: 0,
      p99: 0,
      stdDev: 0,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const mean = sum / count;

  const squaredDiffs = sorted.map(val => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / count;
  const stdDev = Math.sqrt(variance);

  const percentile = (p: number): number => {
    const index = Math.ceil((p / 100) * count) - 1;
    return sorted[Math.max(0, index)];
  };

  return {
    count,
    min: sorted[0],
    max: sorted[count - 1],
    mean: Math.round(mean * 100) / 100,
    median: sorted[Math.floor(count / 2)],
    p95: percentile(95),
    p99: percentile(99),
    stdDev: Math.round(stdDev * 100) / 100,
  };
}

// Welch's t-test for two independent samples
function welchTTest(sample1: number[], sample2: number[]): { tStatistic: number; pValue: number; degreesOfFreedom: number } {
  const n1 = sample1.length;
  const n2 = sample2.length;

  if (n1 < 2 || n2 < 2) {
    return { tStatistic: 0, pValue: 1, degreesOfFreedom: 0 };
  }

  const mean1 = sample1.reduce((a, b) => a + b, 0) / n1;
  const mean2 = sample2.reduce((a, b) => a + b, 0) / n2;

  const variance1 = sample1.reduce((acc, val) => acc + Math.pow(val - mean1, 2), 0) / (n1 - 1);
  const variance2 = sample2.reduce((acc, val) => acc + Math.pow(val - mean2, 2), 0) / (n2 - 1);

  const tStatistic = (mean1 - mean2) / Math.sqrt(variance1 / n1 + variance2 / n2);

  // Welch-Satterthwaite degrees of freedom
  const df = Math.pow(variance1 / n1 + variance2 / n2, 2) /
    (Math.pow(variance1 / n1, 2) / (n1 - 1) + Math.pow(variance2 / n2, 2) / (n2 - 1));

  // Approximate p-value using Student's t-distribution
  const pValue = 2 * (1 - studentTCDF(Math.abs(tStatistic), df));

  return { tStatistic, pValue, degreesOfFreedom: df };
}

// Approximate Student's t CDF using normal approximation for large df
function studentTCDF(t: number, df: number): number {
  if (df > 100) {
    // Use normal approximation for large df
    return normalCDF(t);
  }

  // For smaller df, use a simplified approximation
  const x = df / (df + t * t);
  const prob = 1 - 0.5 * incompleteBeta(df / 2, 0.5, x);
  return prob;
}

function normalCDF(x: number): number {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function erf(x: number): number {
  // Abramowitz and Stegun approximation
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return sign * y;
}

function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  return Math.pow(x, a) * Math.pow(1 - x, b);
}

// Calculate Cohen's d effect size
function cohensD(sample1: number[], sample2: number[]): number {
  const n1 = sample1.length;
  const n2 = sample2.length;

  const mean1 = sample1.reduce((a, b) => a + b, 0) / n1;
  const mean2 = sample2.reduce((a, b) => a + b, 0) / n2;

  const variance1 = sample1.reduce((acc, val) => acc + Math.pow(val - mean1, 2), 0) / (n1 - 1);
  const variance2 = sample2.reduce((acc, val) => acc + Math.pow(val - mean2, 2), 0) / (n2 - 1);

  const pooledSD = Math.sqrt(((n1 - 1) * variance1 + (n2 - 1) * variance2) / (n1 + n2 - 2));

  return (mean1 - mean2) / pooledSD;
}

export function analyzeResults(
  preflight: TransactionResult[],
  skip: TransactionResult[]
): any {
  const successfulPreflight = preflight.filter(r => r.success);
  const successfulSkip = skip.filter(r => r.success);

  const totalPreflight = successfulPreflight
    .map(r => r.totalDurationMs)
    .filter((d): d is number => d !== undefined);

  const totalSkip = successfulSkip
    .map(r => r.totalDurationMs)
    .filter((d): d is number => d !== undefined);

  const minLength = Math.min(successfulPreflight.length, successfulSkip.length);
  const totalLatencyDiff: number[] = [];
  const slotDiff: number[] = [];

  for (let i = 0; i < minLength; i++) {
    const preflightDuration = successfulPreflight[i].totalDurationMs;
    const skipDuration = successfulSkip[i].totalDurationMs;

    if (preflightDuration !== undefined && skipDuration !== undefined) {
      totalLatencyDiff.push(preflightDuration - skipDuration);
    }

    const preflightSlot = successfulPreflight[i].slot;
    const skipSlot = successfulSkip[i].slot;

    if (preflightSlot !== undefined && skipSlot !== undefined) {
      // Positive means skip landed later, negative means it landed earlier
      slotDiff.push(skipSlot - preflightSlot);
    }
  }

  let statisticalTest = null;
  if (totalPreflight.length >= 2 && totalSkip.length >= 2) {
    const tTest = welchTTest(totalPreflight, totalSkip);
    const effectSize = cohensD(totalPreflight, totalSkip);

    statisticalTest = {
      tStatistic: tTest.tStatistic,
      pValue: tTest.pValue,
      degreesOfFreedom: tTest.degreesOfFreedom,
      effectSize: effectSize,
      significant: tTest.pValue < 0.05,
    };
  }

  return {
    preflightResults: {
      successCount: successfulPreflight.length,
      failureCount: preflight.length - successfulPreflight.length,
      successRate: (successfulPreflight.length / preflight.length) * 100,
      totalStats: totalPreflight.length > 0 ? calculateStatistics(totalPreflight) : undefined,
    },
    skipResults: {
      successCount: successfulSkip.length,
      failureCount: skip.length - successfulSkip.length,
      successRate: (successfulSkip.length / skip.length) * 100,
      totalStats: totalSkip.length > 0 ? calculateStatistics(totalSkip) : undefined,
    },
    comparison: {
      latencyDifferenceMs: totalLatencyDiff.length > 0 ? calculateStatistics(totalLatencyDiff) : undefined,
      successRateDifference:
        (successfulPreflight.length / preflight.length) * 100 -
        (successfulSkip.length / skip.length) * 100,
      slotDifference: slotDiff.length > 0 ? calculateStatistics(slotDiff) : undefined,
      statisticalTest,
    },
  };
}

export function printSummary(summary: any, config: any): void {
  console.log('\n' + '='.repeat(80));
  console.log('SOLANA RPC LATENCY TEST RESULTS');
  console.log('='.repeat(80));
  console.log(`\nTest Configuration:`);
  console.log(`  RPC Endpoint: ${config.rpcEndpoint}`);
  console.log(`  Iterations: ${config.iterations}`);
  console.log(`  Amount: ${config.amountLamports} lamports`);
  console.log(`  Confirmation Level: ${config.confirmationLevel}`);
  console.log(`  Timestamp: ${summary.timestamp}`);

  console.log('\n' + '-'.repeat(80));
  console.log('PREFLIGHT');
  console.log('-'.repeat(80));
  const preflight = summary.preflightResults;
  console.log(`Success Rate: ${preflight.successRate.toFixed(2)}% (${preflight.successCount}/${preflight.successCount + preflight.failureCount})`);

  if (preflight.totalStats) {
    console.log(`\nTotal Duration (ms):`);
    printStats(preflight.totalStats);
  }

  console.log('\n' + '-'.repeat(80));
  console.log('SKIP');
  console.log('-'.repeat(80));
  const skip = summary.skipResults;
  console.log(`Success Rate: ${skip.successRate.toFixed(2)}% (${skip.successCount}/${skip.successCount + skip.failureCount})`);

  if (skip.totalStats) {
    console.log(`\nTotal Duration (ms):`);
    printStats(skip.totalStats);
  }

  console.log('\n' + '-'.repeat(80));
  console.log('COMPARISON & STATISTICAL ANALYSIS');
  console.log('-'.repeat(80));

  if (summary.comparison.latencyDifferenceMs) {
    console.log(`\nLatency Difference (preflight - skip, ms):`);
    printStats(summary.comparison.latencyDifferenceMs);
  }

  if (summary.comparison.slotDifference) {
    console.log(`\nSlot Difference (skip - preflight):`);
    printStats(summary.comparison.slotDifference);
    console.log(`  → Negative: skip landed earlier`);
    console.log(`  → Positive: skip landed later`);
    console.log(`  → Zero: both landed in same slot`);

    // Calculate expected latency from slot difference (Solana slots are ~400ms apart)
    const SLOT_TIME_MS = 400;
    const expectedLatencyFromSlots = {
      mean: summary.comparison.slotDifference.mean * SLOT_TIME_MS,
      median: summary.comparison.slotDifference.median * SLOT_TIME_MS,
      min: summary.comparison.slotDifference.min * SLOT_TIME_MS,
      max: summary.comparison.slotDifference.max * SLOT_TIME_MS,
    };

    console.log(`\nExpected Latency from Slot Differences (400ms/slot):`);
    console.log(`  Mean:   ${expectedLatencyFromSlots.mean.toFixed(2)} ms`);
    console.log(`  Median: ${expectedLatencyFromSlots.median.toFixed(2)} ms`);
    console.log(`  Min:    ${expectedLatencyFromSlots.min.toFixed(2)} ms`);
    console.log(`  Max:    ${expectedLatencyFromSlots.max.toFixed(2)} ms`);

    if (summary.comparison.latencyDifferenceMs) {
      const observedMean = summary.comparison.latencyDifferenceMs.mean;
      const expectedMean = expectedLatencyFromSlots.mean;
      const discrepancy = observedMean - expectedMean;
      console.log(`\nComparison:`);
      console.log(`  Observed latency difference (mean): ${observedMean.toFixed(2)} ms`);
      console.log(`  Expected from slots (mean):         ${expectedMean.toFixed(2)} ms`);
      console.log(`  Discrepancy:                        ${discrepancy > 0 ? '+' : ''}${discrepancy.toFixed(2)} ms`);
    }
  }

  console.log(`\nSuccess Rate Difference: ${summary.comparison.successRateDifference > 0 ? '+' : ''}${summary.comparison.successRateDifference.toFixed(2)}%`);

  if (summary.comparison.statisticalTest) {
    const test = summary.comparison.statisticalTest;
    console.log(`\nStatistical Significance Test (Welch's t-test):`);
    console.log(`  t-statistic:       ${test.tStatistic.toFixed(4)}`);
    console.log(`  p-value:           ${test.pValue.toFixed(6)}`);
    console.log(`  Degrees of freedom: ${test.degreesOfFreedom.toFixed(2)}`);
    console.log(`  Effect size (Cohen's d): ${test.effectSize.toFixed(4)}`);
    console.log(`  Statistically significant (α=0.05): ${test.significant ? 'YES' : 'NO'}`);

    if (test.significant) {
      const preflightMean = summary.preflightResults.totalStats?.mean || 0;
      const skipMean = summary.skipResults.totalStats?.mean || 0;
      const direction = preflightMean > skipMean ? 'SLOWER' : 'FASTER';
      console.log(`  \n  → Preflight checks make transactions ${direction} (p < 0.05)`);
    } else {
      console.log(`  \n  → No statistically significant difference detected`);
    }

    const absEffect = Math.abs(test.effectSize);
    let effectInterpretation = '';
    if (absEffect < 0.2) effectInterpretation = 'negligible';
    else if (absEffect < 0.5) effectInterpretation = 'small';
    else if (absEffect < 0.8) effectInterpretation = 'medium';
    else effectInterpretation = 'large';
    console.log(`  → Effect size is ${effectInterpretation}`);
  }

  console.log('\n' + '='.repeat(80));
}

function printStats(stats: Statistics): void {
  console.log(`  Count:  ${stats.count}`);
  console.log(`  Min:    ${stats.min.toFixed(2)}`);
  console.log(`  Max:    ${stats.max.toFixed(2)}`);
  console.log(`  Mean:   ${stats.mean.toFixed(2)}`);
  console.log(`  Median: ${stats.median.toFixed(2)}`);
  console.log(`  P95:    ${stats.p95.toFixed(2)}`);
  console.log(`  P99:    ${stats.p99.toFixed(2)}`);
  console.log(`  StdDev: ${stats.stdDev.toFixed(2)}`);
}
