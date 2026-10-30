import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { createDatabase, migrateUp, seedSynthetic } from '../../packages/db/index.mjs';
import { createApp } from '../../packages/api/server.mjs';
import { loadConfig } from '../../packages/api/config.mjs';
import { createFileService } from '../../packages/files/index.mjs';
import { createBackupService } from '../../packages/backup/index.mjs';
import { createAdmin } from '../../packages/admin/index.mjs';
import { createUniversalFreeGateway, createKeyPoolService } from '../../packages/gateway/index.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const webRoot = fileURLToPath(new URL('../../apps/web/dist/', import.meta.url));

export async function startPhase3WorkspaceServer({
  port = Number(process.env.PORT || 3000),
  host = '127.0.0.1',
  dataDir = resolve(root, '.phase3-local/db'),
  storageDir = resolve(root, '.phase3-local/files'),
  backupDir = resolve(root, '.phase3-local/backups'),
  autoOpenBrowser = true,
} = {}) {
  try {
    process.loadEnvFile?.(resolve(root, '.env'));
  } catch {
    // .env is optional
  }

  await mkdir(dataDir, { recursive: true });
  await mkdir(storageDir, { recursive: true });
  await mkdir(backupDir, { recursive: true });

  const db = await createDatabase({ dataDir });
  await migrateUp(db, { throughVersion: 11 });
  await seedSynthetic(db);

  // Initialize Super Admin Control Center staff & kill switches
  const admin = createAdmin(db);
  await admin.seedSystemRoles();
  const existingStaff = await admin.getStaffUser('synthetic-user-a');
  if (!existingStaff) {
    await admin.createStaffUser(null, {
      userId: 'synthetic-user-a',
      roleId: 'super_admin',
      totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    });
  }
  await admin.seedKillSwitches('synthetic-user-a');

  const files = createFileService({ db, storageDir });
  const backup = createBackupService({ db, storageBaseDir: storageDir, backupDir });
  const keyPool = createKeyPoolService({ db });

  const replies = JSON.parse(
    await readFile(new URL('../../packages/gateway/synthetic.json', import.meta.url), 'utf8'),
  );

  const gateway = createUniversalFreeGateway({
    providerId: 'synthetic-provider',
    modelId: 'synthetic-chat-v1',
    keyPoolService: keyPool,
    githubToken: process.env.GITHUB_TOKEN || process.env.GITHUB_MODELS_TOKEN,
    groqApiKey: process.env.GROQ_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
    replies,
  });

  let server;
  let actualPort = port;

  for (let offset = 0; offset <= 20; offset++) {
    const candidatePort = port + offset;
    const config = await loadConfig({}, { webRoot, port: candidatePort });
    const candidateServer = createApp({
      db,
      config,
      files,
      gateway,
      keyPool,
      admin,
      backup,
    });

    await candidateServer.ready;

    const listened = await new Promise((res) => {
      candidateServer.listen(candidatePort, host, () => res(true));
      candidateServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          res(false);
        }
      });
    });

    if (listened) {
      server = candidateServer;
      actualPort = candidatePort;
      break;
    }
  }

  if (!server) {
    throw new Error(`Could not bind to any port between ${port} and ${port + 20}`);
  }

  const url = `http://${host}:${actualPort}`;
  const localhostUrl = `http://localhost:${actualPort}`;

  const ghStatus =
    process.env.GITHUB_TOKEN || process.env.GITHUB_MODELS_TOKEN
      ? '🟢 Connected (GPT-4o-mini / Llama 3.3)'
      : '⚪ Ready (Add GITHUB_TOKEN to .env)';
  const groqStatus = process.env.GROQ_API_KEY
    ? '🟢 Connected (Llama 3.3 70B)'
    : '⚪ Ready (Add GROQ_API_KEY to .env)';
  const geminiStatus = process.env.GEMINI_API_KEY
    ? '🟢 Connected (Gemini 1.5/2.0)'
    : '⚪ Ready (Add GEMINI_API_KEY to .env)';

  console.log(`\n===============================================================`);
  console.log(`  AI Workspace — Universal Free AI Engine Pool (Ready)`);
  console.log(`  Loopback URL:  ${url}`);
  console.log(`  Localhost URL: ${localhostUrl}`);
  console.log(`  Zero-Cost AI Engines:`);
  console.log(`    • GitHub Models: ${ghStatus}`);
  console.log(`    • GroqCloud:     ${groqStatus}`);
  console.log(`    • Google Gemini: ${geminiStatus}`);
  console.log(`  Capabilities:`);
  console.log(`    - General Q&A (All topics)`);
  console.log(`    - AI Presentation Deck Generator`);
  console.log(`    - CV & Resume Builder`);
  console.log(`    - Email & Proposal Generator`);
  console.log(`    - CSV Data Analysis & Document Q&A`);
  console.log(`===============================================================\n`);

  if (autoOpenBrowser && process.platform === 'win32') {
    try {
      exec(`start ${url}`);
    } catch {
      // Ignore browser launch failure
    }
  }

  return {
    server,
    db,
    url,
    localhostUrl,
    async close() {
      await server.shutdown();
      await db.close();
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const instance = await startPhase3WorkspaceServer();
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, async () => {
        console.log('\nShutting down AI Workspace...');
        await instance.close();
        process.exit(0);
      });
    }
  } catch (err) {
    console.error('Failed to start AI Workspace:', err);
    process.exit(1);
  }
}
