import { randomUUID } from 'node:crypto';
import { AppError } from './errors.mjs';
import { hashToken } from './auth.mjs';

const first = (result) => result.rows[0] ?? null;
const conversation = (row) => row && { id: row.id, title: row.title, updatedAt: row.updated_at };
export function publicUser(row) {
  return { id: row.id, displayName: row.display_name, tier: row.tier, trustLevel: row.trust_level };
}
export function publicMessage(row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    status: row.status,
    providerId: row.provider_id,
    modelId: row.model_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    usageKind: row.usage_kind,
    createdAt: row.created_at,
  };
}

export function usageDayStart(now, offsetMinutes) {
  const offset = offsetMinutes * 60000;
  return new Date(Math.floor((now + offset) / 86400000) * 86400000 - offset).toISOString();
}

export function createRepository(db, config) {
  const { limits } = config;
  const audit = async (tx, userId, action, targetId, metadata = {}) => {
    const counts = first(
      await tx.query(`SELECT
      (SELECT COUNT(*) FROM audit_events) AS audits,
      (SELECT COUNT(*) FROM usage_events) AS usage,
      (SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP) AS sessions,
      (SELECT COUNT(*) FROM users WHERE status='active' AND deleted_at IS NULL) AS users,
      (SELECT COUNT(*) FROM chat_requests WHERE status IN ('pending','streaming')) AS pending`),
    );
    // Reserve terminal evidence before accepting work; logout/deletion/finish release their reserve.
    const reserved = Number(counts.sessions) + Number(counts.users) + Number(counts.pending);
    if (
      Number(counts.audits) + 1 + reserved > limits.maxAuditEvents ||
      Number(counts.usage) + Number(counts.pending) > limits.maxUsageEvents
    ) {
      throw new AppError(
        503,
        'LOCAL_STORAGE_FULL',
        'Local test history is full. Stop the test server and review the local data.',
      );
    }
    return tx.query(
      'INSERT INTO audit_events(id,actor_id,action,target_id,metadata) VALUES($1,$2,$3,$4,$5::jsonb)',
      [randomUUID(), userId, action, targetId, JSON.stringify(metadata)],
    );
  };
  const own = async (tx, userId, id) => {
    const row = first(
      await tx.query(
        'SELECT id,title,updated_at FROM conversations WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL',
        [id, userId],
      ),
    );
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Conversation not found.');
    return row;
  };
  const dailyCounts = async (tx, userId, start) =>
    first(
      await tx.query(
        `SELECT (SELECT COUNT(*) FROM usage_events WHERE user_id=$1 AND created_at >= $2::timestamptz) +
     (SELECT COUNT(*) FROM chat_requests WHERE user_id=$1 AND created_at >= $2::timestamptz AND status IN ('pending','streaming')) AS requests,
     COALESCE((SELECT SUM(input_tokens) FROM usage_events WHERE user_id=$1 AND created_at >= $2::timestamptz),0) AS input_tokens,
     COALESCE((SELECT SUM(output_tokens) FROM usage_events WHERE user_id=$1 AND created_at >= $2::timestamptz),0) AS output_tokens`,
        [userId, start],
      ),
    );
  return {
    async registry(syntheticModelId) {
      if (
        syntheticModelId !== undefined &&
        (typeof syntheticModelId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(syntheticModelId))
      )
        throw new Error('Invalid trusted synthetic model selection.');
      const rows = (
        await db.query(
          `SELECT p.id AS provider_id,p.name,m.id AS model_id,m.external_name,m.display_name,m.context_limit
        FROM providers p JOIN models m ON m.provider_id=p.id
        WHERE p.status='enabled' AND m.status='enabled' AND p.adapter_kind='synthetic_mock'
        AND ($1::text IS NULL OR m.id=$1) ORDER BY m.id`,
          [syntheticModelId ?? null],
        )
      ).rows;
      if (rows.length !== 1) throw new Error('Exactly one enabled synthetic model is required.');
      return rows[0];
    },
    async findUser(id) {
      return first(
        await db.query(
          "SELECT * FROM users WHERE id=$1 AND status='active' AND deleted_at IS NULL",
          [id],
        ),
      );
    },
    async acceptLegal(userId) {
      return db.transaction(async (tx) => {
        const row = first(
          await tx.query(
            "UPDATE users SET legal_version=$2,legal_accepted_at=CURRENT_TIMESTAMP WHERE id=$1 AND status='active' RETURNING *",
            [userId, config.legalVersion],
          ),
        );
        if (!row)
          throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This synthetic account is unavailable.');
        await audit(tx, userId, 'legal_accepted', userId, { version: config.legalVersion });
        return row;
      });
    },
    async createSession(userId, tokenHash, csrfHash, now = Date.now()) {
      return db.transaction(async (tx) => {
        const user = first(
          await tx.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR UPDATE", [
            userId,
          ]),
        );
        if (!user)
          throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This synthetic account is unavailable.');
        await tx.query(
          'INSERT INTO sessions(id,user_id,token_hash,csrf_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)',
          [
            randomUUID(),
            userId,
            tokenHash,
            csrfHash,
            new Date(now).toISOString(),
            new Date(now + limits.sessionSeconds * 1000).toISOString(),
          ],
        );
        await audit(tx, userId, 'session_created', userId);
      });
    },
    async session(tokenHash) {
      return first(
        await db.query(
          `SELECT s.id AS session_id,s.csrf_hash,s.expires_at,u.* FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP AND u.status='active' AND u.deleted_at IS NULL`,
          [tokenHash],
        ),
      );
    },
    async revokeSession(sessionId, userId) {
      return db.transaction(async (tx) => {
        await tx.query(
          'UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=$1 AND user_id=$2',
          [sessionId, userId],
        );
        await audit(tx, userId, 'session_revoked', sessionId);
      });
    },
    async listConversations(userId) {
      return (
        await db.query(
          'SELECT id,title,updated_at FROM conversations WHERE user_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC,id LIMIT $2',
          [userId, limits.maxConversations],
        )
      ).rows.map(conversation);
    },
    async createConversation(userId, title) {
      return db.transaction(async (tx) => {
        const user = first(
          await tx.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR UPDATE", [
            userId,
          ]),
        );
        if (!user)
          throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This synthetic account is unavailable.');
        const count = first(
          await tx.query('SELECT COUNT(*) AS count FROM conversations WHERE user_id=$1', [userId]),
        );
        if (Number(count.count) >= limits.maxConversations)
          throw new AppError(
            429,
            'CONVERSATION_LIMIT',
            'Delete a conversation before creating another.',
          );
        const row = first(
          await tx.query(
            'INSERT INTO conversations(id,user_id,title) VALUES($1,$2,$3) RETURNING id,title,updated_at',
            [randomUUID(), userId, title],
          ),
        );
        await audit(tx, userId, 'conversation_created', row.id);
        return conversation(row);
      });
    },
    async getConversation(userId, id) {
      const row = await own(db, userId, id);
      const messages = (
        await db.query(
          'SELECT * FROM messages WHERE user_id=$1 AND conversation_id=$2 ORDER BY sequence_no',
          [userId, id],
        )
      ).rows;
      return { conversation: conversation(row), messages: messages.map(publicMessage) };
    },
    async renameConversation(userId, id, title) {
      return db.transaction(async (tx) => {
        await own(tx, userId, id);
        const row = first(
          await tx.query(
            'UPDATE conversations SET title=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND user_id=$2 RETURNING id,title,updated_at',
            [id, userId, title],
          ),
        );
        await audit(tx, userId, 'conversation_renamed', id);
        return conversation(row);
      });
    },
    async deleteConversation(userId, id) {
      return db.transaction(async (tx) => {
        await own(tx, userId, id);
        const pending = first(
          await tx.query(
            "SELECT id FROM chat_requests WHERE user_id=$1 AND conversation_id=$2 AND status IN ('pending','streaming') LIMIT 1",
            [userId, id],
          ),
        );
        if (pending)
          throw new AppError(
            409,
            'REQUEST_IN_PROGRESS',
            'Stop the current request before deleting this conversation.',
          );
        await tx.query('DELETE FROM messages WHERE user_id=$1 AND conversation_id=$2', [
          userId,
          id,
        ]);
        await tx.query(
          'DELETE FROM routing_records WHERE user_id=$1 AND request_id IN (SELECT id FROM chat_requests WHERE conversation_id=$2 AND user_id=$1)',
          [userId, id],
        );
        await tx.query('DELETE FROM chat_requests WHERE user_id=$1 AND conversation_id=$2', [
          userId,
          id,
        ]);
        await tx.query('DELETE FROM conversations WHERE id=$1 AND user_id=$2', [id, userId]);
        await audit(tx, userId, 'conversation_deleted', id);
      });
    },
    async accountUsage(userId, now = Date.now()) {
      const row = await dailyCounts(db, userId, usageDayStart(now, limits.dayOffsetMinutes));
      return {
        requestsToday: Number(row.requests),
        dailyLimit: limits.dailyRequests,
        inputTokens: Number(row.input_tokens),
        outputTokens: Number(row.output_tokens),
        usageKind: 'synthetic_estimate',
        dayTimeZone: 'Asia/Dhaka',
      };
    },
    async admit({
      userId,
      conversationId,
      key,
      requestHash,
      content,
      registry,
      routed = false,
      contextAction = 'trim',
      retryOf = null,
      now = Date.now(),
    }) {
      return db.transaction(async (tx) => {
        const user = first(
          await tx.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR UPDATE", [
            userId,
          ]),
        );
        if (!user)
          throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This synthetic account is unavailable.');
        await own(tx, userId, conversationId);
        const existing = first(
          await tx.query('SELECT * FROM chat_requests WHERE user_id=$1 AND idempotency_key=$2', [
            userId,
            key,
          ]),
        );
        if (existing) {
          if (existing.request_hash !== requestHash || existing.conversation_id !== conversationId)
            throw new AppError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'This request key was already used for a different message.',
            );
          return { existing };
        }
        const day = await dailyCounts(tx, userId, usageDayStart(now, limits.dayOffsetMinutes));
        if (Number(day.requests) >= limits.dailyRequests)
          throw new AppError(
            429,
            'DAILY_LIMIT',
            'Your synthetic daily request limit has been reached.',
          );
        const concurrent = first(
          await tx.query(
            "SELECT COUNT(*) AS count FROM chat_requests WHERE user_id=$1 AND status IN ('pending','streaming')",
            [userId],
          ),
        );
        if (Number(concurrent.count) >= limits.userConcurrency)
          throw new AppError(429, 'CONCURRENCY_LIMIT', 'Wait for your current request to finish.');
        const global = first(
          await tx.query(
            "SELECT COUNT(*) AS count FROM chat_requests WHERE status IN ('pending','streaming')",
          ),
        );
        if (Number(global.count) >= limits.globalConcurrency)
          throw new AppError(
            429,
            'CONCURRENCY_LIMIT',
            'The local service is busy. Try again shortly.',
          );
        let sourceSequence = null;
        if (routed && retryOf) {
          const source = first(
            await tx.query(
              "SELECT m.sequence_no::text AS sequence_no,m.content FROM messages m JOIN chat_requests r ON r.id=m.request_id AND r.user_id=m.user_id WHERE m.request_id=$1 AND m.user_id=$2 AND r.conversation_id=$3 AND m.role='user'",
              [retryOf, userId, conversationId],
            ),
          );
          if (!source) throw new AppError(404, 'NOT_FOUND', 'Original user prompt not found.');
          if (source.content !== content)
            throw new AppError(
              400,
              'RETRY_PROMPT_CHANGED',
              'Retry must use the original user prompt.',
            );
          sourceSequence = source.sequence_no;
        }
        const previous = (
          await tx.query(
            "SELECT role,content FROM messages WHERE user_id=$1 AND conversation_id=$2 AND status='complete' AND role IN ('user','assistant') AND ($4::bigint IS NULL OR sequence_no<$4) ORDER BY sequence_no DESC LIMIT $3",
            [userId, conversationId, routed ? 201 : limits.maxContextMessages + 1, sourceSequence],
          )
        ).rows.reverse();
        let historyTrimmed = 0;
        if (routed && contextAction === 'trim') {
          while (
            previous.length &&
            (previous.length + 1 > limits.maxContextMessages ||
              previous.reduce(
                (n, m) => n + Array.from(m.content).length,
                Array.from(content).length,
              ) > limits.maxContextChars ||
              previous[0].role !== 'user')
          ) {
            previous.shift();
            historyTrimmed++;
            while (previous.length && previous[0].role !== 'user') {
              previous.shift();
              historyTrimmed++;
            }
          }
        }
        if (
          previous.length + 1 > limits.maxContextMessages ||
          previous.reduce(
            (sum, row) => sum + Array.from(row.content).length,
            Array.from(content).length,
          ) >
            (routed
              ? limits.maxContextChars
              : Math.min(limits.maxContextChars, registry.context_limit))
        ) {
          throw new AppError(
            413,
            'CONTEXT_LIMIT',
            'This conversation is full. Start a new synthetic conversation.',
          );
        }
        const requestId = randomUUID();
        const routingId = randomUUID();
        const inputTokens = previous.reduce(
          (sum, row) => sum + Array.from(row.content).length,
          Array.from(content).length,
        );
        await tx.query(
          'INSERT INTO chat_requests(id,user_id,conversation_id,idempotency_key,request_hash,input_tokens) VALUES($1,$2,$3,$4,$5,$6)',
          [requestId, userId, conversationId, key, requestHash, inputTokens],
        );
        if (!routed)
          await tx.query(
            "INSERT INTO routing_records(id,request_id,user_id,provider_id,model_id,external_model,run_kind) VALUES($1,$2,$3,$4,$5,$6,'synthetic_mock')",
            [
              routingId,
              requestId,
              userId,
              registry.provider_id,
              registry.model_id,
              registry.external_name,
            ],
          );
        await tx.query(
          "INSERT INTO messages(id,conversation_id,user_id,role,content,request_id,input_tokens) VALUES($1,$2,$3,'user',$4,$5,$6)",
          [randomUUID(), conversationId, userId, content, requestId, inputTokens],
        );
        await tx.query(
          "INSERT INTO messages(id,conversation_id,user_id,role,content,status,provider_id,model_id,routing_record_id,request_id,usage_kind) VALUES($1,$2,$3,'assistant','','pending',$4,$5,$6,$7,'synthetic_estimate')",
          [
            randomUUID(),
            conversationId,
            userId,
            routed ? null : registry.provider_id,
            routed ? null : registry.model_id,
            routed ? null : routingId,
            requestId,
          ],
        );
        await audit(tx, userId, 'chat_admitted', requestId, { run_kind: 'synthetic_mock' });
        return {
          requestId,
          inputTokens,
          messages: [...previous, { role: 'user', content }],
          historyTrimmed,
        };
      });
    },
    async request(userId, requestId) {
      return first(
        await db.query('SELECT * FROM chat_requests WHERE id=$1 AND user_id=$2', [
          requestId,
          userId,
        ]),
      );
    },
    async requestMessage(userId, requestId) {
      const row = first(
        await db.query(
          "SELECT * FROM messages WHERE request_id=$1 AND user_id=$2 AND role='assistant'",
          [requestId, userId],
        ),
      );
      return row && publicMessage(row);
    },
    async finish({ userId, requestId, content, status, latencyMs, routingResult }) {
      return db.transaction(async (tx) => {
        const row = first(
          await tx.query(
            "UPDATE chat_requests SET status=$3,output_tokens=$4,finished_at=CURRENT_TIMESTAMP WHERE id=$1 AND user_id=$2 AND status IN ('pending','streaming') RETURNING *",
            [requestId, userId, status, Array.from(content).length],
          ),
        );
        if (!row) {
          const existing = first(
            await tx.query(
              "SELECT * FROM messages WHERE request_id=$1 AND user_id=$2 AND role='assistant'",
              [requestId, userId],
            ),
          );
          return existing && publicMessage(existing);
        }
        if (routingResult) {
          await tx.query('UPDATE chat_requests SET input_tokens=$3 WHERE id=$1 AND user_id=$2', [
            requestId,
            userId,
            routingResult.inputTokens,
          ]);
          row.input_tokens = routingResult.inputTokens;
          if (routingResult.modelId) {
            const routingId = randomUUID();
            const provenance = first(
              await tx.query(
                "INSERT INTO routing_records(id,request_id,user_id,provider_id,model_id,external_model,run_kind,attempt_count) VALUES($1,$2,$3,$4,$5,$6,'synthetic_mock',$7) ON CONFLICT(request_id) DO UPDATE SET provider_id=$4,model_id=$5,external_model=$6,attempt_count=$7 RETURNING id",
                [
                  routingId,
                  requestId,
                  userId,
                  routingResult.providerId,
                  routingResult.modelId,
                  routingResult.externalName,
                  routingResult.attempts.length,
                ],
              ),
            );
            await tx.query(
              "UPDATE messages SET provider_id=$3,model_id=$4,routing_record_id=$5 WHERE request_id=$1 AND user_id=$2 AND role='assistant'",
              [requestId, userId, routingResult.providerId, routingResult.modelId, provenance.id],
            );
          }
        }
        const message = first(
          await tx.query(
            "UPDATE messages SET content=$3,status=$4,input_tokens=$5,output_tokens=$6 WHERE request_id=$1 AND user_id=$2 AND role='assistant' RETURNING *",
            [requestId, userId, content, status, row.input_tokens, row.output_tokens],
          ),
        );
        if (message.model_id)
          await tx.query(
            'INSERT INTO usage_events(id,user_id,request_id,model_id,input_tokens,output_tokens,latency_ms,outcome,cost_micro_cu) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(request_id) DO NOTHING',
            [
              randomUUID(),
              userId,
              requestId,
              message.model_id,
              row.input_tokens,
              row.output_tokens,
              Math.max(0, Math.floor(latencyMs)),
              status,
              routingResult?.costMicroCu ?? '0',
            ],
          );
        await tx.query(
          'UPDATE conversations SET updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND user_id=$2',
          [row.conversation_id, userId],
        );
        await audit(tx, userId, 'chat_finished', requestId, {
          outcome: status,
          run_kind: 'synthetic_mock',
        });
        return publicMessage(message);
      });
    },
    async recoverInterrupted() {
      const rows = (
        await db.query(
          "SELECT id,user_id FROM chat_requests WHERE status IN ('pending','streaming')",
        )
      ).rows;
      for (const row of rows)
        await this.finish({
          userId: row.user_id,
          requestId: row.id,
          content: '',
          status: 'failed',
          latencyMs: 0,
        });
    },
    async deleteAccount(userId) {
      return db.transaction(async (tx) => {
        const profile = first(
          await tx.query('SELECT id,provider_subject,status FROM users WHERE id=$1 FOR UPDATE', [
            userId,
          ]),
        );
        if (!profile) throw new AppError(404, 'ACCOUNT_UNAVAILABLE', 'Account unavailable.');
        if (profile.status === 'deleted') return;
        const pending = first(
          await tx.query(
            "SELECT id FROM chat_requests WHERE user_id=$1 AND status IN ('pending','streaming') LIMIT 1",
            [userId],
          ),
        );
        if (pending)
          throw new AppError(
            409,
            'REQUEST_IN_PROGRESS',
            'Stop the current request before deleting this account.',
          );
        await tx.query(
          "INSERT INTO deletion_requests(id,user_id,status,deadline_at,completed_at) VALUES($1,$2,'complete',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
          [randomUUID(), userId],
        );
        await tx.query('DELETE FROM messages WHERE user_id=$1', [userId]);
        await tx.query('DELETE FROM routing_records WHERE user_id=$1', [userId]);
        await tx.query('DELETE FROM chat_requests WHERE user_id=$1', [userId]);
        await tx.query('DELETE FROM conversations WHERE user_id=$1', [userId]);
        await tx.query('DELETE FROM sessions WHERE user_id=$1', [userId]);
        await tx.query(
          "UPDATE users SET status='deleted',deleted_at=CURRENT_TIMESTAMP,display_name='Deleted local account',provider_subject=$2,google_sub=NULL,email=NULL,legal_version=NULL,legal_accepted_at=NULL WHERE id=$1",
          [userId, hashToken(profile.provider_subject)],
        );
        await audit(tx, userId, 'account_deleted', userId, {
          content_removed: true,
          minimal_usage_retained: true,
        });
      });
    },
  };
}
