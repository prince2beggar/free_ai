import { mkdir, readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createDatabase,
  migrateUp,
  seedSynthetic,
  runRetention,
} from '../../packages/db/index.mjs';
import { createApp } from '../../packages/api/server.mjs';
import { loadConfig } from '../../packages/api/config.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const webRoot = fileURLToPath(new URL('../../apps/web/dist/', import.meta.url));
const settings = JSON.parse(await readFile(new URL('./settings.json', import.meta.url), 'utf8'));
if (
  !Number.isSafeInteger(settings.maintenanceIntervalMs) ||
  settings.maintenanceIntervalMs < 1000 ||
  settings.maintenanceIntervalMs > 3600000
)
  throw new Error('Invalid local maintenance interval.');

/** Tests default to memory. The executable launcher alone selects the ignored local data dir. */
export async function createPhase1Server({
  db: suppliedDb,
  config: suppliedConfig,
  gateway,
  googleTransport,
  logger,
  dataDir,
} = {}) {
  const db = suppliedDb ?? (await createDatabase({ dataDir }));
  let server;
  try {
    await migrateUp(db);
    await seedSynthetic(db);
    const config = suppliedConfig ?? (await loadConfig({}, { webRoot }));
    server = createApp({
      db,
      config: { ...config, webRoot: config.webRoot ?? webRoot },
      gateway,
      googleTransport,
      logger,
    });
    await server.ready;
    let pending;
    let closed = false;
    const maintenance = () => {
      if (closed) return Promise.reject(new Error('Local staging is closed.'));
      if (pending) return pending;
      pending = runRetention(db, {
        auditRetentionDays: config.limits.auditRetentionDays,
        usageRetentionDays: config.limits.usageRetentionDays,
        deletedAccountRetentionDays: config.limits.deletedAccountRetentionDays,
        batchLimit: config.limits.retentionBatchLimit,
        timeoutMs: Math.min(config.limits.backgroundJobTimeoutMs, 30000),
      }).finally(() => {
        pending = undefined;
      });
      return pending;
    };
    await maintenance();
    const timer = setInterval(() => {
      void maintenance().catch(() =>
        console.error('Local session cleanup failed; evidence retention remains deferred.'),
      );
    }, settings.maintenanceIntervalMs);
    timer.unref();
    return {
      server,
      db,
      maintenance,
      async close() {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        await server.shutdown();
        if (pending) await pending;
        if (!suppliedDb) await db.close();
      },
    };
  } catch (error) {
    if (server) await server.shutdown();
    if (!suppliedDb) await db.close();
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  let app;
  try {
    const config = await loadConfig(
      {
        PHASE1_HOST: process.env.PHASE1_HOST,
        PHASE1_PORT: process.env.PHASE1_PORT,
        PHASE1_MODE: process.env.PHASE1_MODE,
        GOOGLE_AUTH_ENABLED: process.env.GOOGLE_AUTH_ENABLED,
        REAL_PROVIDERS_ENABLED: process.env.REAL_PROVIDERS_ENABLED,
        ...(process.env.PHASE1_MODE === 'LOCAL_GOOGLE'
          ? {
              GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
              GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
              GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
            }
          : {}),
      },
      { webRoot },
    );
    if (config.port === 0) throw new Error('Choose a nonzero local staging port.');
    const dataDir = resolve(
      repo,
      config.googleEnabled ? '.phase1-integration/database' : settings.localDataDirectory,
    );
    const localPath = relative(repo, dataDir);
    const allowedDirectory = config.googleEnabled ? '.phase1-integration' : '.phase1-local';
    if (
      !localPath.startsWith(`${allowedDirectory}/`) &&
      !localPath.startsWith(`${allowedDirectory}\\`)
    )
      throw new Error('Local data must stay under .phase1-local.');
    if (isAbsolute(localPath) || localPath.startsWith('..'))
      throw new Error('Invalid local data boundary.');
    await mkdir(dataDir, { recursive: true });
    app = await createPhase1Server({
      config,
      dataDir,
      logger: (record) => console.log(JSON.stringify(record)),
    });
    app.server.on('error', () => {
      console.error('Local staging could not listen. Check the configured port.');
      void app.close().finally(() => {
        process.exitCode = 1;
      });
    });
    app.server.listen(config.port, config.host, () =>
      console.log(`Phase 1 ${config.mode} staging: http://${config.host}:${config.port}`),
    );
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, () => {
        void app.close().catch(() => {
          console.error('Local shutdown failed.');
          process.exitCode = 1;
        });
      });
  } catch {
    if (app) await app.close();
    console.error('Local staging startup failed. Check configuration and migrations.');
    process.exitCode = 1;
  }
}
