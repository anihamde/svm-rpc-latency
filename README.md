# Solana RPC Latency Test Suite

A comprehensive test suite for measuring the latency and slot landing impact of preflight checks on Solana transactions.

## Overview

This tool sends paired transactions simultaneously (one with preflight, one without) to compare their confirmation times and landing slots. It provides detailed statistics on:

- **Total transaction duration** - Complete time from submission to confirmation using `sendAndConfirmTransaction`
- **Slot landing differences** - Which transaction lands first and by how many slots
- **Expected vs. observed latency** - Compares slot-based expected latency (400ms/slot) with observed timing
- **Statistical significance** - Welch's t-test and Cohen's d effect size analysis
- **Success rates** - Transaction success rates with/without preflight

## Installation

```bash
npm install
```

## Usage

### Basic Usage

Run tests with default configuration (50 iterations on Solana testnet):

```bash
npm run test
```

### Quick Test

Run a quick test with only 10 iterations:

```bash
npm run test:quick
```

### Custom Configuration

Run tests with custom parameters:

```bash
npm run build
node dist/index.js --iterations 100 --endpoint https://api.devnet.solana.com
```

### Command Line Options

- `--endpoint, -e` - RPC endpoint URL (default: https://api.testnet.solana.com)
- `--iterations, -i` - Number of paired test iterations (default: 50)
- `--amount, -a` - Transfer amount in lamports (default: 1)
- `--confirmation, -c` - Confirmation level: processed, confirmed, or finalized (default: confirmed)

### Examples

```bash
# Run 100 iterations on devnet
node dist/index.js --iterations 100 --endpoint https://api.devnet.solana.com

# Use finalized confirmation level
node dist/index.js --confirmation finalized

# Custom amount and iterations
node dist/index.js --amount 5000 --iterations 75
```

## How It Works

The test suite:

1. **Generates test wallets** - Creates payer and recipient keypairs
2. **Funds the payer** - Requests airdrop from testnet faucet
3. **Runs simultaneous pairs** - For each iteration, sends two transactions at the same time:
   - Transaction 1: `sendAndConfirmTransaction` with `skipPreflight: false`
   - Transaction 2: `sendAndConfirmTransaction` with `skipPreflight: true` (different amount to avoid deduplication)
4. **Tracks landing slots** - Records which slot each transaction landed in
5. **Analyzes results** - Calculates comprehensive statistics, slot differences, and statistical significance
6. **Exports data** - Saves detailed results in JSON and CSV formats

### What is Measured

For each transaction, the suite measures:

- **Total duration** - Complete time from calling `sendAndConfirmTransaction` until it returns (includes preflight if enabled, submission, and confirmation)
- **Landing slot** - Which slot the transaction was included in
- **Success/failure status**
- **Transaction signature**
- **Error messages** (if any)

For paired transactions, it calculates:

- **Slot difference** - How many slots apart the two transactions landed (negative = skip landed first)
- **Expected latency from slots** - Converts slot differences to time using 400ms per slot
- **Observed latency difference** - Actual time difference between preflight and skip transactions

### Statistics Calculated

For each metric, the following statistics are computed:

- **Count** - Number of successful transactions
- **Min** - Minimum duration
- **Max** - Maximum duration
- **Mean** - Average duration
- **Median** - 50th percentile
- **P95** - 95th percentile
- **P99** - 99th percentile
- **StdDev** - Standard deviation

## Output

### Console Output

The test suite prints a detailed summary to the console:

```
================================================================================
SOLANA RPC LATENCY TEST RESULTS
================================================================================

Test Configuration:
  RPC Endpoint: https://api.testnet.solana.com
  Iterations: 50
  Amount: 1 lamports
  Confirmation Level: confirmed
  Timestamp: 2025-10-02T...

--------------------------------------------------------------------------------
PREFLIGHT
--------------------------------------------------------------------------------
Success Rate: 98.00% (49/50)

Total Duration (ms):
  Count:  49
  Min:    1234.00
  Max:    3456.00
  Mean:   2100.00
  Median: 2050.00
  P95:    2800.00
  P99:    3200.00
  StdDev: 345.00

--------------------------------------------------------------------------------
SKIP
--------------------------------------------------------------------------------
Success Rate: 96.00% (48/50)

Total Duration (ms):
  Count:  48
  Min:    1150.00
  Max:    3200.00
  Mean:   2020.00
  Median: 1980.00
  P95:    2650.00
  P99:    3000.00
  StdDev: 320.00

--------------------------------------------------------------------------------
COMPARISON & STATISTICAL ANALYSIS
--------------------------------------------------------------------------------

Latency Difference (preflight - skip, ms):
  Count:  48
  Min:    10.00
  Max:    250.00
  Mean:   80.00
  Median: 70.00
  P95:    150.00
  P99:    200.00
  StdDev: 45.00

Slot Difference (skip - preflight):
  Count:  48
  Min:    -1.00
  Max:    2.00
  Mean:   0.50
  Median: 0.00
  P95:    1.00
  P99:    2.00
  StdDev: 0.75
  → Negative: skip landed earlier
  → Positive: skip landed later
  → Zero: both landed in same slot

Expected Latency from Slot Differences (400ms/slot):
  Mean:   200.00 ms
  Median: 0.00 ms
  Min:    -400.00 ms
  Max:    800.00 ms

Comparison:
  Observed latency difference (mean): 80.00 ms
  Expected from slots (mean):         200.00 ms
  Discrepancy:                        -120.00 ms

Success Rate Difference: +2.00%

Statistical Significance Test (Welch's t-test):
  t-statistic:       2.3456
  p-value:           0.023456
  Degrees of freedom: 94.56
  Effect size (Cohen's d): 0.4567
  Statistically significant (α=0.05): YES

  → Preflight checks make transactions SLOWER (p < 0.05)
  → Effect size is small
```

### File Outputs

Results are saved to the `results/` directory:

- **JSON file** - Complete test data including all individual transaction results
- **CSV file** - Tabular data for easy import into spreadsheet tools

Files are named with timestamps: `latency-test-2025-10-02T12-34-56-789Z.json`

## Understanding the Results

### Slot Differences

The slot difference shows which transaction landed first:

- **Negative values**: Skip transaction landed earlier (in an earlier slot)
- **Positive values**: Skip transaction landed later (preflight landed first)
- **Zero**: Both transactions landed in the same slot

Since Solana slots are ~400ms apart, slot differences give you a rough estimate of timing advantage.

### Expected vs. Observed Latency

The tool compares two measurements:

- **Expected latency from slots**: Slot difference × 400ms (theoretical minimum based on which slot each tx landed in)
- **Observed latency difference**: Actual wall-clock time difference measured by `sendAndConfirmTransaction`

**Discrepancy** shows the difference between these:
- **Negative discrepancy**: Observed difference is smaller than slot-based expectation (both txs confirmed in different calls to RPC)
- **Positive discrepancy**: Observed difference is larger than slot-based expectation (additional overhead beyond slot timing)

### Statistical Significance

**Welch's t-test** determines if the latency difference is statistically significant:
- **p-value < 0.05**: The difference is statistically significant (not due to random chance)
- **p-value ≥ 0.05**: No significant difference detected

**Cohen's d (effect size)** measures how meaningful the difference is:
- **< 0.2**: Negligible - difference exists but is practically meaningless
- **0.2-0.5**: Small - noticeable but minor difference
- **0.5-0.8**: Medium - substantial difference
- **≥ 0.8**: Large - very substantial difference

Example: A p-value of 0.001 with Cohen's d of 0.1 means "the difference is real but tiny and doesn't matter in practice."

### Success Rate Analysis

Compare success rates to understand the value of preflight checks:

- **Higher success rate with preflight**: Preflight catches invalid transactions before submission
- **Similar success rates**: Preflight may not provide significant value for simple transfers
- **Lower success rate with preflight**: May indicate network issues or overly strict preflight validation

### Latency Distribution

Pay attention to percentile metrics (P95, P99):

- High P99 values indicate occasional slow transactions
- Large standard deviation suggests inconsistent network performance
- Compare median vs. mean to identify skew in the distribution

## Requirements

- Node.js 16+
- TypeScript 5.3+
- Access to Solana testnet (or devnet/mainnet-beta)

## Network Requirements

The test suite requires:

- Active internet connection
- Access to Solana RPC endpoint
- Ability to receive testnet airdrops (for testnet/devnet)

**Note**: Testnet faucets may have rate limits. If airdrops fail, wait a few minutes and try again.

## Development

### Build

```bash
npm run build
```

### Clean

```bash
npm run clean
```

## Troubleshooting

### Airdrop Failures

If you encounter airdrop failures:

- Wait 5-10 minutes and try again (rate limits)
- Try switching to devnet: `--endpoint https://api.devnet.solana.com`
- Manually fund the test wallet (payer address is printed during setup)

### Transaction Failures

High failure rates may indicate:

- Network congestion
- RPC endpoint issues
- Insufficient funding (check balance output)

### Rate Limiting

Some RPC endpoints have rate limits. If you encounter 429 errors:

- Reduce iteration count: `--iterations 25`
- Use a paid RPC provider
- Add delays between transactions (modify code)
