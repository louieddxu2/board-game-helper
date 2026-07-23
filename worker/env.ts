export interface D1Result<T = unknown> {
  results?: T[];
  success?: boolean;
  meta?: { changes?: number; rows_read?: number; rows_written?: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  PUBLIC_RATE_LIMITER: RateLimitBinding;
  WRITE_RATE_LIMITER: RateLimitBinding;
  APP_ORIGIN?: string;
  GOOGLE_CLIENT_ID?: string;
  BOOTSTRAP_ADMIN_EMAIL?: string;
}
