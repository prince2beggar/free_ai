import {
  ApiError,
  request,
  recoveryMessage,
  sendMessage,
  setCsrfToken,
  fetchProductivityTemplates,
  uploadFile,
  analyzeCsvFile,
  queryCsvFile,
  fetchApiKeys,
  createApiKey,
  updateApiKeyStatus,
  deleteApiKey,
  verifyApiKey,
  testSavedApiKey,
  type ApiKeyItem,
  type Account,
  type AbuseChallenge,
  type AbuseStatus,
  type AvailableModels,
  type Bootstrap,
  type ChallengeProof,
  type Conversation,
  type LedgerUsage,
  type Message,
  type ResponseAttempt,
  type RoutingOptions,
  type RoutingPreset,
  type User,
  type ProductivityTemplate,
  type UploadedFile,
  type CsvAnalysisResponse,
} from './api.js';

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error('Required workspace element is missing.');
  return found;
}
const input = element<HTMLTextAreaElement>('#message');
const form = element<HTMLFormElement>('#composer');
const messages = element<HTMLDivElement>('#messages');
const status = element<HTMLParagraphElement>('#status');
const dialog = element<HTMLDialogElement>('#action-dialog');
let config: Bootstrap | undefined;
let selected: Conversation | undefined;
let conversationMessages: Message[] = [];
let language: 'en' | 'bn' = 'en';
let busy = false;
let busyDepth = 0;
let controller: AbortController | undefined;
let requestId: string | undefined;
let stopRequested = false;
let dialogAction: (() => Promise<void>) | undefined;
let routingControls: HTMLDivElement | undefined;
let availableModels: AvailableModels | undefined;
let verificationPurpose: 'signup' | 'burst' | undefined;
let signupProof: (ChallengeProof & { expiresAt: string }) | undefined;
let burstProof: (ChallengeProof & { expiresAt: string }) | undefined;
let currentAttachedFile: UploadedFile | undefined;
let lastCsvAnalysis: CsvAnalysisResponse | undefined;
let cachedTemplates: Record<string, ProductivityTemplate> = {};
let inMemoryTheme: 'light' | 'dark' = 'dark';
let inMemoryRole: 'admin' | 'user' | undefined;
let inMemoryUserName: string | undefined = 'Rifat';
let inMemoryUserEmail: string | undefined;
let inMemorySelectedModel = 'auto';

