export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function normalizedError(error) {
  if (error instanceof AppError) return error;
  if (error?.name === 'AbortError')
    return new AppError(408, 'REQUEST_CANCELLED', 'The request was stopped.');
  return new AppError(
    503,
    'SERVICE_UNAVAILABLE',
    'The local service is unavailable. Try again later.',
  );
}
