export class ApiError extends Error {
    code;
    status;
    challengeRequired;
    resetAt;
    constructor(code, message, status, challengeRequired = false, resetAt) {
        super(message);
        this.code = code;
        this.status = status;
        this.challengeRequired = challengeRequired;
        this.resetAt = resetAt;
    }
}
let csrfToken = '';
export function setCsrfToken(value) {
    csrfToken = value;
}
async function responseError(response) {
    try {
        const body = (await response.json());
        return new ApiError(typeof body.error?.code === 'string' ? body.error.code : 'REQUEST_FAILED', recoveryMessage(body.error ?? {}, 'The request failed. Try again later.'), response.status, body.error?.challengeRequired === true, typeof body.error?.resetAt === 'string' ? body.error.resetAt : undefined);
    }
    catch {
        return new ApiError('REQUEST_FAILED', 'The request failed. Try again later.', response.status);
    }
}
export function recoveryMessage(data, fallback) {
    const messages = [typeof data.message === 'string' ? data.message : fallback];
    if (typeof data.resetAt === 'string') {
        const reset = new Date(data.resetAt);
        if (Number.isFinite(reset.getTime()))
            messages.push('Reset: ' + reset.toLocaleString() + '.');
    }
    if (Array.isArray(data.alternatives))
        for (const alternative of data.alternatives)
            if (typeof alternative === 'string')
                messages.push(alternative);
    return messages.join(' ');
}
export async function request(path, method = 'GET', body) {
    const headers = { Accept: 'application/json' };
    if (method !== 'GET')
        headers['X-CSRF-Token'] = csrfToken;
    if (body !== undefined)
        headers['Content-Type'] = 'application/json';
    const options = { method, headers, credentials: 'same-origin', cache: 'no-store' };
    if (body !== undefined)
        options.body = JSON.stringify(body);
    const response = await fetch(path, options);
    if (!response.ok)
        throw await responseError(response);
    return (await response.json());
}
export async function sendMessage(conversationId, content, language, signal, onEvent, routing, challenge) {
    const response = await fetch('/api/conversations/' + encodeURIComponent(conversationId) + '/messages', {
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
            ...(routing ? { routing } : {}),
            ...(challenge ? { challenge } : {}),
        }),
    });
    if (!response.ok)
        throw await responseError(response);
    if (!response.body || !response.headers.get('content-type')?.startsWith('text/event-stream'))
        throw new ApiError('INVALID_STREAM', 'The response could not be displayed. Reopen this chat.', 502);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let terminal = false;
    try {
        while (true) {
            const part = await reader.read();
            pending = (pending + decoder.decode(part.value, { stream: !part.done })).replaceAll('\r\n', '\n');
            if (pending.length > 65536)
                throw new ApiError('INVALID_STREAM', 'The response stream was too large. Reopen this chat.', 502);
            let boundary;
            while ((boundary = pending.indexOf('\n\n')) !== -1) {
                const frame = pending.slice(0, boundary);
                pending = pending.slice(boundary + 2);
                const lines = frame.split('\n');
                const event = lines
                    .find((line) => line.startsWith('event:'))
                    ?.slice(6)
                    .trim() ?? 'message';
                const payload = lines
                    .filter((line) => line.startsWith('data:'))
                    .map((line) => line.slice(5).trimStart())
                    .join('\n');
                if (!payload)
                    continue;
                const data = JSON.parse(payload);
                if (typeof data !== 'object' || data === null || Array.isArray(data))
                    throw new ApiError('INVALID_STREAM', 'The response could not be displayed. Reopen this chat.', 502);
                onEvent({ event, data: data });
                if (event === 'done' || event === 'end' || event === 'error')
                    terminal = true;
            }
            if (part.done)
                break;
        }
        if (!terminal)
            throw new ApiError('STREAM_INTERRUPTED', 'Connection interrupted. Reopen this chat to check its saved response.', 502);
    }
    finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}
export async function uploadFile(filename, contentBase64, mimeType) {
    return request('/api/files/upload', 'POST', { filename, contentBase64, mimeType });
}
export async function listFiles(limit = 50, offset = 0) {
    return request(`/api/files?limit=${limit}&offset=${offset}`, 'GET');
}
export async function getFile(fileId) {
    return request(`/api/files/${encodeURIComponent(fileId)}`, 'GET');
}
export async function getFileSections(fileId, maxTokens) {
    const query = maxTokens ? `?maxTokens=${maxTokens}` : '';
    return request(`/api/files/${encodeURIComponent(fileId)}/sections${query}`, 'GET');
}
export async function deleteFile(fileId) {
    return request(`/api/files/${encodeURIComponent(fileId)}`, 'DELETE');
}
export async function getFileWarning() {
    return request('/api/files/warning', 'GET');
}
export async function analyzeCsvFile(fileId) {
    return request(`/api/files/${encodeURIComponent(fileId)}/analysis`, 'GET');
}
export async function queryCsvFile(fileId, question) {
    return request(`/api/files/${encodeURIComponent(fileId)}/query`, 'POST', { question });
}
export async function getStorageUsage() {
    return request('/api/files/storage', 'GET');
}
export async function triggerRetentionCleanup(options) {
    return request('/api/files/cleanup', 'POST', options ?? {});
}
export async function listBackups() {
    return request('/admin/api/backups', 'GET');
}
export async function createBackup(passphrase, options) {
    return request('/admin/api/backups', 'POST', { passphrase, ...options });
}
export async function verifyBackup(archivePath, passphrase) {
    return request('/admin/api/backups/verify', 'POST', { archivePath, passphrase });
}
export async function restoreBackup(archivePath, passphrase, dryRun = false) {
    return request('/admin/api/backups/restore', 'POST', { archivePath, passphrase, dryRun });
}
export async function getSystemStatus() {
    return request('/api/status', 'GET');
}
export async function fetchProductivityTemplates() {
    return request('/api/productivity/templates', 'GET');
}
export async function fetchApiKeys() {
    return request('/api/keys', 'GET');
}
export async function createApiKey(input) {
    return request('/api/keys', 'POST', input);
}
export async function updateApiKeyStatus(id, status) {
    return request(`/api/keys/${encodeURIComponent(id)}/status`, 'PATCH', { status });
}
export async function deleteApiKey(id) {
    return request(`/api/keys/${encodeURIComponent(id)}`, 'DELETE');
}
export async function verifyApiKey(input) {
    return request('/api/keys/verify', 'POST', input);
}
export async function testSavedApiKey(id) {
    return request(`/api/keys/${encodeURIComponent(id)}/test`, 'POST');
}
