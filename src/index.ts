import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { TestConfig, TransactionResult } from './types';
import { analyzeResults, printSummary } from './statistics';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_CONFIG: TestConfig = {
  rpcEndpoint: 'https://api.testnet.solana.com',
  iterations: 50,
  amountLamports: 1,
  confirmationLevel: 'confirmed',
};

async function sendAndTrackTransaction(
  connection: Connection,
  transaction: Transaction,
  payer: Keypair,
  skipPreflight: boolean,
  config: TestConfig,
  iteration: number
): Promise<TransactionResult> {
  const result: TransactionResult = {
    iteration,
    skipPreflight,
    submissionStartMs: 0,
    submissionEndMs: 0,
    submissionDurationMs: 0,
    success: false,
  };

  const startMs = Date.now();
  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [payer],
      {
        skipPreflight,
        commitment: config.confirmationLevel,
      }
    );

    const endMs = Date.now();

    result.submissionStartMs = startMs;
    result.submissionEndMs = endMs;
    result.submissionDurationMs = endMs - startMs;
    result.totalDurationMs = endMs - startMs;
    result.signature = signature;
    result.success = true;

    // Fetch slot number with retry
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const txStatus = await connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0,
        });
        if (txStatus?.slot) {
          result.slot = txStatus.slot;
          break;
        }
      } catch (error) {
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          console.log(`Confirmation error: ${error}`);
        }
        // If all retries fail, slot will remain undefined
      }
    }
  } catch (error) {
    console.log(`Transaction failed: ${error}`); // Log the error
  }

  return result;
}

async function runSimultaneousPair(
  connection1: Connection,
  connection2: Connection,
  payer1: Keypair,
  recipient1: Keypair,
  payer2: Keypair,
  recipient2: Keypair,
  config: TestConfig,
  iteration: number
): Promise<[TransactionResult, TransactionResult]> {
  // We add a variation to ensure that every transaction object differs
  // from previous sent transactions. otherwise, deduplication has been
  // observed, especially on transactions with skipPreflight=false.
  // This dedup fails a tx but also seems to impact the latency results
  // on subsequent transactions for some reason that we do not yet
  // understand.
  const preflightTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer1.publicKey,
      toPubkey: recipient1.publicKey,
      lamports: config.amountLamports + iteration,
    })
  );

  const skipTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer2.publicKey,
      toPubkey: recipient2.publicKey,
      lamports: config.amountLamports + iteration,
    })
  );

  // Send both transactions simultaneously with randomized order
  const preflightPromise = sendAndTrackTransaction(connection1, preflightTx, payer1, false, config, iteration);
  const skipPromise = sendAndTrackTransaction(connection2, skipTx, payer2, true, config, iteration);

  const randomOrder = Math.random() < 0.5;
  const [firstResult, secondResult] = await Promise.allSettled(
    randomOrder ? [preflightPromise, skipPromise] : [skipPromise, preflightPromise]
  );

  const [preflightResult, skipResult] = randomOrder
    ? [firstResult, secondResult]
    : [secondResult, firstResult];

  const resultPreflight: TransactionResult = preflightResult.status === 'fulfilled'
    ? preflightResult.value
    : {
        iteration,
        skipPreflight: false,
        submissionStartMs: 0,
        submissionEndMs: 0,
        submissionDurationMs: 0,
        success: false,
        error: preflightResult.reason instanceof Error ? preflightResult.reason.message : String(preflightResult.reason),
      };

  const resultSkip: TransactionResult = skipResult.status === 'fulfilled'
    ? skipResult.value
    : {
        iteration,
        skipPreflight: true,
        submissionStartMs: 0,
        submissionEndMs: 0,
        submissionDurationMs: 0,
        success: false,
        error: skipResult.reason instanceof Error ? skipResult.reason.message : String(skipResult.reason),
      };

  return [resultPreflight, resultSkip];
}

function loadOrCreateKeypair(filepath: string): Keypair {
  try {
    const keypairData = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    return Keypair.fromSecretKey(new Uint8Array(keypairData));
  } catch (error) {
    const keypair = Keypair.generate();
    fs.writeFileSync(filepath, JSON.stringify(Array.from(keypair.secretKey)));
    console.log(`Created new keypair at: ${filepath}`);
    return keypair;
  }
}