function showToast(message: string): void {
  const toast = document.querySelector<HTMLDivElement>('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

function validProof(proof: (ChallengeProof & { expiresAt: string }) | undefined): boolean {
  return proof !== undefined && new Date(proof.expiresAt).getTime() > Date.now();
}
function requireVerification(purpose: 'signup' | 'burst'): void {
  if (!config?.abuseEnabled) return;
  verificationPurpose = purpose;
  if (purpose === 'signup') signupProof = undefined;
  else burstProof = undefined;
  element('#abuse-verification').hidden = false;
  element('#abuse-verification-status').textContent =
    purpose === 'signup'
      ? 'Verify locally, then choose a shared demo account.'
      : 'Verify locally before your next request, then choose Send or Retry. Verification does not resend a message.';
  updateControls();
}
function renderAbuseStatus(abuse: AbuseStatus | undefined): void {
  const details = element('#abuse-details');
  details.hidden = !config?.abuseEnabled || !abuse;
  if (!config?.abuseEnabled || !abuse) return;
  const moderation = {
    none: 'Active',
    throttle: 'Temporarily throttled',
    suspend: 'Suspended',
    ban: 'Banned',
  }[abuse.moderation.action];
  details.textContent = recoveryMessage(
    {
      message:
        'Local synthetic limits · Trust level ' +
        abuse.trustLevel +
        ' · ' +
        moderation +
        '. Requests today: ' +
        abuse.usage.dailyRequests +
        ' / ' +
        abuse.limits.dailyRequests +
        '. Daily token cap: ' +
        abuse.limits.dailyTokens +
        '. Burst limit: ' +
        abuse.limits.burstRequests +
        ' requests per ' +
        timeLeft(Math.ceil(abuse.limits.burstWindowMs / 1000)) +
        '. New-account source caps: ' +
        abuse.limits.newAccountDeviceRequests +
        ' per device / ' +
        abuse.limits.newAccountIpRequests +
        ' per network range. ' +
        (abuse.verifiedContact ? 'Contact verified. ' : 'Contact not verified. ') +
        (abuse.moderation.until
          ? 'Restriction ends: ' + new Date(abuse.moderation.until).toLocaleString() + '. '
          : ''),
      resetAt: abuse.resetAt,
    },
    '',
  );
  if (abuse.challenge.burstRequired && !validProof(burstProof) && !verificationPurpose)
    requireVerification('burst');
}
async function solveChallenge(challenge: AbuseChallenge): Promise<ChallengeProof> {
  const expiresAt = new Date(challenge.expiresAt).getTime();
  if (
    challenge.algorithm !== 'sha256-leading-zero-bits-v1' ||
    challenge.syntheticOnly !== true ||
    challenge.humanVerification !== false ||
    challenge.purpose !== verificationPurpose ||
    typeof challenge.id !== 'string' ||
    typeof challenge.nonce !== 'string' ||
    !challenge.id.length ||
    !challenge.nonce.length ||
    challenge.id.length > 256 ||
    challenge.nonce.length > 512 ||
    !Number.isInteger(challenge.difficulty) ||
    challenge.difficulty < 1 ||
    challenge.difficulty > 20 ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  )
    throw new ApiError(
      'ABUSE_CHALLENGE_INVALID',
      'This local challenge is unavailable or expired. Verify again.',
      400,
      true,
    );
  const encoder = new TextEncoder();
  const completeBytes = Math.floor(challenge.difficulty / 8);
  const remainingBits = challenge.difficulty % 8;
  // Bound work from the server-issued difficulty; expiration also stops the search.
  const maximumAttempts = 2 ** (challenge.difficulty + 3);
  for (let attempt = 0; attempt < maximumAttempts && Date.now() < expiresAt; attempt++) {
    const solution = String(attempt);
    const hash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(challenge.nonce + ':' + solution)),
    );
    if (Date.now() >= expiresAt) break;
    if (
      hash.slice(0, completeBytes).every((byte) => byte === 0) &&
      (remainingBits === 0 || hash[completeBytes]! >>> (8 - remainingBits) === 0)
    )
      return { id: challenge.id, solution };
    if (attempt % 64 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new ApiError(
    'ABUSE_CHALLENGE_EXPIRED',
    'This local challenge did not finish in time. Verify again.',
    400,
    true,
  );
}
async function verifyLocally(): Promise<void> {
  if (busy || !config?.abuseEnabled || !verificationPurpose) return;
  const purpose = verificationPurpose;
  setBusy(true);
  element('#abuse-verification-status').textContent = 'Completing a local synthetic challenge…';
  try {
    const { challenge } = await request<{ challenge: AbuseChallenge }>(
      '/api/abuse/challenges',
      'POST',
      { purpose },
    );
    const proof = { ...(await solveChallenge(challenge)), expiresAt: challenge.expiresAt };
    if (purpose === 'signup') signupProof = proof;
    else burstProof = proof;
    element('#abuse-verification-status').textContent =
      purpose === 'signup'
        ? 'Local work completed. Choose a shared demo account to submit this proof.'
        : 'Local work completed. Choose Send or Retry to submit this proof; nothing was resent.';
    announce('Local challenge completed. This does not verify a human.');
  } finally {
    setBusy(false);
  }
}

function modelName(id: string): string {
  return availableModels?.models.find((model) => model.id === id)?.displayName ?? id;
}
function routingOptions(
  action: RoutingOptions['action'] = 'send',
  retryOf: string | null = null,
): RoutingOptions | undefined {
  if (!config?.routingEnabled) return undefined;
  const choice = element<HTMLSelectElement>('#model-choice').value;
  return {
    mode: choice.startsWith('model:') ? 'manual' : choice === 'free-only' ? 'free-only' : 'auto',
    modelId: choice.startsWith('model:') ? choice.slice(6) : null,
    preset: element<HTMLSelectElement>('#task-preset').value as RoutingPreset,
    contextAction:
      element<HTMLSelectElement>('#context-action').value === 'refuse' ? 'refuse' : 'trim',
    action,
    retryOf,
  };
}
function routingSelect(id: string, text: string, options: [string, string][]): void {
  if (!routingControls) return;
  const row = document.createElement('p');
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = text;
  const select = document.createElement('select');
  select.id = id;
  select.className = 'secondary';
  for (const [value, text] of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    select.append(option);
  }
  row.append(label, select);
  routingControls.append(row);
}
async function refreshRoutingControls(): Promise<void> {
  if (!config?.routingEnabled || !config.authenticated) {
    if (routingControls) routingControls.hidden = true;
    availableModels = undefined;
    return;
  }
  availableModels = await request<AvailableModels>('/api/models/available');
  const previousChoice = document.querySelector<HTMLSelectElement>('#model-choice')?.value;
  const previousPreset = document.querySelector<HTMLSelectElement>('#task-preset')?.value;
  const previousContext = document.querySelector<HTMLSelectElement>('#context-action')?.value;
  if (!routingControls) {
    routingControls = document.createElement('div');
    routingControls.id = 'routing-controls';
    routingControls.className = 'account-panel';
    routingControls.setAttribute('role', 'group');
    routingControls.setAttribute('aria-label', 'Response settings');
    form.prepend(routingControls);
  }
  routingControls.replaceChildren();
  routingControls.hidden = false;
  routingSelect('model-choice', 'Model', [
    ['auto', 'Auto'],
    ['free-only', 'Free models only'],
    ...availableModels.models.map((model): [string, string] => [
      'model:' + model.id,
      model.displayName,
    ]),
  ]);
  const presetLabels: Record<RoutingPreset, string> = {
    general: 'General',
    coding: 'Coding',
    writing: 'Writing',
    research: 'Research',
    translation: 'Translation',
    summary: 'Summary',
  };
  routingSelect(
    'task-preset',
    'Task preset',
    availableModels.presets.map((preset) => [preset, presetLabels[preset]]),
  );
  routingSelect('context-action', 'Long conversation', [
    ['trim', 'Trim older messages when needed'],
    ['refuse', 'Ask me before trimming'],
  ]);
  const hint = document.createElement('p');
  hint.id = 'context-hint';
  hint.className = 'message-meta';
  hint.textContent =
    'A selected model may use one compatible fallback if it fails before replying; each attempt shows the model used. Trimming leaves older messages saved in this chat but leaves them out of the next response. Retry and regenerate use the server’s request limits and retry budget.';
  routingControls.append(hint);
  element<HTMLSelectElement>('#context-action').setAttribute('aria-describedby', 'context-hint');
  for (const [id, value] of [
    ['#model-choice', previousChoice],
    ['#task-preset', previousPreset],
    ['#context-action', previousContext],
  ]) {
    const select = element<HTMLSelectElement>(id!);
    if (value && [...select.options].some((option) => option.value === value)) select.value = value;
  }
}

function announce(message: string, error = false): void {
  status.textContent = message;
  status.dataset.error = String(error);
}
function updateControls(): void {
  const authenticated = config?.authenticated === true;
  input.disabled = busy || !authenticated;
  const length = input.value.length;
  const maximum = config?.limits.maxInputChars ?? 0;
  element<HTMLSpanElement>('#counter').textContent = maximum
    ? length + ' / ' + maximum + ' characters'
    : '';
  element<HTMLButtonElement>('#send').disabled =
    busy || !authenticated || !input.value.trim() || length > maximum;
  element<HTMLButtonElement>('#send').hidden = busy;
  element<HTMLButtonElement>('#stop').hidden = !busy || !controller;
  element<HTMLButtonElement>('#new-chat').disabled = busy || !authenticated;
  element<HTMLButtonElement>('#rename-chat').disabled = busy || !selected;
  element<HTMLButtonElement>('#delete-chat').disabled = busy || !selected;
  element<HTMLButtonElement>('#logout').disabled = busy;
  element<HTMLButtonElement>('#delete-account').disabled = busy;
  const accepted = element<HTMLInputElement>('#accept-legal').checked;
  const emailInput = document.querySelector<HTMLInputElement>('#user-email-input');
  const emailSubmit = document.querySelector<HTMLButtonElement>('#email-login-submit');
  if (emailSubmit && emailInput) {
    const emailVal = emailInput.value.trim();
    const emailValid = emailVal.length > 3 && emailVal.includes('@');
    emailSubmit.disabled =
      busy || !accepted || !emailValid || (!!config?.abuseEnabled && !validProof(signupProof));
  }
  for (const id of ['#login-alpha', '#login-beta', '#google-signin'])
    element<HTMLButtonElement>(id).disabled =
      busy ||
      !accepted ||
      (id !== '#google-signin' && !!config?.abuseEnabled && !validProof(signupProof));
  element<HTMLButtonElement>('#abuse-verify').disabled =
    busy || (verificationPurpose === 'signup' && !accepted);
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '.conversation-link, .prompt-card, [data-language]',
  ))
    button.disabled = busy;
  for (const select of document.querySelectorAll<HTMLSelectElement>('#routing-controls select'))
    select.disabled = busy || !authenticated;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-response-action]'))
    button.disabled = busy || button.dataset.allowed !== 'true';
}
function setBusy(value: boolean): void {
  busyDepth = Math.max(0, busyDepth + (value ? 1 : -1));
  busy = busyDepth > 0;
  updateControls();
}
function metadata(message: Message): string {
  if (message.role !== 'assistant') return '';
  const provenance =
    message.providerId && message.modelId
      ? message.providerId + ' / ' + message.modelId
      : 'Synthetic response';
  const usage =
    message.inputTokens !== undefined && message.outputTokens !== undefined
      ? ' · Estimated synthetic tokens: ' +
        message.inputTokens +
        ' input / ' +
        message.outputTokens +
        ' output'
      : '';
  const state =
    message.status === 'cancelled'
      ? ' · Stopped'
      : message.status === 'failed'
        ? ' · Failed'
        : message.status === 'streaming'
          ? ' · In progress'
          : '';
  const isSynthetic = !message.providerId || message.providerId === 'synthetic-provider';
  const sampleNote = isSynthetic ? ' · Prewritten sample; no AI model call' : ' · Live AI Engine';
  return provenance + sampleNote + usage + state;
}
function responseDetails(
  message: Message,
  target: { body: HTMLParagraphElement; banner: HTMLParagraphElement; attempts: HTMLDivElement },
): void {
  const changed = message.requestedModelId && message.modelId !== message.requestedModelId;
  const notes: string[] = [];
  if (changed && message.modelId)
    notes.push(
      'You chose ' +
        modelName(message.requestedModelId!) +
        '. ' +
        modelName(message.modelId) +
        ' answered instead.',
    );
  if (message.contextTrimmed)
    notes.push(
      'Older messages were left out of this response to fit the model’s context. They remain saved.',
    );
  target.banner.textContent = notes.join(' ');
  target.banner.hidden = notes.length === 0;
  target.attempts.replaceChildren();
  const attempts = message.attempts ?? [];
  target.body.hidden = attempts.length > 0;
  for (const attempt of attempts) {
    const section = document.createElement('section');
    section.className = 'message';
    section.dataset.attemptId = attempt.attemptId;
    const heading = document.createElement('p');
    heading.className = 'message-label';
    heading.textContent = 'Attempt ' + attempt.index + ' · ' + modelName(attempt.modelId);
    const content = document.createElement('p');
    content.className = 'message-body';
    content.textContent = attempt.content;
    const detail = document.createElement('p');
    detail.className = 'message-meta';
    detail.textContent =
      attempt.providerId +
      ' / ' +
      attempt.modelId +
      (attempt.status === 'failed'
        ? ' · Failed attempt'
        : attempt.status === 'cancelled'
          ? ' · Stopped attempt'
          : attempt.status === 'streaming'
            ? ' · In progress'
            : '');
    section.append(heading, content, detail);
    target.attempts.append(section);
  }
}
function sourceContent(message: Message): string {
  return (
    conversationMessages.find(
      (saved) =>
        saved.role === 'user' &&
        (saved.id === message.sourceMessageId ||
          (saved.requestId && saved.requestId === message.requestId)),
    )?.content ?? ''
  );
}
function responseActions(message: Message, article: HTMLElement): void {
  if (message.role === 'assistant' && message.status === 'complete' && message.content) {
    const exportToolbar = document.createElement('div');
    exportToolbar.className = 'message-actions';

    // Copy
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'secondary';
    copyBtn.textContent = language === 'bn' ? '📋 কপি' : '📋 Copy';
    copyBtn.title = 'Copy response text';
    copyBtn.addEventListener('click', () => {
      void navigator.clipboard.writeText(message.content).then(() => {
        showToast(language === 'bn' ? 'ক্লিপবোর্ডে কপি করা হয়েছে' : 'Copied to clipboard!');
      });
    });

    // Word Doc
    const docBtn = document.createElement('button');
    docBtn.type = 'button';
    docBtn.className = 'secondary';
    docBtn.textContent = language === 'bn' ? '📄 Word (.doc)' : '📄 Word (.doc)';
    docBtn.title = 'Export as Word document';
    docBtn.addEventListener('click', () => {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Export</title><style>body { font-family: Calibri, sans-serif; line-height: 1.6; color: #111; padding: 20px; } pre { background: #f4f4f4; padding: 10px; border-radius: 4px; }</style></head><body>${message.content.replace(/\n/g, '<br/>')}</body></html>`;
      const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `document-export-${Date.now()}.doc`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(language === 'bn' ? 'Word ফাইল ডাউনলোড হয়েছে' : 'Exported as Word DOC');
    });

    // PDF via print
    const pdfBtn = document.createElement('button');
    pdfBtn.type = 'button';
    pdfBtn.className = 'secondary';
    pdfBtn.textContent = language === 'bn' ? '📑 PDF' : '📑 PDF';
    pdfBtn.title = 'Print or save as PDF';
    pdfBtn.addEventListener('click', () => {
      window.print();
    });

    // Markdown
    const mdBtn = document.createElement('button');
    mdBtn.type = 'button';
    mdBtn.className = 'secondary';
    mdBtn.textContent = language === 'bn' ? '⬇️ Markdown' : '⬇️ Markdown';
    mdBtn.title = 'Export as Markdown file';
    mdBtn.addEventListener('click', () => {
      const blob = new Blob([message.content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `content-export-${Date.now()}.md`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(language === 'bn' ? 'Markdown ফাইল ডাউনলোড হয়েছে' : 'Exported as Markdown');
    });

    exportToolbar.append(copyBtn, docBtn, pdfBtn, mdBtn);
    article.append(exportToolbar);
  }

  if (!config?.routingEnabled || message.role !== 'assistant' || !message.requestId) return;
  const content = sourceContent(message);
  for (const action of ['retry', 'regenerate'] as const) {
    const applicable =
      action === 'retry'
        ? ['failed', 'cancelled', 'partial'].includes(message.status)
        : message.status === 'complete';
    if (!applicable) continue;
    const allowed =
      Boolean(content) &&
      message.retryBudgetRemaining !== 0 &&
      (action === 'retry' ? message.retryAllowed !== false : message.regenerateAllowed !== false);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = action === 'retry' ? 'Retry response' : 'Regenerate response';
    button.dataset.responseAction = action;
    button.dataset.allowed = String(allowed);
    button.disabled = busy || !allowed;
    button.addEventListener('click', () => {
      if (busy || !allowed || !message.requestId) return;
      void guard(() => submitMessage(content, routingOptions(action, message.requestId)));
    });
    article.append(button);
    if (!allowed) {
      const hint = document.createElement('p');
      hint.className = 'message-meta';
      hint.textContent = content
        ? 'The retry budget for this response is used up. Send a new message to continue.'
        : 'The source message is unavailable. Reopen this chat before trying again.';
      article.append(hint);
    }
  }
}
function appendMessage(message: Message): {
  body: HTMLParagraphElement;
  meta: HTMLParagraphElement;
  banner: HTMLParagraphElement;
  attempts: HTMLDivElement;
} {
  const article = document.createElement('article');
  article.className = 'message ' + message.role;
  article.dataset.messageId = message.id;
  const label = document.createElement('p');
  label.className = 'message-label';
  label.textContent =
    message.role === 'user'
      ? language === 'bn'
        ? 'আপনি'
        : 'You'
      : language === 'bn'
        ? 'নমুনা এআই সহকারী'
        : 'AI Assistant';
  const body = document.createElement('p');
  body.className = 'message-body';
  body.textContent = message.content;
  const meta = document.createElement('p');
  meta.className = 'message-meta';
  meta.textContent = metadata(message);
  const banner = document.createElement('p');
  banner.className = 'account-panel';
  banner.setAttribute('role', 'status');
  banner.dataset.choiceBanner = 'true';
  const attempts = document.createElement('div');
  attempts.className = 'response-attempts';
  const target = { body, meta, banner, attempts };
  responseDetails(message, target);
  article.append(label, banner, attempts, body, meta);
  responseActions(message, article);
  messages.append(article);
  return target;
}
function renderMessages(): void {
  messages.replaceChildren();
  for (const message of conversationMessages) appendMessage(message);
  element('#welcome').hidden = conversationMessages.length > 0;
}
function renderExamples(): void {
  const examples = element('#examples');
  examples.replaceChildren();
  const prompts =
    language === 'bn'
      ? [
          'পড়াশোনার একটি নমুনা পরিকল্পনা দেখান',
          'লেখার একটি নমুনা ধারণা দেখান',
          'এই স্থানীয় ডেমো কীভাবে কাজ করে?',
        ]
      : [
          'Show a sample study plan',
          'Show a sample writing idea',
          'How does this local demo work?',
        ];
  for (const text of prompts) {
    const button = document.createElement('button');
    button.className = 'prompt-card';
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', () => {
      input.value = text;
      updateControls();
      input.focus();
    });
    examples.append(button);
  }
}
function timeLeft(seconds: number | null): string {
  if (seconds === null) return 'no expiry';
  if (seconds <= 0) return 'expired';
  const units: [number, string][] = [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [size, label] of units) {
    if (seconds >= size) {
      const count = Math.floor(seconds / size);
      return count + ' ' + label + (count === 1 ? '' : 's');
    }
  }
  return seconds + ' second' + (seconds === 1 ? '' : 's');
}
function renderLedgerUsage(usage: LedgerUsage): void {
  const details = element('#usage-details');
  details.replaceChildren();
  const label = document.createElement('span');
  label.textContent = 'Local synthetic token allowances.';
  details.append(label);
  if (usage.entitlements.length === 0) {
    details.append(document.createElement('br'));
    const empty = document.createElement('span');
    empty.textContent = 'No free or pack token allowance is available.';
    details.append(empty);
  }
  const refusalReasons: Record<string, string> = {
    ENTITLEMENT_EXPIRED: 'This allowance has expired.',
    ENTITLEMENT_NOT_STARTED: 'This allowance is not available yet.',
    BALANCE_EXHAUSTED: 'This allowance has been used up.',
    TOKENS_EXHAUSTED: 'The token allowance has been used up.',
    FUNDED_BALANCE_EXHAUSTED: 'The funded allowance has been used up.',
  };
  for (const entitlement of usage.entitlements) {
    const row = document.createElement('span');
    row.textContent =
      (entitlement.kind === 'free' ? 'Free tokens' : 'Pack tokens') +
      ' · Remaining: ' +
      BigInt(entitlement.remaining.inputTokens).toLocaleString('en') +
      ' input / ' +
      BigInt(entitlement.remaining.outputTokens).toLocaleString('en') +
      ' output. Time left: ' +
      timeLeft(entitlement.timeLeftSeconds) +
      '. ' +
      (entitlement.estimated
        ? 'Estimated usage; awaiting reconciliation.'
        : entitlement.pendingReconciliation
          ? 'Awaiting usage reconciliation.'
          : 'Resolved usage.') +
      (entitlement.refusalReason
        ? ' Refusal: ' + (refusalReasons[entitlement.refusalReason] ?? entitlement.refusalReason)
        : '');
    details.append(document.createElement('br'), row);
  }
}
async function refreshAccount(): Promise<void> {
  const account = await request<Account>('/api/account');
  let abuse = account.abuse;
  if (config?.abuseEnabled) {
    const result = abuse ? { abuse } : await request<{ abuse: AbuseStatus }>('/api/abuse/status');
    abuse = result.abuse;
    renderAbuseStatus(result.abuse);
  }
  const isAdmin =
    inMemoryRole === 'admin' ||
    (inMemoryRole !== 'user' &&
      (account.user.id === 'synthetic-user-a' || account.user.tier === 'admin'));

  const customName =
    inMemoryUserName ||
    (inMemoryUserEmail ? inMemoryUserEmail.split('@')[0] : '') ||
    (isAdmin ? 'Md Asadujjaman Prince' : account.user.displayName || 'Workspace User');
  const displayName = customName;
  element('#account-label').textContent = displayName;
  const userDisplayEl = document.querySelector<HTMLElement>('#user-display-name');
  if (userDisplayEl) userDisplayEl.textContent = displayName;
  const userAvatarEl = document.querySelector<HTMLElement>('#user-avatar');
  if (userAvatarEl) {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    const firstChar = parts[0]?.charAt(0) ?? '';
    const lastChar = parts[parts.length - 1]?.charAt(0) ?? '';
    const initials =
      parts.length > 1
        ? (firstChar + lastChar).toUpperCase()
        : displayName.slice(0, 2).toUpperCase();
    userAvatarEl.textContent = initials || (isAdmin ? 'AP' : 'U');
  }

  // Hide admin features for regular users
  const adminSection = document.querySelector<HTMLElement>('#sidebar-admin-section');
  if (adminSection) adminSection.hidden = !isAdmin;
  const topbarAdmin = document.querySelector<HTMLElement>('#topbar-admin-pill');
  if (topbarAdmin) topbarAdmin.hidden = !isAdmin;
  const statusTokensPill = document.querySelector<HTMLElement>('#tokens-mini-pill');
  if (statusTokensPill) statusTokensPill.hidden = !isAdmin;

  const planBadge = document.querySelector<HTMLElement>('.user-plan-badge');
  if (planBadge) {
    planBadge.textContent = isAdmin ? '👑 Super Admin · Full Access' : 'Standard User · Free Tier';
  }

  element('#account-details').textContent =
    account.user.displayName +
    ' · Tier: ' +
    account.user.tier +
    ' · Trust level: ' +
    (abuse?.trustLevel ?? account.user.trustLevel);
  if (account.ledgerUsage) {
    renderLedgerUsage(account.ledgerUsage);
    return;
  }
  element('#usage-details').textContent =
    'Requests today: ' +
    account.usage.requestsToday +
    ' / ' +
    account.usage.dailyLimit +
    ' · Estimated synthetic tokens: ' +
    account.usage.inputTokens +
    ' input / ' +
    account.usage.outputTokens +
    ' output';
}
async function refreshList(): Promise<Conversation[]> {
  const result = await request<{ conversations: Conversation[] }>('/api/conversations');
  const list = element('#conversation-list');
  list.replaceChildren();
  for (const conversation of result.conversations) {
    const button = document.createElement('button');
    button.className = 'conversation-link';
    button.type = 'button';
    button.textContent = conversation.title;
    button.dataset.conversationId = conversation.id;
    if (selected?.id === conversation.id) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', () => {
      void guard(() => openConversation(conversation.id));
    });
    list.append(button);
  }
  element('#empty-list').hidden = result.conversations.length > 0;
  updateControls();
  return result.conversations;
}
async function openConversation(id: string): Promise<void> {
  setBusy(true);
  try {
    const result = await request<{ conversation: Conversation; messages: Message[] }>(
      '/api/conversations/' + encodeURIComponent(id),
    );
    selected = result.conversation;
    conversationMessages = result.messages;
    element('#conversation-title').textContent = selected.title;
    renderMessages();
    for (const button of document.querySelectorAll<HTMLButtonElement>('.conversation-link')) {
      if (button.dataset.conversationId === id) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  } finally {
    setBusy(false);
  }
}
function clearConversation(): void {
  selected = undefined;
  conversationMessages = [];
  element('#conversation-title').textContent = 'New conversation';
  renderMessages();
  updateControls();
}
async function loadTemplates(): Promise<void> {
  try {
    const res = await fetchProductivityTemplates();
    if (res.ok && res.templates) {
      cachedTemplates = res.templates;
    }
  } catch (err) {
    console.warn('Could not load productivity templates:', err);
  }
}

function openStudioDialog(templateId: string): void {
  const template = cachedTemplates[templateId];
  if (!template) {
    showToast('Template not found');
    return;
  }
  const dialogEl = element<HTMLDialogElement>('#studio-dialog');
  const title = element('#studio-dialog-title');
  const desc = element('#studio-dialog-desc');
  const fieldsContainer = element('#studio-dialog-fields');

  title.textContent = language === 'bn' && template.nameBn ? template.nameBn : template.name;
  desc.textContent =
    language === 'bn' && template.descriptionBn ? template.descriptionBn : template.description;
  fieldsContainer.replaceChildren();

  for (const f of template.fields) {
    const group = document.createElement('div');
    group.className = 'form-group';
    const label = document.createElement('label');
    label.htmlFor = `tpl-field-${f.key}`;
    label.textContent = language === 'bn' && f.labelBn ? f.labelBn : f.label;
    if (f.required) {
      const req = document.createElement('span');
      req.style.color = 'var(--color-danger, #e53e3e)';
      req.textContent = ' *';
      label.append(req);
    }

    let inputEl: HTMLElement;
    if (f.type === 'textarea') {
      const textarea = document.createElement('textarea');
      textarea.id = `tpl-field-${f.key}`;
      textarea.rows = 3;
      textarea.placeholder = f.placeholder ?? '';
      textarea.required = f.required ?? false;
      if (f.default) textarea.value = f.default;
      inputEl = textarea;
    } else if (f.type === 'select' && f.options) {
      const select = document.createElement('select');
      select.id = `tpl-field-${f.key}`;
      for (const opt of f.options) {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        select.append(option);
      }
      if (f.default) select.value = f.default;
      inputEl = select;
    } else {
      const inp = document.createElement('input');
      inp.id = `tpl-field-${f.key}`;
      inp.type = 'text';
      inp.placeholder = f.placeholder ?? '';
      inp.required = f.required ?? false;
      if (f.default) inp.value = f.default;
      inputEl = inp;
    }
    group.append(label, inputEl);
    fieldsContainer.append(group);
  }

  const formEl = element<HTMLFormElement>('#studio-dialog-form');
  const onSubmit = (e: Event): void => {
    e.preventDefault();
    const data: Record<string, string> = {};
    for (const f of template.fields) {
      const el = document.getElementById(`tpl-field-${f.key}`) as
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
      if (el) data[f.key] = el.value.trim();
    }
    dialogEl.close();
    formEl.removeEventListener('submit', onSubmit);

    let prompt = '';
    const name = language === 'bn' && template.nameBn ? template.nameBn : template.name;
    if (language === 'bn') {
      prompt = `[টেমপ্লেট: ${name}]\nঅনুগ্রহ করে নিম্নলিখিত তথ্যের ভিত্তিতে একটি পেশাদার ${name} তৈরি করুন:\n\n`;
      for (const f of template.fields) {
        const val = data[f.key] || 'প্রযোজ্য নয়';
        const lbl = f.labelBn || f.label;
        prompt += `- ${lbl}: ${val}\n`;
      }
      prompt += `\nঅনুগ্রহ করে একটি পূর্ণাঙ্গ, সুবিন্যস্ত ও উচ্চমানের আউটপুট প্রদান করুন।`;
    } else {
      prompt = `[Template: ${template.name}]\nPlease generate a professional ${template.name} based on the following details:\n\n`;
      for (const f of template.fields) {
        const val = data[f.key] || 'N/A';
        prompt += `- ${f.label}: ${val}\n`;
      }
      prompt += `\nPlease provide a comprehensive, well-structured, and polished output.`;
    }

    input.value = prompt;
    updateControls();
    void guard(() => submitMessage(prompt, routingOptions('send')));
  };
  formEl.addEventListener('submit', onSubmit, { once: true });

  dialogEl.showModal();
}

function initStudioToolbar(): void {
  const pills = document.querySelectorAll<HTMLButtonElement>('.studio-pill[data-template]');
  for (const pill of pills) {
    pill.addEventListener('click', () => {
      const templateId = pill.dataset.template;
      if (templateId) openStudioDialog(templateId);
    });
  }
  const cancelBtn = document.querySelector<HTMLButtonElement>('#studio-dialog-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      element<HTMLDialogElement>('#studio-dialog').close();
    });
  }
}

