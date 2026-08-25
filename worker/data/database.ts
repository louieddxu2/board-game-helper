import type { D1Database, D1PreparedStatement, D1Result, Env } from '../env';

export type { D1Result } from '../env';

export interface DatabaseStatement {
  bind(...values: unknown[]): DatabaseStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface DatabaseMetrics {
  rowsRead: number;
  rowsWritten: number;
  queries: number;
}

class Statement implements DatabaseStatement {
  constructor(private readonly raw: D1PreparedStatement, private readonly metrics: DatabaseMetrics) {}

  bind(...values: unknown[]): DatabaseStatement {
    return new Statement(this.raw.bind(...values), this.metrics);
  }

  first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.raw.all<T>().then((result) => {
      this.metrics.queries += 1;
      this.metrics.rowsRead += Number(result.meta?.rows_read ?? 0);
      return result.results?.[0] ?? null;
    });
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = await this.raw.all<T>();
    this.metrics.queries += 1;
    this.metrics.rowsRead += Number(result.meta?.rows_read ?? 0);
    return result;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = await this.raw.run<T>();
    this.metrics.queries += 1;
    this.metrics.rowsRead += Number(result.meta?.rows_read ?? 0);
    this.metrics.rowsWritten += Number(result.meta?.rows_written ?? result.meta?.changes ?? 0);
    return result;
  }

  toRaw(): D1PreparedStatement {
    return this.raw;
  }
}

export interface Database {
  statement(sql: string): DatabaseStatement;
  batch(statements: DatabaseStatement[]): Promise<D1Result[]>;
  metrics?(): DatabaseMetrics;
}

class D1DatabaseGateway implements Database {
  private readonly queryMetrics: DatabaseMetrics = { rowsRead: 0, rowsWritten: 0, queries: 0 };

  constructor(private readonly raw: D1Database) {}

  statement(sql: string): DatabaseStatement {
    return new Statement(this.raw.prepare(sql), this.queryMetrics);
  }

  async batch(statements: DatabaseStatement[]): Promise<D1Result[]> {
    const results = await this.raw.batch(statements.map((statement) => {
      if (!(statement instanceof Statement)) throw new Error('Invalid database statement');
      return statement.toRaw();
    }));
    this.queryMetrics.queries += results.length;
    results.forEach((result) => {
      this.queryMetrics.rowsRead += Number(result.meta?.rows_read ?? 0);
      this.queryMetrics.rowsWritten += Number(result.meta?.rows_written ?? result.meta?.changes ?? 0);
    });
    return results;
  }

  metrics(): DatabaseMetrics {
    return { ...this.queryMetrics };
  }
}

export const createDatabase = (env: Pick<Env, 'DB'>): Database => new D1DatabaseGateway(env.DB);

export const getDatabase = (context: { get(key: string): unknown }): Database => {
  const database = context.get('database');
  if (!database || typeof (database as Database).statement !== 'function') {
    throw new Error('Database service is not initialized');
  }
  return database as Database;
};
