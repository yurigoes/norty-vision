/**
 * Tipos compartilhados pra adapters de integracoes externas.
 */

export interface AdapterCredentials {
  baseUrl: string;
  apiKey?: string | null;
  apiToken?: string | null;
  username?: string | null;
  password?: string | null;
}

export interface AdapterResponse<T> {
  ok: boolean;
  status: number;
  body: T | null;
  error?: string;
  rawBody?: unknown;
}

export class AdapterError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}
