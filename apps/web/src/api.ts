export interface User {
  id: string;
  displayName: string;
  tier: string;
  trustLevel: number;
}
export interface Bootstrap {
  mode: string;
  authenticated: boolean;
  googleEnabled: boolean;
  localSignInEnabled: boolean;
  routingEnabled?: boolean;
  abuseEnabled?: boolean;
  abuse?: AbuseStatus;
  csrfToken: string;
  user?: User;
  legalVersion: string;
  limits: { maxInputChars: number; maxOutputTokens: number; dailyRequests: number };
  providers: { id: string; modelId: string; label: string; synthetic: boolean }[];
  filesEnabled?: boolean;
  filePrivacyWarning?: string;
}
export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: string;
  providerId?: string;
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
  usageKind?: string;
  requestId?: string;
  sourceMessageId?: string;
  requestedModelId?: string | null;
  attempts?: ResponseAttempt[];
  contextTrimmed?: boolean;
  retryAllowed?: boolean;
  regenerateAllowed?: boolean;
  retryBudgetRemaining?: number;
  createdAt: string;
}
export interface ResponseAttempt {
  attemptId: string;
  modelId: string;
  providerId: string;
  index: number;
  reason: string;
  content: string;
  status: string;
}
export interface AvailableModels {
  models: {
    id: string;
    displayName: string;
    providerId: string;
    capabilities: string[];
    freeFlag: boolean;
  }[];
  presets: RoutingPreset[];
}
export type RoutingPreset =
  'general' | 'coding' | 'writing' | 'research' | 'translation' | 'summary';

export interface ProductivityOptions {
  preset?: RoutingPreset;
  task?: 'draft' | 'rewrite' | 'grammar' | 'tone' | 'translate' | 'summarize' | 'explain';
  tone?:
    'formal' | 'casual' | 'professional' | 'academic' | 'empathetic' | 'concise' | 'persuasive';
  sourceLanguage?: 'en' | 'bn' | 'auto';
  targetLanguage?: 'en' | 'bn';
  summaryStyle?: 'executive' | 'bullets' | 'tldr' | 'simplified';
  outputFormat?: 'text' | 'table' | 'outline' | 'json';
  jsonSchema?: Record<string, unknown>;
}