function initChatGptFeatures(): void {
  // 1. Theme toggle (Light by default to match ChatGPT screenshot, with 1-click toggle)
  const themeToggle = document.querySelector<HTMLButtonElement>('#theme-toggle');
  const applyTheme = (theme: 'light' | 'dark') => {
    inMemoryTheme = theme;
    document.documentElement.dataset.theme = theme;
    const icon = themeToggle?.querySelector('.theme-icon');
    if (icon) {
      icon.textContent = theme === 'dark' ? '🌙' : '☀️';
    }
  };
  applyTheme(inMemoryTheme);

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const current = inMemoryTheme === 'dark' ? 'light' : 'dark';
      applyTheme(current);
      showToast(`Switched to ${current} mode`);
    });
  }

  // 2. Segmented Mode switcher: [Chat | + Work]
  const tabChat = document.querySelector<HTMLButtonElement>('#tab-chat');
  const tabWork = document.querySelector<HTMLButtonElement>('#tab-work');
  const studioToolbar = document.querySelector<HTMLDivElement>('#studio-toolbar');
  if (tabChat && tabWork && studioToolbar) {
    tabChat.addEventListener('click', () => {
      tabChat.classList.add('active');
      tabChat.setAttribute('aria-selected', 'true');
      tabWork.classList.remove('active');
      tabWork.setAttribute('aria-selected', 'false');
      studioToolbar.classList.remove('studio-visible');
    });
    tabWork.addEventListener('click', () => {
      tabWork.classList.add('active');
      tabWork.setAttribute('aria-selected', 'true');
      tabChat.classList.remove('active');
      tabChat.setAttribute('aria-selected', 'false');
      studioToolbar.classList.add('studio-visible');
    });
  }

  // 3. Sidebar collapse toggle
  const sidebarToggle = document.querySelector<HTMLButtonElement>('#sidebar-toggle-btn');
  const mobileToggle = document.querySelector<HTMLButtonElement>('#mobile-sidebar-toggle');
  const workspace = document.querySelector<HTMLDivElement>('#app-workspace');
  if (sidebarToggle && workspace) {
    sidebarToggle.addEventListener('click', () => {
      workspace.classList.toggle('sidebar-collapsed');
    });
  }
  if (mobileToggle && workspace) {
    mobileToggle.addEventListener('click', () => {
      workspace.classList.toggle('sidebar-open');
    });
  }

  // 4. Quick Action Starters
  const starterCsv = document.querySelector<HTMLButtonElement>('#starter-csv-btn');
  if (starterCsv) {
    starterCsv.addEventListener('click', () => {
      const csvBtn = document.querySelector<HTMLButtonElement>('#btn-csv-tool');
      if (csvBtn) csvBtn.click();
    });
  }
  const starterWeb = document.querySelector<HTMLButtonElement>('#starter-web-btn');
  if (starterWeb) {
    starterWeb.addEventListener('click', () => {
      const docBtn = document.querySelector<HTMLButtonElement>('#btn-doc-tool');
      if (docBtn) docBtn.click();
      else {
        input.value = 'Search the web for ';
        input.focus();
      }
    });
  }

  // 5. Sidebar Menu Items from screenshot
  document.querySelector('#nav-item-images')?.addEventListener('click', () => {
    openStudioDialog('contentCreation');
  });
  document.querySelector('#nav-item-scheduled')?.addEventListener('click', () => {
    showToast('Scheduled tasks & activity log: Active');
  });
  document.querySelector('#nav-item-library')?.addEventListener('click', () => {
    document.querySelector<HTMLButtonElement>('#btn-doc-tool')?.click();
  });
  document.querySelector('#nav-item-plugins')?.addEventListener('click', () => {
    document.querySelector<HTMLButtonElement>('#btn-csv-tool')?.click();
  });
  document.querySelector('#nav-item-codex')?.addEventListener('click', () => {
    openStudioDialog('presentation');
  });
  document.querySelector('#nav-item-explore')?.addEventListener('click', () => {
    tabWork?.click();
    showToast('Productivity Studio tools opened');
  });
  document.querySelector('#nav-item-keys')?.addEventListener('click', () => {
    const dialogEl = document.querySelector<HTMLDialogElement>('#key-pool-dialog');
    if (dialogEl) {
      dialogEl.showModal();
      const refreshBtn = document.querySelector<HTMLButtonElement>('#refresh-keys-btn');
      if (refreshBtn) refreshBtn.click();
    }
  });

  // Projects folders
  document.querySelectorAll<HTMLButtonElement>('.project-folder-link').forEach((link) => {
    link.addEventListener('click', () => {
      const project = link.dataset.project;
      if (project === 'resume') {
        openStudioDialog('resume');
      } else if (project === 'prompt') {
        input.value = 'Draft a comprehensive project proposal for ';
        input.focus();
      }
    });
  });

  // Upgrade buttons
  const onUpgrade = () => {
    showToast('You are on Free Local Tier · All models & tools enabled');
  };
  document.querySelector('#sidebar-upgrade-btn')?.addEventListener('click', onUpgrade);
  document.querySelector('#nav-upgrade-btn')?.addEventListener('click', onUpgrade);

  // Think & Mic buttons
  document.querySelector('#btn-think')?.addEventListener('click', () => {
    showToast('Reasoning & Deep Analysis Mode enabled.');
  });
  document.querySelector('#btn-mic')?.addEventListener('click', () => {
    showToast('Voice dictation ready in browser.');
  });

  // 6. Model Selector (v0 / ChatGPT style)
  const modelSelector = document.querySelector<HTMLSelectElement>('#chat-model-selector');
  const modelPickerIcon = document.querySelector<HTMLElement>('.model-picker-icon');
  if (modelSelector) {
    const savedModel = inMemorySelectedModel || 'auto';
    if ([...modelSelector.options].some((opt) => opt.value === savedModel)) {
      modelSelector.value = savedModel;
    }

    const updateIcon = (val: string) => {
      if (!modelPickerIcon) return;
      if (val.startsWith('gemini')) modelPickerIcon.textContent = '🌟';
      else if (val.startsWith('groq')) modelPickerIcon.textContent = '⚡';
      else if (val.startsWith('openrouter')) modelPickerIcon.textContent = '🌐';
      else if (val.startsWith('anthropic')) modelPickerIcon.textContent = '🟣';
      else if (val.startsWith('openai')) modelPickerIcon.textContent = '🟢';
      else modelPickerIcon.textContent = '⚡';
    };
    updateIcon(modelSelector.value);

    modelSelector.addEventListener('change', () => {
      const chosen = modelSelector.value;
      inMemorySelectedModel = chosen;
      updateIcon(chosen);
      const label = modelSelector.options[modelSelector.selectedIndex]?.text || chosen;
      showToast(
        language === 'bn' ? `মডেল পরিবর্তন হয়েছে: ${label}` : `Switched engine to ${label}`,
      );
    });
  }

  // 7. Clickable user profile to customize name
  document.querySelector('#user-profile-card')?.addEventListener('click', () => {
    const current = inMemoryUserName || 'Rifat';
    const entered = window.prompt('Enter your name for AI personalization & signature:', current);
    if (entered && entered.trim()) {
      inMemoryUserName = entered.trim();
      const topName = document.querySelector<HTMLElement>('#nexus-top-username');
      if (topName) topName.textContent = entered.trim();
      const popName = document.querySelector<HTMLElement>('#popover-username');
      if (popName) popName.textContent = entered.trim();
      void refreshAccount();
      showToast(`Profile name updated: ${entered.trim()}`);
    }
  });
}

