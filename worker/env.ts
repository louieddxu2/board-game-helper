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
  TRUSTED_APP_ORIGINS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_DRIVE_CLIENT_ID?: string;
  GOOGLE_CLIENT_IDS?: string;
  BOOTSTRAP_ADMIN_EMAIL?: string;
  EMAIL_HASH_SECRET?: string;
  ATTRIBUTE_QUESTION_SECRET?: string;
}

// Route handlers receive configuration and service bindings, never the raw D1 binding.
export type RouteEnv = Omit<Env, 'DB'>;