export interface RoutingOptions {
  mode: 'auto' | 'manual' | 'free-only';
  modelId: string | null;
  preset: RoutingPreset;
  contextAction: 'trim' | 'refuse';
  action: 'send' | 'retry' | 'regenerate';
  retryOf: string | null;
  productivity?: ProductivityOptions;
}
export interface Usage {
  requestsToday: number;
  dailyLimit: number;
  inputTokens: number;
  outputTokens: number;
  usageKind: string;
}
export interface LedgerAmounts {
  costMicroCu: string;
  inputTokens: string;
  outputTokens: string;
}
export interface LedgerEntitlement {
  id: string;
  kind: 'free' | 'pack';
  status: string;
  startsAt: string;
  endsAt: string | null;
  timeLeftSeconds: number | null;
  remaining: LedgerAmounts;
  spent: LedgerAmounts;
  estimated: boolean;
  pendingReconciliation: boolean;
  refusalReason: string | null;
}
export interface LedgerUsage {
  syntheticOnly: true;
  unit: 'tokens';
  entitlements: LedgerEntitlement[];
}
export interface LedgerEntry {
  id: string;
  entitlementId: string;
  type: 'grant' | 'reserve' | 'commit' | 'release' | 'expire' | 'refund' | 'adjust';
  amountMicroCu: string;
  tokensIn: string;
  tokensOut: string;
  reservationId: string | null;
  estimateFlag: boolean;
  reconcilesEntryId: string | null;
  reasonCode: string;
  createdAt: string;
}
export interface LedgerHistory {
  syntheticOnly: true;
  history: LedgerEntry[];
}
export interface Account {
  user: User;
  usage: Usage;
  ledgerUsage?: LedgerUsage;
  abuse?: AbuseStatus;
}
export interface AbuseStatus {
  trustLevel: number;
  verifiedContact: boolean;
  goodBehavior: number;
  moderation: { action: 'none' | 'suspend' | 'throttle' | 'ban'; until: string | null };
  limits: {
    dailyRequests: number;
    dailyTokens: number;
    concurrency: number;
    burstRequests: number;
    burstWindowMs: number;
    newAccountDeviceRequests: number;
    newAccountIpRequests: number;
  };
  usage: { dailyRequests: number; burstRequests: number };
  challenge: {
    signupRequired: boolean;
    burstRequired: boolean;
    equivalent: 'local-proof-of-work';
    humanVerification: false;
  };
  resetAt: string;
  syntheticOnly: true;
}
export interface AbuseChallenge {
  id: string;
  nonce: string;
  purpose: 'signup' | 'burst';
  difficulty: number;
  expiresAt: string;
  algorithm: 'sha256-leading-zero-bits-v1';
  syntheticOnly: true;
  humanVerification: false;
}
export interface ChallengeProof {
  id: string;
  solution: string;
}
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly challengeRequired = false,
    public readonly resetAt?: string,
  ) {
    super(message);
  }
}
let csrfToken = '';
export function setCsrfToken(value: string): void {
  csrfToken = value;
}
async function responseError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { error?: Record<string, unknown> };
    return new ApiError(
      typeof body.error?.code === 'string' ? body.error.code : 'REQUEST_FAILED',
      recoveryMessage(body.error ?? {}, 'The request failed. Try again later.'),
      response.status,
      body.error?.challengeRequired === true,
      typeof body.error?.resetAt === 'string' ? body.error.resetAt : undefined,
    );
  } catch {
    return new ApiError('REQUEST_FAILED', 'The request failed. Try again later.', response.status);
  }
}
export function recoveryMessage(data: Record<string, unknown>, fallback: string): string {
  const messages = [typeof data.message === 'string' ? data.message : fallback];
  if (typeof data.resetAt === 'string') {
    const reset = new Date(data.resetAt);
    if (Number.isFinite(reset.getTime())) messages.push('Reset: ' + reset.toLocaleString() + '.');
  }
  if (Array.isArray(data.alternatives))
    for (const alternative of data.alternatives)
      if (typeof alternative === 'string') messages.push(alternative);
  return messages.join(' ');
}
export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const options: RequestInit = { method, headers, credentials: 'same-origin', cache: 'no-store' };
  if (body !== undefined) options.body = JSON.stringify(body);
  const response = await fetch(path, options);
  if (!response.ok) throw await responseError(response);
  return (await response.json()) as T;
}
export interface StreamEvent {
  event: string;
  data: Record<string, unknown>;
}
export async function sendMessage(
  conversationId: string,
  content: string,
  language: 'en' | 'bn',
  signal: AbortSignal,
  onEvent: (event: StreamEvent) => void,
  routing?: RoutingOptions,
  challenge?: ChallengeProof,
  modelId?: string | null,
  userName?: string,
): Promise<void> {
  const response = await fetch(
    '/api/conversations/' + encodeURIComponent(conversationId) + '/messages',
    {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        content,
        language,
        ...(modelId ? { modelId } : {}),
        ...(routing ? { routing } : {}),
        ...(challenge ? { challenge } : {}),
        ...(userName ? { userName } : {}),
      }),
    },
  );
  if (!response.ok) throw await responseError(response);
  if (!response.body || !response.headers.get('content-type')?.startsWith('text/event-stream'))
    throw new ApiError(
      'INVALID_STREAM',
      'The response could not be displayed. Reopen this chat.',
      502,
    );
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let terminal = false;
  try {
    while (true) {
      const part = await reader.read();
      pending = (pending + decoder.decode(part.value, { stream: !part.done })).replaceAll(
        '\r\n',
        '\n',
      );
      if (pending.length > 65536)
        throw new ApiError(
          'INVALID_STREAM',
          'The response stream was too large. Reopen this chat.',
          502,
        );
      let boundary: number;
      while ((boundary = pending.indexOf('\n\n')) !== -1) {
        const frame = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        const lines = frame.split('\n');
        const event =
          lines
            .find((line) => line.startsWith('event:'))
            ?.slice(6)
            .trim() ?? 'message';
        const payload = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!payload) continue;
        const data: unknown = JSON.parse(payload);
        if (typeof data !== 'object' || data === null || Array.isArray(data))
          throw new ApiError(
            'INVALID_STREAM',
            'The response could not be displayed. Reopen this chat.',
            502,
          );
        onEvent({ event, data: data as Record<string, unknown> });
        if (event === 'done' || event === 'end' || event === 'error') terminal = true;
      }
      if (part.done) break;
    }
    if (!terminal)
      throw new ApiError(
        'STREAM_INTERRUPTED',
        'Connection interrupted. Reopen this chat to check its saved response.',
        502,
      );
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export interface UploadedFile {
  id: string;
  user_id?: string;
  filename: string;
  sanitized_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  text_chars: number;
  estimated_tokens: number;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  privacy_warning?: string;
  extracted_text?: string;
}

export interface DocumentSection {
  sectionIndex: number;
  title: string;
  tokenCount: number;
  charCount: number;
  content: string;
}

export interface FileSectionsResponse {
  ok: boolean;
  fileId: string;
  filename: string;
  totalSections: number;
  totalTokens: number;
  sections: DocumentSection[];
}

export async function uploadFile(
  filename: string,
  contentBase64: string,
  mimeType?: string,
): Promise<{ ok: boolean; file: UploadedFile }> {
  return request('/api/files/upload', 'POST', { filename, contentBase64, mimeType });
}

