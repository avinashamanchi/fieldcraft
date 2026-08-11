import type { SQLiteDatabase } from 'expo-sqlite'

export const DATABASE_SCHEMA_VERSION = 6

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

const VERSION_THREE_SCHEMA = `
  ALTER TABLE sync_bootstrap_records ADD COLUMN change_id INTEGER;

  INSERT INTO metadata (owner_id, key, value)
  SELECT DISTINCT staged.owner_id, 'sync-feed-v2-reconciliation-required', 'true'
  FROM sync_bootstrap_records AS staged
  WHERE true
  ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value;

  DELETE FROM metadata
  WHERE key IN ('initial-cloud-pull-complete', 'sync-feed-v2-terminal-reconciliation-pending')
    AND owner_id IN (SELECT DISTINCT owner_id FROM sync_bootstrap_records);

  DELETE FROM sync_cursors
  WHERE entity = '__all__'
    AND owner_id IN (SELECT DISTINCT owner_id FROM sync_bootstrap_records);

  DELETE FROM sync_bootstrap_records;

  PRAGMA user_version = 3;
`

const VERSION_FOUR_SCHEMA = `
  ALTER TABLE sync_bootstrap_records ADD COLUMN change_seq INTEGER;
  ALTER TABLE conflicts ADD COLUMN cloud_rows_json TEXT;

  CREATE TABLE IF NOT EXISTS sync_server_authority (
    owner_id TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    version INTEGER NOT NULL,
    deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
    updated_at TEXT NOT NULL,
    change_source TEXT NOT NULL
      CHECK (change_source IN ('sync_changes', 'sync_snapshot', 'legacy_receipt')),
    change_seq INTEGER NOT NULL CHECK (change_seq >= 0),
    change_id INTEGER NOT NULL CHECK (change_id >= 0),
    PRIMARY KEY (owner_id, entity, entity_id),
    CHECK (
      (change_source = 'sync_changes' AND change_seq > 0 AND change_id > 0)
      OR (change_source = 'sync_snapshot' AND change_id = 0)
      OR (change_source = 'legacy_receipt' AND change_seq = 0 AND change_id = 0)
    )
  );

  INSERT INTO metadata (owner_id, key, value)
  SELECT owners.owner_id, 'sync-feed-v2-reconciliation-required', 'true'
  FROM (
    SELECT owner_id FROM records
    UNION SELECT owner_id FROM outbox
    UNION SELECT owner_id FROM conflicts
    UNION SELECT owner_id FROM sync_cursors
    UNION SELECT owner_id FROM metadata
    UNION SELECT owner_id FROM sync_bootstrap_records
  ) AS owners
  WHERE true
  ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value;

  UPDATE outbox
  SET state = 'pending', last_error = NULL
  WHERE state = 'conflict';

  DELETE FROM conflicts;

  DELETE FROM metadata
  WHERE key IN ('initial-cloud-pull-complete', 'sync-feed-v2-terminal-reconciliation-pending')
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

  DELETE FROM sync_bootstrap_records;

  PRAGMA user_version = 4;
`

const VERSION_FIVE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS sync_change_events (
    owner_id TEXT NOT NULL,
    change_seq INTEGER NOT NULL CHECK (change_seq > 0),
    change_id INTEGER NOT NULL CHECK (change_id > 0),
    PRIMARY KEY (owner_id, change_seq),
    UNIQUE (owner_id, change_id)
  );

  INSERT INTO sync_change_events (owner_id, change_seq, change_id)
  SELECT owner_id, change_seq, change_id
  FROM sync_server_authority
  WHERE change_source = 'sync_changes';

  PRAGMA user_version = 5;
`

const VERSION_SIX_SCHEMA = `
  CREATE INDEX IF NOT EXISTS records_owner_entity_page_idx
    ON records (owner_id, entity, updated_at DESC, entity_id ASC)
    WHERE deleted = 0;

  CREATE TABLE IF NOT EXISTS quarantined_outbox (
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
    attempts INTEGER NOT NULL CHECK (attempts >= 0),
    reason TEXT NOT NULL
      CHECK (reason IN ('validation', 'unsupported-schema', 'integrity', 'invalid-response', 'attempt-limit')),
    quarantined_at TEXT NOT NULL,
    superseded_by TEXT,
    recovery_history_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recovery_history_json)),
    PRIMARY KEY (owner_id, mutation_id),
    UNIQUE (owner_id, sequence)
  );

  CREATE INDEX IF NOT EXISTS quarantined_outbox_owner_active_idx
    ON quarantined_outbox (owner_id, quarantined_at DESC, mutation_id)
    WHERE superseded_by IS NULL;

  CREATE TABLE IF NOT EXISTS outbox_dependencies (
    owner_id TEXT NOT NULL,
    mutation_id TEXT NOT NULL,
    depends_on_mutation_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (owner_id, mutation_id, depends_on_mutation_id),
    CHECK (mutation_id <> depends_on_mutation_id)
  );

  CREATE INDEX IF NOT EXISTS outbox_dependencies_parent_idx
    ON outbox_dependencies (owner_id, depends_on_mutation_id, mutation_id);

  ALTER TABLE sync_bootstrap_records ADD COLUMN change_source TEXT NOT NULL
    DEFAULT 'sync_changes'
    CHECK (change_source IN ('sync_changes', 'sync_snapshot'));

  PRAGMA user_version = 6;
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
      currentVersion = 2
    }

    if (currentVersion === 2) {
      await transaction.execAsync(VERSION_THREE_SCHEMA)
      currentVersion = 3
    }

    if (currentVersion === 3) {
      await transaction.execAsync(VERSION_FOUR_SCHEMA)
      currentVersion = 4
    }

    if (currentVersion === 4) {
      await transaction.execAsync(VERSION_FIVE_SCHEMA)
      currentVersion = 5
    }

    if (currentVersion === 5) {
      await transaction.execAsync(VERSION_SIX_SCHEMA)
    }
  })
}