function initNexus3DBrain(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#nexus-3d-brain-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  const centerX = width / 2;
  const centerY = height / 2;

  interface BrainNode {
    baseX: number;
    baseY: number;
    baseZ: number;
    pulse: number;
  }

  const nodes: BrainNode[] = [];
  const nodeCount = 190;
  for (let i = 0; i < nodeCount; i++) {
    const hemisphere = i % 2 === 0 ? 1 : -1;
    const u = Math.random();
    const v = Math.random();
    const theta = u * 2.0 * Math.PI;
    const phi = Math.acos(2.0 * v - 1.0);
    const r = 70 + Math.random() * 26;

    let x = r * Math.sin(phi) * Math.cos(theta) * 0.9;
    const y = r * Math.sin(phi) * Math.sin(theta) * 0.75;
    const z = r * Math.cos(phi) * 1.05;

    x = x + hemisphere * 18;
    if (Math.abs(x) < 8) x = hemisphere * 8;

    nodes.push({ baseX: x, baseY: y, baseZ: z, pulse: Math.random() });
  }

  let angleY = 0;
  let targetAngleX = 0.2;
  let targetAngleY = 0;

  const stage = document.querySelector<HTMLElement>('#nexus-3d-orb-stage');
  const sphere = document.querySelector<HTMLElement>('#nexus-orb-glass-sphere');
  if (stage) {
    stage.addEventListener('mousemove', (e: MouseEvent) => {
      const rect = stage.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width - 0.5;
      const ny = (e.clientY - rect.top) / rect.height - 0.5;
      targetAngleY = nx * 1.2;
      targetAngleX = 0.2 - ny * 0.8;
      if (sphere) {
        sphere.style.transform = `perspective(800px) rotateY(${nx * 22}deg) rotateX(${-ny * 22}deg)`;
      }
    });
    stage.addEventListener('mouseleave', () => {
      targetAngleX = 0.2;
      targetAngleY = 0;
      if (sphere) sphere.style.transform = '';
    });
  }

  const render = () => {
    ctx.clearRect(0, 0, width, height);

    angleY += 0.008;
    const curAngleY = angleY + targetAngleY;
    const curAngleX = targetAngleX;

    const cosY = Math.cos(curAngleY);
    const sinY = Math.sin(curAngleY);
    const cosX = Math.cos(curAngleX);
    const sinX = Math.sin(curAngleX);

    interface ProjectedNode {
      px: number;
      py: number;
      pz: number;
      pulse: number;
    }
    const projected: ProjectedNode[] = [];

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      const x1 = n.baseX * cosY - n.baseZ * sinY;
      const z1 = n.baseX * sinY + n.baseZ * cosY;
      const y2 = n.baseY * cosX - z1 * sinX;
      const z2 = n.baseY * sinX + z1 * cosX;

      const fov = 260;
      const scale = fov / (fov + z2);
      const px = centerX + x1 * scale;
      const py = centerY + y2 * scale;

      n.pulse = (n.pulse + 0.015) % 1;
      projected.push({ px, py, pz: z2, pulse: n.pulse });
    }

    ctx.lineWidth = 0.8;
    for (let i = 0; i < projected.length; i++) {
      const p1 = projected[i]!;
      for (let j = i + 1; j < projected.length; j++) {
        const p2 = projected[j]!;
        const dx = p1.px - p2.px;
        const dy = p1.py - p2.py;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 32) {
          const alpha = (1 - dist / 32) * 0.45;
          ctx.strokeStyle = `rgba(0, 210, 255, ${alpha.toFixed(2)})`;
          ctx.beginPath();
          ctx.moveTo(p1.px, p1.py);
          ctx.lineTo(p2.px, p2.py);
          ctx.stroke();

          if (p1.pulse > 0.85) {
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(
              p1.px + (p2.px - p1.px) * (p1.pulse - 0.85) * 6,
              p1.py + (p2.py - p1.py) * (p1.pulse - 0.85) * 6,
              1.2,
              0,
              Math.PI * 2,
            );
            ctx.fill();
          }
        }
      }
    }

    for (let i = 0; i < projected.length; i++) {
      const p = projected[i]!;
      const r = Math.max(1, ((p.pz + 100) / 200) * 2.5);
      const alpha = Math.max(0.2, (p.pz + 100) / 200);

      ctx.fillStyle = `rgba(56, 189, 248, ${alpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
      ctx.fill();

      if (p.pulse > 0.9) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(p.px, p.py, r * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    requestAnimationFrame(render);
  };

  render();
}

function initSearchPalette(): void {
  const searchDialog = document.querySelector<HTMLDialogElement>('#nexus-search-dialog');
  const searchInput = document.querySelector<HTMLInputElement>('#search-palette-input');
  const resultsContainer = document.querySelector<HTMLDivElement>('#search-palette-results');
  const closeBtn = document.querySelector<HTMLButtonElement>('#search-palette-close');
  const triggerInput = document.querySelector<HTMLInputElement>('#global-search-input');
  const triggerCapsule = document.querySelector<HTMLDivElement>('#nexus-search-capsule');
  const sidebarSearchBtn = document.querySelector<HTMLButtonElement>('#sidebar-search-btn');

  const items = [
    {
      type: 'model',
      id: 'openai:gpt-4o',
      title: 'ChatGPT',
      sub: 'OpenAI GPT-4o · General purpose reasoning & writing',
      icon: '🟢',
    },
    {
      type: 'model',
      id: 'gemini:gemini-2.0-flash',
      title: 'Gemini 2.0 Flash',
      sub: 'Google · Multimodal, super-fast and capable',
      icon: '🌟',
    },
    {
      type: 'model',
      id: 'anthropic:claude-3-5-sonnet',
      title: 'Claude 3.5 Sonnet',
      sub: 'Anthropic · Deep analysis, logic and coding',
      icon: '✹',
    },
    {
      type: 'model',
      id: 'openrouter:deepseek/deepseek-r1:free',
      title: 'DeepSeek R1',
      sub: 'DeepSeek · High-performance reasoning & math',
      icon: '🐳',
    },
    {
      type: 'model',
      id: 'groq:qwen/qwen3.8-27b',
      title: 'Llama 3 / Qwen (Groq)',
      sub: 'GroqCloud LPU · 1,800+ tokens/sec ultra-fast',
      icon: '⚡',
    },
    {
      type: 'model',
      id: 'dalle-3',
      title: 'DALL·E 3 Image Studio',
      sub: 'OpenAI · Photorealistic 3D and digital image generator',
      icon: '🖼️',
    },
    {
      type: 'model',
      id: 'midjourney',
      title: 'Midjourney Art Studio',
      sub: 'Artistic generative styling and visual concepts',
      icon: '⛵',
    },
    {
      type: 'tool',
      id: 'presentation',
      title: 'Presentation Deck Generator',
      sub: 'Create beautiful slides, decks and outlines',
      icon: '📽️',
    },
    {
      type: 'tool',
      id: 'resume',
      title: 'CV & Resume Builder',
      sub: 'ATS-tailored professional resumes and CVs',
      icon: '📄',
    },
    {
      type: 'tool',
      id: 'csv',
      title: 'CSV Data Insights & Query',
      sub: 'Upload datasets and ask questions in natural language',
      icon: '📊',
    },
    {
      type: 'tool',
      id: 'email',
      title: 'Email & Proposal Generator',
      sub: 'Draft compelling business proposals and emails',
      icon: '💼',
    },
    {
      type: 'tool',
      id: 'doc',
      title: 'Document Library & Q&A',
      sub: 'Attach PDF/TXT files and extract insights',
      icon: '📑',
    },
    {
      type: 'tool',
      id: 'keys',
      title: 'AI API Key Vault',
      sub: 'Multi-key rotation and zero-downtime key manager',
      icon: '🔑',
    },
  ];

  let selectedIndex = 0;

  const renderResults = (query: string) => {
    if (!resultsContainer) return;
    resultsContainer.replaceChildren();

    const q = query.toLowerCase().trim();
    const filtered = q
      ? items.filter(
          (item) => item.title.toLowerCase().includes(q) || item.sub.toLowerCase().includes(q),
        )
      : items;

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'search-result-group-title';
      empty.textContent = 'No matching models or tools found.';
      resultsContainer.append(empty);
      return;
    }

    filtered.forEach((item, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `search-result-row ${index === selectedIndex ? 'selected' : ''}`;
      btn.innerHTML = `
        <span class="search-result-icon">${item.icon}</span>
        <div style="flex: 1;">
          <span class="search-result-title">${item.title}</span>
          <span class="search-result-sub">${item.sub}</span>
        </div>
        <span style="color: #64748b; font-size: 13px;">→</span>
      `;
      btn.addEventListener('click', () => {
        executeItem(item);
      });
      resultsContainer.append(btn);
    });
  };

  const executeItem = (item: (typeof items)[0]) => {
    searchDialog?.close();
    if (item.type === 'model') {
      const modelSelector = document.querySelector<HTMLSelectElement>('#chat-model-selector');
      if (modelSelector && [...modelSelector.options].some((opt) => opt.value === item.id)) {
        modelSelector.value = item.id;
        modelSelector.dispatchEvent(new Event('change'));
      }
      showToast(`Selected ${item.title}`);
      document.querySelector('#chat-panel')?.scrollIntoView({ behavior: 'smooth' });
      input.focus();
    } else if (item.type === 'tool') {
      if (item.id === 'csv') openCsvDialog();
      else if (item.id === 'keys')
        document.querySelector<HTMLDialogElement>('#key-pool-dialog')?.showModal();
      else if (item.id === 'doc') document.querySelector<HTMLInputElement>('#file-input')?.click();
      else openStudioDialog(item.id);
    }
  };

  const openSearch = () => {
    selectedIndex = 0;
    if (searchInput) searchInput.value = '';
    renderResults('');
    if (searchDialog && !searchDialog.open) {
      searchDialog.showModal();
      setTimeout(() => searchInput?.focus(), 50);
    }
  };

  triggerCapsule?.addEventListener('click', openSearch);
  triggerInput?.addEventListener('focus', openSearch);
  sidebarSearchBtn?.addEventListener('click', openSearch);
  closeBtn?.addEventListener('click', () => searchDialog?.close());

  if (searchDialog && !('closedBy' in HTMLDialogElement.prototype)) {
    searchDialog.addEventListener('click', (event) => {
      if (event.target !== searchDialog) return;
      const rect = searchDialog.getBoundingClientRect();
      const inBox =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!inBox) searchDialog.close();
    });
  }

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (
      e.key === '/' &&
      document.activeElement?.tagName !== 'INPUT' &&
      document.activeElement?.tagName !== 'TEXTAREA'
    ) {
      e.preventDefault();
      openSearch();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openSearch();
    }
  });

  searchInput?.addEventListener('input', () => {
    selectedIndex = 0;
    renderResults(searchInput.value);
  });

  searchInput?.addEventListener('keydown', (e: KeyboardEvent) => {
    const rows = resultsContainer?.querySelectorAll<HTMLButtonElement>('.search-result-row');
    if (!rows || rows.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % rows.length;
      updateSelectedRow(rows);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + rows.length) % rows.length;
      updateSelectedRow(rows);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = rows[selectedIndex];
      selected?.click();
    }
  });

  const updateSelectedRow = (rows: NodeListOf<HTMLButtonElement>) => {
    rows.forEach((r, idx) => {
      if (idx === selectedIndex) {
        r.classList.add('selected');
        r.scrollIntoView({ block: 'nearest' });
      } else {
        r.classList.remove('selected');
      }
    });
  };
}

function openHistoryDialog(): void {
  const dialog = document.querySelector<HTMLDialogElement>('#nexus-history-dialog');
  const listEl = document.querySelector<HTMLDivElement>('#history-dialog-list');
  const filterInput = document.querySelector<HTMLInputElement>('#history-filter-input');
  if (!dialog || !listEl) return;

  const renderHistory = (q = '') => {
    listEl.replaceChildren();
    const query = q.toLowerCase().trim();
    const links = document.querySelectorAll<HTMLButtonElement>('.conversation-link');
    if (links.length === 0) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No saved conversations yet.';
      listEl.append(p);
      return;
    }

    links.forEach((link) => {
      const title = link.textContent?.trim() || 'Conversation';
      if (query && !title.toLowerCase().includes(query)) return;

      const item = document.createElement('div');
      item.className = 'history-card-item';
      item.innerHTML = `
        <div style="flex: 1;">
          <span class="history-card-title">${title}</span>
          <span class="history-card-date">Active Conversation</span>
        </div>
        <span style="color: #00d2ff; font-weight: 600;">Open →</span>
      `;
      item.addEventListener('click', () => {
        dialog.close();
        link.click();
        document.querySelector('#chat-panel')?.scrollIntoView({ behavior: 'smooth' });
      });
      listEl.append(item);
    });
  };

  renderHistory();
  if (filterInput) {
    filterInput.value = '';
    filterInput.oninput = () => renderHistory(filterInput.value);
  }

  document.querySelector('#history-dialog-close')?.addEventListener('click', () => dialog.close());
  document.querySelector('#history-close-btn')?.addEventListener('click', () => dialog.close());

  dialog.showModal();
}

function openToolsDialog(): void {
  const dialog = document.querySelector<HTMLDialogElement>('#nexus-tools-dialog');
  if (!dialog) return;

  document.querySelectorAll<HTMLButtonElement>('.nexus-tool-card').forEach((card) => {
    card.onclick = () => {
      dialog.close();
      const launch = card.dataset.launch;
      if (launch === 'csv') openCsvDialog();
      else if (launch === 'doc') document.querySelector<HTMLInputElement>('#file-input')?.click();
      else if (launch === 'image') {
        input.value = 'Create a photorealistic digital render of ';
        document.querySelector('#chat-panel')?.scrollIntoView({ behavior: 'smooth' });
        input.focus();
      } else if (launch) {
        openStudioDialog(launch);
      }
    };
  });

  document.querySelector('#tools-dialog-close')?.addEventListener('click', () => dialog.close());
  document.querySelector('#tools-close-btn')?.addEventListener('click', () => dialog.close());

  dialog.showModal();
}

function initNexusPlatform(): void {
  initNexus3DBrain();

  const homeView = document.querySelector<HTMLDivElement>('#nexus-home-view');
  const chatView = document.querySelector<HTMLElement>('#chat-panel');
  const exploreSection = document.querySelector<HTMLElement>('#nexus-explore-section');

  const navHome = document.querySelector<HTMLButtonElement>('#nav-item-home');
  const navChat = document.querySelector<HTMLButtonElement>('#nav-item-chat');
  const navModels = document.querySelector<HTMLButtonElement>('#nav-item-models');
  const navTools = document.querySelector<HTMLButtonElement>('#nav-item-tools');
  const navLibrary = document.querySelector<HTMLButtonElement>('#nav-item-library');
  const navHistory = document.querySelector<HTMLButtonElement>('#nav-item-history');
  const navSettings = document.querySelector<HTMLButtonElement>('#nav-item-settings');

  const setNavActive = (activeBtn: HTMLElement | null) => {
    document.querySelectorAll('.nexus-nav-item').forEach((item) => item.classList.remove('active'));
    activeBtn?.classList.add('active');
  };

  if (navHome) {
    navHome.addEventListener('click', () => {
      setNavActive(navHome);
      homeView?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  if (navChat) {
    navChat.addEventListener('click', () => {
      setNavActive(navChat);
      chatView?.scrollIntoView({ behavior: 'smooth' });
      input.focus();
    });
  }

  const backToDashBtn = document.querySelector<HTMLButtonElement>('#btn-back-to-dashboard');
  if (backToDashBtn) {
    backToDashBtn.addEventListener('click', () => {
      setNavActive(navHome);
      homeView?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  if (navModels) {
    navModels.addEventListener('click', () => {
      setNavActive(navModels);
      exploreSection?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  const quickAccessViewAll = document.querySelector<HTMLButtonElement>(
    '#btn-quick-access-view-all',
  );
  if (quickAccessViewAll) {
    quickAccessViewAll.addEventListener('click', () => {
      setNavActive(navModels);
      exploreSection?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  const modelSelector = document.querySelector<HTMLSelectElement>('#chat-model-selector');
  const selectModelAndGoToChat = (modelId: string, modelName: string) => {
    inMemorySelectedModel = modelId;
    if (modelSelector) {
      if ([...modelSelector.options].some((opt) => opt.value === modelId)) {
        modelSelector.value = modelId;
        modelSelector.dispatchEvent(new Event('change'));
      }
    }
    showToast(language === 'bn' ? `মডেল নির্বাচিত: ${modelName}` : `Switched to ${modelName}`);
    setNavActive(navChat);
    chatView?.scrollIntoView({ behavior: 'smooth' });
    input.focus();
  };

  document.querySelectorAll<HTMLElement>('.nexus-orbit-badge').forEach((badge) => {
    badge.addEventListener('click', () => {
      const modelId = badge.dataset.model || 'auto';
      const title = badge.getAttribute('title') || 'AI Model';
      selectModelAndGoToChat(modelId, title);
    });
  });

  document.querySelectorAll<HTMLButtonElement>('.nexus-qa-row').forEach((row) => {
    row.addEventListener('click', () => {
      const modelId = row.dataset.model || 'auto';
      const name = row.querySelector('.nexus-qa-name')?.textContent || 'AI Model';
      selectModelAndGoToChat(modelId, name);
    });
  });

  document.querySelectorAll<HTMLButtonElement>('.nexus-filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.nexus-filter-pill').forEach((p) => {
        p.classList.remove('active');
        p.setAttribute('aria-selected', 'false');
      });
      pill.classList.add('active');
      pill.setAttribute('aria-selected', 'true');

      const filter = pill.dataset.filter || 'all';
      const cards = document.querySelectorAll<HTMLElement>('.nexus-3d-card');
      cards.forEach((card) => {
        const cat = card.dataset.category || '';
        if (filter === 'all' || filter === 'more' || cat.includes(filter)) {
          card.style.display = 'flex';
        } else {
          card.style.display = 'none';
        }
      });
    });
  });

  document.querySelectorAll<HTMLElement>('.nexus-3d-card').forEach((card) => {
    card.addEventListener('mousemove', (e: MouseEvent) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const xPct = Math.round((x / rect.width) * 100);
      const yPct = Math.round((y / rect.height) * 100);
      card.style.setProperty('--mouse-x', `${xPct}%`);
      card.style.setProperty('--mouse-y', `${yPct}%`);

      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateX = -((y - centerY) / centerY) * 10;
      const rotateY = ((x - centerX) / centerX) * 10;
      card.style.transform = `perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateY(-6px) scale3d(1.02, 1.02, 1.02)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
    });

    card.addEventListener('click', () => {
      const modelId = card.dataset.model || 'auto';
      const name = card.querySelector('.card-model-name')?.textContent || 'Model';
      if (modelId === 'dalle-3' || modelId === 'midjourney') {
        input.value = `Create a high-detail digital artwork of `;
        setNavActive(navChat);
        chatView?.scrollIntoView({ behavior: 'smooth' });
        input.focus();
        showToast(`Image Studio mode activated for ${name}`);
      } else {
        selectModelAndGoToChat(modelId, name);
      }
    });
  });

  const heroInput = document.querySelector<HTMLInputElement>('#hero-prompt-input');
  const heroSendBtn = document.querySelector<HTMLButtonElement>('#hero-prompt-send');

  const executeHeroPrompt = () => {
    const text = heroInput?.value.trim();
    if (!text) {
      heroInput?.focus();
      return;
    }
    input.value = text;
    if (heroInput) heroInput.value = '';
    setNavActive(navChat);
    chatView?.scrollIntoView({ behavior: 'smooth' });
    void guard(() => submitMessage(text));
  };

  heroInput?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeHeroPrompt();
    }
  });
  heroSendBtn?.addEventListener('click', () => {
    executeHeroPrompt();
  });

  document.querySelectorAll<HTMLButtonElement>('.nexus-starter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      const prompt = pill.dataset.prompt || pill.textContent?.trim() || '';
      input.value = prompt;
      setNavActive(navChat);
      chatView?.scrollIntoView({ behavior: 'smooth' });
      void guard(() => submitMessage(prompt));
    });
  });

  initSearchPalette();

  if (navHistory) {
    navHistory.addEventListener('click', () => {
      openHistoryDialog();
    });
  }

  if (navTools) {
    navTools.addEventListener('click', () => {
      openToolsDialog();
    });
  }

  if (navSettings) {
    navSettings.addEventListener('click', () => {
      const keyDialog = document.querySelector<HTMLDialogElement>('#key-pool-dialog');
      if (keyDialog) {
        keyDialog.showModal();
        document.querySelector<HTMLButtonElement>('#refresh-keys-btn')?.click();
      }
    });
  }

  if (navLibrary) {
    navLibrary.addEventListener('click', () => {
      document.querySelector<HTMLInputElement>('#file-input')?.click();
    });
  }

  const upgradeDialog = document.querySelector<HTMLDialogElement>('#nexus-upgrade-dialog');
  const openUpgrade = () => {
    if (upgradeDialog) upgradeDialog.showModal();
  };
  document.querySelector('#btn-sidebar-upgrade')?.addEventListener('click', openUpgrade);
  document.querySelector('#btn-sidebar-plan-info')?.addEventListener('click', openUpgrade);
  document.querySelector('#upgrade-close-btn')?.addEventListener('click', () => {
    upgradeDialog?.close();
  });
  document.querySelector('#upgrade-dialog-close')?.addEventListener('click', () => {
    upgradeDialog?.close();
  });

  const notifBtn = document.querySelector<HTMLButtonElement>('#btn-notifications');
  const notifPopover = document.querySelector<HTMLDivElement>('#nexus-notifications-popover');
  const profilePill = document.querySelector<HTMLDivElement>('#nexus-top-user-pill');
  const profilePopover = document.querySelector<HTMLDivElement>('#nexus-profile-popover');

  if (notifBtn && notifPopover) {
    notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      notifPopover.hidden = !notifPopover.hidden;
      if (profilePopover) profilePopover.hidden = true;
    });
  }

  if (profilePill && profilePopover) {
    profilePill.addEventListener('click', (e) => {
      e.stopPropagation();
      profilePopover.hidden = !profilePopover.hidden;
      if (notifPopover) notifPopover.hidden = true;
    });
  }

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (notifPopover && !notifPopover.contains(target) && target !== notifBtn) {
      notifPopover.hidden = true;
    }
    if (profilePopover && !profilePopover.contains(target) && !profilePill?.contains(target)) {
      profilePopover.hidden = true;
    }
  });

  document.querySelector('#btn-popover-settings')?.addEventListener('click', () => {
    if (profilePopover) profilePopover.hidden = true;
    document.querySelector<HTMLDialogElement>('#key-pool-dialog')?.showModal();
  });
  document.querySelector('#btn-popover-history')?.addEventListener('click', () => {
    if (profilePopover) profilePopover.hidden = true;
    openHistoryDialog();
  });
  document.querySelector('#btn-popover-logout')?.addEventListener('click', () => {
    document.querySelector<HTMLButtonElement>('#logout')?.click();
  });

  document.querySelector('#btn-promo-launch')?.addEventListener('click', () => {
    input.value = 'How can frontier AI models collaborate across different specialized modalities?';
    setNavActive(navChat);
    chatView?.scrollIntoView({ behavior: 'smooth' });
    void guard(() => submitMessage(input.value));
  });
}

