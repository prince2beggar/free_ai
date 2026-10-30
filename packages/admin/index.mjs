import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppError } from '../api/errors.mjs';
import { verifyTotp } from './totp.mjs';

const defaults = JSON.parse(await readFile(new URL('./defaults.json', import.meta.url), 'utf8'));

const idPattern = /^[a-z0-9_:-]{2,80}$/;

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function createAdmin(db, options = {}) {
  const clock = options.clock ?? Date.now;
  const sessionTtlSeconds = options.sessionTtlSeconds ?? defaults.sessionTtlSeconds;
  const totpStepSeconds = options.totpStepSeconds ?? defaults.totpStepSeconds;
  const totpWindow = options.totpWindow ?? defaults.totpWindow;

  async function seedSystemRoles() {
    for (const role of defaults.systemRoles) {
      await db.query(
        `INSERT INTO staff_roles (id, name, description, permissions, is_system)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           permissions = EXCLUDED.permissions`,
        [role.id, role.name, role.description, JSON.stringify(role.permissions)],
      );
    }
  }

  async function seedKillSwitches(actorId) {
    const now = new Date(clock()).toISOString();
    for (const switchId of defaults.killSwitches) {
      await db.query(
        `INSERT INTO kill_switches (id, enabled, reason, updated_by, updated_at)
         VALUES ($1, FALSE, 'Initial seed', $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [switchId, actorId, now],
      );
      if (actorId) {
        await db.query(
          `INSERT INTO config_revisions (entity_type, entity_id, version, action, actor_id, before_data, after_data, reason, idempotency_key, created_at)
           VALUES ('kill_switch', $1, 1, 'create', $2, NULL, $3, 'Initial platform seed', $4, $5)
           ON CONFLICT (entity_type, entity_id, version) DO NOTHING`,
          [
            switchId,
            actorId,
            JSON.stringify({ id: switchId, enabled: false, reason: 'Initial seed' }),
            'seed-initial-' + switchId,
            now,
          ],
        );
      }
    }
  }

  async function getRole(roleId) {
    const res = await db.query('SELECT * FROM staff_roles WHERE id = $1', [roleId]);
    return res.rows[0] ?? null;
  }

  async function listRoles() {
    const res = await db.query('SELECT * FROM staff_roles ORDER BY id ASC');
    return res.rows.map((r) => ({
      ...r,
      permissions: typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions,
    }));
  }

  async function createRole(actorStaff, { id, name, description, permissions }) {
    assertHasPermission(actorStaff, 'role:manage');
    if (!id || !/^[a-z0-9_-]{2,40}$/.test(id)) {
      throw new AppError(400, 'INVALID_ROLE_ID', 'Invalid role id format.');
    }
    if (!name || name.length < 2 || name.length > 60) {
      throw new AppError(400, 'INVALID_ROLE_NAME', 'Invalid role name.');
    }
    if (
      !Array.isArray(permissions) ||
      !permissions.every((p) => defaults.permissions.includes(p))
    ) {
      throw new AppError(400, 'INVALID_PERMISSIONS', 'Unknown or invalid permission in list.');
    }
    await db.query(
      `INSERT INTO staff_roles (id, name, description, permissions, is_system)
       VALUES ($1, $2, $3, $4, FALSE)`,
      [id, name, description ?? null, JSON.stringify(permissions)],
    );
    await recordAudit(actorStaff, {
      action: 'ROLE_CREATED',
      targetType: 'role',
      targetId: id,
      metadata: { name, permissions },
    });
    return getRole(id);
  }

  async function updateRole(actorStaff, { id, name, description, permissions }) {
    assertHasPermission(actorStaff, 'role:manage');
    const existing = await getRole(id);
    if (!existing) throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found.');
    if (existing.is_system && id === 'super_admin') {
      throw new AppError(403, 'SYSTEM_ROLE_PROTECTED', 'Cannot modify super_admin system role.');
    }
    const updatedPermissions = permissions !== undefined ? permissions : existing.permissions;
    if (
      !Array.isArray(updatedPermissions) ||
      !updatedPermissions.every((p) => defaults.permissions.includes(p))
    ) {
      throw new AppError(400, 'INVALID_PERMISSIONS', 'Unknown or invalid permission in list.');
    }
    const updatedName = name ?? existing.name;
    const updatedDesc = description ?? existing.description;
    await db.query(
      `UPDATE staff_roles SET name = $1, description = $2, permissions = $3 WHERE id = $4`,
      [updatedName, updatedDesc, JSON.stringify(updatedPermissions), id],
    );
    await recordAudit(actorStaff, {
      action: 'ROLE_UPDATED',
      targetType: 'role',
      targetId: id,
      metadata: { before: existing, after: { name: updatedName, permissions: updatedPermissions } },
    });
    return getRole(id);
  }

  function hasPermission(staffUser, permission) {
    if (!staffUser || !staffUser.role) return false;
    const permissions = Array.isArray(staffUser.role.permissions)
      ? staffUser.role.permissions
      : typeof staffUser.role.permissions === 'string'
        ? JSON.parse(staffUser.role.permissions)
        : [];
    if (staffUser.role.id === 'super_admin' || permissions.includes('all')) return true;
    return permissions.includes(permission);
  }

  function assertHasPermission(staffUser, permission) {
    if (!hasPermission(staffUser, permission)) {
      throw new AppError(
        403,
        'INSUFFICIENT_PERMISSIONS',
        `Staff lacks required permission: ${permission}`,
      );
    }
  }

  async function getStaffUser(userId) {
    const res = await db.query(
      `SELECT s.*, u.email, u.display_name, r.id as role_id, r.name as role_name, r.permissions
       FROM staff_users s
       JOIN users u ON s.id = u.id
       JOIN staff_roles r ON s.role_id = r.id
       WHERE s.id = $1`,
      [userId],
    );
    if (!res.rows[0]) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      status: row.status,
      totpSecret: row.totp_secret,
      createdAt: row.created_at,
      role: {
        id: row.role_id,
        name: row.role_name,
        permissions:
          typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions,
      },
    };
  }

  async function createStaffUser(actorStaff, { userId, roleId, totpSecret }) {
    if (actorStaff) assertHasPermission(actorStaff, 'staff:manage');
    const role = await getRole(roleId);
    if (!role) throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found.');
    if (!totpSecret || totpSecret.length < 16) {
      throw new AppError(400, 'INVALID_TOTP_SECRET', 'TOTP secret must be at least 16 characters.');
    }
    await db.query(
      `INSERT INTO staff_users (id, role_id, totp_secret, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (id) DO UPDATE SET
         role_id = EXCLUDED.role_id,
         totp_secret = EXCLUDED.totp_secret,
         status = 'active'`,
      [userId, roleId, totpSecret],
    );
    if (actorStaff) {
      await recordAudit(actorStaff, {
        action: 'STAFF_USER_CREATED',
        targetType: 'staff_user',
        targetId: userId,
        metadata: { roleId },
      });
    }
    return getStaffUser(userId);
  }

  async function updateStaffUser(actorStaff, { targetStaffId, roleId, status }) {
    assertHasPermission(actorStaff, 'staff:manage');
    const current = await getStaffUser(targetStaffId);
    if (!current) throw new AppError(404, 'STAFF_NOT_FOUND', 'Staff user not found.');
    if (targetStaffId === actorStaff.id && status === 'suspended') {
      throw new AppError(400, 'CANNOT_SUSPEND_SELF', 'Cannot suspend your own staff account.');
    }
    const newRoleId = roleId ?? current.role.id;
    const newStatus = status ?? current.status;
    if (roleId && !(await getRole(roleId))) {
      throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found.');
    }
    await db.query(`UPDATE staff_users SET role_id = $1, status = $2 WHERE id = $3`, [
      newRoleId,
      newStatus,
      targetStaffId,
    ]);
    await recordAudit(actorStaff, {
      action: 'STAFF_USER_UPDATED',
      targetType: 'staff_user',
      targetId: targetStaffId,
      metadata: {
        before: { roleId: current.role.id, status: current.status },
        after: { roleId: newRoleId, status: newStatus },
      },
    });
    return getStaffUser(targetStaffId);
  }

  async function createSession(staffId, mfaVerified = false) {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = sha256(rawToken);
    const csrfToken = randomBytes(24).toString('hex');
    const csrfHash = sha256(csrfToken);
    const sessionId = randomUUID();
    const now = clock();
    const expiresAt = new Date(now + sessionTtlSeconds * 1000).toISOString();
    await db.query(
      `INSERT INTO staff_sessions (id, token_hash, staff_id, mfa_verified, csrf_hash, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        sessionId,
        tokenHash,
        staffId,
        mfaVerified,
        csrfHash,
        new Date(now).toISOString(),
        expiresAt,
      ],
    );
    return { token: rawToken, csrfToken, sessionId, expiresAt, mfaVerified };
  }

  async function authenticateSession(token, { requireMfa = true } = {}) {
    if (!token || typeof token !== 'string') return null;
    const tokenHash = sha256(token);
    const now = new Date(clock()).toISOString();
    const res = await db.query(
      `SELECT sess.*, su.status as staff_status, su.role_id, su.totp_secret,
              r.name as role_name, r.permissions
       FROM staff_sessions sess
       JOIN staff_users su ON sess.staff_id = su.id
       JOIN staff_roles r ON su.role_id = r.id
       WHERE sess.token_hash = $1
         AND sess.revoked_at IS NULL
         AND sess.expires_at > $2
         AND su.status = 'active'`,
      [tokenHash, now],
    );
    if (!res.rows[0]) return null;
    const row = res.rows[0];
    if (requireMfa && !row.mfa_verified) {
      throw new AppError(403, 'MFA_REQUIRED', 'Admin action requires completed MFA verification.');
    }
    const staff = {
      id: row.staff_id,
      role: {
        id: row.role_id,
        name: row.role_name,
        permissions:
          typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions,
      },
      mfaVerified: row.mfa_verified,
      sessionId: row.id,
      csrfHash: row.csrf_hash,
      totpSecret: row.totp_secret,
    };
    return staff;
  }

  async function verifySessionMfa(sessionToken, totpCode, ipAddress = null) {
    const staff = await authenticateSession(sessionToken, { requireMfa: false });
    if (!staff) throw new AppError(401, 'INVALID_SESSION', 'Session invalid or expired.');
    if (staff.mfaVerified) return { ok: true, alreadyVerified: true };
    const valid = verifyTotp(staff.totpSecret, totpCode, clock(), totpStepSeconds, totpWindow);
    if (!valid) {
      throw new AppError(400, 'INVALID_MFA_CODE', 'Invalid or expired TOTP code.');
    }
    const tokenHash = sha256(sessionToken);
    await db.query(`UPDATE staff_sessions SET mfa_verified = TRUE WHERE token_hash = $1`, [
      tokenHash,
    ]);
    staff.mfaVerified = true;
    await recordAudit(staff, {
      action: 'STAFF_MFA_VERIFIED',
      targetType: 'staff_session',
      targetId: staff.sessionId,
      metadata: { staffId: staff.id },
      ipHash: ipAddress ? sha256(ipAddress) : null,
    });
    return { ok: true, mfaVerified: true };
  }

  async function revokeSession(sessionToken) {
    if (!sessionToken) return;
    const tokenHash = sha256(sessionToken);
    await db.query(`UPDATE staff_sessions SET revoked_at = $1 WHERE token_hash = $2`, [
      new Date(clock()).toISOString(),
      tokenHash,
    ]);
  }

  async function getKillSwitches() {
    const res = await db.query('SELECT * FROM kill_switches ORDER BY id ASC');
    const map = {};
    for (const row of res.rows) {
      map[row.id] = {
        id: row.id,
        enabled: row.enabled,
        reason: row.reason,
        updatedBy: row.updated_by,
        updatedAt: row.updated_at,
      };
    }
    return map;
  }

  async function isKillSwitchActive(switchId) {
    const switches = await getKillSwitches();
    if (switches['all_ai']?.enabled) return true;
    if (switchId && switches[switchId]?.enabled) return true;
    if (switchId?.startsWith('model:')) {
      const parts = switchId.split(':');
      if (parts.length > 2) {
        const providerId = parts[1];
        if (switches[`provider:${providerId}`]?.enabled) return true;
      }
    }
    return false;
  }

  async function setKillSwitch(actorStaff, { id, enabled, reason, idempotencyKey }) {
    assertHasPermission(actorStaff, 'kill_switch:manage');
    if (!id || !idPattern.test(id)) {
      throw new AppError(400, 'INVALID_SWITCH_ID', 'Invalid kill switch identifier.');
    }
    if (typeof enabled !== 'boolean') {
      throw new AppError(400, 'INVALID_ENABLED_VALUE', 'Kill switch state must be a boolean.');
    }
    const switchReason = reason ?? (enabled ? 'Emergency shutdown' : 'Re-enabled');
    const key = idempotencyKey ?? randomUUID();
    return db.transaction(async (tx) => {
      const existing = (await tx.query('SELECT * FROM kill_switches WHERE id = $1', [id])).rows[0];
      const beforeData = existing
        ? { id: existing.id, enabled: existing.enabled, reason: existing.reason }
        : null;
      const afterData = { id, enabled, reason: switchReason };
      const now = new Date(clock()).toISOString();
      await tx.query(
        `INSERT INTO kill_switches (id, enabled, reason, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           enabled = EXCLUDED.enabled,
           reason = EXCLUDED.reason,
           updated_by = EXCLUDED.updated_by,
           updated_at = EXCLUDED.updated_at`,
        [id, enabled, switchReason, actorStaff.id, now],
      );
      const revRes = await tx.query(
        `SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM config_revisions WHERE entity_type = 'kill_switch' AND entity_id = $1`,
        [id],
      );
      const nextVersion = revRes.rows[0].next_version;
      await tx.query(
        `INSERT INTO config_revisions (entity_type, entity_id, version, action, actor_id, before_data, after_data, reason, idempotency_key, created_at)
         VALUES ('kill_switch', $1, $2, 'update', $3, $4, $5, $6, $7, $8)`,
        [
          id,
          nextVersion,
          actorStaff.id,
          beforeData ? JSON.stringify(beforeData) : null,
          JSON.stringify(afterData),
          switchReason,
          key,
          now,
        ],
      );
      const auditId = randomUUID();
      await tx.query(
        `INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, metadata, created_at)
         VALUES ($1, $2, 'KILL_SWITCH_TOGGLED', 'kill_switch', $3, $4, $5)`,
        [
          auditId,
          actorStaff.id,
          id,
          JSON.stringify({ enabled, reason: switchReason, version: nextVersion }),
          now,
        ],
      );
      return { id, enabled, reason: switchReason, version: nextVersion, updatedAt: now };
    });
  }

  async function recordConfigRevision(
    actorStaff,
    { entityType, entityId, action, beforeData, afterData, reason, idempotencyKey },
  ) {
    const key = idempotencyKey ?? randomUUID();
    const now = new Date(clock()).toISOString();
    const revRes = await db.query(
      `SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM config_revisions WHERE entity_type = $1 AND entity_id = $2`,
      [entityType, entityId],
    );
    const nextVersion = revRes.rows[0].next_version;
    await db.query(
      `INSERT INTO config_revisions (entity_type, entity_id, version, action, actor_id, before_data, after_data, reason, idempotency_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        entityType,
        entityId,
        nextVersion,
        action,
        actorStaff.id,
        beforeData ? JSON.stringify(beforeData) : null,
        JSON.stringify(afterData),
        reason,
        key,
        now,
      ],
    );
    return { version: nextVersion, entityType, entityId, action, afterData };
  }

  async function getConfigHistory(entityType, entityId) {
    const res = await db.query(
      `SELECT cr.*, su.role_id as actor_role
       FROM config_revisions cr
       JOIN staff_users su ON cr.actor_id = su.id
       WHERE cr.entity_type = $1 AND cr.entity_id = $2
       ORDER BY cr.version DESC`,
      [entityType, entityId],
    );
    return res.rows.map((r) => ({
      ...r,
      beforeData: r.before_data
        ? typeof r.before_data === 'string'
          ? JSON.parse(r.before_data)
          : r.before_data
        : null,
      afterData: typeof r.after_data === 'string' ? JSON.parse(r.after_data) : r.after_data,
    }));
  }

  async function rollbackConfig(
    actorStaff,
    { entityType, entityId, targetVersion, reason, idempotencyKey },
  ) {
    assertHasPermission(actorStaff, 'config:rollback');
    if (!targetVersion || targetVersion < 1) {
      throw new AppError(400, 'INVALID_TARGET_VERSION', 'Invalid target version for rollback.');
    }
    const history = await getConfigHistory(entityType, entityId);
    const targetRev = history.find((h) => h.version === targetVersion);
    if (!targetRev) {
      throw new AppError(
        404,
        'VERSION_NOT_FOUND',
        `Target revision version ${targetVersion} not found.`,
      );
    }
    const currentRev = history[0];
    const restoredData = targetRev.afterData;
    const rollbackReason =
      reason ?? `Rollback ${entityType}:${entityId} to version ${targetVersion}`;
    const key = idempotencyKey ?? randomUUID();
    const now = new Date(clock()).toISOString();

    return db.transaction(async (tx) => {
      if (entityType === 'kill_switch') {
        await tx.query(
          `UPDATE kill_switches SET enabled = $1, reason = $2, updated_by = $3, updated_at = $4 WHERE id = $5`,
          [restoredData.enabled, rollbackReason, actorStaff.id, now, entityId],
        );
      } else if (entityType === 'routing_policy') {
        const nextPolicyVerRes = await tx.query(
          `SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM routing_policies WHERE id = $1`,
          [entityId],
        );
        const nextPolicyVersion = nextPolicyVerRes.rows[0].next_version;
        await tx.query(`UPDATE routing_policies SET version = $1, data = $2 WHERE id = $3`, [
          nextPolicyVersion,
          JSON.stringify(restoredData),
          entityId,
        ]);
        await tx.query(
          `INSERT INTO router_policy_versions (id, policy_id, version, actor_id, actor_role, idempotency_key, request_hash, data, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            randomUUID(),
            entityId,
            nextPolicyVersion,
            actorStaff.id,
            actorStaff.role.id,
            key,
            sha256(JSON.stringify(restoredData)),
            JSON.stringify(restoredData),
            now,
          ],
        );
      } else if (entityType === 'role') {
        await tx.query(
          `UPDATE staff_roles SET name = $1, description = $2, permissions = $3 WHERE id = $4`,
          [
            restoredData.name,
            restoredData.description ?? null,
            JSON.stringify(restoredData.permissions),
            entityId,
          ],
        );
      } else if (entityType === 'registry_provider') {
        await tx.query(
          `UPDATE providers SET
             name = $1,
             adapter_kind = $2,
             base_url = $3,
             status = $4,
             terms_url = $5,
             terms_reviewed_at = $6,
             data_policy_flag = $7,
             allows_multiuser = $8,
             secret_ref = $9
           WHERE id = $10`,
          [
            restoredData.name,
            restoredData.adapter_kind ?? restoredData.adapterKind,
            restoredData.base_url ?? restoredData.baseUrl ?? null,
            restoredData.status,
            restoredData.terms_url ?? restoredData.termsUrl ?? null,
            restoredData.terms_reviewed_at ?? restoredData.termsReviewedAt ?? null,
            restoredData.data_policy_flag ?? restoredData.dataPolicyFlag ?? 'unknown',
            Boolean(restoredData.allows_multiuser ?? restoredData.allowsMultiuser),
            restoredData.secret_ref ?? restoredData.secretRef ?? null,
            entityId,
          ],
        );
      } else if (entityType === 'registry_model') {
        await tx.query(
          `UPDATE models SET
             display_name = $1,
             external_name = $2,
             capabilities = $3,
             context_limit = $4,
             model_class = $5,
             cu_in_rate_per_1k = $6,
             cu_out_rate_per_1k = $7,
             agent_ready = $8,
             bangla_score = $9,
             free_flag = $10,
             status = $11
           WHERE id = $12`,
          [
            restoredData.display_name ?? restoredData.displayName,
            restoredData.external_name ?? restoredData.externalName,
            restoredData.capabilities ?? ['text'],
            restoredData.context_limit ?? restoredData.contextLimit,
            restoredData.model_class ?? restoredData.modelClass ?? 'synthetic',
            restoredData.cu_in_rate_per_1k ?? restoredData.cuInRatePer1k ?? 0,
            restoredData.cu_out_rate_per_1k ?? restoredData.cuOutRatePer1k ?? 0,
            Boolean(restoredData.agent_ready ?? restoredData.agentReady),
            restoredData.bangla_score ?? restoredData.banglaScore ?? null,
            Boolean(restoredData.free_flag ?? restoredData.freeFlag),
            restoredData.status,
            entityId,
          ],
        );
      }

      const revRes = await tx.query(
        `SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM config_revisions WHERE entity_type = $1 AND entity_id = $2`,
        [entityType, entityId],
      );
      const nextVersion = revRes.rows[0].next_version;
      await tx.query(
        `INSERT INTO config_revisions (entity_type, entity_id, version, action, actor_id, before_data, after_data, reason, idempotency_key, created_at)
         VALUES ($1, $2, $3, 'rollback', $4, $5, $6, $7, $8, $9)`,
        [
          entityType,
          entityId,
          nextVersion,
          actorStaff.id,
          JSON.stringify(currentRev.afterData),
          JSON.stringify(restoredData),
          rollbackReason,
          key,
          now,
        ],
      );
      await tx.query(
        `INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, metadata, created_at)
         VALUES ($1, $2, 'CONFIG_ROLLBACK', $3, $4, $5, $6)`,
        [
          randomUUID(),
          actorStaff.id,
          entityType,
          entityId,
          JSON.stringify({ targetVersion, newVersion: nextVersion, reason: rollbackReason }),
          now,
        ],
      );

      return {
        entityType,
        entityId,
        restoredVersion: targetVersion,
        newVersion: nextVersion,
        restoredData,
      };
    });
  }

  async function recordAudit(
    actorStaff,
    { action, targetType, targetId, metadata = {}, ipHash = null },
  ) {
    const id = randomUUID();
    const now = new Date(clock()).toISOString();
    await db.query(
      `INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, metadata, ip_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, actorStaff.id, action, targetType, targetId, JSON.stringify(metadata), ipHash, now],
    );
    return id;
  }

  async function getAuditLog({ limit = 50, offset = 0, targetType, action, actorId } = {}) {
    let sql = 'SELECT * FROM admin_audit_log';
    const params = [];
    const conditions = [];
    if (targetType) {
      params.push(targetType);
      conditions.push(`target_type = $${params.length}`);
    }
    if (action) {
      params.push(action);
      conditions.push(`action = $${params.length}`);
    }
    if (actorId) {
      params.push(actorId);
      conditions.push(`actor_id = $${params.length}`);
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    params.push(limit);
    sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
    params.push(offset);
    sql += ` OFFSET $${params.length}`;
    const res = await db.query(sql, params);
    return res.rows.map((r) => ({
      ...r,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
    }));
  }

  async function exportAuditLogCsv(
    actorStaff,
    { targetType, action, limit = 500, offset = 0 } = {},
  ) {
    assertHasPermission(actorStaff, 'audit:read');
    const logs = await getAuditLog({ targetType, action, limit, offset });
    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '';
      const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
      return `"${str.replace(/"/g, '""')}"`;
    };
    const header = [
      '"id"',
      '"actor_id"',
      '"action"',
      '"target_type"',
      '"target_id"',
      '"metadata"',
      '"ip_hash"',
      '"created_at"',
    ].join(',');
    const rows = logs.map((r) =>
      [
        escapeCsv(r.id),
        escapeCsv(r.actor_id),
        escapeCsv(r.action),
        escapeCsv(r.target_type),
        escapeCsv(r.target_id),
        escapeCsv(r.metadata),
        escapeCsv(r.ip_hash),
        escapeCsv(r.created_at),
      ].join(','),
    );
    const csv = [header, ...rows].join('\n');
    await recordAudit(actorStaff, {
      action: 'AUDIT_LOG_EXPORTED',
      targetType: 'audit_log',
      targetId: 'all',
      metadata: {
        exportedCount: logs.length,
        targetType: targetType ?? null,
        action: action ?? null,
      },
    });
    return { csv, count: logs.length };
  }

  async function getDashboardOverview() {
    const requestsRes = await db.query(
      `SELECT
         count(*)::int as total,
         count(*) FILTER (WHERE state = 'COMPLETE')::int as completed,
         count(*) FILTER (WHERE state IN ('ESTIMATED', 'CORRECTED'))::int as failed,
         COALESCE(AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL), 0)::int as avg_latency
       FROM router_attempts`,
    );
    const spendRes = await db.query(
      `SELECT COALESCE(SUM(amount_micro_cu), 0)::text as total_micro_cu FROM usage_ledger WHERE type IN ('commit', 'adjust')`,
    );
    const usersRes = await db.query(
      `SELECT
         count(*)::int as total,
         count(*) FILTER (WHERE status = 'active')::int as active,
         count(*) FILTER (WHERE status = 'suspended')::int as suspended
       FROM users WHERE deleted_at IS NULL`,
    );
    const tasksRes = await db.query(
      `SELECT count(*)::int as active_tasks FROM ledger_reservations WHERE kind = 'task' AND state IN ('ACTIVE', 'PLANNING', 'AWAITING_APPROVAL', 'REVIEW')`,
    );
    const killSwitchesRes = await db.query(
      `SELECT count(*)::int as active_switches FROM kill_switches WHERE enabled = TRUE`,
    );
    const poolRes = await db.query(
      `SELECT pool_remaining_tokens::text as tokens FROM capacity_job_runs ORDER BY created_at DESC LIMIT 1`,
    );
    const nowIso = new Date(clock()).toISOString();
    const breakersCountRes = await db.query(
      `SELECT count(*)::int as active_breakers FROM router_breakers WHERE opened_until IS NOT NULL AND opened_until > $1`,
      [nowIso],
    );
    let alertsRows = [];
    try {
      const ownerAlertsRes = await db.query(
        `SELECT id, kind, title, created_at FROM owner_alerts ORDER BY created_at DESC LIMIT 5`,
      );
      if (ownerAlertsRes.rows.length > 0) {
        alertsRows = ownerAlertsRes.rows;
      }
    } catch {
      // Table may not be migrated in older fixtures
    }
    if (alertsRows.length === 0) {
      const abuseAlertsRes = await db.query(
        `SELECT id, source_kind as kind, rule as title, created_at FROM abuse_alerts ORDER BY created_at DESC LIMIT 5`,
      );
      alertsRows = abuseAlertsRes.rows;
    }

    const reqStats = requestsRes.rows[0];
    const totalRequests = reqStats.total;
    const failedRequests = reqStats.failed;
    const errorRate = totalRequests > 0 ? failedRequests / totalRequests : 0;
    const totalMicroCu = BigInt(spendRes.rows[0]?.total_micro_cu ?? '0');
    const cu = (Number(totalMicroCu) / 10000).toFixed(2);

    return {
      requests: {
        total: totalRequests,
        completed: reqStats.completed,
        failed: failedRequests,
      },
      errors: {
        total: failedRequests,
        rate: errorRate,
      },
      latency: {
        avgMs: reqStats.avg_latency,
      },
      freePoolRemaining: {
        tokens: poolRes.rows[0]?.tokens ?? '0',
        unit: 'tokens',
      },
      spend: {
        totalMicroCu: totalMicroCu.toString(),
        cu,
      },
      activeUsers: usersRes.rows[0].active,
      totalUsers: usersRes.rows[0].total,
      suspendedUsers: usersRes.rows[0].suspended,
      activeTasks: tasksRes.rows[0].active_tasks,
      openIncidents: killSwitchesRes.rows[0].active_switches,
      activeBreakers: breakersCountRes.rows[0]?.active_breakers ?? 0,
      recentAlerts: alertsRows.map((a) => ({
        id: a.id,
        kind: a.kind,
        title: a.title,
        createdAt: a.created_at,
      })),
      syntheticOnly: true,
    };
  }

  async function listProviders() {
    const res = await db.query(`SELECT * FROM providers ORDER BY id ASC`);
    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      adapterKind: r.adapter_kind,
      baseUrl: r.base_url,
      status: r.status,
      termsUrl: r.terms_url,
      termsReviewedAt: r.terms_reviewed_at,
      dataPolicyFlag: r.data_policy_flag,
      allowsMultiuser: r.allows_multiuser,
      secretRef: r.secret_ref,
      createdAt: r.created_at,
    }));
  }

  async function getProvider(id) {
    const res = await db.query(`SELECT * FROM providers WHERE id = $1`, [id]);
    const r = res.rows[0];
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      adapterKind: r.adapter_kind,
      baseUrl: r.base_url,
      status: r.status,
      termsUrl: r.terms_url,
      termsReviewedAt: r.terms_reviewed_at,
      dataPolicyFlag: r.data_policy_flag,
      allowsMultiuser: r.allows_multiuser,
      secretRef: r.secret_ref,
      createdAt: r.created_at,
    };
  }

  async function upsertProvider(
    actorStaff,
    {
      id,
      name,
      adapterKind = 'synthetic_mock',
      baseUrl = null,
      status = 'disabled',
      termsUrl = null,
      termsReviewedAt = null,
      dataPolicyFlag = 'unknown',
      allowsMultiuser = false,
      secretRef = null,
      reason,
      idempotencyKey,
    },
  ) {
    assertHasPermission(actorStaff, 'provider:manage');
    if (!id || !/^[a-z0-9_-]{2,80}$/.test(id)) {
      throw new AppError(400, 'INVALID_PROVIDER_ID', 'Invalid provider ID format.');
    }
    if (!name || name.length < 2 || name.length > 80) {
      throw new AppError(400, 'INVALID_PROVIDER_NAME', 'Invalid provider name.');
    }
    if (!['synthetic_mock', 'external'].includes(adapterKind)) {
      throw new AppError(400, 'INVALID_ADAPTER_KIND', 'Invalid adapter kind.');
    }
    if (!['enabled', 'disabled'].includes(status)) {
      throw new AppError(400, 'INVALID_STATUS', 'Invalid status.');
    }
    if (!['no_training', 'may_train', 'unknown', 'synthetic_only'].includes(dataPolicyFlag)) {
      throw new AppError(400, 'INVALID_DATA_POLICY', 'Invalid data policy flag.');
    }

    const key = idempotencyKey ?? randomUUID();
    const actionReason = reason ?? `Upsert provider ${id}`;
    const now = new Date(clock()).toISOString();

    return db.transaction(async (tx) => {
      const existingRes = await tx.query(`SELECT * FROM providers WHERE id = $1`, [id]);
      const existing = existingRes.rows[0] ?? null;

      await tx.query(
        `INSERT INTO providers (id, name, adapter_kind, base_url, status, terms_url, terms_reviewed_at, data_policy_flag, allows_multiuser, secret_ref, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           adapter_kind = EXCLUDED.adapter_kind,
           base_url = EXCLUDED.base_url,
           status = EXCLUDED.status,
           terms_url = EXCLUDED.terms_url,
           terms_reviewed_at = EXCLUDED.terms_reviewed_at,
           data_policy_flag = EXCLUDED.data_policy_flag,
           allows_multiuser = EXCLUDED.allows_multiuser,
           secret_ref = EXCLUDED.secret_ref`,
        [
          id,
          name,
          adapterKind,
          baseUrl,
          status,
          termsUrl,
          termsReviewedAt,
          dataPolicyFlag,
          allowsMultiuser,
          secretRef,
          now,
        ],
      );

      const afterData = {
        id,
        name,
        adapterKind,
        baseUrl,
        status,
        termsUrl,
        termsReviewedAt,
        dataPolicyFlag,
        allowsMultiuser,
        secretRef,
      };

      const revRes = await tx.query(
        `SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM config_revisions WHERE entity_type = 'registry_provider' AND entity_id = $1`,
        [id],
      );
      const nextVersion = revRes.rows[0].next_version;

      await tx.query(
        `INSERT INTO config_revisions (entity_type, entity_id, version, action, actor_id, before_data, after_data, reason, idempotency_key, created_at)
         VALUES ('registry_provider', $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          nextVersion,
          existing ? 'update' : 'create',
          actorStaff.id,
          existing ? JSON.stringify(existing) : null,
          JSON.stringify(afterData),
          actionReason,
          key,
          now,
        ],
      );

      await tx.query(
        `INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, metadata, created_at)
         VALUES ($1, $2, $3, 'provider', $4, $5, $6)`,
        [
          randomUUID(),
          actorStaff.id,
          existing ? 'PROVIDER_UPDATED' : 'PROVIDER_CREATED',
          id,
          JSON.stringify({ name, status, adapterKind, dataPolicyFlag }),
          now,
        ],
      );

      return afterData;
    });
  }

  async function testProvider(actorStaff, providerId) {
    assertHasPermission(actorStaff, 'provider:manage');
    const provider = await getProvider(providerId);
    if (!provider) {
      throw new AppError(404, 'PROVIDER_NOT_FOUND', `Provider ${providerId} not found.`);
    }
    const result = {
      ok: true,
      providerId,
      status: provider.status,
      adapterKind: provider.adapterKind,
      latencyMs: 32,
      healthy: true,
      syntheticOnly: true,
    };
    await recordAudit(actorStaff, {
      action: 'PROVIDER_TEST_CALL',
      targetType: 'provider',
      targetId: providerId,
      metadata: result,
    });
    return result;
  }

  async function listModels() {
    const res = await db.query(`SELECT * FROM models ORDER BY id ASC`);
    return res.rows.map((r) => ({
      id: r.id,
      providerId: r.provider_id,
      externalName: r.external_name,
      displayName: r.display_name,
      capabilities: r.capabilities,
      contextLimit: r.context_limit,
      modelClass: r.model_class,
      cuInRatePer1k: r.cu_in_rate_per_1k,
      cuOutRatePer1k: r.cu_out_rate_per_1k,
      agentReady: r.agent_ready,
      banglaScore: r.bangla_score,
      freeFlag: r.free_flag,
      status: r.status,
      createdAt: r.created_at,
    }));
  }

  async function getModel(id) {
    const res = await db.query(`SELECT * FROM models WHERE id = $1`, [id]);
    const r = res.rows[0];
    if (!r) return null;
    return {
      id: r.id,
      providerId: r.provider_id,
      externalName: r.external_name,
      displayName: r.display_name,
      capabilities: r.capabilities,
      contextLimit: r.context_limit,
      modelClass: r.model_class,
      cuInRatePer1k: r.cu_in_rate_per_1k,
      cuOutRatePer1k: r.cu_out_rate_per_1k,
      agentReady: r.agent_ready,
      banglaScore: r.bangla_score,
      freeFlag: r.free_flag,
      status: r.status,
      createdAt: r.created_at,
    };
  }

  async function upsertModel(
    actorStaff,
    {
      id,
      providerId,
      externalName,
      displayName,
      capabilities = ['text'],
      contextLimit = 4096,
      modelClass = 'synthetic',
      cuInRatePer1k = 0,
      cuOutRatePer1k = 0,
      agentReady = false,
      banglaScore = null,
      freeFlag = false,
      status = 'disabled',
      reason,
      idempotencyKey,
    },
  ) {
    assertHasPermission(actorStaff, 'model:manage');
    if (!id || !/^[a-z0-9_-]{2,80}$/.test(id)) {
      throw new AppError(400, 'INVALID_MODEL_ID', 'Invalid model ID format.');
    }
    if (!providerId) {
      throw new AppError(400, 'INVALID_PROVIDER_ID', 'Missing provider ID.');
    }
    if (!displayName || displayName.length < 2 || displayName.length > 80) {
      throw new AppError(400, 'INVALID_DISPLAY_NAME', 'Invalid model display name.');
    }
    if (!['enabled', 'disabled'].includes(status)) {
      throw new AppError(400, 'INVALID_STATUS', 'Invalid status.');
    }

    const key = idempotencyKey ?? randomUUID();
    const actionReason = reason ?? `Upsert model ${id}`;
    const now = new Date(clock()).toISOString();

    return db.transaction(async (tx) => {
      const existingRes = await tx.query(`SELECT * FROM models WHERE id = $1`, [id]);
      const existing = existingRes.rows[0] ?? null;

      await tx.query(
        `INSERT INTO models (id, provider_id, external_name, display_name, capabilities, context_limit, model_class, cu_in_rate_per_1k, cu_out_rate_per_1k, agent_ready, bangla_score, free_flag, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (id) DO UPDATE SET
           provider_id = EXCLUDED.provider_id,
           external_name = EXCLUDED.external_name,
           display_name = EXCLUDED.display_name,
           capabilities = EXCLUDED.capabilities,
           context_limit = EXCLUDED.context_limit,
           model_class = EXCLUDED.model_class,
           cu_in_rate_per_1k = EXCLUDED.cu_in_rate_per_1k,
           cu_out_rate_per_1k = EXCLUDED.cu_out_rate_per_1k,
           agent_ready = EXCLUDED.agent_ready,
           bangla_score = EXCLUDED.bangla_score,
           free_flag = EXCLUDED.free_flag,
           status = EXCLUDED.status`,
        [
          id,
          providerId,
          externalName ?? id,
          displayName,
          capabilities,
          contextLimit,
          modelClass,
          cuInRatePer1k,
          cuOutRatePer1k,
          agentReady,
          banglaScore,
          freeFlag,
          status,
          now,
        ],
      );

      const afterData = {
        id,
        providerId,
        externalName: externalName ?? id,
        displayName,
        capabilities,
        contextLimit,
        modelClass,
        cuInRatePer1k,
        cuOutRatePer1k,
        agentReady,
        banglaScore,
        freeFlag,
        status,
      };

      const revRes = await tx.query(
        `SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM config_revisions WHERE entity_type = 'registry_model' AND entity_id = $1`,
        [id],
      );
      const nextVersion = revRes.rows[0].next_version;

      await tx.query(
        `INSERT INTO config_revisions (entity_type, entity_id, version, action, actor_id, before_data, after_data, reason, idempotency_key, created_at)
         VALUES ('registry_model', $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          nextVersion,
          existing ? 'update' : 'create',
          actorStaff.id,
          existing ? JSON.stringify(existing) : null,
          JSON.stringify(afterData),
          actionReason,
          key,
          now,
        ],
      );

      await tx.query(
        `INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, metadata, created_at)
         VALUES ($1, $2, $3, 'model', $4, $5, $6)`,
        [
          randomUUID(),
          actorStaff.id,
          existing ? 'MODEL_UPDATED' : 'MODEL_CREATED',
          id,
          JSON.stringify({ displayName, providerId, status, cuInRatePer1k, cuOutRatePer1k }),
          now,
        ],
      );

      return afterData;
    });
  }

  async function getRoutingPolicies() {
    const res = await db.query(`SELECT * FROM routing_policies ORDER BY id ASC`);
    return res.rows.map((r) => ({
      id: r.id,
      version: r.version,
      data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
    }));
  }

  async function updateRoutingPolicy(actorStaff, { id, data, reason, idempotencyKey }) {
    assertHasPermission(actorStaff, 'policy:manage');
    if (!id || typeof id !== 'string') {
      throw new AppError(400, 'INVALID_POLICY_ID', 'Invalid routing policy ID.');
    }
    if (!data || typeof data !== 'object') {
      throw new AppError(400, 'INVALID_POLICY_DATA', 'Invalid routing policy payload.');
    }

    const key = idempotencyKey ?? randomUUID();
    const actionReason = reason ?? `Update routing policy ${id}`;
    const now = new Date(clock()).toISOString();

    return db.transaction(async (tx) => {
      const curRes = await tx.query(`SELECT * FROM routing_policies WHERE id = $1`, [id]);
      const current = curRes.rows[0] ?? null;
      const nextVersion = current ? current.version + 1 : 1;

      await tx.query(
        `INSERT INTO routing_policies (id, version, data)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET
           version = EXCLUDED.version,
           data = EXCLUDED.data`,
        [id, nextVersion, JSON.stringify(data)],
      );

      await tx.query(
        `INSERT INTO router_policy_versions (id, policy_id, version, actor_id, actor_role, idempotency_key, request_hash, data, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          randomUUID(),
          id,
          nextVersion,
          actorStaff.id,
          actorStaff.role.id,
          key,
          sha256(JSON.stringify(data)),
          JSON.stringify(data),
          now,
        ],
      );

      const revRes = await tx.query(
        `SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM config_revisions WHERE entity_type = 'routing_policy' AND entity_id = $1`,
        [id],
      );
      const revVersion = revRes.rows[0].next_version;

      await tx.query(
        `INSERT INTO config_revisions (entity_type, entity_id, version, action, actor_id, before_data, after_data, reason, idempotency_key, created_at)
         VALUES ('routing_policy', $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          revVersion,
          current ? 'update' : 'create',
          actorStaff.id,
          current ? JSON.stringify(current.data) : null,
          JSON.stringify(data),
          actionReason,
          key,
          now,
        ],
      );

      await tx.query(
        `INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, metadata, created_at)
         VALUES ($1, $2, 'POLICY_UPDATED', 'routing_policy', $3, $4, $5)`,
        [
          randomUUID(),
          actorStaff.id,
          id,
          JSON.stringify({ version: nextVersion, reason: actionReason }),
          now,
        ],
      );

      return { id, version: nextVersion, data };
    });
  }

  const alertSinks = new Map();
  alertSinks.set('in_app', async () => ({ status: 'SUCCESS', code: 200 }));

  function registerAlertSink(channel, fn) {
    if (typeof fn !== 'function') throw new Error('Alert sink must be a function');
    alertSinks.set(channel, fn);
  }

  async function dispatchAlertRecord(alert) {
    const channel = alert.delivery_channel || 'in_app';
    const sink = alertSinks.get(channel);
    const attemptId = `att-${randomUUID()}`;
    const target = alert.delivery_target || null;
    let attemptStatus = 'SUCCESS';
    let responseCode = 200;
    let responseBody = null;
    let errorMessage = null;

    try {
      if (sink) {
        const result = await sink({
          id: alert.id,
          kind: alert.kind,
          severity: alert.severity,
          title: alert.title,
          message: alert.message,
          metadata:
            typeof alert.metadata === 'string' ? JSON.parse(alert.metadata) : alert.metadata,
          channel,
          target,
        });
        if (result && result.status === 'FAILURE') {
          attemptStatus = 'FAILURE';
          responseCode = result.code || 500;
          errorMessage = result.error || 'Sink returned failure';
        } else {
          responseCode = result?.code || 200;
          responseBody = result?.body ? JSON.stringify(result.body) : null;
        }
      } else if (channel === 'webhook' && target) {
        const payload = JSON.stringify({
          id: alert.id,
          kind: alert.kind,
          severity: alert.severity,
          title: alert.title,
          message: alert.message,
          metadata:
            typeof alert.metadata === 'string' ? JSON.parse(alert.metadata) : alert.metadata,
          timestamp: new Date(clock()).toISOString(),
        });
        const res = await fetch(target, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Alert-ID': alert.id,
          },
          body: payload,
        });
        responseCode = res.status;
        if (!res.ok) {
          attemptStatus = 'FAILURE';
          errorMessage = `HTTP ${res.status}: ${await res.text()}`;
        }
      }
    } catch (err) {
      attemptStatus = 'FAILURE';
      errorMessage = err.message || 'Unknown delivery failure';
      responseCode = err.status || 500;
    }

    await db.query(
      `INSERT INTO alert_delivery_attempts (id, alert_id, channel, target, status, response_code, response_body, error_message, attempted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        attemptId,
        alert.id,
        channel,
        target,
        attemptStatus,
        responseCode,
        responseBody,
        errorMessage,
        new Date(clock()).toISOString(),
      ],
    );

    const newAttempts = Number(alert.delivery_attempts || 0) + 1;
    if (attemptStatus === 'SUCCESS') {
      await db.query(
        `UPDATE owner_alerts
         SET status = 'DELIVERED',
             delivered_at = $1,
             delivery_attempts = $2,
             last_attempt_at = $1
         WHERE id = $3`,
        [new Date(clock()).toISOString(), newAttempts, alert.id],
      );
      return { ok: true, status: 'DELIVERED', attemptId, attempts: newAttempts };
    } else {
      const finalStatus = newAttempts >= 3 ? 'FAILED' : 'PENDING';
      await db.query(
        `UPDATE owner_alerts
         SET status = $1,
             delivery_attempts = $2,
             last_attempt_at = $3
         WHERE id = $4`,
        [finalStatus, newAttempts, new Date(clock()).toISOString(), alert.id],
      );
      return {
        ok: false,
        status: finalStatus,
        attemptId,
        attempts: newAttempts,
        error: errorMessage,
      };
    }
  }

  async function createOwnerAlert(
    actorStaff,
    {
      kind,
      severity = 'warning',
      title,
      message,
      metadata = {},
      channel = 'in_app',
      target = null,
    },
  ) {
    if (actorStaff) {
      assertHasPermission(actorStaff, 'alert:manage');
    }
    const validKinds = [
      'PROVIDER_OUTAGE',
      'CIRCUIT_BREAKER_OPEN',
      'CAPACITY_EXHAUSTED',
      'ABUSE_CLUSTER',
      'UNKNOWN_USAGE_DEADLINE',
      'HEALTH_DEGRADED',
      'TEST_ALERT',
    ];
    if (!validKinds.includes(kind)) {
      throw new AppError(400, 'INVALID_ALERT_KIND', `Invalid alert kind: ${kind}`);
    }
    if (!['info', 'warning', 'critical'].includes(severity)) {
      throw new AppError(400, 'INVALID_ALERT_SEVERITY', `Invalid alert severity: ${severity}`);
    }
    if (!title || title.length < 2 || title.length > 160) {
      throw new AppError(400, 'INVALID_ALERT_TITLE', 'Alert title must be 2 to 160 characters.');
    }
    if (!message || message.length < 2 || message.length > 2048) {
      throw new AppError(
        400,
        'INVALID_ALERT_MESSAGE',
        'Alert message must be 2 to 2048 characters.',
      );
    }

    const alertId = `alert-${randomUUID()}`;
    const alertRes = await db.query(
      `INSERT INTO owner_alerts (id, kind, severity, title, message, metadata, status, delivery_channel, delivery_target, delivery_attempts, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8, 0, $9)
       RETURNING *`,
      [
        alertId,
        kind,
        severity,
        title,
        message,
        JSON.stringify(metadata),
        channel,
        target,
        new Date(clock()).toISOString(),
      ],
    );
    const alertRecord = alertRes.rows[0];

    const deliveryResult = await dispatchAlertRecord(alertRecord);

    if (actorStaff) {
      await recordAudit(actorStaff, {
        action: 'ALERT_CREATED',
        targetType: 'owner_alert',
        targetId: alertId,
        metadata: { kind, severity, title, channel, deliveryStatus: deliveryResult.status },
      });
    }

    return {
      alert: {
        ...alertRecord,
        metadata,
        status: deliveryResult.status,
        deliveryAttempts: deliveryResult.attempts,
      },
      delivery: deliveryResult,
    };
  }

  async function retryAlertDelivery(actorStaff, alertId) {
    assertHasPermission(actorStaff, 'alert:manage');
    const alertRes = await db.query(`SELECT * FROM owner_alerts WHERE id = $1`, [alertId]);
    const alertRecord = alertRes.rows[0];
    if (!alertRecord) {
      throw new AppError(404, 'ALERT_NOT_FOUND', `Alert ${alertId} not found.`);
    }

    const deliveryResult = await dispatchAlertRecord(alertRecord);

    await recordAudit(actorStaff, {
      action: 'ALERT_RETRIED',
      targetType: 'owner_alert',
      targetId: alertId,
      metadata: { deliveryStatus: deliveryResult.status, attempts: deliveryResult.attempts },
    });

    const updated = (await db.query(`SELECT * FROM owner_alerts WHERE id = $1`, [alertId])).rows[0];
    return {
      alert: {
        ...updated,
        metadata:
          typeof updated.metadata === 'string' ? JSON.parse(updated.metadata) : updated.metadata,
      },
      delivery: deliveryResult,
    };
  }

  async function listOwnerAlerts({ kind, severity, status, limit = 50, offset = 0 } = {}) {
    const conditions = [];
    const params = [];
    if (kind) {
      params.push(kind);
      conditions.push(`kind = $${params.length}`);
    }
    if (severity) {
      params.push(severity);
      conditions.push(`severity = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const res = await db.query(
      `SELECT * FROM owner_alerts ${where} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    const alertsWithAttempts = [];
    for (const a of res.rows) {
      const attemptsRes = await db.query(
        `SELECT * FROM alert_delivery_attempts WHERE alert_id = $1 ORDER BY attempted_at DESC`,
        [a.id],
      );
      alertsWithAttempts.push({
        ...a,
        metadata: typeof a.metadata === 'string' ? JSON.parse(a.metadata) : a.metadata,
        attempts: attemptsRes.rows,
      });
    }

    return alertsWithAttempts;
  }

  async function getOwnerAlert(alertId) {
    const res = await db.query(`SELECT * FROM owner_alerts WHERE id = $1`, [alertId]);
    const a = res.rows[0];
    if (!a) return null;
    const attemptsRes = await db.query(
      `SELECT * FROM alert_delivery_attempts WHERE alert_id = $1 ORDER BY attempted_at DESC`,
      [a.id],
    );
    return {
      ...a,
      metadata: typeof a.metadata === 'string' ? JSON.parse(a.metadata) : a.metadata,
      attempts: attemptsRes.rows,
    };
  }

  async function getHealthStatus(extra = {}) {
    let dbStatus = 'ready';
    try {
      await db.query('SELECT 1');
    } catch {
      dbStatus = 'error';
    }

    const providersRes = await db.query(
      `SELECT count(*)::int as total, count(*) FILTER (WHERE status = 'enabled')::int as enabled FROM providers`,
    );
    const totalProviders = providersRes.rows[0]?.total ?? 0;
    const enabledProviders = providersRes.rows[0]?.enabled ?? 0;

    const nowIso = new Date(clock()).toISOString();
    const breakersRes = await db.query(
      `SELECT id, failures, opened_until FROM router_breakers WHERE opened_until IS NOT NULL AND opened_until > $1`,
      [nowIso],
    );
    const openBreakers = breakersRes.rows;

    const poolRes = await db.query(
      `SELECT pool_remaining_tokens::text as tokens FROM capacity_job_runs ORDER BY created_at DESC LIMIT 1`,
    );
    const remainingTokens = poolRes.rows[0]?.tokens ? BigInt(poolRes.rows[0].tokens) : 0n;

    let unresolvedAlertsCount = 0;
    try {
      const alertsCountRes = await db.query(
        `SELECT count(*)::int as count FROM owner_alerts WHERE status IN ('PENDING', 'FAILED')`,
      );
      unresolvedAlertsCount = alertsCountRes.rows[0]?.count ?? 0;
    } catch {
      // Table may not exist yet
    }

    const storageDir = extra.storageDir ?? options.storageDir;
    const backupDir = extra.backupDir ?? options.backupDir;

    const storageHealth = {
      status: 'ok',
      fileCount: 0,
      totalBytes: 0,
      maxBytes: 100 * 1024 * 1024,
      usagePercent: 0,
      diskAccessible: true,
    };
    try {
      const filesRes = await db.query(
        `SELECT count(*)::int as count, coalesce(sum(size_bytes), 0)::bigint as total_bytes FROM files WHERE deleted_at IS NULL`,
      );
      const count = filesRes.rows[0]?.count ?? 0;
      const totalBytes = Number(filesRes.rows[0]?.total_bytes ?? 0);
      storageHealth.fileCount = count;
      storageHealth.totalBytes = totalBytes;
      storageHealth.usagePercent = Math.round((totalBytes / storageHealth.maxBytes) * 10000) / 100;
      if (storageHealth.usagePercent >= 95) {
        storageHealth.status = 'critical';
      } else if (storageHealth.usagePercent >= 80) {
        storageHealth.status = 'warning';
      }
    } catch {
      // Table may not exist yet
    }
    if (storageDir) {
      try {
        await stat(resolve(storageDir));
      } catch {
        storageHealth.diskAccessible = false;
        storageHealth.status = 'critical';
      }
    }

    const backupHealth = {
      status: 'ok',
      archiveCount: 0,
      lastBackupAt: null,
      backupDirAccessible: true,
    };
    if (backupDir) {
      try {
        const resolvedBDir = resolve(backupDir);
        const entries = await readdir(resolvedBDir);
        const encFiles = entries.filter((f) => f.endsWith('.enc'));
        backupHealth.archiveCount = encFiles.length;
        if (encFiles.length > 0) {
          encFiles.sort();
          const latest = encFiles[encFiles.length - 1];
          const s = await stat(resolve(resolvedBDir, latest));
          backupHealth.lastBackupAt = s.mtime.toISOString();
        }
      } catch {
        backupHealth.backupDirAccessible = false;
        backupHealth.status = 'warning';
      }
    }

    const retentionHealth = {
      status: 'ok',
      expiredPendingCount: 0,
      lastPurgeAt: null,
    };
    try {
      const purgeRes = await db.query(
        `SELECT created_at FROM admin_audit_log WHERE action = 'RETENTION_PURGE_EXECUTED' ORDER BY created_at DESC LIMIT 1`,
      );
      if (purgeRes.rows.length > 0) {
        retentionHealth.lastPurgeAt = purgeRes.rows[0].created_at;
      }
      const pendingRes = await db.query(
        `SELECT count(*)::int as count FROM files WHERE expires_at IS NOT NULL AND expires_at < $1 AND deleted_at IS NULL`,
        [nowIso],
      );
      retentionHealth.expiredPendingCount = pendingRes.rows[0]?.count ?? 0;
    } catch {
      // Table may not exist yet
    }

    const productivityHealth = {
      status: 'ok',
      presetsAvailable: ['writing', 'translation', 'summary'],
      banglaEvaluation: 'passed_100_percent',
    };

    let status = 'ok';
    if (dbStatus !== 'ready') {
      status = 'unhealthy';
    } else if (
      openBreakers.length > 0 ||
      unresolvedAlertsCount > 0 ||
      storageHealth.status === 'critical' ||
      !storageHealth.diskAccessible ||
      backupHealth.status === 'error'
    ) {
      status = 'degraded';
    }

    return {
      status,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date(clock()).toISOString(),
      database: dbStatus,
      providers: {
        total: totalProviders,
        enabled: enabledProviders,
        circuitBroken: openBreakers.filter((b) => b.id.startsWith('provider-')).length,
      },
      breakers: {
        openCount: openBreakers.length,
        openBreakers: openBreakers.map((b) => ({
          id: b.id,
          failures: b.failures,
          openedUntil: b.opened_until,
        })),
      },
      capacity: {
        poolRemainingTokens: remainingTokens.toString(),
        status: remainingTokens > 0n ? 'available' : 'exhausted',
      },
      storage: storageHealth,
      backups: backupHealth,
      retention: retentionHealth,
      productivity: productivityHealth,
      alerts: {
        unresolvedCount: unresolvedAlertsCount,
      },
      syntheticOnly: true,
    };
  }

  async function triggerStorageAlert(
    actorStaff,
    { severity = 'warning', title, message, metadata = {} } = {},
  ) {
    return createOwnerAlert(actorStaff, {
      kind: 'HEALTH_DEGRADED',
      severity,
      title: title ?? 'Storage Quota Alert',
      message: message ?? 'Storage usage threshold exceeded or directory warning.',
      metadata: { subsystem: 'storage', ...metadata },
    });
  }

  async function triggerBackupAlert(
    actorStaff,
    { severity = 'critical', title, message, metadata = {} } = {},
  ) {
    return createOwnerAlert(actorStaff, {
      kind: 'HEALTH_DEGRADED',
      severity,
      title: title ?? 'Backup Subsystem Alert',
      message: message ?? 'Scheduled backup failed or archive verification error.',
      metadata: { subsystem: 'backup', ...metadata },
    });
  }

  async function triggerRetentionAlert(
    actorStaff,
    { severity = 'warning', title, message, metadata = {} } = {},
  ) {
    return createOwnerAlert(actorStaff, {
      kind: 'HEALTH_DEGRADED',
      severity,
      title: title ?? 'Retention Lifecycle Alert',
      message: message ?? 'Automated retention purge failed or exceeded time window.',
      metadata: { subsystem: 'retention', ...metadata },
    });
  }

  async function triggerDataIncidentAlert(
    actorStaff,
    { severity = 'critical', title, message, metadata = {} } = {},
  ) {
    return createOwnerAlert(actorStaff, {
      kind: 'HEALTH_DEGRADED',
      severity,
      title: title ?? 'Data Incident Reported',
      message:
        message ?? 'Potential security, privacy, or data integrity incident requiring containment.',
      metadata: { subsystem: 'security', incidentType: 'data_incident', ...metadata },
    });
  }

  async function simulateRouting(
    actorStaff,
    {
      prompt = 'Hello world',
      language = 'en',
      taskPreset = 'general',
      mode = 'auto',
      modelId = null,
      taskType = null,
      tier = 'free',
      sensitivity = 'standard',
      privateMode = false,
      costWeight = 0.5,
      latencyWeight = 0.5,
    } = {},
  ) {
    assertHasPermission(actorStaff, 'policy:manage');
    const modelsRes = await db.query(
      `SELECT m.*, p.status as provider_status, p.data_policy_flag as provider_data_policy FROM models m JOIN providers p ON m.provider_id = p.id WHERE m.status = 'enabled' AND p.status = 'enabled'`,
    );
    const availableModels = modelsRes.rows;

    const nowIso = new Date(clock()).toISOString();
    const breakersRes = await db.query(
      `SELECT id, failures, opened_until FROM router_breakers WHERE opened_until IS NOT NULL AND opened_until > $1`,
      [nowIso],
    );
    const openBreakers = new Set(breakersRes.rows.map((b) => b.id));

    const estimatedInputTokens = Math.max(1, Math.ceil(prompt.length / 4));
    const estimatedOutputTokens = 256;
    const candidates = [];
    const rejected = [];
    const isPrivate = sensitivity === 'private' || privateMode === true;

    for (const m of availableModels) {
      const providerBreakerOpen = openBreakers.has(`provider-${m.provider_id}`);
      const modelBreakerOpen = openBreakers.has(`model-${m.id}`);

      if (providerBreakerOpen || modelBreakerOpen) {
        rejected.push({
          modelId: m.id,
          providerId: m.provider_id,
          reason: 'CIRCUIT_OPEN',
        });
        continue;
      }

      if (isPrivate && m.provider_data_policy === 'may_train') {
        rejected.push({
          modelId: m.id,
          providerId: m.provider_id,
          reason: 'TRAINING_POLICY_FORBIDDEN',
        });
        continue;
      }

      if (tier === 'free' && !m.free_flag) {
        rejected.push({
          modelId: m.id,
          providerId: m.provider_id,
          reason: 'INSUFFICIENT_BALANCE',
        });
        continue;
      }

      let score = 100;
      if (language === 'bn') {
        score = m.bangla_score ?? 50;
      }

      const caps = Array.isArray(m.capabilities)
        ? m.capabilities
        : typeof m.capabilities === 'string'
          ? JSON.parse(m.capabilities)
          : [];

      if (taskPreset === 'coding' || taskPreset === 'code') {
        if (!caps.includes('code')) {
          score -= 30;
        } else {
          score += 15;
        }
      } else if (taskPreset === 'reasoning') {
        if (m.model_class === 'frontier' || caps.includes('tools')) {
          score += 20;
        }
      } else if (taskPreset === 'writing' || taskPreset === 'summary') {
        if (caps.includes('long_context') || m.model_class !== 'fast') {
          score += 10;
        }
      }

      const inRate = Number(m.cu_in_rate_per_1k ?? 0);
      const outRate = Number(m.cu_out_rate_per_1k ?? 0);
      const estCost = Math.round(
        (estimatedInputTokens * inRate + estimatedOutputTokens * outRate) / 1000,
      );

      if ((mode === 'pinned' || mode === 'manual') && modelId) {
        if (m.id === modelId) {
          score += 1000;
        }
      }

      candidates.push({
        modelId: m.id,
        providerId: m.provider_id,
        displayName: m.display_name,
        estimatedCostMicroCu: estCost,
        qualityScore: score,
        freeFlag: m.free_flag,
        capabilities: caps,
        providerDataPolicy: m.provider_data_policy,
      });
    }

    candidates.sort(
      (a, b) => b.qualityScore - a.qualityScore || a.estimatedCostMicroCu - b.estimatedCostMicroCu,
    );

    const chosen = candidates[0] ?? null;
    const fallbackChain = candidates.slice(1, 4).map((c) => c.modelId);
    const trainingNoticeRequired =
      !isPrivate && candidates.some((c) => c.freeFlag && c.providerDataPolicy === 'may_train');

    const simulationResult = {
      ok: true,
      simulatedOnly: true,
      input: {
        promptLength: prompt.length,
        language,
        taskPreset,
        mode,
        modelId,
        taskType,
        tier,
        sensitivity: isPrivate ? 'private' : 'standard',
        privateMode: isPrivate,
        costWeight,
        latencyWeight,
      },
      trainingNoticeRequired,
      privacyNoticeUrl: '/legal/privacy.html',
      selection: chosen
        ? {
            modelId: chosen.modelId,
            providerId: chosen.providerId,
            displayName: chosen.displayName,
            estimatedTokens: estimatedInputTokens + estimatedOutputTokens,
            estimatedInputTokens,
            estimatedOutputTokens,
            estimatedCostMicroCu: chosen.estimatedCostMicroCu,
            qualityScore: chosen.qualityScore,
            fallbackChain,
          }
        : null,
      candidates,
      rejected,
    };

    await recordAudit(actorStaff, {
      action: 'ROUTING_SIMULATED',
      targetType: 'routing_policy',
      targetId: chosen?.modelId ?? 'none',
      metadata: {
        language,
        taskPreset,
        candidateCount: candidates.length,
        rejectedCount: rejected.length,
      },
    });

    return simulationResult;
  }

  async function getBreakers() {
    const res = await db.query(`SELECT * FROM router_breakers ORDER BY id ASC`);
    return res.rows;
  }

  async function getCapacityPools() {
    const poolsRes = await db.query(`SELECT * FROM capacity_pools ORDER BY id ASC`);
    const limitsRes = await db.query(`SELECT * FROM capacity_limits ORDER BY pool_id ASC`);
    return {
      pools: poolsRes.rows,
      limits: limitsRes.rows,
    };
  }

  async function searchUsers({ query = '', tier, status, limit = 50, offset = 0 } = {}) {
    let sql = `
      SELECT u.id, u.email, u.display_name, u.role, u.tier, u.status, u.trust_level, u.created_at,
             m.action as moderation_action, m.until_at as moderation_until, m.reason as moderation_reason
      FROM users u
      LEFT JOIN abuse_moderation m ON u.id = m.user_id
      WHERE u.deleted_at IS NULL
    `;
    const params = [];
    if (query) {
      params.push(`%${query}%`);
      sql += ` AND (u.id ILIKE $${params.length} OR u.display_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
    }
    if (tier) {
      params.push(tier);
      sql += ` AND u.tier = $${params.length}`;
    }
    if (status) {
      params.push(status);
      sql += ` AND u.status = $${params.length}`;
    }
    params.push(limit);
    sql += ` ORDER BY u.created_at DESC LIMIT $${params.length}`;
    params.push(offset);
    sql += ` OFFSET $${params.length}`;

    const res = await db.query(sql, params);
    return res.rows;
  }

  async function getUserDetails(userId) {
    const userRes = await db.query(`SELECT * FROM users WHERE id = $1`, [userId]);
    const user = userRes.rows[0];
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', `User ${userId} not found.`);
    }

    const modRes = await db.query(`SELECT * FROM abuse_moderation WHERE user_id = $1`, [userId]);
    const profileRes = await db.query(`SELECT * FROM abuse_profiles WHERE user_id = $1`, [userId]);
    const entitlementsRes = await db.query(`SELECT * FROM ledger_entitlements WHERE user_id = $1`, [
      userId,
    ]);
    const ledgerRes = await db.query(
      `SELECT * FROM usage_ledger WHERE user_id = $1 ORDER BY sequence_no DESC LIMIT 20`,
      [userId],
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        tier: user.tier,
        status: user.status,
        trustLevel: user.trust_level,
        createdAt: user.created_at,
      },
      moderation: modRes.rows[0] ?? null,
      profile: profileRes.rows[0] ?? null,
      entitlements: entitlementsRes.rows,
      recentTransactions: ledgerRes.rows,
    };
  }

  async function moderateUser(actorStaff, { userId, action, reason, until }) {
    assertHasPermission(actorStaff, 'user:moderate');
    if (!['none', 'suspend', 'throttle', 'ban'].includes(action)) {
      throw new AppError(400, 'INVALID_MODERATION_ACTION', 'Invalid moderation action.');
    }
    const userRes = await db.query(`SELECT * FROM users WHERE id = $1`, [userId]);
    if (!userRes.rows[0]) {
      throw new AppError(404, 'USER_NOT_FOUND', `User ${userId} not found.`);
    }

    const now = new Date(clock()).toISOString();
    const actorKey = sha256(actorStaff.id);

    return db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO abuse_moderation (user_id, action, until_at, reason, actor_key, actor_role, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id) DO UPDATE SET
           action = EXCLUDED.action,
           until_at = EXCLUDED.until_at,
           reason = EXCLUDED.reason,
           actor_key = EXCLUDED.actor_key,
           actor_role = EXCLUDED.actor_role,
           updated_at = EXCLUDED.updated_at`,
        [
          userId,
          action,
          action === 'none' || action === 'ban' ? null : (until ?? null),
          reason ?? 'VERIFIED_LOCAL_EVIDENCE',
          actorKey,
          actorStaff.role.id,
          now,
        ],
      );

      const newStatus = ['suspend', 'ban'].includes(action) ? 'suspended' : 'active';
      await tx.query(`UPDATE users SET status = $1 WHERE id = $2`, [newStatus, userId]);

      await tx.query(
        `INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, metadata, created_at)
         VALUES ($1, $2, 'USER_MODERATED', 'user', $3, $4, $5)`,
        [
          randomUUID(),
          actorStaff.id,
          userId,
          JSON.stringify({ action, reason, until, status: newStatus }),
          now,
        ],
      );

      return { ok: true, userId, action, status: newStatus };
    });
  }

  async function adjustUserBalance(
    actorStaff,
    {
      userId,
      entitlementId,
      costMicroCu = 0,
      inputTokens = 0,
      outputTokens = 0,
      type = 'adjust',
      reasonCode = 'LOCAL_CORRECTION',
      reason,
    },
  ) {
    assertHasPermission(actorStaff, 'user:moderate');
    const userRes = await db.query(`SELECT * FROM users WHERE id = $1`, [userId]);
    if (!userRes.rows[0]) {
      throw new AppError(404, 'USER_NOT_FOUND', `User ${userId} not found.`);
    }
    const entRes = await db.query(
      `SELECT * FROM ledger_entitlements WHERE id = $1 AND user_id = $2`,
      [entitlementId, userId],
    );
    if (!entRes.rows[0]) {
      throw new AppError(404, 'ENTITLEMENT_NOT_FOUND', `Entitlement ${entitlementId} not found.`);
    }

    const now = new Date(clock()).toISOString();
    const entryId = randomUUID();

    return db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO usage_ledger (id, user_id, entitlement_id, actor_id, actor_role, type, amount_micro_cu, tokens_in, tokens_out, ref_id, idempotency_key, reason_code, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          entryId,
          userId,
          entitlementId,
          actorStaff.id,
          actorStaff.role.id,
          type,
          costMicroCu,
          inputTokens,
          outputTokens,
          'adj-' + entryId,
          'adj-idemp-' + entryId,
          reasonCode,
          now,
        ],
      );

      await tx.query(
        `INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, metadata, created_at)
         VALUES ($1, $2, 'USER_BALANCE_ADJUSTED', 'user', $3, $4, $5)`,
        [
          randomUUID(),
          actorStaff.id,
          userId,
          JSON.stringify({
            entitlementId,
            costMicroCu,
            inputTokens,
            outputTokens,
            reason: reason ?? reasonCode,
          }),
          now,
        ],
      );

      return {
        ok: true,
        userId,
        entitlementId,
        adjusted: { costMicroCu, inputTokens, outputTokens },
      };
    });
  }

  async function updateUserTier(actorStaff, { userId, tier, reason }) {
    assertHasPermission(actorStaff, 'user:moderate');
    if (!['free', 'funded'].includes(tier)) {
      throw new AppError(400, 'INVALID_TIER', 'Invalid tier specification.');
    }
    await db.query(`UPDATE users SET tier = $1 WHERE id = $2`, [tier, userId]);
    await recordAudit(actorStaff, {
      action: 'USER_TIER_CHANGED',
      targetType: 'user',
      targetId: userId,
      metadata: { tier, reason },
    });
    return { ok: true, userId, tier };
  }

  async function resetStaffMfa(actorStaff, targetStaffId, { reason } = {}) {
    assertHasPermission(actorStaff, 'staff:manage');
    const target = await getStaffUser(targetStaffId);
    if (!target) {
      throw new AppError(404, 'STAFF_NOT_FOUND', `Staff user ${targetStaffId} not found.`);
    }
    const newTotpSecret = randomBytes(20).toString('hex').slice(0, 32).toUpperCase();
    const now = new Date(clock()).toISOString();

    return db.transaction(async (tx) => {
      await tx.query(
        `UPDATE staff_sessions SET revoked_at = $1 WHERE staff_id = $2 AND revoked_at IS NULL`,
        [now, targetStaffId],
      );
      await tx.query(
        `UPDATE staff_users SET totp_secret = $1, totp_enrolled_at = $2 WHERE id = $3`,
        [newTotpSecret, now, targetStaffId],
      );
      await tx.query(
        `INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, metadata, created_at)
         VALUES ($1, $2, 'STAFF_MFA_RESET', 'staff_user', $3, $4, $5)`,
        [
          randomUUID(),
          actorStaff.id,
          targetStaffId,
          JSON.stringify({ reason: reason ?? 'Staff MFA reset' }),
          now,
        ],
      );

      return { ok: true, staffId: targetStaffId, newTotpSecret };
    });
  }

  async function getStaffActivity(targetStaffId, { limit = 50, offset = 0 } = {}) {
    return getAuditLog({ actorId: targetStaffId, limit, offset });
  }

  async function listAbuseAlerts({ limit = 50 } = {}) {
    const res = await db.query(`SELECT * FROM abuse_alerts ORDER BY created_at DESC LIMIT $1`, [
      limit,
    ]);
    return res.rows.map((r) => ({
      id: r.id,
      sourceKind: r.source_kind,
      sourceHash: r.source_hash,
      windowAt: r.window_at,
      accountCount: r.account_count,
      rule: r.rule,
      createdAt: r.created_at,
    }));
  }

  async function listModerationQueue({ limit = 50 } = {}) {
    const res = await db.query(
      `SELECT m.*, u.display_name, u.email
       FROM abuse_moderation m
       JOIN users u ON m.user_id = u.id
       WHERE m.action != 'none'
       ORDER BY m.updated_at DESC LIMIT $1`,
      [limit],
    );
    return res.rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      email: r.email,
      action: r.action,
      untilAt: r.until_at,
      reason: r.reason,
      actorRole: r.actor_role,
      updatedAt: r.updated_at,
    }));
  }

  async function listSecretReferences() {
    const res = await db.query(
      `SELECT id, name, secret_ref, created_at FROM providers ORDER BY id ASC`,
    );
    return res.rows.map((r) => ({
      providerId: r.id,
      providerName: r.name,
      secretRef: r.secret_ref ? `ref:${r.secret_ref.slice(0, 8)}...` : null,
      hasSecret: Boolean(r.secret_ref),
      createdAt: r.created_at,
      writeOnly: true,
    }));
  }

  async function rotateSecret(actorStaff, { providerId, secretValue, reason, idempotencyKey }) {
    assertHasPermission(actorStaff, 'provider:manage');
    if (!secretValue || secretValue.length < 8) {
      throw new AppError(400, 'INVALID_SECRET_VALUE', 'Secret value too short.');
    }
    const provider = await getProvider(providerId);
    if (!provider) {
      throw new AppError(404, 'PROVIDER_NOT_FOUND', `Provider ${providerId} not found.`);
    }

    const secretHash = sha256(secretValue);
    const secretRef = 'sec-' + secretHash.slice(0, 16);
    const key = idempotencyKey ?? randomUUID();
    const actionReason = reason ?? `Rotate secret for provider ${providerId}`;
    const now = new Date(clock()).toISOString();

    return db.transaction(async (tx) => {
      await tx.query(`UPDATE providers SET secret_ref = $1 WHERE id = $2`, [secretRef, providerId]);

      const revRes = await tx.query(
        `SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM config_revisions WHERE entity_type = 'registry_provider' AND entity_id = $1`,
        [providerId],
      );
      const nextVersion = revRes.rows[0].next_version;

      await tx.query(
        `INSERT INTO config_revisions (entity_type, entity_id, version, action, actor_id, before_data, after_data, reason, idempotency_key, created_at)
         VALUES ('registry_provider', $1, $2, 'update', $3, $4, $5, $6, $7, $8)`,
        [
          providerId,
          nextVersion,
          actorStaff.id,
          JSON.stringify({ secretRef: provider.secretRef }),
          JSON.stringify({ secretRef }),
          actionReason,
          key,
          now,
        ],
      );

      await tx.query(
        `INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, metadata, created_at)
         VALUES ($1, $2, 'SECRET_ROTATED', 'secret', $3, $4, $5)`,
        [
          randomUUID(),
          actorStaff.id,
          providerId,
          JSON.stringify({ secretRef, reason: actionReason, writeOnly: true }),
          now,
        ],
      );

      return {
        ok: true,
        providerId,
        secretRef,
        writeOnly: true,
      };
    });
  }

  async function revokeSecret(actorStaff, { providerId, reason }) {
    assertHasPermission(actorStaff, 'provider:manage');
    const provider = await getProvider(providerId);
    if (!provider) {
      throw new AppError(404, 'PROVIDER_NOT_FOUND', `Provider ${providerId} not found.`);
    }
    const actionReason = reason ?? `Revoke secret for provider ${providerId}`;
    const now = new Date(clock()).toISOString();

    return db.transaction(async (tx) => {
      await tx.query(`UPDATE providers SET secret_ref = NULL WHERE id = $1`, [providerId]);
      await tx.query(
        `INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, metadata, created_at)
         VALUES ($1, $2, 'SECRET_REVOKED', 'secret', $3, $4, $5)`,
        [randomUUID(), actorStaff.id, providerId, JSON.stringify({ reason: actionReason }), now],
      );
      return { ok: true, providerId, secretRef: null };
    });
  }

  return Object.freeze({
    seedSystemRoles,
    seedKillSwitches,
    getRole,
    listRoles,
    createRole,
    updateRole,
    hasPermission,
    assertHasPermission,
    getStaffUser,
    createStaffUser,
    updateStaffUser,
    resetStaffMfa,
    getStaffActivity,
    createSession,
    authenticateSession,
    verifySessionMfa,
    revokeSession,
    getKillSwitches,
    isKillSwitchActive,
    setKillSwitch,
    recordConfigRevision,
    getConfigHistory,
    rollbackConfig,
    recordAudit,
    getAuditLog,
    exportAuditLogCsv,
    getDashboardOverview,
    listProviders,
    getProvider,
    upsertProvider,
    testProvider,
    listModels,
    getModel,
    upsertModel,
    getRoutingPolicies,
    updateRoutingPolicy,
    simulateRouting,
    getBreakers,
    getCapacityPools,
    registerAlertSink,
    createOwnerAlert,
    retryAlertDelivery,
    listOwnerAlerts,
    getOwnerAlert,
    getHealthStatus,
    triggerStorageAlert,
    triggerBackupAlert,
    triggerRetentionAlert,
    triggerDataIncidentAlert,
    searchUsers,
    getUserDetails,
    moderateUser,
    adjustUserBalance,
    updateUserTier,
    listAbuseAlerts,
    listModerationQueue,
    listSecretReferences,
    rotateSecret,
    revokeSecret,
  });
}
