import { readFile } from 'node:fs/promises';

const numericBounds = {
  maxInputChars: [1, 10000],
  maxBodyBytes: [256, 65536],
  maxContextChars: [1, 100000],
  maxContextMessages: [1, 1000],
  maxOutputTokens: [1, 4096],
  dailyRequests: [1, 1000],
  dayOffsetMinutes: [-720, 840],
  userConcurrency: [1, 8],
  globalConcurrency: [1, 32],
  requestTimeoutMs: [50, 60000],
  bodyTimeoutMs: [50, 10000],
  headersTimeoutMs: [50, 10000],
  backgroundJobTimeoutMs: [50, 60000],
  sessionSeconds: [1, 86400],
  oauthStateSeconds: [1, 600],
  rateWindowMs: [50, 3600000],
  ipRequestsPerWindow: [1, 10000],
  userRequestsPerWindow: [1, 10000],
  endpointRequestsPerWindow: [1, 10000],
  rateBucketLimit: [1, 10000],
  maxConversations: [1, 1000],
  maxTitleChars: [1, 120],
  chunkChars: [1, 100],
  chunkDelayMs: [0, 1000],
  auditRetentionDays: [1, 365],
  usageRetentionDays: [1, 365],
  deletedAccountRetentionDays: [1, 365],
  retentionBatchLimit: [1, 1000],
  maxAuditEvents: [4, 100000],
  maxUsageEvents: [1, 100000],
};

export function validateConfig(config) {
  if (
    !config ||
    !['LOCAL_SYNTHETIC', 'LOCAL_GOOGLE'].includes(config.mode) ||
    config.host !== '127.0.0.1' ||
    config.googleEnabled !== (config.mode === 'LOCAL_GOOGLE') ||
    config.realProvidersEnabled !== false ||
    !Number.isInteger(config.port) ||
    config.port < 0 ||
    config.port > 65535 ||
    !config.localIdentities ||
    typeof config.legalVersion !== 'string' ||
    !config.legalVersion
  ) {
    throw new Error('Only a complete approved loopback configuration is allowed.');
  }
  if (config.googleEnabled) {
    const google = config.google;
    if (
      !google ||
      typeof google.clientId !== 'string' ||
      !/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(google.clientId) ||
      typeof google.clientSecret !== 'string' ||
      !google.clientSecret ||
      google.clientSecret.length > 4096 ||
      google.redirectUri !== `http://127.0.0.1:${config.port}/api/auth/google/callback`
    )
      throw new Error('Google sign-in requires an exact local client and callback configuration.');
  }
  if (Object.keys(config.limits ?? {}).length !== Object.keys(numericBounds).length)
    throw new Error('Unexpected limit configuration.');
  for (const [key, [minimum, maximum]] of Object.entries(numericBounds)) {
    const value = config.limits[key];
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
      throw new Error(`Invalid configured limit: ${key}.`);
  }
  if (
    config.limits.maxInputChars > config.limits.maxContextChars ||
    config.limits.userConcurrency > config.limits.globalConcurrency
  ) {
    throw new Error('Configured input/concurrency limits are inconsistent.');
  }
  if (
    !Object.values(config.localIdentities).every(
      (value) => typeof value === 'string' && /^[a-z0-9-]{1,80}$/.test(value),
    )
  ) {
    throw new Error('Invalid synthetic identity configuration.');
  }
  return config;
}

export async function loadConfig(env = process.env, overrides = {}) {
  if (
    (env.PHASE1_MODE && !['LOCAL_SYNTHETIC', 'LOCAL_GOOGLE'].includes(env.PHASE1_MODE)) ||
    (env.GOOGLE_AUTH_ENABLED &&
      env.GOOGLE_AUTH_ENABLED !== (env.PHASE1_MODE === 'LOCAL_GOOGLE' ? 'true' : 'false')) ||
    (env.REAL_PROVIDERS_ENABLED && env.REAL_PROVIDERS_ENABLED !== 'false')
  ) {
    throw new Error(
      'Real model routes remain disabled; Google requires complete local configuration.',
    );
  }
  const defaults = JSON.parse(await readFile(new URL('./defaults.json', import.meta.url), 'utf8'));
  const rawPort = env.PHASE1_PORT;
  if (rawPort !== undefined && !/^[0-9]{1,5}$/.test(rawPort))
    throw new Error('Invalid local port.');
  const config = {
    ...defaults,
    mode: env.PHASE1_MODE ?? defaults.mode,
    googleEnabled: env.PHASE1_MODE === 'LOCAL_GOOGLE',
    host: env.PHASE1_HOST ?? defaults.host,
    port: rawPort === undefined ? defaults.port : Number(rawPort),
    ...overrides,
    limits: { ...defaults.limits, ...overrides.limits },
  };
  if (config.googleEnabled && !config.google) {
    config.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_REDIRECT_URI,
    };
  }
  return validateConfig(config);
}