function renderCsvTable(analysis: CsvAnalysisResponse): void {
  const container = element('#csv-preview-container');
  container.replaceChildren();

  const table = document.createElement('table');
  table.className = 'csv-table-preview';
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const col of analysis.summary.headers) {
    const th = document.createElement('th');
    th.textContent = col;
    headerRow.append(th);
  }
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  const rows = analysis.summary.preview.slice(0, 10);
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const cell of row) {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  container.append(table);
}

function openCsvDialog(): void {
  if (!lastCsvAnalysis) {
    showToast(
      language === 'bn' ? 'প্রথমে একটি CSV ফাইল আপলোড করুন' : 'Please attach a CSV file first',
    );
    element<HTMLInputElement>('#file-input').click();
    return;
  }
  const dialogEl = element<HTMLDialogElement>('#csv-dialog');
  element('#csv-stat-rows').textContent = String(lastCsvAnalysis.summary.totalRows);
  element('#csv-stat-cols').textContent = String(lastCsvAnalysis.summary.totalColumns);
  const numericCount = lastCsvAnalysis.columns.filter(
    (c) =>
      c.inferredType === 'numeric' || c.inferredType === 'integer' || c.inferredType === 'float',
  ).length;
  const categoricalCount = lastCsvAnalysis.columns.filter(
    (c) => c.inferredType === 'string' || c.inferredType === 'category',
  ).length;
  element('#csv-stat-numeric').textContent = String(numericCount);
  element('#csv-stat-categorical').textContent = String(categoricalCount);
  renderCsvTable(lastCsvAnalysis);
  element('#csv-query-results').textContent = '';
  dialogEl.showModal();
}

