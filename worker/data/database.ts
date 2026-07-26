import type { D1Database, D1PreparedStatement, D1Result, Env } from '../env';

export type { D1Result } from '../env';

export interface DatabaseStatement {
  bind(...values: unknown[]): DatabaseStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

class Statement implements DatabaseStatement {
  constructor(private readonly raw: D1PreparedStatement) {}

  bind(...values: unknown[]): DatabaseStatement {
    return new Statement(this.raw.bind(...values));
  }

  first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.raw.first<T>();
  }

  all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.raw.all<T>();
  }

  run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.raw.run<T>();
  }

  toRaw(): D1PreparedStatement {
    return this.raw;
  }
}

export interface Database {
  statement(sql: string): DatabaseStatement;
  batch(statements: DatabaseStatement[]): Promise<D1Result[]>;
}

class D1DatabaseGateway implements Database {
  constructor(private readonly raw: D1Database) {}

  statement(sql: string): DatabaseStatement {
    return new Statement(this.raw.prepare(sql));
  }

  batch(statements: DatabaseStatement[]): Promise<D1Result[]> {
    return this.raw.batch(statements.map((statement) => {
      if (!(statement instanceof Statement)) throw new Error('Invalid database statement');
      return statement.toRaw();
    }));
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
