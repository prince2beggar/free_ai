import { mkdir, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, migrateUp, SYNTHETIC_SEED } from '../../packages/db/index.mjs';
import { createApp } from '../../packages/api/server.mjs';
import { loadConfig } from '../../packages/api/config.mjs';
import { createRouterFixture, routerFixture, refreshRouterFairShare } from './router-fixture.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const webRoot = fileURLToPath(new URL('../../apps/web/dist/', import.meta.url));
/** Ephemeral by default; only the executable selects persistent fixture storage. */
export async function createRouterServer({
  db: suppliedDb,
  config: suppliedConfig,
  fixtureOptions = {},
} = {}) {
  const db = suppliedDb ?? (await createDatabase());
  let server;
  try {
    await migrateUp(db, { throughVersion: 6 });
    const fixture = await createRouterFixture(db, fixtureOptions);
    const config = suppliedConfig ?? (await loadConfig({}, { webRoot, port: 0 }));
    server = createApp({
      db,
      config,
      router: fixture.router,
      ledger: fixture.ledger,
      syntheticChatModelId: SYNTHETIC_SEED.model,
    });
    await server.ready;
    return {
      ...fixture,
      db,
      config,
      server,
      async close() {
        await server.shutdown();
        if (!suppliedDb) await db.close();
      },
    };
  } catch (error) {
    if (server) await server.shutdown();
    if (!suppliedDb) await db.close();
    throw error;
  }
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--serve'))
    throw new Error('Invalid Router launcher arguments.');
  const serve = args[0] === '--serve';
  let lock, db, app, timer;
  const lockPath = resolve(root, '.phase2-local/router-launcher.lock');
  async function close() {
    if (timer) clearInterval(timer);
    try {
      if (app) await app.close();
      if (db) {
        await db.close();
        db = undefined;
      }
    } finally {
      if (lock) {
        await lock.close();
        lock = undefined;
        await unlink(lockPath);
      }
    }
  }
  try {
    const dir = resolve(root, '.phase2-local/router-database');
    await mkdir(dir, { recursive: true });
    lock = await open(lockPath, 'wx');
    db = await createDatabase({ dataDir: dir });
    const config = await loadConfig({}, { webRoot, port: routerFixture.preview.port });
    app = await createRouterServer({ db, config });
    if (serve) {
      await new Promise((accept, reject) => {
        app.server.once('error', reject);
        app.server.listen(config.port, config.host, accept);
      });
      timer = setInterval(
        () =>
          app.router
            .sweep()
            .then(() => refreshRouterFairShare(app))
            .catch(() => {
              console.error('Synthetic Router maintenance failed; admission remains bounded.');
              app.server.close();
              process.exitCode = 1;
            }),
        routerFixture.preview.maintenanceIntervalMs,
      );
      console.log(
        JSON.stringify({
          status: 'LOCAL_PHASE2_ROUTER_READY',
          url: `http://${config.host}:${config.port}`,
          syntheticOnly: true,
          realProvidersEnabled: false,
          providerCredentialsRead: false,
          modelCallsMade: 0,
          staffWebRoutes: false,
          abuseStep: 'DEFERRED_TO_2_5',
        }),
      );
      process.once('SIGINT', () =>
        close().catch(() => {
          process.exitCode = 1;
        }),
      );
      process.once('SIGTERM', () =>
        close().catch(() => {
          process.exitCode = 1;
        }),
      );
    } else {
      console.log(
        JSON.stringify(
          {
            status: 'LOCAL_PHASE2_ROUTER_READY',
            syntheticOnly: true,
            models: (await app.router.available(SYNTHETIC_SEED.userA)).models,
            allowance: await app.governor.allowance(SYNTHETIC_SEED.userA),
            providerCredentialsRead: false,
            modelCallsMade: 0,
            realProvidersEnabled: false,
            staffWebRoutes: false,
          },
          null,
          2,
        ),
      );
      await close();
    }
  } catch {
    await close().catch(() => undefined);
    console.error(
      'Local synthetic Router setup failed. Check fixture, migrations or launcher lock.',
    );
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
