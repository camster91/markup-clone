export class IntegrationHttpError extends Error {
  readonly statusCode: number;
  readonly retryAfter: string | null;

  constructor(provider: string, statusCode: number, retryAfter: string | null) {
    // Receiver bodies are deliberately excluded: they are untrusted and may
    // echo credentials or internal diagnostics into the owner-visible log.
    super(`${provider} returned ${statusCode}`);
    this.name = 'IntegrationHttpError';
    this.statusCode = statusCode;
    this.retryAfter = retryAfter;
  }
}
