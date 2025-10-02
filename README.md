# Solana RPC Latency Test Suite

A comprehensive test suite for measuring the latency impact of preflight confirmation on Solana transactions.

## Overview

This tool measures and compares transaction latency on Solana with and without preflight checks enabled using `sendAndConfirmTransaction`. It provides detailed statistics on:

- **Total transaction duration** - Complete time from submission to confirmation using `sendAndConfirmTransaction`
- **Latency comparison** - Statistical comparison between preflight enabled/disabled
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
- `--iterations, -i` - Number of test iterations (default: 50)
- `--amount, -a` - Transfer amount in lamports (default: 1000)
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
3. **Runs with preflight** - Executes N transactions using `sendAndConfirmTransaction` with `skipPreflight: false`
4. **Runs without preflight** - Executes N transactions using `sendAndConfirmTransaction` with `skipPreflight: true`
5. **Analyzes results** - Calculates comprehensive statistics and comparisons
6. **Exports data** - Saves detailed results in JSON and CSV formats

### What is Measured

For each transaction, the suite measures:

- **Total duration** - Complete time from calling `sendAndConfirmTransaction` until it returns (includes preflight if enabled, submission, and confirmation)
- **Success/failure status**
- **Transaction signature**
- **Error messages** (if any)

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
  Amount: 1000 lamports
  Confirmation Level: confirmed
  Timestamp: 2025-10-02T...

--------------------------------------------------------------------------------
WITH PREFLIGHT CHECKS
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
WITHOUT PREFLIGHT CHECKS (skipPreflight: true)
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
COMPARISON
--------------------------------------------------------------------------------

Latency Difference (with preflight - without preflight, ms):
  Count:  48
  Min:    10.00
  Max:    250.00
  Mean:   80.00
  Median: 70.00
  P95:    150.00
  P99:    200.00
  StdDev: 45.00

Success Rate Difference: +2.00%
```

### File Outputs

Results are saved to the `results/` directory:

- **JSON file** - Complete test data including all individual transaction results
- **CSV file** - Tabular data for easy import into spreadsheet tools

Files are named with timestamps: `latency-test-2025-10-02T12-34-56-789Z.json`

## Understanding the Results

### Latency Difference

The latency difference shows the overhead added by preflight checks. This includes:

- Transaction simulation on the RPC node
- Network round-trip time for the simulation request
- Additional validation performed during simulation

A positive mean difference indicates that preflight checks add latency on average.

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

## License

MIT