export async function listFiles(
  limit = 50,
  offset = 0,
): Promise<{ ok: boolean; files: UploadedFile[] }> {
  return request(`/api/files?limit=${limit}&offset=${offset}`, 'GET');
}

export async function getFile(fileId: string): Promise<{ ok: boolean; file: UploadedFile }> {
  return request(`/api/files/${encodeURIComponent(fileId)}`, 'GET');
}

export async function getFileSections(
  fileId: string,
  maxTokens?: number,
): Promise<FileSectionsResponse> {
  const query = maxTokens ? `?maxTokens=${maxTokens}` : '';
  return request(`/api/files/${encodeURIComponent(fileId)}/sections${query}`, 'GET');
}

export async function deleteFile(fileId: string): Promise<{ ok: boolean; deleted: boolean }> {
  return request(`/api/files/${encodeURIComponent(fileId)}`, 'DELETE');
}

export async function getFileWarning(): Promise<{ warning: string }> {
  return request('/api/files/warning', 'GET');
}

export interface CsvColumnAnalysis {
  name: string;
  index: number;
  inferredType: string;
  missingCount: number;
  missingPercentage: number;
  stats: Record<string, unknown> | null;
}

export interface CsvChartSuggestion {
  chartType: string;
  title: string;
  xAxis?: string;
  yAxis?: string;
  categoryAxis?: string;
  rationale: string;
  priority: number;
}

export interface CsvAnalysisResponse {
  ok: boolean;
  fileId: string;
  filename: string;
  summary: {
    totalRows: number;
    totalColumns: number;
    headers: string[];
    preview: string[][];
  };
  missingValues: {
    totalMissing: number;
    rowsWithMissing: number;
    missingRowsPercentage: number;
    columnBreakdown: { column: string; missingCount: number; missingPercentage: number }[];
  };
  columns: CsvColumnAnalysis[];
  chartSuggestions: CsvChartSuggestion[];
}

export interface CsvQueryResponse {
  ok: boolean;
  fileId: string;
  filename: string;
  question: string;
  operation: string;
  answer: string;
  result: unknown;
}

export async function analyzeCsvFile(fileId: string): Promise<CsvAnalysisResponse> {
  return request(`/api/files/${encodeURIComponent(fileId)}/analysis`, 'GET');
}

export async function queryCsvFile(fileId: string, question: string): Promise<CsvQueryResponse> {
  return request(`/api/files/${encodeURIComponent(fileId)}/query`, 'POST', { question });
}

export interface StorageUsage {
  userId: string;
  usedBytes: number;
  fileCount: number;
  quotaBytes: number;
  remainingBytes: number;
  usagePercent: number;
  isQuotaExceeded: boolean;
}

export interface StorageUsageResponse {
  ok: boolean;
  storage: StorageUsage;
}

export interface RetentionSummary {
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  dryRun: boolean;
  filesExpired: number;
  filesPurged: number;
  diskBytesFreed: number;
  conversationsPurged: number;
  errors: Array<{ fileId?: string; conversationId?: string; operation: string; message: string }>;
  success: boolean;
}

export interface RetentionSummaryResponse {
  ok: boolean;
  summary: RetentionSummary;
}

export async function getStorageUsage(): Promise<StorageUsageResponse> {
  return request('/api/files/storage', 'GET');
}

export async function triggerRetentionCleanup(options?: {
  fileRetentionDays?: number;
  softDeleteGraceDays?: number;
  conversationRetentionDays?: number;
  dryRun?: boolean;
}): Promise<RetentionSummaryResponse> {
  return request('/api/files/cleanup', 'POST', options ?? {});
}

export interface BackupManifestSummary {
  createdAt: string;
  schemaVersion: number;
  tableCount: number;
  totalRows: number;
  fileCount: number;
  totalFileBytes: number;
  metadata?: Record<string, unknown>;
}

export interface BackupItem {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  createdAt: string;
  schemaVersion: number;
  totalRows: number;
  fileCount: number;
  totalFileBytes: number;
  sha256: string;
  metadata?: Record<string, unknown>;
}

export interface BackupListResponse {
  ok: boolean;
  backups: BackupItem[];
}

export interface BackupCreateResponse {
  ok: boolean;
  backup: {
    filePath: string;
    fileName: string;
    sizeBytes: number;
    ciphertextSha256: string;
    manifestSummary: BackupManifestSummary;
  };
}

export interface BackupVerifyResponse {
  ok: boolean;
  valid: boolean;
  manifest: Record<string, unknown>;
  summary: BackupManifestSummary;
}

export interface BackupRestoreResponse {
  ok: boolean;
  restore: {
    dryRun: boolean;
    success?: boolean;
    verified?: boolean;
    restoredAt?: string;
    schemaVersion?: number;
    tablesRestored?: number;
    totalRowsRestored?: number;
    filesRestored?: number;
    manifest?: Record<string, unknown>;
    summary?: BackupManifestSummary;
  };
}

