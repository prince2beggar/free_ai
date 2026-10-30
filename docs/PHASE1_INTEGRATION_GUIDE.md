# Phase 1 integration setup before hosting

Updated **2026-10-13, Asia/Dhaka**. P1-PREHOST-001 / SRS 17.1.3 authorizes implementation and local checks now; **host and domain are owner-deferred**. Google OAuth routes, a scoped Groq evaluation transport and a no-call readiness command are implemented. **Actual Google sign-in and real model evaluation have not run:** no real client credentials, eligible provider account/model or completed test scope has been supplied. This guide does not mark full Phase 1 accepted.

## First: configure Google sign-in locally

1. In your own Google Cloud project, configure the OAuth consent audience and permitted test users. Create an OAuth client of type **Web application**. Add the exact authorized redirect URI **`http://127.0.0.1:4175/api/auth/google/callback`**. No hosted domain is needed for this local web flow. Follow [Google's web-server guide](https://developers.google.com/identity/protocols/oauth2/web-server) and [OIDC documentation](https://developers.google.com/identity/openid-connect/openid-connect), read 2026-10-13. This app requests `openid email profile`, not Drive/Gmail scopes.
2. Store the client ID and client secret only in the local server process. Do not paste the secret here or commit it. The launcher deliberately does not load `.env`; the empty example documents names only. From a new PowerShell terminal in `D:\free_ai`:

```powershell
$env:PHASE1_MODE = 'LOCAL_GOOGLE'
$env:GOOGLE_AUTH_ENABLED = 'true'
$env:REAL_PROVIDERS_ENABLED = 'false'
$env:PHASE1_PORT = '4175'
$env:GOOGLE_REDIRECT_URI = 'http://127.0.0.1:4175/api/auth/google/callback'
$env:GOOGLE_CLIENT_ID = Read-Host 'Google Web client ID'
$taskSecret = Read-Host 'Google client secret' -AsSecureString
$taskSecretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecret)
try {
    $env:GOOGLE_CLIENT_SECRET = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskSecretPointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskSecretPointer)
}
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase1
```

3. Open **http://127.0.0.1:4175**, read/accept the updated local drafts and select **Sign in with Google**. The test mode disables Demo Alpha/Beta sign-in and stores its database separately under ignored `.phase1-integration/database`. It binds state to the browser, uses PKCE/nonce and signature/issuer/audience/time verification, consumes state once and rotates the server session. A cancelled, forged or replayed callback fails safely. HTTP cookies are an explicit loopback exception; hosted HTTPS/Secure-cookie behavior remains untested.
4. Verify returning sign-in, sign-out/revocation, saved synthetic chats and deletion. The app stores verified subject/display name, not email or Google access/refresh tokens. Deletion leaves a subject hash with retained minimal evidence; repeat deletion is idempotent and cannot restore an account or reset retained limits. Close this terminal after testing to discard its process environment. **Chat still uses synthetic responses in this mode.**

## Second: prepare the exact free provider test

Groq remains an optional reviewed starting candidate, not a proven production choice. Create your own Free account when ready. Do not upgrade to Developer or attach a payment method for this zero-spend test. Read its [quickstart](https://console.groq.com/docs/quickstart), [billing guidance](https://console.groq.com/docs/billing-faqs), [rate-limit documentation](https://console.groq.com/docs/rate-limits) and the exact account/model terms. Sources read 2026-10-13; advertised quotas do not substitute for your account's limits.

Create a key and keep it as the server-process variable `GROQ_API_KEY`, using the same secure prompt/BSTR pattern above with that variable name. Do not paste the key in chat, scope JSON, command arguments or source.

Copy [the inactive scope example](../tools/phase1/test-scope.example.json) to ignored `.phase1-integration/scope.json`. Supply actual values for exact model ID, account RPM/TPM/remaining daily calls, dedicated test-account evidence, dated terms/eligibility and Free/no-overage proof, local key-variable name, and exact expiry with the **`+06:00`** Asia/Dhaka offset. The already approved bounds remain **45 calls, 4,000 input/1,024 output tokens per call, BDT 0, no retries/fallbacks, fixed synthetic data only**. Do not re-approve those numbers or invent a date/limit.

Exact-model input-token evidence must cover the rendered system/user chat template for each fixed case. Character counts are not verified token counts. Once the model is selected, collect that evidence with an approved tokenizer/configuration; leave `tokenization.verified=false` until it is actually verified. The reviewed scope digest must be supplied separately from the scope file. A template, `ownerApproved` flag or digest alone does not prove provider eligibility, real account settings or an owner decision; those need the actual record/evidence.

Run the **no-call** readiness check:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\prototype.ps1 -Task phase1-readiness
```

Current result: **NEEDS_ACCOUNT_AND_SCOPE**, `modelCallsMade=0`, `credentialsRead=false`, `hostDomain=OWNER_DEFERRED`. The readiness command reports the scope digest and missing concrete fields without reading a credential value or contacting Google/Groq.

## Third: run only the verified evaluation scope

After the concrete scope and external approval record are verified, the explicit execution command is:

```powershell
$taskApprovedScopeHash = Read-Host 'Previously reviewed and approved scope SHA-256'
$env:NODE_TLS_REJECT_UNAUTHORIZED = '1'
& .\.tools\node-v24.21.0-win-x64\node.exe --use-system-ca .\tools\phase1\evaluate.mjs --scope .\.phase1-integration\scope.json --scope-sha256 $taskApprovedScopeHash --execute
```

Until the missing account/scope/tokenization evidence is complete, this fails closed. No execution was attempted during the preparation work. The implementation uses [Groq's exact chat-completions endpoint](https://console.groq.com/docs/api-reference), fixed frozen-suite system/prompts, one exact model, bounded responses, account pacing and a durable synchronized attempt journal. It reserves before sending; crash/timeout/error/unknown usage/route mismatch/quota warning/cost signal/expiry stops subsequent work. The first request must fit account TPM; expiry is rechecked before credential access and after reservation and bounds the transport deadline. Attempts remain spent across restart; locks and missing captures are never silently cleared to retry.

Captures and the attempt/stop files stay under ignored `.eval-local/groq/<scopeId>`. Captured token counts are provider-reported; missing usage stays unknown, not zero. Cost remains unknown unless actually established. Results remain **unreviewed**, never auto-approved or self-graded. No candidate code is executed. The frozen evaluator continues to accept only offline/imported-unverified inputs; independent language and isolated coding review remain required before real quality acceptance. Ordinary chat is not switched to a real provider by this command.

## Fourth: close local acceptance and prepare the later host

Run `tools/prototype.ps1 -Task phase1-check`, `-Task phase1-browser`, the preserved Python suite and `-Task browser` with the README PowerShell flags. Auth/Groq adapter coverage uses `tools/prototype.ps1 -Task phase1-coverage`, enforcing the 70% line threshold on the reviewed Node runtime. Request logs contain only generated request ID, fixed surface category, method/status/duration; no raw URL, OAuth code, header, user ID or prompt. Basic palette text/focus contrast was measured and strengthened; the full screen-reader/WCAG and phone/4G performance checks remain unverified. [W3C criteria](https://www.w3.org/TR/WCAG21/#contrast-minimum) read 2026-10-13.

The five legal pages now use **local-draft-v2**, preserve v1 history and disclose optional Google identity processing and separate scoped Groq evaluation. Local copy/security checks cannot establish qualified legal clearance, target audience/regions or provider resale/public-serving permission. Those remain open. Audit/usage expiry still awaits a separate privileged retention boundary; the unsafe SQL bypass was not applied.

Once the actual Google and eligible model flows are verified, record original T1.1 and staging acceptance. **Hosted staging is deferred until you add the host/domain.** At that point verify environment/secret separation, HTTPS/origin and Secure cookies, actual PostgreSQL/retention roles, CI/migration/rollback/backup behavior, bounded billing/capacity, image/OS/WASM scan, required legal/quality/NFR review and owner acceptance. No hosting purchase, DNS change, public exposure or Phase 2 acceptance occurred in this process.
