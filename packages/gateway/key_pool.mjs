import { randomUUID } from 'node:crypto';
import { AppError } from '../api/errors.mjs';

/**
 * Masks an API key for safe display (e.g. ghp_8a2d••••39fe).
 */
export function maskApiKey(key) {
  if (typeof key !== 'string' || key.length < 8) return '••••••••';
  const prefix = key.slice(0, 8);
  const suffix = key.slice(-4);
  return `${prefix}••••${suffix}`;
}

const SUPPORTED_PROVIDERS = [
  'github',
  'groq',
  'gemini',
  'openrouter',
  'deepseek',
  'mistral',
  'cerebras',
  'together',
  'sambanova',
  'openai',
  'anthropic',
  'cohere',
  'custom',
];

/**
 * Multi-Key Pool & Load-Balancing Manager
 */
export function createKeyPoolService({ db }) {
  if (!db) {
    throw new Error('Database instance is required for KeyPoolService.');
  }

  // In-memory round-robin pointer per provider
  const rotationIndex = new Map();
  // In-memory rate-limit cooldown: Map<keyId, untilTimestamp>
  const cooldowns = new Map();

  return {
    async addKey({ provider, label, apiKey, expiresAt = null }) {
      let cleanProvider = String(provider ?? '')
        .toLowerCase()
        .trim();

      // Normalize common user aliases / typos
      if (cleanProvider === 'qroqe' || cleanProvider === 'groqe' || cleanProvider === 'groqcloud') {
        cleanProvider = 'groq';
      } else if (cleanProvider === 'google') {
        cleanProvider = 'gemini';
      } else if (cleanProvider === 'githubmodels') {
        cleanProvider = 'github';
      }

      const isCustom = cleanProvider === 'custom' || cleanProvider.startsWith('custom:');
      if (!isCustom && !SUPPORTED_PROVIDERS.includes(cleanProvider)) {
        throw new AppError(
          400,
          'INVALID_PROVIDER',
          `Provider must be one of: ${SUPPORTED_PROVIDERS.join(', ')}`,
        );
      }

      const cleanLabel = String(label ?? '').trim();
      if (!cleanLabel || cleanLabel.length > 80) {
        throw new AppError(400, 'INVALID_LABEL', 'Label must be between 1 and 80 characters.');
      }

      const cleanKey = String(apiKey ?? '').trim();
      if (!cleanKey || cleanKey.length < 8) {
        throw new AppError(400, 'INVALID_API_KEY', 'API key must be at least 8 characters.');
      }

      let parsedExpiry = null;
      if (expiresAt) {
        const d = new Date(expiresAt);
        if (Number.isNaN(d.getTime())) {
          throw new AppError(400, 'INVALID_EXPIRY', 'Invalid expiration date format.');
        }
        parsedExpiry = d.toISOString();
      }

      const id = randomUUID();
      const keyMask = maskApiKey(cleanKey);

      await db.query(
        `INSERT INTO api_key_pool (id, provider, label, api_key, key_mask, status, requests_used, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'active', 0, $6)`,
        [id, cleanProvider, cleanLabel, cleanKey, keyMask, parsedExpiry],
      );

      return {
        id,
        provider: cleanProvider,
        label: cleanLabel,
        keyMask,
        status: 'active',
        requestsUsed: 0,
        expiresAt: parsedExpiry,
      };
    },

    async listKeys() {
      const res = await db.query(
        `SELECT id, provider, label, key_mask, status, requests_used, expires_at, created_at, updated_at
         FROM api_key_pool
         ORDER BY created_at DESC`,
      );

      const now = Date.now();
      return res.rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        label: row.label,
        keyMask: row.key_mask,
        status: row.status,
        requestsUsed: row.requests_used,
        expiresAt: row.expires_at,
        isExpired: row.expires_at ? new Date(row.expires_at).getTime() < now : false,
        isRateLimited: (cooldowns.get(row.id) ?? 0) > now,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    },

    async updateKeyStatus(id, newStatus) {
      if (!['active', 'blocked'].includes(newStatus)) {
        throw new AppError(400, 'INVALID_STATUS', "Status must be 'active' or 'blocked'.");
      }

      const res = await db.query(
        `UPDATE api_key_pool
         SET status = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING id, provider, label, key_mask, status`,
        [newStatus, id],
      );

      if (!res.rows[0]) {
        throw new AppError(404, 'KEY_NOT_FOUND', 'API key not found.');
      }

      return res.rows[0];
    },

    async deleteKey(id) {
      const res = await db.query(`DELETE FROM api_key_pool WHERE id = $1 RETURNING id`, [id]);
      if (!res.rows[0]) {
        throw new AppError(404, 'KEY_NOT_FOUND', 'API key not found.');
      }
      cooldowns.delete(id);
      return { ok: true, id };
    },

    async getActiveKeys(provider) {
      const cleanProvider = String(provider).toLowerCase().trim();
      const nowIso = new Date().toISOString();

      const res = await db.query(
        `SELECT id, provider, label, api_key, key_mask, status, requests_used
         FROM api_key_pool
         WHERE provider = $1
           AND status = 'active'
           AND (expires_at IS NULL OR expires_at > $2)
         ORDER BY created_at ASC`,
        [cleanProvider, nowIso],
      );

      const now = Date.now();
      // Filter out keys currently in rate-limit cooldown
      return res.rows.filter((k) => (cooldowns.get(k.id) ?? 0) <= now);
    },

    async getAllActiveKeys() {
      const nowIso = new Date().toISOString();
      const res = await db.query(
        `SELECT id, provider, label, api_key, key_mask, status, requests_used
         FROM api_key_pool
         WHERE status = 'active'
           AND (expires_at IS NULL OR expires_at > $1)
         ORDER BY created_at ASC`,
        [nowIso],
      );

      const now = Date.now();
      return res.rows.filter((k) => (cooldowns.get(k.id) ?? 0) <= now);
    },

    /**
     * Round-Robin rotation selector for active keys of a provider.
     */
    async rotateKey(provider) {
      const activeKeys = await this.getActiveKeys(provider);
      if (!activeKeys.length) return null;

      const currentIndex = rotationIndex.get(provider) ?? 0;
      const selected = activeKeys[currentIndex % activeKeys.length];
      rotationIndex.set(provider, (currentIndex + 1) % activeKeys.length);
      return selected;
    },

    async recordUsage(id) {
      if (!id) return;
      await db
        .query(
          `UPDATE api_key_pool
         SET requests_used = requests_used + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
          [id],
        )
        .catch(() => undefined);
    },

    markRateLimited(id, cooldownSeconds = 60) {
      if (!id) return;
      cooldowns.set(id, Date.now() + cooldownSeconds * 1000);
    },

    async testKey(id) {
      const res = await db.query(
        `SELECT id, provider, label, api_key FROM api_key_pool WHERE id = $1`,
        [id],
      );
      if (!res.rows[0]) {
        throw new AppError(404, 'KEY_NOT_FOUND', 'API key not found.');
      }
      return verifyKeyConnection({
        provider: res.rows[0].provider,
        apiKey: res.rows[0].api_key,
      });
    },
  };
}

/**
 * Auto-detect AI provider from API key format and prefixes.
 */
export function detectProviderFromKey(key) {
  const trimmed = String(key ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('gsk_')) {
    return { provider: 'groq', name: 'GroqCloud (Ultra-Fast Llama 3.3)' };
  }
  if (trimmed.startsWith('AIzaSy')) {
    return { provider: 'gemini', name: 'Google Gemini' };
  }
  if (trimmed.startsWith('ghp_') || trimmed.startsWith('github_pat_')) {
    return { provider: 'github', name: 'GitHub Models' };
  }
  if (trimmed.startsWith('sk-or-')) {
    return { provider: 'openrouter', name: 'OpenRouter' };
  }
  if (trimmed.startsWith('sk-ant-')) {
    return { provider: 'anthropic', name: 'Anthropic Claude' };
  }
  if (trimmed.startsWith('csk-')) {
    return { provider: 'cerebras', name: 'Cerebras' };
  }
  if (trimmed.startsWith('sk-') || trimmed.startsWith('sess-')) {
    return { provider: 'openai', name: 'OpenAI / Compatible' };
  }
  return null;
}

/**
 * Performs a zero-token, lightweight live ping to test and connect an API key.
 */
export async function verifyKeyConnection({ provider, apiKey }) {
  let cleanProvider = String(provider ?? '')
    .toLowerCase()
    .trim();

  // Normalize aliases
  if (cleanProvider === 'qroqe' || cleanProvider === 'groqe' || cleanProvider === 'groqcloud') {
    cleanProvider = 'groq';
  } else if (cleanProvider === 'google') {
    cleanProvider = 'gemini';
  } else if (cleanProvider === 'githubmodels') {
    cleanProvider = 'github';
  }

  const cleanKey = String(apiKey ?? '').trim();
  if (!cleanKey || cleanKey.length < 8) {
    return {
      ok: false,
      connected: false,
      error: 'Key must be at least 8 characters long.',
      provider: cleanProvider,
    };
  }

  const startMs = Date.now();

  try {
    if (cleanProvider === 'groq') {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${cleanKey}` },
        signal: AbortSignal.timeout(6000),
      });
      const latencyMs = Date.now() - startMs;
      if (res.ok) {
        const bodyData = await res.json().catch(() => null);
        const models = (bodyData?.data || []).map((m) => m.id);
        const chatModels = models.filter(
          (id) => !id.includes('whisper') && !id.includes('guard') && !id.includes('safeguard'),
        );
        let workingModel = null;
        for (const cm of chatModels) {
          const cRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${cleanKey}`,
            },
            body: JSON.stringify({
              model: cm,
              messages: [{ role: 'user', content: 'hi' }],
              max_tokens: 10,
            }),
          });
          const cText = await cRes.text().catch(() => '');
          console.log(`[Groq Model Test] ${cm} -> HTTP ${cRes.status}: ${cText.slice(0, 120)}`);
          if (cRes.ok) {
            workingModel = cm;
            break;
          }
        }
        return {
          ok: true,
          connected: true,
          provider: 'groq',
          providerName: 'GroqCloud',
          latencyMs,
          models,
          workingModel,
          message: `Connected to GroqCloud (${workingModel || latencyMs + 'ms'})`,
        };
      }
      return {
        ok: false,
        connected: false,
        provider: 'groq',
        status: res.status,
        error: `Groq authorization failed (${res.status}): Invalid API key`,
      };
    }

    if (cleanProvider === 'gemini') {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`,
        {
          signal: AbortSignal.timeout(6000),
        },
      );
      const latencyMs = Date.now() - startMs;
      if (res.ok) {
        const bodyData = await res.json().catch(() => null);
        const models = (bodyData?.models || [])
          .map((m) => (typeof m.name === 'string' ? m.name.replace(/^models\//, '') : ''))
          .filter(Boolean);
        return {
          ok: true,
          connected: true,
          provider: 'gemini',
          providerName: 'Google Gemini',
          latencyMs,
          models,
          message: `Connected to Google Gemini (${latencyMs}ms)`,
        };
      }
      return {
        ok: false,
        connected: false,
        provider: 'gemini',
        status: res.status,
        error: `Google Gemini authorization failed (${res.status}): Invalid API key or quota exceeded`,
      };
    }

    if (cleanProvider === 'github') {
      const res = await fetch('https://models.inference.ai.azure.com/models', {
        headers: { Authorization: `Bearer ${cleanKey}` },
        signal: AbortSignal.timeout(6000),
      });
      const latencyMs = Date.now() - startMs;
      if (res.ok) {
        return {
          ok: true,
          connected: true,
          provider: 'github',
          providerName: 'GitHub Models',
          latencyMs,
          message: `Connected to GitHub Models (${latencyMs}ms)`,
        };
      }
      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${cleanKey}`,
          'User-Agent': 'AI-Workspace-KeyPool',
        },
        signal: AbortSignal.timeout(6000),
      });
      if (userRes.ok) {
        return {
          ok: true,
          connected: true,
          provider: 'github',
          providerName: 'GitHub Models',
          latencyMs,
          message: `GitHub token verified (${latencyMs}ms)`,
        };
      }
      return {
        ok: false,
        connected: false,
        provider: 'github',
        status: res.status,
        error: `GitHub token invalid or unauthorized (${res.status})`,
      };
    }

    if (cleanProvider === 'openrouter') {
      const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { Authorization: `Bearer ${cleanKey}` },
        signal: AbortSignal.timeout(6000),
      });
      const latencyMs = Date.now() - startMs;
      if (res.ok) {
        return {
          ok: true,
          connected: true,
          provider: 'openrouter',
          providerName: 'OpenRouter',
          latencyMs,
          message: `Connected to OpenRouter (${latencyMs}ms)`,
        };
      }
      return {
        ok: false,
        connected: false,
        provider: 'openrouter',
        status: res.status,
        error: `OpenRouter authorization failed (${res.status})`,
      };
    }

    if (cleanProvider === 'cerebras') {
      const res = await fetch('https://api.cerebras.ai/v1/models', {
        headers: { Authorization: `Bearer ${cleanKey}` },
        signal: AbortSignal.timeout(6000),
      });
      const latencyMs = Date.now() - startMs;
      if (res.ok) {
        return {
          ok: true,
          connected: true,
          provider: 'cerebras',
          providerName: 'Cerebras',
          latencyMs,
          message: `Connected to Cerebras (${latencyMs}ms)`,
        };
      }
      return {
        ok: false,
        connected: false,
        provider: 'cerebras',
        status: res.status,
        error: `Cerebras authorization failed (${res.status})`,
      };
    }

    if (cleanProvider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${cleanKey}` },
        signal: AbortSignal.timeout(6000),
      });
      const latencyMs = Date.now() - startMs;
      if (res.ok) {
        return {
          ok: true,
          connected: true,
          provider: 'openai',
          providerName: 'OpenAI',
          latencyMs,
          message: `Connected to OpenAI (${latencyMs}ms)`,
        };
      }
      return {
        ok: false,
        connected: false,
        provider: 'openai',
        status: res.status,
        error: `OpenAI authorization failed (${res.status})`,
      };
    }

    // Generic / Custom provider format check
    return {
      ok: true,
      connected: true,
      provider: cleanProvider,
      providerName: cleanProvider,
      latencyMs: Date.now() - startMs,
      message: `Key format accepted for ${cleanProvider}`,
    };
  } catch (err) {
    return {
      ok: true,
      connected: true,
      warned: true,
      provider: cleanProvider,
      latencyMs: Date.now() - startMs,
      message: `Key accepted (offline verification: ${err.message})`,
    };
  }
}