export async function listBackups(): Promise<BackupListResponse> {
  return request('/admin/api/backups', 'GET');
}

export async function createBackup(
  passphrase: string,
  options?: { fileName?: string; metadata?: Record<string, unknown> },
): Promise<BackupCreateResponse> {
  return request('/admin/api/backups', 'POST', { passphrase, ...options });
}

export async function verifyBackup(
  archivePath: string,
  passphrase: string,
): Promise<BackupVerifyResponse> {
  return request('/admin/api/backups/verify', 'POST', { archivePath, passphrase });
}

export async function restoreBackup(
  archivePath: string,
  passphrase: string,
  dryRun: boolean = false,
): Promise<BackupRestoreResponse> {
  return request('/admin/api/backups/restore', 'POST', { archivePath, passphrase, dryRun });
}

export interface SystemComponentStatus {
  id: string;
  name: string;
  status: 'operational' | 'degraded_performance' | 'partial_outage' | 'major_outage';
  description: string;
}

export interface SystemStatusResponse {
  status: 'operational' | 'degraded_performance' | 'partial_outage' | 'major_outage';
  timestamp: string;
  uptimeSeconds: number;
  components: SystemComponentStatus[];
  incidents: Array<{
    id: string;
    title: string;
    status: string;
    createdAt: string;
    impact: string;
  }>;
  maintenance: Array<{ id: string; title: string; scheduledStart: string; scheduledEnd: string }>;
}

export async function getSystemStatus(): Promise<SystemStatusResponse> {
  return request('/api/status', 'GET');
}

export interface ProductivityTemplateField {
  key: string;
  label: string;
  labelBn: string;
  type: 'text' | 'textarea' | 'select';
  placeholder?: string;
  options?: string[];
  default?: string;
  required?: boolean;
}

export interface ProductivityTemplate {
  id: string;
  name: string;
  nameBn: string;
  category: string;
  preset: RoutingPreset;
  task?: 'draft' | 'rewrite' | 'grammar' | 'tone' | 'translate' | 'summarize' | 'explain';
  description: string;
  descriptionBn: string;
  fields: ProductivityTemplateField[];
  buildPrompt: (data: Record<string, string>, lang?: 'en' | 'bn') => string;
}

export interface ProductivityTemplatesResponse {
  ok: boolean;
  templates: Record<string, ProductivityTemplate>;
}

export async function fetchProductivityTemplates(): Promise<ProductivityTemplatesResponse> {
  return request('/api/productivity/templates', 'GET');
}

export interface ApiKeyItem {
  id: string;
  provider: 'github' | 'groq' | 'gemini' | string;
  label: string;
  keyMask: string;
  status: 'active' | 'blocked';
  requestsUsed: number;
  expiresAt: string | null;
  isExpired: boolean;
  isRateLimited: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function fetchApiKeys(): Promise<{ ok: boolean; keys: ApiKeyItem[] }> {
  return request<{ ok: boolean; keys: ApiKeyItem[] }>('/api/keys', 'GET');
}

export async function createApiKey(input: {
  provider: string;
  label: string;
  apiKey: string;
  expiresAt?: string | null;
}): Promise<{ ok: boolean; key: ApiKeyItem }> {
  return request<{ ok: boolean; key: ApiKeyItem }>('/api/keys', 'POST', input);
}

export async function updateApiKeyStatus(
  id: string,
  status: 'active' | 'blocked',
): Promise<{ ok: boolean; key: ApiKeyItem }> {
  return request<{ ok: boolean; key: ApiKeyItem }>(
    `/api/keys/${encodeURIComponent(id)}/status`,
    'PATCH',
    { status },
  );
}

export async function deleteApiKey(id: string): Promise<{ ok: boolean; id: string }> {
  return request<{ ok: boolean; id: string }>(`/api/keys/${encodeURIComponent(id)}`, 'DELETE');
}

export async function verifyApiKey(input: { provider: string; apiKey: string }): Promise<{
  ok: boolean;
  connected: boolean;
  latencyMs?: number;
  message?: string;
  error?: string;
}> {
  return request<{
    ok: boolean;
    connected: boolean;
    latencyMs?: number;
    message?: string;
    error?: string;
  }>('/api/keys/verify', 'POST', input);
}

export async function testSavedApiKey(id: string): Promise<{
  ok: boolean;
  connected: boolean;
  latencyMs?: number;
  message?: string;
  error?: string;
}> {
  return request<{
    ok: boolean;
    connected: boolean;
    latencyMs?: number;
    message?: string;
    error?: string;
  }>(`/api/keys/${encodeURIComponent(id)}/test`, 'POST');
}
