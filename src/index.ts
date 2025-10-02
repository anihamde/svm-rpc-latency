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
      }
      // If all retries fail, slot will remain undefined
    }
  }

  return result;
}

async function runSimultaneousPair(
  connection: Connection,
  payer: Keypair,
  recipient: Keypair,
  config: TestConfig,
  iteration: number
): Promise<[TransactionResult, TransactionResult]> {
  // Create two different transactions (different amounts to avoid sending the same tx twice and subsequent deduplication)
  const preflightTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient.publicKey,
      lamports: config.amountLamports,
    })
  );

  const skipTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient.publicKey,
      lamports: config.amountLamports + 1,
    })
  );

  // Send both transactions simultaneously
  const [preflightResult, skipResult] = await Promise.allSettled([
    sendAndTrackTransaction(connection, preflightTx, payer, false, config, iteration),
    sendAndTrackTransaction(connection, skipTx, payer, true, config, iteration),
  ]);

  const result1: TransactionResult = preflightResult.status === 'fulfilled'
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

  const result2: TransactionResult = skipResult.status === 'fulfilled'
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

  return [result1, result2];
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

  const connection = new Connection(config.rpcEndpoint, 'confirmed');

  const payerKeypairPath = path.join(process.cwd(), 'payer-keypair.json');
  const recipientKeypairPath = path.join(process.cwd(), 'recipient-keypair.json');

  const payer = loadOrCreateKeypair(payerKeypairPath);
  const recipient = loadOrCreateKeypair(recipientKeypairPath);

  console.log(`\nUsing Keypairs:`);
  console.log(`Payer: ${payer.publicKey.toBase58()}`);
  console.log(`Recipient: ${recipient.publicKey.toBase58()}`);

  let balance = await connection.getBalance(payer.publicKey);
  console.log(`\nPayer balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  const requiredBalance = config.amountLamports * config.iterations * 2;
  if (balance < requiredBalance) {
    console.log(`\nInsufficient balance. Requesting airdrop...`);
    try {
      const airdropSignature = await connection.requestAirdrop(
        payer.publicKey,
        LAMPORTS_PER_SOL * 1
      );
      console.log('Airdrop transaction signature:', airdropSignature);
      await connection.confirmTransaction(airdropSignature);
      console.log('Airdrop successful!');

      balance = await connection.getBalance(payer.publicKey);
      console.log(`New balance: ${balance / LAMPORTS_PER_SOL} SOL`);
    } catch (error) {
      console.error('Airdrop failed. Please ensure you are connected to testnet.');
      console.error('You may need to fund the wallet manually or try again later.');
      throw error;
    }
  }

  if (balance < requiredBalance) {
    throw new Error(`Insufficient balance for test. Need at least ${requiredBalance / LAMPORTS_PER_SOL} SOL.`);
  }

  const allResults: TransactionResult[] = [];

  console.log();
  console.log('='.repeat(80));
  console.log('Running simultaneous paired tests (preflight vs skip)...');
  console.log('='.repeat(80));

  for (let i = 0; i < config.iterations; i++) {
    process.stdout.write(`\rProgress: ${i + 1}/${config.iterations} pairs`);

    const [result1, result2] = await runSimultaneousPair(
      connection,
      payer,
      recipient,
      config,
      i
    );
    allResults.push(result1, result2);

    // Small delay between pairs
    await new Promise(resolve => setTimeout(resolve, 100));
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
