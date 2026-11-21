export interface MigrationRowBudget {
  reads: number;
  writes: number;
  reason?: string;
}
export interface MigrationRowMeasurement {
  name: string;
  reads: number;
  writes: number;
  budget: MigrationRowBudget;
}
export declare const DEFAULT_MIGRATION_ROW_BUDGET: Readonly<MigrationRowBudget>;
export declare const splitSqlStatements: (sql: string) => string[];
export declare const migrationRowBudget: (sql: string) => MigrationRowBudget;
export declare const rowBudgetViolations: (measurements: MigrationRowMeasurement[]) => string[];
export declare const measureMigrationRows: (pending: string[], options?: { directory?: string }) => Promise<MigrationRowMeasurement[]>;
export declare const checkMigrationRowBudget: (pending: string[], options?: { directory?: string }) => Promise<MigrationRowMeasurement[]>;
