"use strict";
// Super Admin Control Center Client Logic
let staffCsrfToken = '';
let currentStaff = null;
function showToast(message) {
    const toast = document.querySelector('#admin-toast');
    if (!toast)
        return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3500);
}
async function adminRequest(path, method = 'GET', bodyData) {
    const headers = {
        Accept: 'application/json',
    };
    if (method !== 'GET') {
        headers['Content-Type'] = 'application/json';
        if (staffCsrfToken)
            headers['X-CSRF-Token'] = staffCsrfToken;
    }
    const options = {
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
            if (parsed.error?.message)
                msg = parsed.error.message;
            else if (parsed.message)
                msg = parsed.message;
        }
        catch {
            // ignore
        }
        throw new Error(msg);
    }
    return (await res.json());
}
async function checkAuth() {
    const loginBanner = document.querySelector('#admin-login-banner');
    try {
        const res = await adminRequest('/admin/api/status');
        if (res.staff) {
            currentStaff = res.staff;
            if (loginBanner)
                loginBanner.hidden = true;
            const nameEl = document.querySelector('#staff-display-name');
            if (nameEl)
                nameEl.textContent = 'Super Admin Alpha';
            return true;
        }
    }
    catch {
        // Unauthenticated
    }
    if (loginBanner)
        loginBanner.hidden = false;
    return false;
}
async function performQuickUnlock() {
    try {
        const demo = await adminRequest('/admin/api/auth/demo-code');
        const loginRes = await adminRequest('/admin/api/auth/login', 'POST', {
            userId: demo.userId,
            totpCode: demo.totpCode,
        });
        staffCsrfToken = loginRes.csrfToken;
        currentStaff = loginRes.staff;
        const loginBanner = document.querySelector('#admin-login-banner');
        if (loginBanner)
            loginBanner.hidden = true;
        showToast('🚀 Super Admin Control Center Unlocked!');
        await refreshAll();
    }
    catch (err) {
        showToast(err instanceof Error ? err.message : 'Unlock failed');
    }
}
// 1. Multi-Key Vault
async function loadKeys() {
    const tbody = document.querySelector('#admin-keys-tbody');
    const emptyNotice = document.querySelector('#admin-keys-empty');
    const countMetric = document.querySelector('#metric-keys-count');
    const activeMetric = document.querySelector('#metric-keys-active');
    if (!tbody)
        return;
    tbody.innerHTML = '';
    try {
        let res;
        try {
            res = await adminRequest('/admin/api/keys');
        }
        catch {
            res = await adminRequest('/api/keys');
        }
        const keys = res.keys ?? [];
        if (countMetric)
            countMetric.textContent = String(keys.length);
        const activeCount = keys.filter((k) => k.status === 'active' && !k.isExpired).length;
        if (activeMetric)
            activeMetric.textContent = `${activeCount} Active`;
        if (keys.length === 0) {
            if (emptyNotice) {
                emptyNotice.hidden = false;
                emptyNotice.textContent = 'No database keys found. Falling back to .env environment variables.';
            }
            return;
        }
        if (emptyNotice)
            emptyNotice.hidden = true;
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
                tdExpiry.innerHTML = k.isExpired ? `<span class="badge-expired">Expired</span>` : d;
            }
            else {
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
                    }
                    catch {
                        await adminRequest(`/api/keys/${encodeURIComponent(k.id)}/status`, 'PATCH', {
                            status: next,
                        });
                    }
                    showToast(`Key '${k.label}' set to ${next}`);
                    await loadKeys();
                }
                catch (err) {
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
                    let testRes;
                    try {
                        testRes = await adminRequest(`/admin/api/keys/${encodeURIComponent(k.id)}/test`, 'POST', {});
                    }
                    catch {
                        testRes = await adminRequest(`/api/keys/${encodeURIComponent(k.id)}/test`, 'POST', {});
                    }
                    if (testRes.connected) {
                        showToast(`🟢 ${k.label}: ${testRes.message || 'Connected successfully!'}`);
                        testBtn.textContent = '🟢 OK';
                    }
                    else {
                        showToast(`🔴 ${k.label}: ${testRes.error || 'Connection failed'}`);
                        testBtn.textContent = '🔴 Failed';
                    }
                }
                catch (err) {
                    showToast(`🔴 Test failed: ${err instanceof Error ? err.message : 'Network error'}`);
                    testBtn.textContent = '⚡ Test';
                }
                finally {
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
                if (!confirm(`Permanently remove '${k.label}' from pool?`))
                    return;
                try {
                    try {
                        await adminRequest(`/admin/api/keys/${encodeURIComponent(k.id)}`, 'DELETE');
                    }
                    catch {
                        await adminRequest(`/api/keys/${encodeURIComponent(k.id)}`, 'DELETE');
                    }
                    showToast(`Key '${k.label}' deleted`);
                    await loadKeys();
                }
                catch (err) {
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
    }
    catch (err) {
        if (emptyNotice) {
            emptyNotice.hidden = false;
            emptyNotice.textContent = err instanceof Error ? err.message : 'Error loading keys';
        }
    }
}
// 2. Kill Switches
async function loadKillSwitches() {
    const container = document.querySelector('#kill-switches-container');
    const metricStatus = document.querySelector('#metric-ai-status');
    const metricHint = document.querySelector('#metric-kill-hint');
    const historyTbody = document.querySelector('#switch-history-tbody');
    if (!container)
        return;
    container.innerHTML = '';
    try {
        const res = await adminRequest('/admin/api/kill-switches');
        const raw = res.killSwitches;
        const switches = Array.isArray(raw)
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
                if (metricHint)
                    metricHint.textContent = 'All AI generation halted';
            }
            else {
                if (metricStatus) {
                    metricStatus.textContent = 'ONLINE';
                    metricStatus.className = 'metric-val status-pill-online';
                }
                if (metricHint)
                    metricHint.textContent = 'All AI models active';
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
                const reason = reasonInput.value.trim() || (nextEnabled ? 'Manual admin pause' : 'Resumed by admin');
                try {
                    await adminRequest('/admin/api/kill-switches', 'POST', {
                        id: sw.id,
                        enabled: nextEnabled,
                        reason,
                    });
                    showToast(`Switch '${sw.id}' ${nextEnabled ? 'TRIGGERED' : 'DEACTIVATED'}`);
                    await loadKillSwitches();
                }
                catch (err) {
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
            historyTbody.innerHTML = '';
            const hist = await adminRequest('/admin/api/config/history', 'POST', {
                entityType: 'kill_switch',
                entityId: 'all_ai',
            }).catch(() => ({ history: [] }));
            for (const h of hist.history ?? []) {
                const row = document.createElement('tr');
                row.innerHTML = `
          <td><code>${h.entity_id}</code></td>
          <td>v${h.version}</td>
          <td><span class="provider-tag">${h.action}</span></td>
          <td>${h.actor_id}</td>
          <td>${h.reason}</td>
          <td>${new Date(h.created_at).toLocaleString()}</td>
        `;
                historyTbody.appendChild(row);
            }
        }
    }
    catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to load kill switches');
    }
}
// 3. Users & Moderation
async function loadUsers() {
    const tbody = document.querySelector('#admin-users-tbody');
    const countMetric = document.querySelector('#metric-users-count');
    const bannedMetric = document.querySelector('#metric-users-banned');
    if (!tbody)
        return;
    tbody.innerHTML = '';
    try {
        const res = await adminRequest('/admin/api/users');
        const users = res.users ?? [];
        if (countMetric)
            countMetric.textContent = String(users.length);
        let sanctionedCount = 0;
        for (const u of users) {
            const isSanctioned = u.status === 'banned' || u.status === 'suspended' || u.status === 'throttled';
            if (isSanctioned)
                sanctionedCount++;
            const tr = document.createElement('tr');
            const tdId = document.createElement('td');
            tdId.innerHTML = `<code>${u.id}</code>`;
            const tdName = document.createElement('td');
            tdName.textContent = u.displayName || u.display_name || 'Anonymous';
            const tdTier = document.createElement('td');
            tdTier.innerHTML = `<span class="staff-role-badge">${u.tier || 'free'}</span>`;
            const tdTrust = document.createElement('td');
            tdTrust.textContent = `Level ${u.trustLevel ?? u.trust_level ?? 1}`;
            const tdStatus = document.createElement('td');
            tdStatus.innerHTML = `<span class="switch-status-badge ${u.status === 'banned' ? 'switch-status-on' : 'switch-status-off'}">${u.status ?? 'active'}</span>`;
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
                }
                catch (err) {
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
                }
                catch (err) {
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
        if (bannedMetric)
            bannedMetric.textContent = `${sanctionedCount} Sanctioned`;
    }
    catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to load users');
    }
}
// 4. Backups & Disaster Recovery
async function loadBackups() {
    const tbody = document.querySelector('#admin-backups-tbody');
    const emptyNotice = document.querySelector('#admin-backups-empty');
    const metricCount = document.querySelector('#metric-backups-count');
    if (!tbody)
        return;
    tbody.innerHTML = '';
    try {
        const res = await adminRequest('/admin/api/backups');
        const backups = res.backups ?? [];
        if (metricCount)
            metricCount.textContent = String(backups.length);
        if (backups.length === 0) {
            if (emptyNotice)
                emptyNotice.hidden = false;
            return;
        }
        if (emptyNotice)
            emptyNotice.hidden = true;
        for (const b of backups) {
            const tr = document.createElement('tr');
            const tdFile = document.createElement('td');
            tdFile.innerHTML = `<code>${b.fileName}</code>`;
            const tdSize = document.createElement('td');
            tdSize.textContent = `${(b.sizeBytes / 1024).toFixed(1)} KB`;
            const tdSha = document.createElement('td');
            tdSha.innerHTML = `<code class="key-masked-code" title="${b.ciphertextSha256}">${b.ciphertextSha256.slice(0, 16)}...</code>`;
            const tdCreated = document.createElement('td');
            tdCreated.textContent = new Date(b.createdAt).toLocaleString();
            const tdActions = document.createElement('td');
            const verifyBtn = document.createElement('button');
            verifyBtn.className = 'btn-mod';
            verifyBtn.textContent = 'Verify Integrity';
            verifyBtn.addEventListener('click', async () => {
                const pass = prompt('Enter passphrase to verify archive integrity:');
                if (!pass)
                    return;
                try {
                    const v = await adminRequest('/admin/api/backups/verify', 'POST', {
                        archivePath: b.path || b.fileName,
                        passphrase: pass,
                    });
                    if (v.valid) {
                        showToast('✅ Backup archive integrity verified! SHA-256 and AES-GCM tags match.');
                    }
                }
                catch (err) {
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
    }
    catch (err) {
        if (emptyNotice) {
            emptyNotice.hidden = false;
            emptyNotice.textContent = err instanceof Error ? err.message : 'Failed to load backups';
        }
    }
}
// 5. Audit Log
async function loadAudit() {
    const tbody = document.querySelector('#admin-audit-tbody');
    const emptyNotice = document.querySelector('#admin-audit-empty');
    if (!tbody)
        return;
    tbody.innerHTML = '';
    try {
        const res = await adminRequest('/admin/api/audit', 'POST', {});
        const logs = res.auditLogs ?? [];
        if (logs.length === 0) {
            if (emptyNotice)
                emptyNotice.hidden = false;
            return;
        }
        if (emptyNotice)
            emptyNotice.hidden = true;
        for (const a of logs) {
            const createdStr = a.created_at || a.createdAt;
            const createdFormatted = createdStr ? new Date(createdStr).toLocaleString() : 'Just now';
            const actor = a.actorId || a.actor_id || 'system';
            const targetType = a.targetType || a.target_type || 'n/a';
            const targetId = a.targetId || a.target_id || 'n/a';
            const tr = document.createElement('tr');
            tr.innerHTML = `
        <td>${createdFormatted}</td>
        <td><code>${actor}</code></td>
        <td><span class="provider-tag">${a.action}</span></td>
        <td>${targetType}</td>
        <td><code>${targetId}</code></td>
        <td><pre style="margin:0;font-size:11px;">${JSON.stringify(a.metadata || {})}</pre></td>
      `;
            tbody.appendChild(tr);
        }
    }
    catch (err) {
        if (emptyNotice) {
            emptyNotice.hidden = false;
            emptyNotice.textContent = err instanceof Error ? err.message : 'Failed to load audit';
        }
    }
}
async function loadTokens() {
    const availableMetric = document.querySelector('#metric-tokens-available');
    const totalMetric = document.querySelector('#metric-tokens-total');
    const hintMetric = document.querySelector('#metric-tokens-hint');
    const statAvail = document.querySelector('#stat-tokens-available');
    const statTotal = document.querySelector('#stat-tokens-total');
    const statConsumed = document.querySelector('#stat-tokens-consumed');
    const statIn = document.querySelector('#stat-tokens-in');
    const statOut = document.querySelector('#stat-tokens-out');
    const statUtil = document.querySelector('#stat-tokens-utilization');
    const progressFill = document.querySelector('#stat-tokens-progress-fill');
    const provCountSub = document.querySelector('#stat-tokens-providers-count');
    const providerTbody = document.querySelector('#admin-provider-tokens-tbody');
    const providerEmpty = document.querySelector('#admin-provider-tokens-empty');
    const userTbody = document.querySelector('#admin-user-tokens-tbody');
    const userEmpty = document.querySelector('#admin-user-tokens-empty');
    try {
        let res;
        try {
            res = await adminRequest('/admin/api/tokens');
        }
        catch {
            res = await adminRequest('/api/tokens');
        }
        if (!res || !res.summary)
            return;
        const { summary, byProvider, byUser } = res;
        const fmt = (n) => n.toLocaleString('en-US');
        const fmtCompact = (n) => {
            if (n >= 1000000)
                return (n / 1000000).toFixed(2) + 'M';
            if (n >= 1000)
                return (n / 1000).toFixed(1) + 'k';
            return String(n);
        };
        // 1. Top metric card
        if (availableMetric)
            availableMetric.textContent = fmtCompact(summary.availableTokens);
        if (totalMetric)
            totalMetric.textContent = `${fmtCompact(summary.totalTokens)} Total`;
        if (hintMetric)
            hintMetric.textContent = `${fmt(summary.consumedTokens)} Consumed (${summary.utilizationPercent}% used)`;
        // 2. Tab stats boxes
        if (statAvail)
            statAvail.textContent = fmt(summary.availableTokens);
        if (statTotal)
            statTotal.textContent = fmt(summary.totalTokens);
        if (statConsumed)
            statConsumed.textContent = fmt(summary.consumedTokens);
        if (statIn)
            statIn.textContent = fmt(summary.inputTokens);
        if (statOut)
            statOut.textContent = fmt(summary.outputTokens);
        if (statUtil)
            statUtil.textContent = `${summary.utilizationPercent}%`;
        if (progressFill)
            progressFill.style.width = `${Math.min(100, Math.max(1, summary.utilizationPercent))}%`;
        if (provCountSub)
            provCountSub.textContent = `${summary.configuredProviders} Configured Providers · ${summary.activeKeysCount} Active Keys`;
        // 3. Provider table ("Which Have How Many")
        if (providerTbody) {
            providerTbody.innerHTML = '';
            if (!byProvider || byProvider.length === 0) {
                if (providerEmpty)
                    providerEmpty.hidden = false;
            }
            else {
                if (providerEmpty)
                    providerEmpty.hidden = true;
                for (const p of byProvider) {
                    const tr = document.createElement('tr');
                    const statusBadge = p.status === 'active'
                        ? '<span class="status-pill status-pill-active">ACTIVE</span>'
                        : p.status === 'ready'
                            ? '<span class="status-pill status-pill-online">READY</span>'
                            : '<span class="status-pill status-pill-offline">OFFLINE</span>';
                    tr.innerHTML = `
            <td>
              <strong>${p.displayName}</strong>
              <div class="muted small">${p.provider}</div>
            </td>
            <td>${statusBadge}</td>
            <td><strong>${p.activeKeys}</strong> / ${p.keysCount}</td>
            <td><strong>${fmt(p.requestsUsed)}</strong> reqs</td>
            <td><strong>${fmt(p.totalTokens)}</strong> tokens</td>
            <td><strong style="color: var(--admin-accent-green);">${fmt(p.availableTokens)}</strong></td>
            <td>${fmt(p.dailyTokenCapacity)} / day</td>
            <td>
              <div class="token-bar-inline">
                <div class="token-bar-inline-fill" style="width: ${Math.min(100, p.utilizationPercent)}%"></div>
              </div>
              <span class="small">${p.utilizationPercent}%</span>
            </td>
          `;
                    providerTbody.appendChild(tr);
                }
            }
        }
        // 4. User table ("Which Have How Many")
        if (userTbody) {
            userTbody.innerHTML = '';
            if (!byUser || byUser.length === 0) {
                if (userEmpty)
                    userEmpty.hidden = false;
            }
            else {
                if (userEmpty)
                    userEmpty.hidden = true;
                for (const u of byUser) {
                    const tr = document.createElement('tr');
                    const remainingBadgeClass = u.quotaRemainingPercent > 50
                        ? 'token-badge-green'
                        : u.quotaRemainingPercent > 20
                            ? 'token-badge-blue'
                            : 'token-badge-gold';
                    tr.innerHTML = `
            <td>
              <strong>${u.displayName}</strong>
            </td>
            <td><code>${u.userId}</code></td>
            <td><span class="token-badge-pill token-badge-blue">${u.tier.toUpperCase()}</span></td>
            <td><strong>${u.requests}</strong> / ${u.dailyRequestLimit}</td>
            <td>${fmt(u.inputTokens)}</td>
            <td>${fmt(u.outputTokens)}</td>
            <td><strong>${fmt(u.consumedTokens)}</strong></td>
            <td><strong style="color: var(--admin-accent-green);">${fmt(u.availableTokens)}</strong></td>
            <td>
              <span class="token-badge-pill ${remainingBadgeClass}">
                ${u.quotaRemainingPercent}% Remaining
              </span>
            </td>
          `;
                    userTbody.appendChild(tr);
                }
            }
        }
    }
    catch (err) {
        console.error('Failed to load token ledger stats:', err);
    }
}
async function refreshAll() {
    await Promise.allSettled([
        loadTokens(),
        loadKeys(),
        loadKillSwitches(),
        loadUsers(),
        loadBackups(),
        loadAudit(),
    ]);
}
function initEventHandlers() {
    // Tabs
    document.querySelectorAll('.admin-tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.admin-tab-btn').forEach((b) => b.classList.remove('active'));
            document.querySelectorAll('.admin-tab-panel').forEach((p) => p.setAttribute('hidden', ''));
            btn.classList.add('active');
            const targetId = btn.dataset.tab;
            const targetPanel = targetId ? document.getElementById(targetId) : null;
            if (targetPanel)
                targetPanel.removeAttribute('hidden');
        });
    });
    // Theme Toggle
    const themeToggle = document.querySelector('#admin-theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const isLight = document.documentElement.getAttribute('data-theme') === 'light';
            if (isLight) {
                document.documentElement.removeAttribute('data-theme');
            }
            else {
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
    function detectProviderFromKey(key) {
        const trimmed = key.trim();
        if (!trimmed)
            return null;
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
    const valInput = document.querySelector('#admin-key-value');
    const provSelect = document.querySelector('#admin-key-provider');
    const customGroup = document.querySelector('#admin-custom-provider-group');
    const labelInput = document.querySelector('#admin-key-label');
    const detectPill = document.querySelector('#admin-key-detect-pill');
    const connectStatus = document.querySelector('#admin-key-connect-status');
    const testKeyBtn = document.querySelector('#admin-btn-test-key');
    let verifyTimeout = null;
    async function runConnectionTest() {
        if (!valInput || !provSelect || !connectStatus)
            return;
        const rawVal = valInput.value.trim();
        if (rawVal.length < 8) {
            connectStatus.setAttribute('hidden', '');
            return;
        }
        let prov = provSelect.value;
        if (prov === 'custom') {
            const customNameEl = document.querySelector('#admin-key-custom-name');
            prov = customNameEl?.value.trim().toLowerCase() || 'custom';
        }
        connectStatus.removeAttribute('hidden');
        connectStatus.className = 'key-connect-status testing';
        connectStatus.innerHTML = `<span class="spinner-small"></span> Testing live connection to ${prov}...`;
        try {
            let res;
            try {
                res = await adminRequest('/admin/api/keys/verify', 'POST', { provider: prov, apiKey: rawVal });
            }
            catch {
                res = await adminRequest('/api/keys/verify', 'POST', { provider: prov, apiKey: rawVal });
            }
            if (res.connected) {
                connectStatus.className = 'key-connect-status connected';
                connectStatus.innerHTML = `🟢 <strong>Connected</strong>: ${res.message || 'Ready for instant AI chat'}`;
            }
            else {
                connectStatus.className = 'key-connect-status failed';
                connectStatus.innerHTML = `🔴 <strong>Connection error</strong>: ${res.error || 'Invalid key or unauthorized'}`;
            }
        }
        catch (err) {
            connectStatus.className = 'key-connect-status failed';
            connectStatus.innerHTML = `🔴 <strong>Connection error</strong>: ${err instanceof Error ? err.message : 'Network error'}`;
        }
    }
    if (valInput) {
        const handleKeyChange = () => {
            const detected = detectProviderFromKey(valInput.value);
            if (detected && provSelect) {
                provSelect.value = detected.provider;
                if (customGroup)
                    customGroup.setAttribute('hidden', '');
                if (detectPill) {
                    detectPill.removeAttribute('hidden');
                    detectPill.textContent = `✨ Auto-detected: ${detected.name}`;
                }
                if (labelInput && !labelInput.value.trim()) {
                    labelInput.value = `${detected.name.split(' ')[0]} Key`;
                }
            }
            else if (detectPill) {
                detectPill.setAttribute('hidden', '');
            }
            if (verifyTimeout)
                clearTimeout(verifyTimeout);
            if (valInput.value.trim().length >= 8) {
                verifyTimeout = setTimeout(() => {
                    void runConnectionTest();
                }, 700);
            }
            else if (connectStatus) {
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
                document.querySelector('#admin-key-custom-name')?.focus();
            }
            else {
                customGroup.setAttribute('hidden', '');
            }
            if (valInput && valInput.value.trim().length >= 8) {
                void runConnectionTest();
            }
        });
    }
    // Add Key Form
    const keyForm = document.querySelector('#admin-add-key-form');
    if (keyForm) {
        keyForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const provEl = document.querySelector('#admin-key-provider');
            const labelEl = document.querySelector('#admin-key-label');
            const valEl = document.querySelector('#admin-key-value');
            const expEl = document.querySelector('#admin-key-expiry');
            const customNameEl = document.querySelector('#admin-key-custom-name');
            const submitBtn = document.querySelector('#admin-btn-save-key');
            if (!provEl || !labelEl || !valEl)
                return;
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
                }
                else if (rawCustom === 'google') {
                    provider = 'gemini';
                }
                else if (rawCustom === 'githubmodels') {
                    provider = 'github';
                }
                else if ([
                    'openrouter',
                    'deepseek',
                    'mistral',
                    'cerebras',
                    'together',
                    'sambanova',
                    'openai',
                    'anthropic',
                ].includes(rawCustom)) {
                    provider = rawCustom;
                }
                else {
                    provider = `custom:${rawCustom.replace(/[^a-z0-9_-]/g, '')}`;
                }
            }
            const label = labelEl.value.trim();
            const apiKey = valEl.value.trim();
            const expiresAt = expEl?.value ? new Date(expEl.value).toISOString() : null;
            if (!label || !apiKey)
                return;
            if (submitBtn)
                submitBtn.disabled = true;
            try {
                let res;
                try {
                    res = await adminRequest('/admin/api/keys', 'POST', { provider, label, apiKey, expiresAt });
                }
                catch {
                    res = await adminRequest('/api/keys', 'POST', { provider, label, apiKey, expiresAt });
                }
                const connMsg = res.connection?.connected
                    ? ` (${res.connection.message || 'Connected 🟢'})`
                    : '';
                showToast(`Key '${label}' added and connected to ${provider}!${connMsg}`);
                labelEl.value = '';
                valEl.value = '';
                if (expEl)
                    expEl.value = '';
                if (customNameEl)
                    customNameEl.value = '';
                if (customGroup)
                    customGroup.setAttribute('hidden', '');
                if (detectPill)
                    detectPill.setAttribute('hidden', '');
                if (connectStatus)
                    connectStatus.setAttribute('hidden', '');
                if (provEl)
                    provEl.value = 'groq';
                await loadKeys();
            }
            catch (err) {
                showToast(err instanceof Error ? err.message : 'Failed to add key');
            }
            finally {
                if (submitBtn)
                    submitBtn.disabled = false;
            }
        });
    }
    // Create Backup Form
    const backupForm = document.querySelector('#admin-backup-form');
    if (backupForm) {
        backupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const passEl = document.querySelector('#backup-passphrase');
            const nameEl = document.querySelector('#backup-filename');
            const submitBtn = document.querySelector('#btn-create-backup');
            if (!passEl)
                return;
            const passphrase = passEl.value;
            const fileName = nameEl?.value.trim() || undefined;
            if (!passphrase || passphrase.length < 8) {
                showToast('Passphrase must be at least 8 characters');
                return;
            }
            if (submitBtn)
                submitBtn.disabled = true;
            try {
                await adminRequest('/admin/api/backups', 'POST', {
                    passphrase,
                    fileName,
                    metadata: { createdVia: 'super_admin_ui' },
                });
                showToast('🔒 Encrypted backup archive created successfully!');
                passEl.value = '';
                if (nameEl)
                    nameEl.value = '';
                await loadBackups();
            }
            catch (err) {
                showToast(err instanceof Error ? err.message : 'Backup generation failed');
            }
            finally {
                if (submitBtn)
                    submitBtn.disabled = false;
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
    }
    else {
        await refreshAll();
    }
});