function initCsvDialog(): void {
  const dialogEl = element<HTMLDialogElement>('#csv-dialog');
  const closeBtn = document.querySelector<HTMLButtonElement>('#csv-dialog-close');
  if (closeBtn) closeBtn.addEventListener('click', () => dialogEl.close());

  const queryInput = element<HTMLInputElement>('#csv-query-input');
  const queryBtn = element<HTMLButtonElement>('#csv-query-send');
  const resultsDiv = element('#csv-query-results');

  queryBtn.addEventListener('click', async () => {
    const q = queryInput.value.trim();
    if (!q || !currentAttachedFile) return;
    try {
      resultsDiv.textContent = language === 'bn' ? 'বিশ্লেষণ করা হচ্ছে…' : 'Analyzing query…';
      const res = await queryCsvFile(currentAttachedFile.id, q);
      if (res.ok) {
        resultsDiv.textContent = res.answer;
      }
    } catch (err) {
      resultsDiv.textContent = err instanceof Error ? err.message : 'Query failed';
    }
  });

  const csvToolBtn = document.querySelector<HTMLButtonElement>('#btn-csv-tool');
  if (csvToolBtn) {
    csvToolBtn.addEventListener('click', () => {
      openCsvDialog();
    });
  }
}

function initKeyPoolDialog(): void {
  const dialogEl = document.querySelector<HTMLDialogElement>('#key-pool-dialog');
  if (!dialogEl) return;

  const closeBtn = document.querySelector<HTMLButtonElement>('#key-pool-dialog-close');
  const footerCloseBtn = document.querySelector<HTMLButtonElement>('#key-pool-close');
  const refreshBtn = document.querySelector<HTMLButtonElement>('#refresh-keys-btn');
  const formEl = document.querySelector<HTMLFormElement>('#key-pool-form');
  const tbody = document.querySelector<HTMLTableSectionElement>('#key-pool-tbody');
  const emptyHint = document.querySelector<HTMLParagraphElement>('#key-pool-empty');

  const closeDialog = () => dialogEl.close();
  if (closeBtn) closeBtn.addEventListener('click', closeDialog);
  if (footerCloseBtn) footerCloseBtn.addEventListener('click', closeDialog);

  async function renderTable(): Promise<void> {
    if (!tbody || !emptyHint) return;
    tbody.innerHTML = '';
    try {
      const res = await fetchApiKeys();
      const keys: ApiKeyItem[] = res.keys ?? [];
      if (keys.length === 0) {
        emptyHint.hidden = false;
        return;
      }
      emptyHint.hidden = true;

      for (const k of keys) {
        const row = document.createElement('tr');
        row.className = `key-row status-${k.status}`;

        // Provider badge
        const tdProvider = document.createElement('td');
        const badge = document.createElement('span');
        const safeClass = k.provider.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
        badge.className = `provider-tag provider-${safeClass}`;
        badge.textContent =
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
        tdProvider.appendChild(badge);

        // Label
        const tdLabel = document.createElement('td');
        tdLabel.className = 'key-label-cell';
        tdLabel.textContent = k.label;

        // Masked key
        const tdMask = document.createElement('td');
        const code = document.createElement('code');
        code.className = 'key-masked-code';
        code.textContent = k.keyMask;
        tdMask.appendChild(code);

        // Usage count
        const tdUsage = document.createElement('td');
        tdUsage.className = 'key-usage-cell';
        tdUsage.textContent = `${k.requestsUsed} reqs`;

        // Expiry
        const tdExpiry = document.createElement('td');
        if (k.expiresAt) {
          const dateStr = new Date(k.expiresAt).toLocaleDateString();
          if (k.isExpired) {
            tdExpiry.innerHTML = `<span class="badge-expired" title="Expired on ${dateStr}">Expired</span>`;
          } else {
            tdExpiry.textContent = dateStr;
          }
        } else {
          tdExpiry.textContent = 'Never';
        }

        // Status toggle button
        const tdStatus = document.createElement('td');
        const statusBtn = document.createElement('button');
        statusBtn.type = 'button';
        statusBtn.className = `key-status-toggle ${k.status === 'active' ? 'status-active' : 'status-blocked'}`;
        if (k.isRateLimited) {
          statusBtn.textContent = '⏳ Cooldown';
          statusBtn.title = 'Rate-limited; automatically cooling down for 60s';
        } else {
          statusBtn.textContent = k.status === 'active' ? 'Active' : 'Blocked';
          statusBtn.title = `Click to ${k.status === 'active' ? 'block' : 'activate'} this key`;
        }

        statusBtn.addEventListener('click', async () => {
          const nextStatus = k.status === 'active' ? 'blocked' : 'active';
          try {
            await updateApiKeyStatus(k.id, nextStatus);
            showToast(`Key '${k.label}' set to ${nextStatus}`);
            await renderTable();
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Failed to update key status');
          }
        });
        tdStatus.appendChild(statusBtn);

        // Actions
        const tdActions = document.createElement('td');

        const testBtn = document.createElement('button');
        testBtn.type = 'button';
        testBtn.className = 'key-test-btn icon-btn-small secondary';
        testBtn.title = 'Test connection to provider';
        testBtn.textContent = '⚡ Test';
        testBtn.style.marginRight = '6px';
        testBtn.addEventListener('click', async () => {
          testBtn.textContent = '🔄...';
          testBtn.disabled = true;
          try {
            const testRes = await testSavedApiKey(k.id);
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
        delBtn.className = 'key-delete-btn icon-btn-small';
        delBtn.title = 'Remove key from pool';
        delBtn.textContent = '🗑️';
        delBtn.addEventListener('click', async () => {
          if (!confirm(`Are you sure you want to remove '${k.label}' from the rotation pool?`))
            return;
          try {
            await deleteApiKey(k.id);
            showToast(`Key '${k.label}' removed from pool.`);
            await renderTable();
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Failed to delete key');
          }
        });
        tdActions.appendChild(delBtn);

        row.appendChild(tdProvider);
        row.appendChild(tdLabel);
        row.appendChild(tdMask);
        row.appendChild(tdUsage);
        row.appendChild(tdExpiry);
        row.appendChild(tdStatus);
        row.appendChild(tdActions);
        tbody.appendChild(row);
      }
    } catch (err) {
      emptyHint.hidden = false;
      emptyHint.textContent = err instanceof Error ? err.message : 'Error loading keys';
    }
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      void renderTable();
    });
  }

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

  const valInput = document.querySelector<HTMLInputElement>('#key-value');
  const provSelect = document.querySelector<HTMLSelectElement>('#key-provider');
  const customGroup = document.querySelector<HTMLElement>('#key-custom-provider-group');
  const labelInput = document.querySelector<HTMLInputElement>('#key-label');
  const detectPill = document.querySelector<HTMLElement>('#key-detect-pill');
  const connectStatus = document.querySelector<HTMLElement>('#key-connect-status');
  const testKeyBtn = document.querySelector<HTMLButtonElement>('#btn-test-key');

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
      const customNameEl = document.querySelector<HTMLInputElement>('#key-custom-name');
      prov = customNameEl?.value.trim().toLowerCase() || 'custom';
    }

    connectStatus.removeAttribute('hidden');
    connectStatus.className = 'key-connect-status testing';
    connectStatus.innerHTML = `<span class="spinner-small"></span> Testing live connection to ${prov}...`;

    try {
      const res = await verifyApiKey({ provider: prov, apiKey: rawVal });
      if (res.connected) {
        connectStatus.className = 'key-connect-status connected';
        connectStatus.innerHTML = `🟢 <strong>Connected</strong>: ${res.message || 'Ready for instant AI chat'}`;
      } else {
        connectStatus.className = 'key-connect-status failed';
        connectStatus.innerHTML = `🔴 <strong>Connection error</strong>: ${res.error || 'Invalid key or unauthorized'}`;
      }
    } catch (err) {
      connectStatus.className = 'key-connect-status failed';
      connectStatus.innerHTML = `🔴 <strong>Connection error</strong>: ${err instanceof Error ? err.message : 'Network error'}`;
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
        document.querySelector<HTMLInputElement>('#key-custom-name')?.focus();
      } else {
        customGroup.setAttribute('hidden', '');
      }
      if (valInput && valInput.value.trim().length >= 8) {
        void runConnectionTest();
      }
    });
  }

  if (formEl) {
    formEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      const providerEl = document.querySelector<HTMLSelectElement>('#key-provider');
      const labelEl = document.querySelector<HTMLInputElement>('#key-label');
      const valEl = document.querySelector<HTMLInputElement>('#key-value');
      const expiryEl = document.querySelector<HTMLInputElement>('#key-expiry');
      const customNameEl = document.querySelector<HTMLInputElement>('#key-custom-name');
      const submitBtn = document.querySelector<HTMLButtonElement>('#save-key-btn');

      if (!providerEl || !labelEl || !valEl) return;
      let provider = providerEl.value;

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
      const expiresAt = expiryEl?.value ? new Date(expiryEl.value).toISOString() : null;

      if (!label || !apiKey) return;
      if (submitBtn) submitBtn.disabled = true;

      try {
        await createApiKey({ provider, label, apiKey, expiresAt });
        showToast(`Key '${label}' added and connected to ${provider}! 🚀`);
        labelEl.value = '';
        valEl.value = '';
        if (expiryEl) expiryEl.value = '';
        if (customNameEl) customNameEl.value = '';
        if (customGroup) customGroup.setAttribute('hidden', '');
        if (detectPill) detectPill.setAttribute('hidden', '');
        if (connectStatus) connectStatus.setAttribute('hidden', '');
        if (providerEl) providerEl.value = 'groq';
        await renderTable();
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to add API key');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }
}

function initFileAttachment(): void {
  const attachBtn = document.querySelector<HTMLButtonElement>('#attach-file');
  const fileInput = document.querySelector<HTMLInputElement>('#file-input');
  const badge = document.querySelector<HTMLSpanElement>('#attached-file-badge');
  if (!attachBtn || !fileInput || !badge) return;

  attachBtn.addEventListener('click', () => {
    fileInput.click();
  });

  badge.addEventListener('click', () => {
    currentAttachedFile = undefined;
    lastCsvAnalysis = undefined;
    fileInput.value = '';
    badge.hidden = true;
    showToast(language === 'bn' ? 'ফাইল সরানো হয়েছে' : 'Attachment removed');
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setBusy(true);
        announce(language === 'bn' ? 'ফাইল আপলোড হচ্ছে…' : 'Uploading file…');
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1] ?? '';
        const res = await uploadFile(file.name, base64, file.type || 'text/plain');
        if (res.ok && res.file) {
          currentAttachedFile = res.file;
          badge.textContent = `📎 ${res.file.sanitized_name} ✕`;
          badge.hidden = false;
          showToast(
            language === 'bn'
              ? `সংযুক্ত: ${res.file.sanitized_name}`
              : `Attached: ${res.file.sanitized_name}`,
          );

          if (file.name.toLowerCase().endsWith('.csv') || file.type.includes('csv')) {
            try {
              const analysisRes = await analyzeCsvFile(res.file.id);
              if (analysisRes.ok) {
                lastCsvAnalysis = analysisRes;
                showToast(
                  language === 'bn' ? 'CSV বিশ্লেষণ সম্পন্ন হয়েছে' : 'CSV analyzed successfully!',
                );
              }
            } catch (err) {
              console.warn('CSV analysis failed:', err);
            }
          }
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'File upload failed');
      } finally {
        setBusy(false);
        announce('');
      }
    };
    reader.readAsDataURL(file);
  });
}

