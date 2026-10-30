# Incident Runbook: Provider Outage & Circuit Breaker Response

| Metadata | Details |
|---|---|
| **Incident ID** | `RUNBOOK-OPS-08-PROV` |
| **Requirements** | SRS `OPS-08`, `OPS-06`, `ROUTE-03`, `ROUTE-04` |
| **Severity Level** | SEV-2 (with automated fallback) / SEV-1 (if all eligible providers fail) |
| **Subsystem** | AI Router, Provider Gateway, Capacity Governor |

---

## 1. Trigger Conditions & Detection

An incident is triggered when one of the following occurs:
1. **Automated Breaker Trip**: A provider or model records 5 consecutive network or API failures within a 60-second window. The circuit breaker trips into `OPEN` state.
2. **Owner Alert Fired**: An owner alert with kind `PROVIDER_OUTAGE` or `CIRCUIT_BREAKER_OPEN` is generated and dispatched to the on-call channel.
3. **Health Degradation**: Public `/health` and admin `/admin/api/monitoring/health` endpoints report `status: "degraded"` with `breakers.openCount > 0`.
4. **Latency Anomaly**: Upstream time-to-first-token exceeds 10 seconds on > 20% of synthetic/live requests.

---

## 2. Automated System Behavior

The platform includes built-in resilience mechanisms that act immediately without human intervention:
- **Automatic Model Fallback**: When the primary selected model fails or its circuit breaker is open, the Router immediately re-evaluates the candidate set in priority order and dispatches to the highest-ranking available alternative.
- **Circuit Breaker Isolation**: In `OPEN` state, subsequent requests skip the failed provider entirely, avoiding timeout overheads and fast-failing until the cooldown period (default 60 seconds) expires.
- **Clean 503 Rejection**: If all eligible models in the pool are circuit-broken or disabled, the admission layer returns HTTP 503 `NO_ELIGIBLE_MODELS` with clear guidance to try again later.
- **Zero Platform Disruption**: Administrative authentication, audit logging, file processing, and saved conversation retrieval remain fully functional during external provider outages (`OPS-06`).

---

## 3. Immediate Mitigation Steps

If an outage persists or causes user-facing degradation, the on-call operator must execute the following:

### Step 1: Assess Incident Scope
- Open Admin Control Center: `GET /admin` or `GET /admin/api/monitoring/health`.
- Check open circuit breakers and error counts:
  ```bash
  # Query health endpoint
  curl -s http://127.0.0.1:4178/health | jq .breakers
  ```
- Identify which provider/model IDs are experiencing errors.

### Step 2: Manually Disable Failing Provider (Control Center M2)
If upstream provider status indicates an extended outage, disable the provider to prevent repeated failed probe attempts:
```http
POST /admin/api/providers/{providerId}/status
Content-Type: application/json
X-CSRF-Token: {csrfToken}

{
  "status": "disabled",
  "reason": "Upstream service outage confirmed by provider status page"
}
```

### Step 3: Verify Fallback Routing (Control Center M4 / AP-06 Simulator)
Run the zero-mutation dry-run routing simulator to confirm fallback models receive incoming traffic cleanly:
```http
POST /admin/api/routing/simulate
Content-Type: application/json
X-CSRF-Token: {csrfToken}

{
  "prompt": "Test fallback verification",
  "language": "en",
  "taskPreset": "general"
}
```
Verify that the `selection.modelId` resolves to an active, operational alternative.

### Step 4: Update Public Status Page
1. Update `/status` by declaring a component degradation on `AI Router & Gateway`.
2. Post an incident banner:
   - **Title**: Degraded Performance: Upstream Model Latency
   - **Impact**: Responses are temporarily routed through backup synthetic models. No chat data is affected.

---

## 4. Recovery & Post-Incident Verification

1. **Monitor Upstream Health**: Check official provider status page (e.g., Google Cloud, Groq Status, Cloudflare Status).
2. **Execute Controlled Dry-Run Probe**: Send a test request via routing simulator or operator test endpoint (`/admin/api/providers/{providerId}/test`).
3. **Re-Enable Provider**: Once upstream recovery is confirmed, restore provider status to `enabled` in Control Center M2.
4. **Verify Health Cleared**: Confirm `/health` returns `status: "ok"` and `breakers.openCount: 0`.
5. **Resolve Status Page Incident**: Update `/status` to "All Systems Operational".
