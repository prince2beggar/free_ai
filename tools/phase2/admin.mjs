import { mkdir, open, readFile, readdir, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, migrateUp, SYNTHETIC_SEED } from '../../packages/db/index.mjs';
import { createAbuse } from '../../packages/abuse/index.mjs';
import { createAdmin } from '../../packages/admin/index.mjs';
import { createApp } from '../../packages/api/server.mjs';
import { loadConfig } from '../../packages/api/config.mjs';
import { createRouterFixture, refreshRouterFairShare } from './router-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const webRoot = fileURLToPath(new URL('../../apps/web/dist/', import.meta.url));
const defaults = JSON.parse(
  await readFile(new URL('./admin-defaults.json', import.meta.url), 'utf8'),
);

export const DEFAULT_ADMIN_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

/** Ephemeral unless the executable selects its own locked synthetic directory. */
export async function createAdminServer({
  db: suppliedDb,
  config: suppliedConfig,
  fixtureOptions = {},
  deviceKey: suppliedKey,
} = {}) {
  const db = suppliedDb ?? (await createDatabase());
  let server;
  try {
    await migrateUp(db, { throughVersion: 9 });
    const {
      clock = Date.now,
      abuseOptions = {},
      adminOptions = {},
      ...routerOptions
    } = fixtureOptions;
    if (
      typeof clock !== 'function' ||
      !abuseOptions ||
      typeof abuseOptions !== 'object' ||
      Array.isArray(abuseOptions) ||
      Object.hasOwn(abuseOptions, 'key') ||
      Object.hasOwn(abuseOptions, 'clock')
    )
      throw new Error('Invalid trusted synthetic admin fixture options.');
    const key = suppliedKey === undefined ? randomBytes(32) : Buffer.from(suppliedKey);
    if (key.length !== 32) throw new Error('Invalid local admin device key.');
    const abuse = createAbuse(db, { ...abuseOptions, key, clock });
    const admin = createAdmin(db, { ...adminOptions, clock });

    await admin.seedSystemRoles();

    await db.query(
      `INSERT INTO users (id, identity_provider, provider_subject, display_name)
       VALUES ($1, 'synthetic', 'subA', 'Admin Alpha'), ($2, 'synthetic', 'subB', 'Auditor Beta')
       ON CONFLICT DO NOTHING`,
      [SYNTHETIC_SEED.userA, SYNTHETIC_SEED.userB],
    );

    // Seed super admin staff account if not already present
    const existingStaff = await admin.getStaffUser(SYNTHETIC_SEED.userA);
    if (!existingStaff) {
      await admin.createStaffUser(null, {
        userId: SYNTHETIC_SEED.userA,
        roleId: 'super_admin',
        totpSecret: DEFAULT_ADMIN_TOTP_SECRET,
      });
    }
    await admin.seedKillSwitches(SYNTHETIC_SEED.userA);

    // One lock order for API admission and every funded Router attempt.
    const guardedDb = {
      ...db,
      transaction: (body) => abuse.withTransaction(body),
    };
    const fixture = await createRouterFixture(guardedDb, {
      ...routerOptions,
      clock,
      routerOptions: {
        ...routerOptions.routerOptions,
        admissionGuard: (tx, data) => abuse.assertAttemptInTransaction(tx, data),
      },
    });
    const config = suppliedConfig ?? (await loadConfig({}, { webRoot, port: 0 }));
    server = createApp({
      db: guardedDb,
      config,
      router: fixture.router,
      ledger: fixture.ledger,
      abuse,
      abuseDeviceKey: key,
      abuseDeviceCookieSeconds: defaults.deviceCookieSeconds,
      admin,
      syntheticChatModelId: SYNTHETIC_SEED.model,
    });
    await server.ready;
    return {
      ...fixture,
      db: guardedDb,
      config,
      server,
      abuse,
      admin,
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

async function localKey(dir, path) {
  try {
    const key = await readFile(path);
    if (key.length !== 32) throw new Error('Invalid local admin key.');
    return key;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if ((await readdir(dir)).length)
      throw new Error('An existing admin database requires its original local key.');
    const key = randomBytes(32);
    const file = await open(path, 'wx', 0o600);
    try {
      await file.writeFile(key);
    } finally {
      await file.close();
    }
    return key;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--serve'))
    throw new Error('Invalid admin launcher arguments.');
  const serve = args[0] === '--serve';
  const dir = resolve(root, '.phase2-local/admin-database');
  const lockPath = resolve(root, '.phase2-local/admin-launcher.lock');
  const keyPath = resolve(root, '.phase2-local/admin-hmac.key');
  let lock, db, app, timer;
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
    await mkdir(dir, { recursive: true });
    lock = await open(lockPath, 'wx');
    const key = await localKey(dir, keyPath);
    db = await createDatabase({ dataDir: dir });
    const config = await loadConfig({}, { webRoot, port: defaults.port });
    app = await createAdminServer({ db, config, deviceKey: key });
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
              console.error('Local synthetic admin maintenance failed.');
              app.server.close();
              process.exitCode = 1;
            }),
        defaults.maintenanceIntervalMs,
      );
      console.log(
        JSON.stringify({
          status: 'LOCAL_PHASE2_ADMIN_READY',
          url: `http://${config.host}:${config.port}`,
          adminUrl: `http://${config.host}:${config.port}/admin`,
          syntheticOnly: true,
          realProvidersEnabled: false,
          providerCredentialsRead: false,
          modelCallsMade: 0,
          staffWebRoutes: true,
          mfaEnforced: true,
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
            status: 'LOCAL_PHASE2_ADMIN_READY',
            syntheticOnly: true,
            superAdminSeeded: true,
            providerCredentialsRead: false,
            modelCallsMade: 0,
            realProvidersEnabled: false,
            staffWebRoutes: true,
            mfaEnforced: true,
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
      'Local synthetic admin setup failed. Check fixture, original key, migrations or launcher lock.',
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