async function runTests(config: TestConfig): Promise<void> {
  console.log('Initializing Solana RPC Latency Test...');
  console.log(`RPC Endpoint: ${config.rpcEndpoint}`);
  console.log(`Iterations: ${config.iterations}`);

  const connection1 = new Connection(config.rpcEndpoint, 'confirmed');
  const connection2 = new Connection(config.rpcEndpoint, 'confirmed');

  const payer1KeypairPath = path.join(process.cwd(), 'payer1-keypair.json');
  const recipient1KeypairPath = path.join(process.cwd(), 'recipient1-keypair.json');
  const payer2KeypairPath = path.join(process.cwd(), 'payer2-keypair.json');
  const recipient2KeypairPath = path.join(process.cwd(), 'recipient2-keypair.json');

  const payer1 = loadOrCreateKeypair(payer1KeypairPath);
  const recipient1 = loadOrCreateKeypair(recipient1KeypairPath);
  const payer2 = loadOrCreateKeypair(payer2KeypairPath);
  const recipient2 = loadOrCreateKeypair(recipient2KeypairPath);

  console.log(`\nUsing Keypairs:`);
  console.log(`Payer 1 (Preflight): ${payer1.publicKey.toBase58()}`);
  console.log(`Recipient 1 (Preflight): ${recipient1.publicKey.toBase58()}`);
  console.log(`Payer 2 (Skip): ${payer2.publicKey.toBase58()}`);
  console.log(`Recipient 2 (Skip): ${recipient2.publicKey.toBase58()}`);

  let balance1 = await connection1.getBalance(payer1.publicKey);
  let balance2 = await connection.getBalance(payer2.publicKey);
  console.log(`\nPayer 1 balance: ${balance1 / LAMPORTS_PER_SOL} SOL`);
  console.log(`Payer 2 balance: ${balance2 / LAMPORTS_PER_SOL} SOL`);

  const requiredBalancePerPayer = config.amountLamports * config.iterations;

  // Request airdrops if needed
  if (balance1 < requiredBalancePerPayer) {
    console.log(`\nInsufficient balance for Payer 1. Requesting airdrop...`);
    try {
      const airdropSignature = await connection1.requestAirdrop(
        payer1.publicKey,
        LAMPORTS_PER_SOL * 1
      );
      console.log('Airdrop transaction signature:', airdropSignature);
      await connection1.confirmTransaction(airdropSignature);
      console.log('Airdrop successful!');

      balance1 = await connection1.getBalance(payer1.publicKey);
      console.log(`New Payer 1 balance: ${balance1 / LAMPORTS_PER_SOL} SOL`);
    } catch (error) {
      console.error('Airdrop failed. Please ensure you are connected to testnet.');
      console.error('You may need to fund the wallet manually or try again later.');
      throw error;
    }
  }

  if (balance2 < requiredBalancePerPayer) {
    console.log(`\nInsufficient balance for Payer 2. Requesting airdrop...`);
    try {
      const airdropSignature = await connection2.requestAirdrop(
        payer2.publicKey,
        LAMPORTS_PER_SOL * 1
      );
      console.log('Airdrop transaction signature:', airdropSignature);
      await connection2.confirmTransaction(airdropSignature);
      console.log('Airdrop successful!');

      balance2 = await connection2.getBalance(payer2.publicKey);
      console.log(`New Payer 2 balance: ${balance2 / LAMPORTS_PER_SOL} SOL`);
    } catch (error) {
      console.error('Airdrop failed. Please ensure you are connected to testnet.');
      console.error('You may need to fund the wallet manually or try again later.');
      throw error;
    }
  }

  if (balance1 < requiredBalancePerPayer || balance2 < requiredBalancePerPayer) {
    throw new Error(`Insufficient balance for test. Each payer needs at least ${requiredBalancePerPayer / LAMPORTS_PER_SOL} SOL.`);
  }

  const allResults: TransactionResult[] = [];

  console.log();
  console.log('='.repeat(80));
  console.log('Running simultaneous paired tests (preflight vs skip)...');
  console.log('='.repeat(80));

  for (let i = 0; i < config.iterations; i++) {
    process.stdout.write(`\rProgress: ${i + 1}/${config.iterations} pairs`);

    const [resultPreflight, resultSkip] = await runSimultaneousPair(
      connection1,
      connection2,
      payer1,
      recipient1,
      payer2,
      recipient2,
      config,
      i
    );
    allResults.push(resultPreflight, resultSkip);

    // Small delay between pairs
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  console.log(' - Complete!\n');

  const preflightResults = allResults.filter(r => !r.skipPreflight);
  const skipResults = allResults.filter(r => r.skipPreflight);

  const analysis = analyzeResults(preflightResults, skipResults);
  const summary = {
    testConfig: config,
    timestamp: new Date().toISOString(),
    ...analysis,
  };

  printSummary(summary, config);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsDir = path.join(process.cwd(), 'results');

  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const detailedResults = {
    summary,
    preflightResults,
    skipResults,
  };

  const jsonPath = path.join(resultsDir, `latency-test-${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(detailedResults, null, 2));
  console.log(`\nDetailed results saved to: ${jsonPath}`);

  const csvPath = path.join(resultsDir, `latency-test-${timestamp}.csv`);
  const csvContent = generateCSV(preflightResults, skipResults);
  fs.writeFileSync(csvPath, csvContent);
  console.log(`CSV results saved to: ${csvPath}`);
}

function generateCSV(
  preflight: TransactionResult[],
  skip: TransactionResult[]
): string {
  const headers = [
    'iteration',
    'skipPreflight',
    'success',
    'totalDurationMs',
    'signature',
    'error',
  ].join(',');

  const rows = [...preflight, ...skip].map(r => {
    return [
      r.iteration,
      r.skipPreflight,
      r.success,
      r.totalDurationMs || '',
      r.signature || '',
      r.error ? `"${r.error.replace(/"/g, '""')}"` : '',
    ].join(',');
  });

  return [headers, ...rows].join('\n');
}

function parseArgs(): Partial<TestConfig> {
  const args = process.argv.slice(2);
  const config: Partial<TestConfig> = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--endpoint':
      case '-e':
        config.rpcEndpoint = args[++i];
        break;
      case '--iterations':
      case '-i':
        config.iterations = parseInt(args[++i], 10);
        break;
      case '--amount':
      case '-a':
        config.amountLamports = parseInt(args[++i], 10);
        break;
      case '--confirmation':
      case '-c':
        config.confirmationLevel = args[++i] as 'processed' | 'confirmed' | 'finalized';
        break;
    }
  }

  return config;
}

async function main() {
  const customConfig = parseArgs();
  const config: TestConfig = { ...DEFAULT_CONFIG, ...customConfig };

  try {
    await runTests(config);
  } catch (error) {
    console.error('\nTest failed with error:', error);
    process.exit(1);
  }
}

main();
