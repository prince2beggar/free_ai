// Super Admin Control Center Client Logic

interface StaffUser {
  id: string;
  role: string;
  mfaVerified: boolean;
}

interface KeyItem {
  id: string;
  provider: string;
  label: string;
  keyMask: string;
  status: 'active' | 'blocked';
  requestsUsed: number;
  expiresAt: string | null;
  isExpired: boolean;
  isRateLimited: boolean;
}

interface KillSwitch {
  id: string;
  enabled: boolean;
  reason: string;
  updatedBy: string;
  updatedAt: string;
}

interface UserItem {
  id: string;
  displayName: string;
  tier: string;
  trustLevel: number;
  status?: string;
}

interface BackupItem {
  fileName: string;
  sizeBytes: number;
  ciphertextSha256: string;
  createdAt: string;
  path?: string;
}

interface AuditItem {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  actorId: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

interface TokenStatsSummary {
  totalTokens: number;
  availableTokens: number;
  consumedTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalRequests: number;
  utilizationPercent: number;
  configuredProviders: number;
  activeKeysCount: number;
}

interface ProviderTokenItem {
  provider: string;
  displayName: string;
  keysCount: number;
  activeKeys: number;
  requestsUsed: number;
  totalTokens: number;
  availableTokens: number;
  dailyTokenCapacity: number;
  utilizationPercent: number;
  status: string;
}

interface UserTokenItem {
  userId: string;
  displayName: string;
  tier: string;
  status: string;
  requests: number;
  dailyRequestLimit: number;
  inputTokens: number;
  outputTokens: number;
  consumedTokens: number;
  dailyTokenAllowance: number;
  availableTokens: number;
  quotaRemainingPercent: number;
}

interface TokenStatsResponse {
  ok: boolean;
  summary: TokenStatsSummary;
  byProvider: ProviderTokenItem[];
  byUser: UserTokenItem[];
}

let staffCsrfToken = '';
let currentStaff: StaffUser | null = null;

function showToast(message: string): void {
  const toast = document.querySelector<HTMLDivElement>('#admin-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

async function adminRequest<T>(
  path: string,
  method = 'GET',
  bodyData?: Record<string, unknown>,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    if (staffCsrfToken) headers['X-CSRF-Token'] = staffCsrfToken;
  }
  const options: RequestInit = {
    method,
    headers,
    credentials: 'include',
  };
  if (bodyData !== undefined) {
    options.body = JSON.stringify(bodyData);
  }
  const res = await fetch(path, options);

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    let msg = `Request failed (${res.status})`;
    try {
      const parsed = JSON.parse(errorText);
      if (parsed.error?.message) msg = parsed.error.message;
      else if (parsed.message) msg = parsed.message;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

async function checkAuth(): Promise<boolean> {
  const loginBanner = document.querySelector<HTMLDivElement>('#admin-login-banner');
  try {
    const res = await adminRequest<{ staff?: StaffUser }>('/admin/api/status');
    if (res.staff) {
      currentStaff = res.staff;
      if (loginBanner) loginBanner.hidden = true;
      const nameEl = document.querySelector<HTMLElement>('#staff-display-name');
      if (nameEl) nameEl.textContent = 'Super Admin Alpha';
      return true;
    }
  } catch {
    // Unauthenticated
  }

  if (loginBanner) loginBanner.hidden = false;
  return false;
}

async function performQuickUnlock(): Promise<void> {
  try {
    const demo = await adminRequest<{ userId: string; totpCode: string }>(
      '/admin/api/auth/demo-code',
    );
    const loginRes = await adminRequest<{ csrfToken: string; staff: StaffUser }>(
      '/admin/api/auth/login',
      'POST',
      {
        userId: demo.userId,
        totpCode: demo.totpCode,
      },
    );
    staffCsrfToken = loginRes.csrfToken;
    currentStaff = loginRes.staff;
    const loginBanner = document.querySelector<HTMLDivElement>('#admin-login-banner');
    if (loginBanner) loginBanner.hidden = true;
    showToast('🚀 Super Admin Control Center Unlocked!');
    await refreshAll();
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Unlock failed');
  }
}

// 1. Multi-Key Vault
async function loadKeys(): Promise<void> {
  const tbody = document.querySelector<HTMLTableSectionElement>('#admin-keys-tbody');
  const emptyNotice = document.querySelector<HTMLElement>('#admin-keys-empty');
  const countMetric = document.querySelector<HTMLElement>('#metric-keys-count');
  const activeMetric = document.querySelector<HTMLElement>('#metric-keys-active');

  if (!tbody) return;
  tbody.replaceChildren();

  try {
    let res: { ok: boolean; keys: KeyItem[] };
    try {
      res = await adminRequest<{ ok: boolean; keys: KeyItem[] }>('/admin/api/keys');
    } catch {
      res = await adminRequest<{ ok: boolean; keys: KeyItem[] }>('/api/keys');
    }
    const keys = res.keys ?? [];

    if (countMetric) countMetric.textContent = String(keys.length);
    const activeCount = keys.filter((k) => k.status === 'active' && !k.isExpired).length;
    if (activeMetric) activeMetric.textContent = `${activeCount} Active`;

    if (keys.length === 0) {
      if (emptyNotice) {
        emptyNotice.hidden = false;
        emptyNotice.textContent =
          'No database keys found. Falling back to .env environment variables.';
      }
      return;
    }
    if (emptyNotice) emptyNotice.hidden = true;

    for (const k of keys) {
      const tr = document.createElement('tr');

      const tdProvider = document.createElement('td');
      const tag = document.createElement('span');
      const safeProvClass = k.provider.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
      tag.className = `provider-tag provider-${safeProvClass}`;
      tag.textContent =
        k.provider === 'github'
          ? 'GitHub Models'
          : k.provider === 'groq'
            ? 'GroqCloud'
            : k.provider === 'gemini'
              ? 'Google Gemini'
              : k.provider === 'openrouter'
                ? 'OpenRouter'
                : k.provider === 'deepseek'
                  ? 'DeepSeek'
                  : k.provider === 'mistral'
                    ? 'Mistral AI'
                    : k.provider === 'cerebras'
                      ? 'Cerebras'
                      : k.provider === 'together'
                        ? 'Together AI'
                        : k.provider === 'sambanova'
                          ? 'SambaNova'
                          : k.provider === 'openai'
                            ? 'OpenAI'
                            : k.provider === 'anthropic'
                              ? 'Anthropic'
                              : k.provider.startsWith('custom:')
                                ? `Custom (${k.provider.slice(7)})`
                                : k.provider;
      tdProvider.appendChild(tag);

      const tdLabel = document.createElement('td');
      tdLabel.className = 'key-label-cell';
      tdLabel.textContent = k.label;

      const tdMask = document.createElement('td');
      const code = document.createElement('code');
      code.className = 'key-masked-code';
      code.textContent = k.keyMask;
      tdMask.appendChild(code);

      const tdUsage = document.createElement('td');
      tdUsage.className = 'key-usage-cell';
      tdUsage.textContent = `${k.requestsUsed} reqs`;

      const tdExpiry = document.createElement('td');
      if (k.expiresAt) {
        const d = new Date(k.expiresAt).toLocaleDateString();
        if (k.isExpired) {
          const expSpan = document.createElement('span');
          expSpan.className = 'badge-expired';
          expSpan.textContent = 'Expired';
          tdExpiry.replaceChildren(expSpan);
        } else {
          tdExpiry.textContent = d;
        }
      } else {
        tdExpiry.textContent = 'Never';
      }

      const tdStatus = document.createElement('td');
      const statusBtn = document.createElement('button');
      statusBtn.type = 'button';
      statusBtn.className = `key-status-toggle ${k.status === 'active' ? 'status-active' : 'status-blocked'}`;
      statusBtn.textContent = k.isRateLimited
        ? '⏳ Cooldown'
        : k.status === 'active'
          ? 'Active'
          : 'Blocked';
      statusBtn.addEventListener('click', async () => {
        const next = k.status === 'active' ? 'blocked' : 'active';
        try {
          try {
            await adminRequest(`/admin/api/keys/${encodeURIComponent(k.id)}/status`, 'PATCH', {
              status: next,
            });
          } catch {
            await adminRequest(`/api/keys/${encodeURIComponent(k.id)}/status`, 'PATCH', {
              status: next,
            });
          }
          showToast(`Key '${k.label}' set to ${next}`);
          await loadKeys();
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Status update failed');
        }
      });
      tdStatus.appendChild(statusBtn);

      const tdActions = document.createElement('td');

      const testBtn = document.createElement('button');
      testBtn.type = 'button';
      testBtn.className = 'key-test-btn secondary';
      testBtn.textContent = '⚡ Test';
      testBtn.title = 'Test connection to provider';
      testBtn.style.marginRight = '6px';
      testBtn.addEventListener('click', async () => {
        testBtn.textContent = '🔄...';
        testBtn.disabled = true;
        try {
          let testRes: {
            ok: boolean;
            connected: boolean;
            latencyMs?: number;
            message?: string;
            error?: string;
          };
          try {
            testRes = await adminRequest<{
              ok: boolean;
              connected: boolean;
              latencyMs?: number;
              message?: string;
              error?: string;
            }>(`/admin/api/keys/${encodeURIComponent(k.id)}/test`, 'POST', {});
          } catch {
            testRes = await adminRequest<{
              ok: boolean;
              connected: boolean;
              latencyMs?: number;
              message?: string;
              error?: string;
            }>(`/api/keys/${encodeURIComponent(k.id)}/test`, 'POST', {});
          }
          if (testRes.connected) {
            showToast(`🟢 ${k.label}: ${testRes.message || 'Connected successfully!'}`);
            testBtn.textContent = '🟢 OK';
          } else {
            showToast(`🔴 ${k.label}: ${testRes.error || 'Connection failed'}`);
            testBtn.textContent = '🔴 Failed';
          }
        } catch (err) {
          showToast(`🔴 Test failed: ${err instanceof Error ? err.message : 'Network error'}`);
          testBtn.textContent = '⚡ Test';
        } finally {
          testBtn.disabled = false;
        }
      });
      tdActions.appendChild(testBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'key-delete-btn';
      delBtn.textContent = '🗑️';
      delBtn.title = 'Delete Key';
      delBtn.addEventListener('click', async () => {
        if (!confirm(`Permanently remove '${k.label}' from pool?`)) return;
        try {
          try {
            await adminRequest(`/admin/api/keys/${encodeURIComponent(k.id)}`, 'DELETE');
          } catch {
            await adminRequest(`/api/keys/${encodeURIComponent(k.id)}`, 'DELETE');
          }
          showToast(`Key '${k.label}' deleted`);
          await loadKeys();
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Delete failed');
        }
      });
      tdActions.appendChild(delBtn);

      tr.appendChild(tdProvider);
      tr.appendChild(tdLabel);
      tr.appendChild(tdMask);
      tr.appendChild(tdUsage);
      tr.appendChild(tdExpiry);
      tr.appendChild(tdStatus);
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    }
  } catch (err) {
    if (emptyNotice) {
      emptyNotice.hidden = false;
      emptyNotice.textContent = err instanceof Error ? err.message : 'Error loading keys';
    }
  }
}

// 2. Kill Switches
async function loadKillSwitches(): Promise<void> {
  const container = document.querySelector<HTMLElement>('#kill-switches-container');
  const metricStatus = document.querySelector<HTMLElement>('#metric-ai-status');
  const metricHint = document.querySelector<HTMLElement>('#metric-kill-hint');
  const historyTbody = document.querySelector<HTMLTableSectionElement>('#switch-history-tbody');

  if (!container) return;
  container.replaceChildren();

  try {
    const res = await adminRequest<{ killSwitches: KillSwitch[] | Record<string, KillSwitch> }>(
      '/admin/api/kill-switches',
    );
    const raw = res.killSwitches;
    const switches: KillSwitch[] = Array.isArray(raw)
      ? raw
      : typeof raw === 'object' && raw !== null
        ? Object.values(raw)
        : [];

    const masterAi = switches.find((s) => s.id === 'all_ai');
    if (masterAi) {
      if (masterAi.enabled) {
        if (metricStatus) {
          metricStatus.textContent = 'PAUSED';
          metricStatus.className = 'metric-val status-pill-offline';
        }
        if (metricHint) metricHint.textContent = 'All AI generation halted';
      } else {
        if (metricStatus) {
          metricStatus.textContent = 'ONLINE';
          metricStatus.className = 'metric-val status-pill-online';
        }
        if (metricHint) metricHint.textContent = 'All AI models active';
      }
    }

    for (const sw of switches) {
      const card = document.createElement('div');
      card.className = `switch-card ${sw.enabled ? 'switch-active' : ''}`;

      const header = document.createElement('div');
      header.className = 'switch-card-header';

      const info = document.createElement('div');
      const idTitle = document.createElement('div');
      idTitle.className = 'switch-id';
      idTitle.textContent = sw.id;

      const desc = document.createElement('div');
      desc.className = 'switch-desc';
      desc.textContent =
        sw.id === 'all_ai'
          ? 'Emergency Master Switch: Halts all streaming AI models'
          : sw.id === 'file_uploads'
            ? 'Blocks new file uploads across all workspaces'
            : sw.id === 'free_tier'
              ? 'Disables free-tier usage'
              : sw.id === 'signups'
                ? 'Freezes new local and OAuth registrations'
                : `Toggle switch for ${sw.id}`;
      info.appendChild(idTitle);
      info.appendChild(desc);

      const statusBadge = document.createElement('span');
      statusBadge.className = `switch-status-badge ${sw.enabled ? 'switch-status-on' : 'switch-status-off'}`;
      statusBadge.textContent = sw.enabled ? 'TRIGGERED (PAUSED)' : 'NORMAL (ALLOWED)';

      header.appendChild(info);
      header.appendChild(statusBadge);

      const controls = document.createElement('div');
      controls.className = 'switch-controls';

      const reasonInput = document.createElement('input');
      reasonInput.type = 'text';
      reasonInput.placeholder = 'Reason for audit log...';
      reasonInput.value = sw.reason || '';

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = `btn-toggle-switch ${sw.enabled ? 'secondary' : 'primary'}`;
      toggleBtn.textContent = sw.enabled ? '🟢 Resume / Deactivate' : '🛑 Trigger Kill Switch';

      toggleBtn.addEventListener('click', async () => {
        const nextEnabled = !sw.enabled;
        const reason =
          reasonInput.value.trim() || (nextEnabled ? 'Manual admin pause' : 'Resumed by admin');
        try {
          await adminRequest('/admin/api/kill-switches', 'POST', {
            id: sw.id,
            enabled: nextEnabled,
            reason,
          });
          showToast(`Switch '${sw.id}' ${nextEnabled ? 'TRIGGERED' : 'DEACTIVATED'}`);
          await loadKillSwitches();
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Failed to toggle switch');
        }
      });

      controls.appendChild(reasonInput);
      controls.appendChild(toggleBtn);

      card.appendChild(header);
      card.appendChild(controls);
      container.appendChild(card);
    }

    // Load switch history
    if (historyTbody) {
      historyTbody.replaceChildren();
      const hist = await adminRequest<{
        history: Array<{
          entity_id: string;
          version: number;
          action: string;
          actor_id: string;
          reason: string;
          created_at: string;
        }>;
      }>('/admin/api/config/history', 'POST', {
        entityType: 'kill_switch',
        entityId: 'all_ai',
      }).catch(() => ({ history: [] }));

      for (const h of hist.history ?? []) {
        const row = document.createElement('tr');
        const tdId = document.createElement('td');
        const codeId = document.createElement('code');
        codeId.textContent = h.entity_id;
        tdId.appendChild(codeId);

        const tdVer = document.createElement('td');
        tdVer.textContent = `v${h.version}`;

        const tdAct = document.createElement('td');
        const spAct = document.createElement('span');
        spAct.className = 'provider-tag';
        spAct.textContent = h.action;
        tdAct.appendChild(spAct);

        const tdActor = document.createElement('td');
        tdActor.textContent = h.actor_id;

        const tdReason = document.createElement('td');
        tdReason.textContent = h.reason;

        const tdDate = document.createElement('td');
        tdDate.textContent = new Date(h.created_at).toLocaleString();

        row.append(tdId, tdVer, tdAct, tdActor, tdReason, tdDate);
        historyTbody.appendChild(row);
      }
    }
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Failed to load kill switches');
  }
}

// 3. Users & Moderation
async function loadUsers(): Promise<void> {
  const tbody = document.querySelector<HTMLTableSectionElement>('#admin-users-tbody');
  const countMetric = document.querySelector<HTMLElement>('#metric-users-count');
  const bannedMetric = document.querySelector<HTMLElement>('#metric-users-banned');

  if (!tbody) return;
  tbody.replaceChildren();

  try {
    const res = await adminRequest<{ ok: boolean; users: UserItem[] }>('/admin/api/users');
    const users = res.users ?? [];

    if (countMetric) countMetric.textContent = String(users.length);

    let sanctionedCount = 0;
    for (const u of users) {
      const isSanctioned =
        u.status === 'banned' || u.status === 'suspended' || u.status === 'throttled';
      if (isSanctioned) sanctionedCount++;

      const tr = document.createElement('tr');

      const tdId = document.createElement('td');
      const codeId = document.createElement('code');
      codeId.textContent = u.id;
      tdId.appendChild(codeId);

      const tdName = document.createElement('td');
      tdName.textContent = u.displayName || (u as any).display_name || 'Anonymous';

      const tdTier = document.createElement('td');
      const spanTier = document.createElement('span');
      spanTier.className = 'staff-role-badge';
      spanTier.textContent = u.tier || 'free';
      tdTier.appendChild(spanTier);

      const tdTrust = document.createElement('td');
      tdTrust.textContent = `Level ${u.trustLevel ?? (u as any).trust_level ?? 1}`;

      const tdStatus = document.createElement('td');
      const spanStatus = document.createElement('span');
      spanStatus.className = `switch-status-badge ${u.status === 'banned' ? 'switch-status-on' : 'switch-status-off'}`;
      spanStatus.textContent = u.status ?? 'active';
      tdStatus.appendChild(spanStatus);

      const tdActions = document.createElement('td');
      const row = document.createElement('div');
      row.className = 'user-actions-row';

      const btnThrottle = document.createElement('button');
      btnThrottle.className = 'btn-mod';
      btnThrottle.textContent = 'Throttle (1h)';
      btnThrottle.addEventListener('click', async () => {
        try {
          await adminRequest(`/admin/api/users/${encodeURIComponent(u.id)}/moderate`, 'POST', {
            action: 'throttle',
            reason: 'Excessive requests / testing',
            until: new Date(Date.now() + 3600000).toISOString(),
          });
          showToast(`User ${u.displayName} throttled for 1 hour.`);
          await loadUsers();
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Action failed');
        }
      });

      const btnBan = document.createElement('button');
      btnBan.className = 'btn-mod btn-mod-danger';
      btnBan.textContent = u.status === 'banned' ? 'Lift Ban' : 'Ban User';
      btnBan.addEventListener('click', async () => {
        const nextAction = u.status === 'banned' ? 'none' : 'ban';
        try {
          await adminRequest(`/admin/api/users/${encodeURIComponent(u.id)}/moderate`, 'POST', {
            action: nextAction,
            reason: nextAction === 'ban' ? 'Malicious activity' : 'Sanction resolved',
          });
          showToast(`User ${u.displayName} ${nextAction === 'ban' ? 'banned' : 'unbanned'}.`);
          await loadUsers();
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Action failed');
        }
      });

      row.appendChild(btnThrottle);
      row.appendChild(btnBan);
      tdActions.appendChild(row);

      tr.appendChild(tdId);
      tr.appendChild(tdName);
      tr.appendChild(tdTier);
      tr.appendChild(tdTrust);
      tr.appendChild(tdStatus);
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    }

    if (bannedMetric) bannedMetric.textContent = `${sanctionedCount} Sanctioned`;
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Failed to load users');
  }
}

// 4. Backups & Disaster Recovery
async function loadBackups(): Promise<void> {
  const tbody = document.querySelector<HTMLTableSectionElement>('#admin-backups-tbody');
  const emptyNotice = document.querySelector<HTMLElement>('#admin-backups-empty');
  const metricCount = document.querySelector<HTMLElement>('#metric-backups-count');

  if (!tbody) return;
  tbody.replaceChildren();

  try {
    const res = await adminRequest<{ ok: boolean; backups: BackupItem[] }>('/admin/api/backups');
    const backups = res.backups ?? [];

    if (metricCount) metricCount.textContent = String(backups.length);

    if (backups.length === 0) {
      if (emptyNotice) emptyNotice.hidden = false;
      return;
    }
    if (emptyNotice) emptyNotice.hidden = true;

    for (const b of backups) {
      const tr = document.createElement('tr');

      const tdFile = document.createElement('td');
      const codeFile = document.createElement('code');
      codeFile.textContent = b.fileName;
      tdFile.appendChild(codeFile);

      const tdSize = document.createElement('td');
      tdSize.textContent = `${(b.sizeBytes / 1024).toFixed(1)} KB`;

      const tdSha = document.createElement('td');
      const codeSha = document.createElement('code');
      codeSha.className = 'key-masked-code';
      codeSha.title = b.ciphertextSha256;
      codeSha.textContent = `${b.ciphertextSha256.slice(0, 16)}...`;
      tdSha.appendChild(codeSha);

      const tdCreated = document.createElement('td');
      tdCreated.textContent = new Date(b.createdAt).toLocaleString();

      const tdActions = document.createElement('td');
      const verifyBtn = document.createElement('button');
      verifyBtn.className = 'btn-mod';
      verifyBtn.textContent = 'Verify Integrity';
      verifyBtn.addEventListener('click', async () => {
        const pass = prompt('Enter passphrase to verify archive integrity:');
        if (!pass) return;
        try {
          const v = await adminRequest<{
            ok: boolean;
            valid: boolean;
            summary: Record<string, unknown>;
          }>('/admin/api/backups/verify', 'POST', {
            archivePath: b.path || b.fileName,
            passphrase: pass,
          });
          if (v.valid) {
            showToast('✅ Backup archive integrity verified! SHA-256 and AES-GCM tags match.');
          }
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Verification failed');
        }
      });

      tdActions.appendChild(verifyBtn);

      tr.appendChild(tdFile);
      tr.appendChild(tdSize);
      tr.appendChild(tdSha);
      tr.appendChild(tdCreated);
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    }
  } catch (err) {
    if (emptyNotice) {
      emptyNotice.hidden = false;
      emptyNotice.textContent = err instanceof Error ? err.message : 'Failed to load backups';
    }
  }
}

// 5. Audit Log
async function loadAudit(): Promise<void> {
  const tbody = document.querySelector<HTMLTableSectionElement>('#admin-audit-tbody');
  const emptyNotice = document.querySelector<HTMLElement>('#admin-audit-empty');

  if (!tbody) return;
  tbody.replaceChildren();

  try {
    const res = await adminRequest<{ auditLogs: AuditItem[] }>('/admin/api/audit', 'POST', {});
    const logs = res.auditLogs ?? [];

    if (logs.length === 0) {
      if (emptyNotice) emptyNotice.hidden = false;
      return;
    }
    if (emptyNotice) emptyNotice.hidden = true;

    for (const a of logs) {
      const createdStr = (a as any).created_at || a.createdAt;
      const createdFormatted = createdStr ? new Date(createdStr).toLocaleString() : 'Just now';
      const actor = a.actorId || (a as any).actor_id || 'system';
      const targetType = a.targetType || (a as any).target_type || 'n/a';
      const targetId = a.targetId || (a as any).target_id || 'n/a';
      const tr = document.createElement('tr');

      const tdCreated = document.createElement('td');
      tdCreated.textContent = createdFormatted;

      const tdActor = document.createElement('td');
      const codeActor = document.createElement('code');
      codeActor.textContent = actor;
      tdActor.appendChild(codeActor);

      const tdAction = document.createElement('td');
      const spanAction = document.createElement('span');
      spanAction.className = 'provider-tag';
      spanAction.textContent = a.action;
      tdAction.appendChild(spanAction);

      const tdTargetType = document.createElement('td');
      tdTargetType.textContent = targetType;

      const tdTargetId = document.createElement('td');
      const codeTargetId = document.createElement('code');
      codeTargetId.textContent = targetId;
      tdTargetId.appendChild(codeTargetId);

      const tdMeta = document.createElement('td');
      const preMeta = document.createElement('pre');
      preMeta.style.margin = '0';
      preMeta.style.fontSize = '11px';
      preMeta.textContent = JSON.stringify(a.metadata || {});
      tdMeta.appendChild(preMeta);

      tr.append(tdCreated, tdActor, tdAction, tdTargetType, tdTargetId, tdMeta);
      tbody.appendChild(tr);
    }
  } catch (err) {
    if (emptyNotice) {
      emptyNotice.hidden = false;
      emptyNotice.textContent = err instanceof Error ? err.message : 'Failed to load audit';
    }
  }
}

async function loadTokens(): Promise<void> {
  const availableMetric = document.querySelector<HTMLElement>('#metric-tokens-available');
  const totalMetric = document.querySelector<HTMLElement>('#metric-tokens-total');
  const hintMetric = document.querySelector<HTMLElement>('#metric-tokens-hint');

  const statAvail = document.querySelector<HTMLElement>('#stat-tokens-available');
  const statTotal = document.querySelector<HTMLElement>('#stat-tokens-total');
  const statConsumed = document.querySelector<HTMLElement>('#stat-tokens-consumed');
  const statIn = document.querySelector<HTMLElement>('#stat-tokens-in');
  const statOut = document.querySelector<HTMLElement>('#stat-tokens-out');
  const statUtil = document.querySelector<HTMLElement>('#stat-tokens-utilization');
  const progressFill = document.querySelector<HTMLElement>('#stat-tokens-progress-fill');
  const provCountSub = document.querySelector<HTMLElement>('#stat-tokens-providers-count');

  const providerTbody = document.querySelector<HTMLTableSectionElement>(
    '#admin-provider-tokens-tbody',
  );
  const providerEmpty = document.querySelector<HTMLElement>('#admin-provider-tokens-empty');
  const userTbody = document.querySelector<HTMLTableSectionElement>('#admin-user-tokens-tbody');
  const userEmpty = document.querySelector<HTMLElement>('#admin-user-tokens-empty');

  try {
    let res: TokenStatsResponse;
    try {
      res = await adminRequest<TokenStatsResponse>('/admin/api/tokens');
    } catch {
      res = await adminRequest<TokenStatsResponse>('/api/tokens');
    }

    if (!res || !res.summary) return;
    const { summary, byProvider, byUser } = res;

    const fmt = (n: number) => n.toLocaleString('en-US');
    const fmtCompact = (n: number) => {
      if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
      return String(n);
    };

    // 1. Top metric card
    if (availableMetric) availableMetric.textContent = fmtCompact(summary.availableTokens);
    if (totalMetric) totalMetric.textContent = `${fmtCompact(summary.totalTokens)} Total`;
    if (hintMetric)
      hintMetric.textContent = `${fmt(summary.consumedTokens)} Consumed (${summary.utilizationPercent}% used)`;

    // 2. Tab stats boxes
    if (statAvail) statAvail.textContent = fmt(summary.availableTokens);
    if (statTotal) statTotal.textContent = fmt(summary.totalTokens);
    if (statConsumed) statConsumed.textContent = fmt(summary.consumedTokens);
    if (statIn) statIn.textContent = fmt(summary.inputTokens);
    if (statOut) statOut.textContent = fmt(summary.outputTokens);
    if (statUtil) statUtil.textContent = `${summary.utilizationPercent}%`;
    if (progressFill)
      progressFill.style.width = `${Math.min(100, Math.max(1, summary.utilizationPercent))}%`;
    if (provCountSub)
      provCountSub.textContent = `${summary.configuredProviders} Configured Providers · ${summary.activeKeysCount} Active Keys`;

    // 3. Provider table ("Which Have How Many")
    if (providerTbody) {
      providerTbody.replaceChildren();
      if (!byProvider || byProvider.length === 0) {
        if (providerEmpty) providerEmpty.hidden = false;
      } else {
        if (providerEmpty) providerEmpty.hidden = true;
        for (const p of byProvider) {
          const tr = document.createElement('tr');

          const tdName = document.createElement('td');
          const strongName = document.createElement('strong');
          strongName.textContent = p.displayName;
          const mutedDiv = document.createElement('div');
          mutedDiv.className = 'muted small';
          mutedDiv.textContent = p.provider;
          tdName.append(strongName, mutedDiv);

          const tdStatus = document.createElement('td');
          const statusPill = document.createElement('span');
          statusPill.className = `status-pill status-pill-${p.status === 'active' ? 'active' : p.status === 'ready' ? 'online' : 'offline'}`;
          statusPill.textContent = p.status.toUpperCase();
          tdStatus.appendChild(statusPill);

          const tdKeys = document.createElement('td');
          const strongKeys = document.createElement('strong');
          strongKeys.textContent = String(p.activeKeys);
          tdKeys.append(strongKeys, document.createTextNode(` / ${p.keysCount}`));

          const tdReqs = document.createElement('td');
          const strongReqs = document.createElement('strong');
          strongReqs.textContent = fmt(p.requestsUsed);
          tdReqs.append(strongReqs, document.createTextNode(' reqs'));

          const tdTokens = document.createElement('td');
          const strongTokens = document.createElement('strong');
          strongTokens.textContent = fmt(p.totalTokens);
          tdTokens.append(strongTokens, document.createTextNode(' tokens'));

          const tdAvail = document.createElement('td');
          const strongAvail = document.createElement('strong');
          strongAvail.style.color = 'var(--admin-accent-green)';
          strongAvail.textContent = fmt(p.availableTokens);
          tdAvail.appendChild(strongAvail);

          const tdCap = document.createElement('td');
          tdCap.textContent = `${fmt(p.dailyTokenCapacity)} / day`;

          const tdUtil = document.createElement('td');
          const barDiv = document.createElement('div');
          barDiv.className = 'token-bar-inline';
          const fillDiv = document.createElement('div');
          fillDiv.className = 'token-bar-inline-fill';
          fillDiv.style.width = `${Math.min(100, p.utilizationPercent)}%`;
          barDiv.appendChild(fillDiv);
          const utilSpan = document.createElement('span');
          utilSpan.className = 'small';
          utilSpan.textContent = ` ${p.utilizationPercent}%`;
          tdUtil.append(barDiv, utilSpan);

          tr.append(tdName, tdStatus, tdKeys, tdReqs, tdTokens, tdAvail, tdCap, tdUtil);
          providerTbody.appendChild(tr);
        }
      }
    }

    // 4. User table ("Which Have How Many")
    if (userTbody) {
      userTbody.replaceChildren();
      if (!byUser || byUser.length === 0) {
        if (userEmpty) userEmpty.hidden = false;
      } else {
        if (userEmpty) userEmpty.hidden = true;
        for (const u of byUser) {
          const tr = document.createElement('tr');
          const remainingBadgeClass =
            u.quotaRemainingPercent > 50
              ? 'token-badge-green'
              : u.quotaRemainingPercent > 20
                ? 'token-badge-blue'
                : 'token-badge-gold';

          const tdName = document.createElement('td');
          const strongName = document.createElement('strong');
          strongName.textContent = u.displayName;
          tdName.appendChild(strongName);

          const tdId = document.createElement('td');
          const codeId = document.createElement('code');
          codeId.textContent = u.userId;
          tdId.appendChild(codeId);

          const tdTier = document.createElement('td');
          const tierPill = document.createElement('span');
          tierPill.className = 'token-badge-pill token-badge-blue';
          tierPill.textContent = u.tier.toUpperCase();
          tdTier.appendChild(tierPill);

          const tdReqs = document.createElement('td');
          const strongReqs = document.createElement('strong');
          strongReqs.textContent = String(u.requests);
          tdReqs.append(strongReqs, document.createTextNode(` / ${u.dailyRequestLimit}`));

          const tdIn = document.createElement('td');
          tdIn.textContent = fmt(u.inputTokens);

          const tdOut = document.createElement('td');
          tdOut.textContent = fmt(u.outputTokens);

          const tdConsumed = document.createElement('td');
          const strongConsumed = document.createElement('strong');
          strongConsumed.textContent = fmt(u.consumedTokens);
          tdConsumed.appendChild(strongConsumed);

          const tdAvail = document.createElement('td');
          const strongAvail = document.createElement('strong');
          strongAvail.style.color = 'var(--admin-accent-green)';
          strongAvail.textContent = fmt(u.availableTokens);
          tdAvail.appendChild(strongAvail);

          const tdRem = document.createElement('td');
          const remPill = document.createElement('span');
          remPill.className = `token-badge-pill ${remainingBadgeClass}`;
          remPill.textContent = `${u.quotaRemainingPercent}% Remaining`;
          tdRem.appendChild(remPill);

          tr.append(tdName, tdId, tdTier, tdReqs, tdIn, tdOut, tdConsumed, tdAvail, tdRem);
          userTbody.appendChild(tr);
        }
      }
    }
  } catch (err) {
    console.error('Failed to load token ledger stats:', err);
  }
}

async function refreshAll(): Promise<void> {
  await Promise.allSettled([
    loadTokens(),
    loadKeys(),
    loadKillSwitches(),
    loadUsers(),
    loadBackups(),
    loadAudit(),
  ]);
}

function initEventHandlers(): void {
  // Tabs
  document.querySelectorAll<HTMLButtonElement>('.admin-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.admin-tab-panel').forEach((p) => p.setAttribute('hidden', ''));

      btn.classList.add('active');
      const targetId = btn.dataset.tab;
      const targetPanel = targetId ? document.getElementById(targetId) : null;
      if (targetPanel) targetPanel.removeAttribute('hidden');
    });
  });

  // Theme Toggle
  const themeToggle = document.querySelector<HTMLButtonElement>('#admin-theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      if (isLight) {
        document.documentElement.removeAttribute('data-theme');
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
      }
    });
  }

  // Refresh
  document.querySelector('#admin-refresh-btn')?.addEventListener('click', () => {
    void refreshAll();
    showToast('Telemetry & status refreshed.');
  });
  document.querySelector('#admin-reload-tokens-btn')?.addEventListener('click', () => {
    void loadTokens();
    showToast('Token ledger refreshed.');
  });
  document.querySelector('#admin-reload-keys-btn')?.addEventListener('click', () => loadKeys());
  document
    .querySelector('#admin-reload-switches-btn')
    ?.addEventListener('click', () => loadKillSwitches());
  document.querySelector('#admin-reload-users-btn')?.addEventListener('click', () => loadUsers());
  document
    .querySelector('#admin-reload-backups-btn')
    ?.addEventListener('click', () => loadBackups());
  document.querySelector('#admin-reload-audit-btn')?.addEventListener('click', () => loadAudit());

  // Quick Unlock Button
  document.querySelector('#btn-quick-unlock')?.addEventListener('click', () => {
    void performQuickUnlock();
  });

  // Provider Auto-Detection & Live Test
  function detectProviderFromKey(key: string): { provider: string; name: string } | null {
    const trimmed = key.trim();
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

  const valInput = document.querySelector<HTMLInputElement>('#admin-key-value');
  const provSelect = document.querySelector<HTMLSelectElement>('#admin-key-provider');
  const customGroup = document.querySelector<HTMLElement>('#admin-custom-provider-group');
  const labelInput = document.querySelector<HTMLInputElement>('#admin-key-label');
  const detectPill = document.querySelector<HTMLElement>('#admin-key-detect-pill');
  const connectStatus = document.querySelector<HTMLElement>('#admin-key-connect-status');
  const testKeyBtn = document.querySelector<HTMLButtonElement>('#admin-btn-test-key');

  let verifyTimeout: ReturnType<typeof setTimeout> | null = null;

  async function runConnectionTest() {
    if (!valInput || !provSelect || !connectStatus) return;
    const rawVal = valInput.value.trim();
    if (rawVal.length < 8) {
      connectStatus.setAttribute('hidden', '');
      return;
    }

    let prov = provSelect.value;
    if (prov === 'custom') {
      const customNameEl = document.querySelector<HTMLInputElement>('#admin-key-custom-name');
      prov = customNameEl?.value.trim().toLowerCase() || 'custom';
    }

    connectStatus.removeAttribute('hidden');
    connectStatus.className = 'key-connect-status testing';
    const sp = document.createElement('span');
    sp.className = 'spinner-small';
    connectStatus.replaceChildren(
      sp,
      document.createTextNode(` Testing live connection to ${prov}...`),
    );

    try {
      let res: {
        ok: boolean;
        connected: boolean;
        latencyMs?: number;
        message?: string;
        error?: string;
      };
      try {
        res = await adminRequest<{
          ok: boolean;
          connected: boolean;
          latencyMs?: number;
          message?: string;
          error?: string;
        }>('/admin/api/keys/verify', 'POST', { provider: prov, apiKey: rawVal });
      } catch {
        res = await adminRequest<{
          ok: boolean;
          connected: boolean;
          latencyMs?: number;
          message?: string;
          error?: string;
        }>('/api/keys/verify', 'POST', { provider: prov, apiKey: rawVal });
      }

      if (res.connected) {
        connectStatus.className = 'key-connect-status connected';
        const str = document.createElement('strong');
        str.textContent = 'Connected';
        connectStatus.replaceChildren(
          document.createTextNode('🟢 '),
          str,
          document.createTextNode(`: ${res.message || 'Ready for instant AI chat'}`),
        );
      } else {
        connectStatus.className = 'key-connect-status failed';
        const str = document.createElement('strong');
        str.textContent = 'Connection error';
        connectStatus.replaceChildren(
          document.createTextNode('🔴 '),
          str,
          document.createTextNode(`: ${res.error || 'Invalid key or unauthorized'}`),
        );
      }
    } catch (err) {
      connectStatus.className = 'key-connect-status failed';
      const str = document.createElement('strong');
      str.textContent = 'Connection error';
      connectStatus.replaceChildren(
        document.createTextNode('🔴 '),
        str,
        document.createTextNode(`: ${err instanceof Error ? err.message : 'Network error'}`),
      );
    }
  }

  if (valInput) {
    const handleKeyChange = () => {
      const detected = detectProviderFromKey(valInput.value);
      if (detected && provSelect) {
        provSelect.value = detected.provider;
        if (customGroup) customGroup.setAttribute('hidden', '');
        if (detectPill) {
          detectPill.removeAttribute('hidden');
          detectPill.textContent = `✨ Auto-detected: ${detected.name}`;
        }
        if (labelInput && !labelInput.value.trim()) {
          labelInput.value = `${detected.name.split(' ')[0]} Key`;
        }
      } else if (detectPill) {
        detectPill.setAttribute('hidden', '');
      }

      if (verifyTimeout) clearTimeout(verifyTimeout);
      if (valInput.value.trim().length >= 8) {
        verifyTimeout = setTimeout(() => {
          void runConnectionTest();
        }, 700);
      } else if (connectStatus) {
        connectStatus.setAttribute('hidden', '');
      }
    };

    valInput.addEventListener('input', handleKeyChange);
    valInput.addEventListener('paste', () => setTimeout(handleKeyChange, 50));
  }

  if (testKeyBtn) {
    testKeyBtn.addEventListener('click', () => {
      void runConnectionTest();
    });
  }

  // Provider Select Change (Toggle Custom Name Field)
  if (provSelect && customGroup) {
    provSelect.addEventListener('change', () => {
      if (provSelect.value === 'custom') {
        customGroup.removeAttribute('hidden');
        document.querySelector<HTMLInputElement>('#admin-key-custom-name')?.focus();
      } else {
        customGroup.setAttribute('hidden', '');
      }
      if (valInput && valInput.value.trim().length >= 8) {
        void runConnectionTest();
      }
    });
  }

  // Add Key Form
  const keyForm = document.querySelector<HTMLFormElement>('#admin-add-key-form');
  if (keyForm) {
    keyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const provEl = document.querySelector<HTMLSelectElement>('#admin-key-provider');
      const labelEl = document.querySelector<HTMLInputElement>('#admin-key-label');
      const valEl = document.querySelector<HTMLInputElement>('#admin-key-value');
      const expEl = document.querySelector<HTMLInputElement>('#admin-key-expiry');
      const customNameEl = document.querySelector<HTMLInputElement>('#admin-key-custom-name');
      const submitBtn = document.querySelector<HTMLButtonElement>('#admin-btn-save-key');

      if (!provEl || !labelEl || !valEl) return;
      let provider = provEl.value;

      if (provider === 'custom') {
        const rawCustom = customNameEl?.value.trim().toLowerCase() || '';
        if (!rawCustom) {
          showToast('Please type a custom provider name');
          customNameEl?.focus();
          return;
        }
        if (rawCustom === 'qroqe' || rawCustom === 'groqe' || rawCustom === 'groqcloud') {
          provider = 'groq';
        } else if (rawCustom === 'google') {
          provider = 'gemini';
        } else if (rawCustom === 'githubmodels') {
          provider = 'github';
        } else if (
          [
            'openrouter',
            'deepseek',
            'mistral',
            'cerebras',
            'together',
            'sambanova',
            'openai',
            'anthropic',
          ].includes(rawCustom)
        ) {
          provider = rawCustom;
        } else {
          provider = `custom:${rawCustom.replace(/[^a-z0-9_-]/g, '')}`;
        }
      }

      const label = labelEl.value.trim();
      const apiKey = valEl.value.trim();
      const expiresAt = expEl?.value ? new Date(expEl.value).toISOString() : null;

      if (!label || !apiKey) return;
      if (submitBtn) submitBtn.disabled = true;

      try {
        let res: { ok: boolean; connection?: { connected: boolean; message?: string } };
        try {
          res = await adminRequest<{
            ok: boolean;
            connection?: { connected: boolean; message?: string };
          }>('/admin/api/keys', 'POST', { provider, label, apiKey, expiresAt });
        } catch {
          res = await adminRequest<{
            ok: boolean;
            connection?: { connected: boolean; message?: string };
          }>('/api/keys', 'POST', { provider, label, apiKey, expiresAt });
        }
        const connMsg = res.connection?.connected
          ? ` (${res.connection.message || 'Connected 🟢'})`
          : '';
        showToast(`Key '${label}' added and connected to ${provider}!${connMsg}`);
        labelEl.value = '';
        valEl.value = '';
        if (expEl) expEl.value = '';
        if (customNameEl) customNameEl.value = '';
        if (customGroup) customGroup.setAttribute('hidden', '');
        if (detectPill) detectPill.setAttribute('hidden', '');
        if (connectStatus) connectStatus.setAttribute('hidden', '');
        if (provEl) provEl.value = 'groq';
        await loadKeys();
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to add key');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // Create Backup Form
  const backupForm = document.querySelector<HTMLFormElement>('#admin-backup-form');
  if (backupForm) {
    backupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const passEl = document.querySelector<HTMLInputElement>('#backup-passphrase');
      const nameEl = document.querySelector<HTMLInputElement>('#backup-filename');
      const submitBtn = document.querySelector<HTMLButtonElement>('#btn-create-backup');

      if (!passEl) return;
      const passphrase = passEl.value;
      const fileName = nameEl?.value.trim() || undefined;

      if (!passphrase || passphrase.length < 8) {
        showToast('Passphrase must be at least 8 characters');
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      try {
        await adminRequest('/admin/api/backups', 'POST', {
          passphrase,
          fileName,
          metadata: { createdVia: 'super_admin_ui' },
        });
        showToast('🔒 Encrypted backup archive created successfully!');
        passEl.value = '';
        if (nameEl) nameEl.value = '';
        await loadBackups();
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Backup generation failed');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }
}

// Bootstrap
window.addEventListener('DOMContentLoaded', async () => {
  initEventHandlers();
  const authed = await checkAuth();
  if (!authed) {
    // Attempt automatic quick unlock in local dev mode
    await performQuickUnlock();
  } else {
    await refreshAll();
  }
});