function initDocTool(): void {
  const docToolBtn = document.querySelector<HTMLButtonElement>('#btn-doc-tool');
  if (!docToolBtn) return;
  docToolBtn.addEventListener('click', () => {
    if (currentAttachedFile) {
      input.value =
        language === 'bn'
          ? `অনুগ্রহ করে সংযুক্ত নথি "${currentAttachedFile.sanitized_name}"-এর মূল বিষয়বস্তু, সারাংশ এবং প্রয়োজনীয় সুপারিশসমূহ বিস্তারিত ব্যাখ্যা করুন।`
          : `Please analyze the attached document "${currentAttachedFile.sanitized_name}", provide an executive summary, and highlight the key findings and actionable recommendations.`;
      input.focus();
      updateControls();
    } else {
      showToast(
        language === 'bn'
          ? 'প্রথমে একটি PDF বা Text ফাইল সংযুক্ত করুন'
          : 'Please attach a PDF or text document first',
      );
      const fInput = document.querySelector<HTMLInputElement>('#file-input');
      if (fInput) fInput.click();
    }
  });
}

async function initialize(): Promise<void> {
  setBusy(true);
  try {
    config = await request<Bootstrap>('/api/bootstrap');
    setCsrfToken(config.csrfToken);
    signupProof = undefined;
    burstProof = undefined;
    verificationPurpose = undefined;
    element('#abuse-verification').hidden = true;
    element('#abuse-details').hidden = true;
    if (config.abuseEnabled && !config.authenticated && config.localSignInEnabled)
      requireVerification('signup');
    renderAbuseStatus(config.abuse);
    element('#login-panel').hidden = config.authenticated;
    element('#chat-panel').hidden = !config.authenticated;
    element('#signed-in-nav').hidden = !config.authenticated;
    const homeView = document.querySelector<HTMLElement>('#nexus-home-view');
    if (homeView) homeView.hidden = !config.authenticated;
    element('#legal-version').textContent =
      'Version ' + config.legalVersion + ' · Needs legal review';
    element('#google-signin').hidden = !config.googleEnabled;
    element('#login-alpha').hidden = config.localSignInEnabled === false;
    element('#login-beta').hidden = config.localSignInEnabled === false;
    if (config.googleEnabled)
      element('#login-description').textContent =
        'Sign in with your configured Google test account. Responses remain synthetic samples. The privacy notice explains locally stored account identifiers and Google sign-in processing. Use sample messages only.';
    input.maxLength = config.limits.maxInputChars;
    element('#model-label').textContent = config.providers
      .map((provider) => provider.id + ' / ' + provider.modelId + ' · Synthetic sample')
      .join(', ');
    await refreshRoutingControls();
    clearConversation();
    if (config.authenticated) {
      const list = await refreshList();
      if (list[0]) await openConversation(list[0].id);
      await refreshAccount();
    } else {
      element('#account-label').textContent = 'Local workspace';
      element('#conversation-list').replaceChildren();
    }
    await loadTemplates();
    initStudioToolbar();
    initFileAttachment();
    initCsvDialog();
    initKeyPoolDialog();
    initDocTool();
    initChatGptFeatures();
    initNexusPlatform();
    updateControls();
  } finally {
    setBusy(false);
  }
}
async function guard(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.challengeRequired || error.code.startsWith('ABUSE_CHALLENGE'))
    )
      requireVerification(config?.authenticated ? 'burst' : 'signup');
    if (error instanceof ApiError && error.status === 401) {
      await initialize().catch(() => undefined);
      announce('Your session expired. Sign in to the local test account again.', true);
    } else
      announce(
        error instanceof ApiError
          ? error.message
          : 'The local workspace could not complete this action. Try again or restart the preview.',
        true,
      );
    setBusy(false);
  }
}
async function signIn(identity: string): Promise<void> {
  if (!config || !element<HTMLInputElement>('#accept-legal').checked || busy) return;
  if (config.abuseEnabled && !validProof(signupProof)) {
    requireVerification('signup');
    return;
  }
  setBusy(true);
  try {
    const challenge = signupProof
      ? { id: signupProof.id, solution: signupProof.solution }
      : undefined;
    signupProof = undefined;
    const response = await request<{ user: User; csrfToken: string }>('/api/auth/local', 'POST', {
      identity,
      acceptedLegalVersion: config.legalVersion,
      ...(config.abuseEnabled && challenge ? { challenge } : {}),
    });
    setCsrfToken(response.csrfToken);
    await initialize();
    announce('Signed in to a shared local fixture account. Use synthetic messages only.');
  } finally {
    setBusy(false);
  }
}
function openDialog(
  title: string,
  description: string,
  confirm: string,
  rename: boolean,
  action: () => Promise<void>,
): void {
  element('#dialog-title').textContent = title;
  element('#dialog-description').textContent = description;
  element('#dialog-confirm').textContent = confirm;
  element('#title-label').hidden = !rename;
  element<HTMLInputElement>('#title-input').hidden = !rename;
  element<HTMLInputElement>('#title-input').value = rename ? (selected?.title ?? '') : '';
  element<HTMLInputElement>('#title-input').required = rename;
  dialogAction = action;
  dialog.showModal();
}
element('#dialog-cancel').addEventListener('click', () => dialog.close());
element<HTMLFormElement>('#dialog-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const action = dialogAction;
  dialogAction = undefined;
  dialog.close();
  if (action) void guard(action);
});
element<HTMLInputElement>('#accept-legal').addEventListener('change', updateControls);
element('#abuse-verify').addEventListener('click', () => {
  void guard(verifyLocally);
});
element('#login-alpha').addEventListener('click', () => {
  inMemoryRole = 'admin';
  inMemoryUserName = 'Md Asadujjaman Prince';
  void guard(() => signIn('demo-alpha'));
});
element('#login-beta').addEventListener('click', () => {
  inMemoryRole = 'user';
  inMemoryUserName = 'Workspace User';
  void guard(() => signIn('demo-beta'));
});

