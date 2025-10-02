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

  // Calculate standard deviation
  const squaredDiffs = sorted.map(val => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / count;
  const stdDev = Math.sqrt(variance);

  // Percentile calculation
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
  // Simplified approximation for our use case
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use a simple approximation
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
  withPreflight: TransactionResult[],
  withoutPreflight: TransactionResult[]
): any {
  // Filter successful transactions
  const successfulWithPreflight = withPreflight.filter(r => r.success);
  const successfulWithoutPreflight = withoutPreflight.filter(r => r.success);

  // Extract total durations
  const totalWithPreflight = successfulWithPreflight
    .map(r => r.totalDurationMs)
    .filter((d): d is number => d !== undefined);

  const totalWithoutPreflight = successfulWithoutPreflight
    .map(r => r.totalDurationMs)
    .filter((d): d is number => d !== undefined);

  // Calculate latency difference (with preflight - without preflight)
  const minLength = Math.min(successfulWithPreflight.length, successfulWithoutPreflight.length);
  const totalLatencyDiff: number[] = [];

  for (let i = 0; i < minLength; i++) {
    const withPreflightDuration = successfulWithPreflight[i].totalDurationMs;
    const withoutPreflightDuration = successfulWithoutPreflight[i].totalDurationMs;

    if (withPreflightDuration !== undefined && withoutPreflightDuration !== undefined) {
      totalLatencyDiff.push(withPreflightDuration - withoutPreflightDuration);
    }
  }

  // Perform statistical significance test
  let statisticalTest = null;
  if (totalWithPreflight.length >= 2 && totalWithoutPreflight.length >= 2) {
    const tTest = welchTTest(totalWithPreflight, totalWithoutPreflight);
    const effectSize = cohensD(totalWithPreflight, totalWithoutPreflight);

    statisticalTest = {
      tStatistic: tTest.tStatistic,
      pValue: tTest.pValue,
      degreesOfFreedom: tTest.degreesOfFreedom,
      effectSize: effectSize,
      significant: tTest.pValue < 0.05,
    };
  }

  return {
    withPreflightResults: {
      successCount: successfulWithPreflight.length,
      failureCount: withPreflight.length - successfulWithPreflight.length,
      successRate: (successfulWithPreflight.length / withPreflight.length) * 100,
      totalStats: totalWithPreflight.length > 0 ? calculateStatistics(totalWithPreflight) : undefined,
    },
    withoutPreflightResults: {
      successCount: successfulWithoutPreflight.length,
      failureCount: withoutPreflight.length - successfulWithoutPreflight.length,
      successRate: (successfulWithoutPreflight.length / withoutPreflight.length) * 100,
      totalStats: totalWithoutPreflight.length > 0 ? calculateStatistics(totalWithoutPreflight) : undefined,
    },
    comparison: {
      latencyDifferenceMs: totalLatencyDiff.length > 0 ? calculateStatistics(totalLatencyDiff) : undefined,
      successRateDifference:
        (successfulWithPreflight.length / withPreflight.length) * 100 -
        (successfulWithoutPreflight.length / withoutPreflight.length) * 100,
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
  console.log('WITH PREFLIGHT CHECKS');
  console.log('-'.repeat(80));
  const withPreflight = summary.withPreflightResults;
  console.log(`Success Rate: ${withPreflight.successRate.toFixed(2)}% (${withPreflight.successCount}/${withPreflight.successCount + withPreflight.failureCount})`);

  if (withPreflight.totalStats) {
    console.log(`\nTotal Duration (ms):`);
    printStats(withPreflight.totalStats);
  }

  console.log('\n' + '-'.repeat(80));
  console.log('WITHOUT PREFLIGHT CHECKS (skipPreflight: true)');
  console.log('-'.repeat(80));
  const withoutPreflight = summary.withoutPreflightResults;
  console.log(`Success Rate: ${withoutPreflight.successRate.toFixed(2)}% (${withoutPreflight.successCount}/${withoutPreflight.successCount + withoutPreflight.failureCount})`);

  if (withoutPreflight.totalStats) {
    console.log(`\nTotal Duration (ms):`);
    printStats(withoutPreflight.totalStats);
  }

  console.log('\n' + '-'.repeat(80));
  console.log('COMPARISON & STATISTICAL ANALYSIS');
  console.log('-'.repeat(80));

  if (summary.comparison.latencyDifferenceMs) {
    console.log(`\nLatency Difference (with preflight - without preflight, ms):`);
    printStats(summary.comparison.latencyDifferenceMs);
  }

  console.log(`\nSuccess Rate Difference: ${summary.comparison.successRateDifference > 0 ? '+' : ''}${summary.comparison.successRateDifference.toFixed(2)}%`);

  // Print statistical significance test results
  if (summary.comparison.statisticalTest) {
    const test = summary.comparison.statisticalTest;
    console.log(`\nStatistical Significance Test (Welch's t-test):`);
    console.log(`  t-statistic:       ${test.tStatistic.toFixed(4)}`);
    console.log(`  p-value:           ${test.pValue.toFixed(6)}`);
    console.log(`  Degrees of freedom: ${test.degreesOfFreedom.toFixed(2)}`);
    console.log(`  Effect size (Cohen's d): ${test.effectSize.toFixed(4)}`);
    console.log(`  Statistically significant (α=0.05): ${test.significant ? 'YES' : 'NO'}`);

    if (test.significant) {
      const withMean = summary.withPreflightResults.totalStats?.mean || 0;
      const withoutMean = summary.withoutPreflightResults.totalStats?.mean || 0;
      const direction = withMean > withoutMean ? 'SLOWER' : 'FASTER';
      console.log(`  \n  → Preflight checks make transactions ${direction} (p < 0.05)`);
    } else {
      console.log(`  \n  → No statistically significant difference detected`);
    }

    // Effect size interpretation
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
