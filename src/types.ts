export interface TestConfig {
  rpcEndpoint: string;
  iterations: number;
  amountLamports: number;
  confirmationLevel: 'processed' | 'confirmed' | 'finalized';
}

export interface TransactionResult {
  iteration: number;
  skipPreflight: boolean;
  preflightStartMs?: number;
  preflightEndMs?: number;
  preflightDurationMs?: number;
  submissionStartMs: number;
  submissionEndMs: number;
  submissionDurationMs: number;
  confirmationStartMs?: number;
  confirmationEndMs?: number;
  confirmationDurationMs?: number;
  totalDurationMs?: number;
  success: boolean;
  signature?: string;
  slot?: number;
  error?: string;
}

export interface Statistics {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p25: number;
  p75: number;
  p95: number;
  p99: number;
  stdDev: number;
}

export interface TestSummary {
  testConfig: TestConfig;
  timestamp: string;
  preflightResults: {
    successCount: number;
    failureCount: number;
    successRate: number;
    preflightStats?: Statistics;
    submissionStats: Statistics;
    confirmationStats?: Statistics;
    totalStats?: Statistics;
  };
  skipResults: {
    successCount: number;
    failureCount: number;
    successRate: number;
    submissionStats: Statistics;
    confirmationStats?: Statistics;
    totalStats?: Statistics;
  };
  comparison: {
    preflightOverheadMs?: Statistics;
    totalLatencyDifferenceMs?: Statistics;
    successRateDifference: number;
    slotDifference?: Statistics;
  };
}