// Modern Email Login Form Handler
const emailLoginForm = document.querySelector<HTMLFormElement>('#email-login-form');
const userEmailInput = document.querySelector<HTMLInputElement>('#user-email-input');
if (userEmailInput) {
  userEmailInput.addEventListener('input', updateControls);
}
if (emailLoginForm && userEmailInput) {
  emailLoginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = userEmailInput.value.trim();
    if (!email || !email.includes('@')) return;
    const lower = email.toLowerCase();
    const isAdmin =
      lower.includes('admin') ||
      lower.includes('prince') ||
      lower.startsWith('asad') ||
      lower.startsWith('owner');
    const namePart = email.split('@')[0] || 'User';
    const cleanName = namePart.charAt(0).toUpperCase() + namePart.slice(1);

    inMemoryUserEmail = email;
    if (isAdmin) {
      inMemoryRole = 'admin';
      inMemoryUserName = 'Md Asadujjaman Prince';
      void guard(() => signIn('demo-alpha'));
    } else {
      inMemoryRole = 'user';
      inMemoryUserName = cleanName;
      void guard(() => signIn('demo-beta'));
    }
  });
}
element('#google-signin').addEventListener('click', () => {
  void guard(async () => {
    if (!config?.googleEnabled || busy || !element<HTMLInputElement>('#accept-legal').checked)
      return;
    setBusy(true);
    try {
      const result = await request<{ authorizationUrl: string }>('/api/auth/google/start', 'POST', {
        acceptedLegalVersion: config.legalVersion,
      });
      const target = new URL(result.authorizationUrl);
      if (
        target.origin !== 'https://accounts.google.com' ||
        target.pathname !== '/o/oauth2/v2/auth'
      )
        throw new Error('Invalid sign-in destination.');
      window.location.assign(target.href);
    } finally {
      setBusy(false);
    }
  });
});
element('#google-signin').addEventListener('click', () => {
  if (!config?.googleEnabled || !element<HTMLInputElement>('#accept-legal').checked) return;
  void guard(async () => {
    const result = await request<{ redirectUrl: string }>('/api/auth/google/start', 'POST', {
      acceptedLegalVersion: config?.legalVersion,
    });
    const target = new URL(result.redirectUrl);
    if (target.protocol !== 'https:' || target.hostname !== 'accounts.google.com')
      throw new ApiError(
        'AUTH_DISABLED',
        'Google sign-in is unavailable in this local configuration.',
        403,
      );
    window.location.assign(target.href);
  });
});
element('#logout').addEventListener('click', () => {
  void guard(async () => {
    setBusy(true);
    try {
      inMemoryRole = undefined;
      inMemoryUserName = undefined;
      inMemoryUserEmail = undefined;
      await request('/api/auth/logout', 'POST', {});
      await initialize();
      announce('Signed out. Your local conversations remain saved.');
    } finally {
      setBusy(false);
    }
  });
});
document.querySelector('#sidebar-logout')?.addEventListener('click', () => {
  element<HTMLButtonElement>('#logout').click();
});
element('#new-chat').addEventListener('click', () => {
  void guard(async () => {
    setBusy(true);
    try {
      const result = await request<{ conversation: Conversation }>(
        '/api/conversations',
        'POST',
        {},
      );
      await openConversation(result.conversation.id);
      await refreshList();
      input.value = '';
      announce('');
      input.focus();
    } finally {
      setBusy(false);
    }
  });
});
element('#rename-chat').addEventListener('click', () => {
  if (!selected) return;
  const id = selected.id;
  openDialog(
    'Rename conversation',
    'Choose a short title for this synthetic conversation.',
    'Save title',
    true,
    async () => {
      setBusy(true);
      try {
        const title = element<HTMLInputElement>('#title-input').value.trim();
        await request('/api/conversations/' + encodeURIComponent(id), 'PATCH', { title });
        await openConversation(id);
        await refreshList();
        announce('Conversation renamed.');
      } finally {
        setBusy(false);
      }
    },
  );
});
element('#delete-chat').addEventListener('click', () => {
  if (!selected) return;
  const id = selected.id;
  openDialog(
    'Delete conversation?',
    'This removes the saved synthetic conversation and its messages from this computer.',
    'Delete conversation',
    false,
    async () => {
      setBusy(true);
      try {
        await request('/api/conversations/' + encodeURIComponent(id), 'DELETE', {});
        clearConversation();
        const list = await refreshList();
        if (list[0]) await openConversation(list[0].id);
        announce('Conversation deleted.');
      } finally {
        setBusy(false);
      }
    },
  );
});
element('#delete-account').addEventListener('click', () => {
  openDialog(
    'Delete local test account data?',
    'All conversations and sessions for this shared fixture account will be removed. The identity cannot be reused. Minimal pseudonymous usage and deletion audit records remain in the local test data. Production retention cleanup requires further work.',
    'Delete account data',
    false,
    async () => {
      setBusy(true);
      try {
        await request('/api/account/deletion', 'POST', {});
        await initialize();
        announce('Local test account data deleted. Its sessions have been revoked.');
      } finally {
        setBusy(false);
      }
    },
  );
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-language]')) {
  button.addEventListener('click', () => {
    language = button.dataset.language === 'bn' ? 'bn' : 'en';
    input.lang = language;
    input.placeholder = language === 'bn' ? 'একটি নমুনা বার্তা লিখুন…' : 'Try a synthetic message…';
    for (const other of document.querySelectorAll<HTMLButtonElement>('[data-language]'))
      other.setAttribute('aria-pressed', String(other === button));
    renderExamples();
    renderMessages();
    updateControls();
  });
}
input.addEventListener('input', updateControls);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!element<HTMLButtonElement>('#send').disabled) form.requestSubmit();
  }
});
element('#stop').addEventListener('click', () => {
  const active = controller;
  if (!active) return;
  stopRequested = true;
  element<HTMLButtonElement>('#stop').disabled = true;
  active.abort();
  if (requestId) {
    void request('/api/requests/' + encodeURIComponent(requestId) + '/cancel', 'POST', {}).catch(
      () => undefined,
    );
  }
});
async function submitMessage(content: string, routing = routingOptions()): Promise<void> {
  if (busy || !config?.authenticated || !content.trim()) return;
  controller = new AbortController();
  stopRequested = false;
  requestId = undefined;
  const active = controller;
  const challenge = validProof(burstProof)
    ? { id: burstProof!.id, solution: burstProof!.solution }
    : undefined;
  burstProof = undefined;
  setBusy(true);
  let failed = false;
  try {
    if (!selected) {
      const result = await request<{ conversation: Conversation }>(
        '/api/conversations',
        'POST',
        {},
      );
      selected = result.conversation;
      element('#conversation-title').textContent = selected.title;
      await refreshList();
    }
    element('#welcome').hidden = true;
    if (!routing || routing.action === 'send')
      appendMessage({
        id: 'pending-user',
        role: 'user',
        content,
        status: 'complete',
        createdAt: '',
      });
    const draft: Message = {
      id: 'pending-assistant',
      role: 'assistant',
      content: '',
      status: 'streaming',
      createdAt: '',
      ...(routing ? { requestedModelId: routing.modelId, attempts: [] } : {}),
    };
    const target = appendMessage(draft);
    input.value = '';
    announce(
      language === 'bn' ? 'নমুনা উত্তর দেখানো হচ্ছে…' : 'Showing a prewritten synthetic response…',
    );
    let messageToSend = content;
    if (currentAttachedFile) {
      let attachmentText = `\n\n[Attached File: ${currentAttachedFile.sanitized_name} (${currentAttachedFile.mime_type})]`;
      if (currentAttachedFile.extracted_text) {
        attachmentText += `\nExtracted Content:\n"""\n${currentAttachedFile.extracted_text.slice(0, 3000)}\n"""`;
      }
      messageToSend += attachmentText;
    }
    const modelSelector = document.querySelector<HTMLSelectElement>('#chat-model-selector');
    const selectedModel =
      modelSelector?.value && modelSelector.value !== 'auto' ? modelSelector.value : null;

    await sendMessage(
      selected.id,
      messageToSend,
      language,
      active.signal,
      (frame) => {
        if (frame.event === 'meta' || frame.event === 'start') {
          requestId = typeof frame.data.requestId === 'string' ? frame.data.requestId : undefined;
          if (requestId) draft.requestId = requestId;
          if (typeof frame.data.providerId === 'string') draft.providerId = frame.data.providerId;
          if (typeof frame.data.modelId === 'string') draft.modelId = frame.data.modelId;
          if (frame.data.contextTrimmed === true) draft.contextTrimmed = true;
          target.meta.textContent = metadata(draft);
          responseDetails(draft, target);
        } else if (frame.event === 'context') {
          if (typeof frame.data.removedMessages === 'number' && frame.data.removedMessages > 0)
            draft.contextTrimmed = true;
          responseDetails(draft, target);
        } else if (frame.event === 'attempt') {
          if (
            typeof frame.data.attemptId !== 'string' ||
            typeof frame.data.modelId !== 'string' ||
            typeof frame.data.providerId !== 'string' ||
            typeof frame.data.index !== 'number'
          )
            throw new ApiError(
              'INVALID_STREAM',
              'The response attempt could not be displayed. Reopen this chat.',
              502,
            );
          for (const previous of draft.attempts ?? [])
            if (previous.status === 'streaming') previous.status = 'failed';
          const attempt: ResponseAttempt = {
            attemptId: frame.data.attemptId,
            modelId: frame.data.modelId,
            providerId: frame.data.providerId,
            index: frame.data.index,
            reason: typeof frame.data.reason === 'string' ? frame.data.reason : '',
            content: '',
            status: 'streaming',
          };
          draft.attempts ??= [];
          draft.attempts.push(attempt);
          draft.modelId = attempt.modelId;
          draft.providerId = attempt.providerId;
          target.meta.textContent = metadata(draft);
          responseDetails(draft, target);
        } else if (
          (frame.event === 'chunk' || frame.event === 'delta') &&
          typeof frame.data.text === 'string'
        ) {
          draft.content += frame.data.text;
          target.body.textContent = draft.content;
          if (draft.attempts?.length) {
            const attempt = draft.attempts.find(
              (entry) => entry.attemptId === frame.data.attemptId,
            );
            if (!attempt)
              throw new ApiError(
                'INVALID_STREAM',
                'The response attempt could not be displayed. Reopen this chat.',
                502,
              );
            attempt.content += frame.data.text;
            responseDetails(draft, target);
          }
        } else if (frame.event === 'done' || frame.event === 'end') {
          draft.status = 'complete';
          const attempt = draft.attempts?.at(-1);
          if (attempt) attempt.status = 'complete';
          if (frame.data.contextTrimmed === true) draft.contextTrimmed = true;
          target.meta.textContent = metadata(draft);
          responseDetails(draft, target);
        } else if (frame.event === 'error') {
          failed = true;
          draft.status = stopRequested ? 'cancelled' : 'failed';
          const attempt = draft.attempts?.at(-1);
          if (attempt) attempt.status = draft.status;
          target.meta.textContent = metadata(draft);
          responseDetails(draft, target);
          if (stopRequested) {
            announce(
              language === 'bn'
                ? '\u09a8\u09ae\u09c1\u09a8\u09be \u0989\u09a4\u09cd\u09a4\u09b0 \u09ac\u09a8\u09cd\u09a7 \u0995\u09b0\u09be \u09b9\u09af\u09bc\u09c7\u099b\u09c7\u0964'
                : 'Synthetic response stopped.',
            );
            return;
          }
          if (
            frame.data.code === 'ABUSE_CHALLENGE_REQUIRED' ||
            frame.data.challengeRequired === true
          ) {
            requireVerification('burst');
            if (!routing || routing.action === 'send') input.value = content;
          }
          announce(
            recoveryMessage(
              frame.data,
              'This response failed. Reopen the chat to check its status.',
            ),
            true,
          );
        }
      },
      routing,
      challenge,
      selectedModel,
      inMemoryUserName || 'Md Asadujjaman Prince',
    );
    if (!failed && verificationPurpose === 'burst') {
      verificationPurpose = undefined;
      element('#abuse-verification').hidden = true;
    }
    if (!failed) {
      if (stopRequested || active.signal.aborted) {
        announce(
          language === 'bn' ? 'নমুনা উত্তর বন্ধ করা হয়েছে।' : 'Synthetic response stopped.',
        );
      } else {
        announce(language === 'bn' ? 'নমুনা উত্তর সংরক্ষিত হয়েছে।' : 'Synthetic sample saved.');
      }
      currentAttachedFile = undefined;
      const badge = document.querySelector<HTMLSpanElement>('#attached-file-badge');
      if (badge) badge.hidden = true;
      const fInput = document.querySelector<HTMLInputElement>('#file-input');
      if (fInput) fInput.value = '';
    }
  } catch (error) {
    if (active.signal.aborted || stopRequested)
      announce(language === 'bn' ? 'নমুনা উত্তর বন্ধ করা হয়েছে।' : 'Synthetic response stopped.');
    else {
      if ((!routing || routing.action === 'send') && error instanceof ApiError)
        input.value = content;
      throw error;
    }
  } finally {
    controller = undefined;
    requestId = undefined;
    if (selected) await openConversation(selected.id).catch(() => undefined);
    await refreshAccount().catch(() => undefined);
    setBusy(false);
    element<HTMLButtonElement>('#stop').disabled = false;
    input.focus();
  }
}
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (busy || !config?.authenticated || !input.value.trim()) return;
  const content = input.value;
  void guard(() => submitMessage(content));
});
renderExamples();
void guard(async () => {
  await initialize();
  announce('');
});
