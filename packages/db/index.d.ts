export interface QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
  affectedRows?: number;
}

export interface QueryClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<Row>>;
  exec(sql: string): Promise<QueryResult[]>;
}

export interface Database extends QueryClient {
  transaction<Result>(callback: (transaction: QueryClient) => Promise<Result>): Promise<Result>;
  close(): Promise<void>;
}

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
  readonly down: string;
  readonly checksum: string;
}

export function createDatabase(options?: { dataDir?: string }): Promise<Database>;
export function migrateUp(
  database: Database,
  options?: { throughVersion?: number },
): Promise<number[]>;
export function migrateDown(database: Database, options?: { steps?: number }): Promise<number[]>;
export function seedSynthetic(database: Database): Promise<void>;
export function runRetention(
  database: Database,
  options?: {
    auditRetentionDays?: number;
    usageRetentionDays?: number;
    deletedAccountRetentionDays?: number;
    batchLimit?: number;
    timeoutMs?: number;
  },
): Promise<{
  counts: {
    sessions: number;
    oauthStates: number;
    deletionRequests: number;
    users: number;
    auditEvents: number;
    usageEvents: number;
  };
  deferred: string[];
  reason: string;
  elapsedMs: number;
}>;
export const migrations: readonly Migration[];
export const SYNTHETIC_SEED: Readonly<{
  userA: string;
  userB: string;
  provider: string;
  model: string;
  legalVersion: string;
}>;
