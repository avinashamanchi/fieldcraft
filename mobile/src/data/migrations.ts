import type { SQLiteDatabase } from 'expo-sqlite'

export const DATABASE_SCHEMA_VERSION = 2

type UserVersionRow = { user_version: number }

const VERSION_ONE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS records (
    owner_id TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    version INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (owner_id, entity, entity_id)
  );

  CREATE TABLE IF NOT EXISTS outbox (
    owner_id TEXT NOT NULL,
    mutation_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    base_version INTEGER,
    payload_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'pending'
      CHECK (state IN ('pending', 'syncing', 'failed', 'conflict', 'complete')),
    last_error TEXT,
    PRIMARY KEY (owner_id, mutation_id),
    UNIQUE (owner_id, sequence)
  );

  CREATE TABLE IF NOT EXISTS conflicts (
    owner_id TEXT NOT NULL,
    mutation_id TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    local_payload_json TEXT NOT NULL,
    cloud_payload_json TEXT NOT NULL,
    cloud_version INTEGER NOT NULL,
    PRIMARY KEY (owner_id, mutation_id)
  );

  CREATE TABLE IF NOT EXISTS sync_cursors (
    owner_id TEXT NOT NULL,
    entity TEXT NOT NULL,
    cursor TEXT NOT NULL,
    PRIMARY KEY (owner_id, entity)
  );

  CREATE TABLE IF NOT EXISTS metadata (
    owner_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (owner_id, key)
  );

  PRAGMA user_version = 1;
`

const VERSION_TWO_SCHEMA = `
  CREATE TABLE IF NOT EXISTS sync_bootstrap_records (
    owner_id TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    version INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (owner_id, entity, entity_id)
  );

  INSERT INTO metadata (owner_id, key, value)
  SELECT cursor.owner_id, 'sync-feed-v2-reconciliation-required', 'true'
  FROM sync_cursors AS cursor
  WHERE cursor.entity = '__all__'
    AND CASE
      WHEN json_valid(cursor.cursor) = 0 THEN 1
      WHEN json_type(cursor.cursor, '$.updatedAt') IS NOT 'text' THEN 1
      WHEN json_type(cursor.cursor, '$.changeId') IS NOT 'integer' THEN 1
      ELSE 0
    END = 1
  ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value;

  DELETE FROM metadata
  WHERE key = 'initial-cloud-pull-complete'
    AND owner_id IN (
      SELECT owner_id FROM metadata
      WHERE key = 'sync-feed-v2-reconciliation-required'
    );

  DELETE FROM sync_cursors
  WHERE entity = '__all__'
    AND owner_id IN (
      SELECT owner_id FROM metadata
      WHERE key = 'sync-feed-v2-reconciliation-required'
    );

  PRAGMA user_version = 2;
`

export const applyMigrations = async (database: SQLiteDatabase): Promise<void> => {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const row = await transaction.getFirstAsync<UserVersionRow>('PRAGMA user_version')
    let currentVersion = row?.user_version ?? 0

    if (currentVersion > DATABASE_SCHEMA_VERSION) {
      throw new Error(
        `Database schema ${currentVersion} is newer than supported schema ${DATABASE_SCHEMA_VERSION}`,
      )
    }

    if (currentVersion === 0) {
      await transaction.execAsync(VERSION_ONE_SCHEMA)
      currentVersion = 1
    }

    if (currentVersion === 1) {
      await transaction.execAsync(VERSION_TWO_SCHEMA)
    }
  })
}
