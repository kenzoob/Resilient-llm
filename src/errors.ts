export interface LLMErrorOptions {
  status?: number;
  retryable?: boolean;
  provider?: string;
  cause?: unknown;
}

export class LLMError extends Error {
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly provider: string | undefined;

  constructor(message: string, options: LLMErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "LLMError";
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.provider = options.provider;
  }
}

const RETRYABLE_STATUSES = new Set([429]);

export function isRetryable(error: unknown): boolean {
  if (!(error instanceof LLMError)) {
    return false;
  }
  if (!error.retryable) {
    return false;
  }
  if (error.status === undefined) {
    return true;
  }
  return RETRYABLE_STATUSES.has(error.status) || (error.status >= 500 && error.status <= 599);
}

export function parseRetryAfter(header: string | null): number | undefined {
  if (header === null || header.trim() === "") {
    return undefined;
  }

  if (/^\d+$/.test(header.trim())) {
    return Number(header.trim()) * 1000;
  }

  const dateMs = Date.parse(header);
  if (Number.isNaN(dateMs)) {
    return undefined;
  }

  return Math.max(0, dateMs - Date.now());
}
