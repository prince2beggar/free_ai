# Incident Runbook: Token Quota & Capacity Exhaustion

| Metadata | Details |
|---|---|
| **Incident ID** | `RUNBOOK-OPS-08-QUOTA` |
| **Requirements** | SRS `OPS-08`, `CAP-01`..`05`, `ROUTER-04`, `OPS-03` |
| **Severity Level** | SEV-2 (High Demand Throttling) / SEV-1 (Systemic Starvation) |
| **Subsystem** | Capacity Governor, Usage Ledger, Routing Admission |

---

## 1. Trigger Conditions & Detection

1. **Capacity Alert Triggered**: The Capacity Governor detects remaining shared-pool tokens fell below the emergency safety reserve (safety factor $S_F = 1.35$).
2. **Owner Alert Fired**: An owner alert with kind `CAPACITY_EXHAUSTED` is dispatched.
3. **HTTP 503 Spike**: Rate of requests rejected with `503 CAPACITY_EXHAUSTED` exceeds 5% of total incoming requests.
4. **Daily User Limit Exhaustion**: Legitimate users encounter repeated `429 DAILY_LIMIT_EXCEEDED` warnings.

---

## 2. Automated System Behavior

- **Hard Spend Caps & Zero Overdraft**: The Capacity Governor enforces hard mathematical bounds based on funded pools (`docs/CAPACITY.md`). In accordance with SRS `OPS-03`, paid auto-upgrades and overdraft billing are strictly disabled.
- **Fail-Closed Admission**: When available shared tokens reach zero, admission halts immediately to prevent unfunded provider calls.
- **Atomic Double-Lock Reservation**: Prevents race conditions and phantom token overdrafts across parallel requests.
- **Midnight UTC Token Reset**: The Governor automatically replenishes standard user daily quotas at 00:00:00 UTC.

---

## 3. Triage & Investigation Procedure

### Step 1: Inspect Capacity Dashboard (Admin Control Center M4)
- View current pool status via `GET /admin/api/capacity` or query capacity job runs:
  ```sql
  SELECT pool_remaining_tokens, safety_factor, updated_at
  FROM capacity_job_runs
  ORDER BY created_at DESC LIMIT 5;
  ```
- Determine whether depletion is due to:
  - **Organic traffic surge**: High number of unique active users utilizing standard limits.
  - **Runaway user loop / bot burst**: Single account or IP cluster consuming disproportionate tokens.

### Step 2: Differentiate Organic vs Abusive Consumption
- Check top consuming accounts in Ledger (`packages/ledger`):
  ```sql
  SELECT user_id, count(*) as req_count, sum(tokens_estimated) as total_tokens
  FROM usage_events
  WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '2 hours'
  GROUP BY user_id
  ORDER BY total_tokens DESC LIMIT 10;
  ```
- If an abusive user or script is identified, execute Step 4 of the [`ABUSE_WAVE.md`](ABUSE_WAVE.md) runbook to restrict or suspend the account.

---

## 4. Mitigation & Resolution Options

### Option A: Organic High-Demand Throttling (Preserve Pool)
If token consumption is organic but exceeds daily forecast:
1. Enforce tier prioritization: allow `supporter` or `verified` tiers while temporarily pausing non-essential free tier bursts.
2. Update public Status Page:
   - **Status**: Degraded Performance
   - **Banner**: "High Demand: Temporary Free Tier Capacity Throttling in Effect"
   - **Guidance**: Quotas will automatically refresh at midnight UTC.

### Option B: Operator Token Pool Injection (Emergency Reserve)
If authorized by the System Owner and backed by verified reserve funds:
1. Operators can adjust the pool allocation via signed configuration revision in Control Center M4.
2. Record an immutable audit log entry documenting the reason and funding source.

---

## 5. Post-Incident Review

- Verify automatic midnight reset occurs cleanly without stuck reservations.
- Reconcile actual daily consumption against mathematical models in `docs/CAPACITY.md`.
- Evaluate whether daily limits or safety factor $S_F$ require adjustment before next public wave.
