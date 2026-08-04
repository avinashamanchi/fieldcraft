type BindValue = string | number | null

type RecordRow = {
  owner_id: string
  entity: string
  entity_id: string
  payload_json: string
  version: number
  deleted: number
  updated_at: string
}

type BootstrapRecordRow = RecordRow & {
  change_seq?: number
  change_id?: number
}

type ServerAuthorityRow = RecordRow & {
  change_source: string
  change_seq: number
  change_id: number
}

type OutboxRow = {
  owner_id: string
  mutation_id: string
  sequence: number
  entity: string
  entity_id: string
  kind: string
  base_version: number | null
  payload_json: string
  payload_hash: string
  created_at: string
  attempts: number
  state: 'pending' | 'syncing' | 'failed' | 'conflict' | 'complete'
  last_error: string | null
}

type ConflictRow = {
  owner_id: string
  mutation_id: string
  entity: string
  entity_id: string
  local_payload_json: string
  cloud_payload_json: string
  cloud_version: number
  cloud_rows_json: string | null
}

type SyncCursorRow = {
  owner_id: string
  entity: string
  cursor: string
}

export type MockDatabaseState = {
  userVersion: number
  tables: Set<string>
  records: RecordRow[]
  bootstrapRecords: BootstrapRecordRow[]
  serverAuthorities: ServerAuthorityRow[]
  outbox: OutboxRow[]
  conflicts: Record<string, unknown>[]
  syncCursors: Record<string, unknown>[]
  metadata: Record<string, unknown>[]
  failNextOutboxInsert: boolean
  failNextOutboxAcknowledge: boolean
  failNextMigration: boolean
  failNextOwnerClear: boolean
  closeCount: number
  nextReadPause: ReadPause | null
  nextOutboxReadPause: ReadPause | null
  nextMigrationReadPause: ReadPause | null
  nextOwnerClearPause: ReadPause | null
  nextOutboxInsertPause: ReadPause | null
  transactionTail: Promise<void>
}

type ReadPause = {
  started: Promise<void>
  markStarted: () => void
  wait: Promise<void>
  release: () => void
}

const databases = new Map<string, MockDatabaseState>()

const createState = (): MockDatabaseState => ({
  userVersion: 0,
  tables: new Set(),
  records: [],
  bootstrapRecords: [],
  serverAuthorities: [],
  outbox: [],
  conflicts: [],
  syncCursors: [],
  metadata: [],
  failNextOutboxInsert: false,
  failNextOutboxAcknowledge: false,
  failNextMigration: false,
  failNextOwnerClear: false,
  closeCount: 0,
  nextReadPause: null,
  nextOutboxReadPause: null,
  nextMigrationReadPause: null,
  nextOwnerClearPause: null,
  nextOutboxInsertPause: null,
  transactionTail: Promise.resolve(),
})

const copyState = (state: MockDatabaseState): MockDatabaseState => ({
  userVersion: state.userVersion,
  tables: new Set(state.tables),
  records: state.records.map((row) => ({ ...row })),
  bootstrapRecords: state.bootstrapRecords.map((row) => ({ ...row })),
  serverAuthorities: state.serverAuthorities.map((row) => ({ ...row })),
  outbox: state.outbox.map((row) => ({ ...row })),
  conflicts: state.conflicts.map((row) => ({ ...row })),
  syncCursors: state.syncCursors.map((row) => ({ ...row })),
  metadata: state.metadata.map((row) => ({ ...row })),
  failNextOutboxInsert: state.failNextOutboxInsert,
  failNextOutboxAcknowledge: state.failNextOutboxAcknowledge,
  failNextMigration: state.failNextMigration,
  failNextOwnerClear: state.failNextOwnerClear,
  closeCount: state.closeCount,
  nextReadPause: state.nextReadPause,
  nextOutboxReadPause: state.nextOutboxReadPause,
  nextMigrationReadPause: state.nextMigrationReadPause,
  nextOwnerClearPause: state.nextOwnerClearPause,
  nextOutboxInsertPause: state.nextOutboxInsertPause,
  transactionTail: state.transactionTail,
})

const commitState = (target: MockDatabaseState, source: MockDatabaseState): void => {
  target.userVersion = source.userVersion
  target.tables = source.tables
  target.records = source.records
  target.bootstrapRecords = source.bootstrapRecords
  target.serverAuthorities = source.serverAuthorities
  target.outbox = source.outbox
  target.conflicts = source.conflicts
  target.syncCursors = source.syncCursors
  target.metadata = source.metadata
}

const asParams = (params: unknown[]): BindValue[] => {
  if (params.length === 1 && Array.isArray(params[0])) {
    return params[0] as BindValue[]
  }
  return params as BindValue[]
}

const normalizeSql = (source: string): string => source.replace(/\s+/g, ' ').trim().toLowerCase()

const expectedSql = {
  recordsUpsert: normalizeSql(`/* records:upsert */
    INSERT INTO records
      (owner_id, entity, entity_id, payload_json, version, deleted, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, entity, entity_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      version = excluded.version,
      deleted = excluded.deleted,
      updated_at = excluded.updated_at`),
  bootstrapUpsert: normalizeSql(`/* bootstrap:stage:upsert */
    INSERT INTO sync_bootstrap_records
      (owner_id, entity, entity_id, payload_json, version, deleted, updated_at,
       change_seq, change_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, entity, entity_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      version = excluded.version,
      deleted = excluded.deleted,
      updated_at = excluded.updated_at,
      change_seq = excluded.change_seq,
      change_id = excluded.change_id
    WHERE excluded.change_seq >= sync_bootstrap_records.change_seq`),
  authorityUpsert: normalizeSql(`/* server-authority:upsert */
    INSERT INTO sync_server_authority
      (owner_id, entity, entity_id, payload_json, version, deleted, updated_at,
       change_source, change_seq, change_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, entity, entity_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      version = excluded.version,
      deleted = excluded.deleted,
      updated_at = excluded.updated_at,
      change_source = excluded.change_source,
      change_seq = excluded.change_seq,
      change_id = excluded.change_id`),
  outboxInsert: normalizeSql(`/* outbox:insert */
    INSERT INTO outbox
      (owner_id, mutation_id, sequence, entity, entity_id, kind, base_version,
       payload_json, payload_hash, created_at, attempts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  conflictUpsert: normalizeSql(`/* conflicts:upsert */
    INSERT INTO conflicts
      (owner_id, mutation_id, entity, entity_id, local_payload_json,
       cloud_payload_json, cloud_version, cloud_rows_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, mutation_id) DO UPDATE SET
      entity = excluded.entity,
      entity_id = excluded.entity_id,
      local_payload_json = excluded.local_payload_json,
      cloud_payload_json = excluded.cloud_payload_json,
      cloud_version = excluded.cloud_version,
      cloud_rows_json = excluded.cloud_rows_json`),
  cursorUpsert: normalizeSql(`/* sync-cursors:upsert */
    INSERT INTO sync_cursors (owner_id, entity, cursor)
    VALUES (?, ?, ?)
    ON CONFLICT(owner_id, entity) DO UPDATE SET cursor = excluded.cursor`),
  outboxAcknowledge: normalizeSql(`/* outbox:acknowledge */
    UPDATE outbox SET state = 'complete', last_error = NULL
    WHERE owner_id = ? AND mutation_id = ?
      AND state IN ('pending', 'failed', 'syncing')`),
  outboxFailure: normalizeSql(`/* outbox:failure */
    UPDATE outbox
    SET state = 'failed', attempts = attempts + 1, last_error = ?
    WHERE owner_id = ? AND mutation_id = ?
      AND state IN ('pending', 'failed', 'syncing', 'conflict')`),
  outboxConflict: normalizeSql(`/* outbox:conflict */
    UPDATE outbox SET state = 'conflict', last_error = NULL
    WHERE owner_id = ? AND mutation_id = ?
      AND state IN ('pending', 'failed', 'syncing')`),
  outboxResolve: normalizeSql(`/* outbox:resolve */
    UPDATE outbox SET state = 'complete', last_error = NULL
    WHERE owner_id = ? AND mutation_id = ? AND state = 'conflict'`),
  conflictDelete: '/* conflicts:delete */ delete from conflicts where owner_id = ? and mutation_id = ?',
  recordsClear: '/* owner:clear:records */ delete from records where owner_id = ?',
  outboxClear: '/* owner:clear:outbox */ delete from outbox where owner_id = ?',
  conflictsClear: '/* owner:clear:conflicts */ delete from conflicts where owner_id = ?',
  cursorsClear: '/* owner:clear:sync_cursors */ delete from sync_cursors where owner_id = ?',
  metadataClear: '/* owner:clear:metadata */ delete from metadata where owner_id = ?',
  bootstrapClear: '/* owner:clear:sync_bootstrap_records */ delete from sync_bootstrap_records where owner_id = ?',
  authorityClear: '/* owner:clear:sync_server_authority */ delete from sync_server_authority where owner_id = ?',
  bootstrapRecordDelete: normalizeSql(`/* bootstrap:records:delete */
    DELETE FROM records WHERE owner_id = ? AND entity = ? AND entity_id = ?`),
  bootstrapStageClear: '/* bootstrap:stage:clear */ delete from sync_bootstrap_records where owner_id = ?',
  bootstrapStageDeleteKey: normalizeSql(`/* bootstrap:stage:delete-key */
    DELETE FROM sync_bootstrap_records
    WHERE owner_id = ? AND entity = ? AND entity_id = ?`),
  reconciliationTerminalUpsert: normalizeSql(`/* metadata:reconciliation-terminal:upsert */
    INSERT INTO metadata (owner_id, key, value)
    VALUES (?, ?, ?)
    ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value`),
  reconciliationSchedule: normalizeSql(`/* metadata:reconciliation:schedule */
    INSERT INTO metadata (owner_id, key, value)
    VALUES (?, ?, ?)
    ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value`),
  initialPullDelete: normalizeSql(`/* metadata:initial-pull:delete */
    DELETE FROM metadata WHERE owner_id = ? AND key = ?`),
  bootstrapCursorReset: normalizeSql(`/* sync-cursors:bootstrap-reset */
    DELETE FROM sync_cursors WHERE owner_id = ? AND entity = ?`),
  reconciliationTerminalDelete: '/* metadata:reconciliation-terminal:delete */ delete from metadata where owner_id = ? and key = ?',
  reconciliationDelete: '/* metadata:reconciliation:delete */ delete from metadata where owner_id = ? and key = ?',
  recordsGet: normalizeSql(`/* records:get */
    SELECT entity_id, payload_json FROM records
    WHERE owner_id = ? AND entity = ? AND entity_id = ? AND deleted = 0`),
  duplicate: normalizeSql(`/* outbox:duplicate */
    SELECT payload_hash FROM outbox WHERE owner_id = ? AND mutation_id = ?`),
  nextSequence: normalizeSql(`/* outbox:next-sequence */
    SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
    FROM outbox WHERE owner_id = ?`),
  recordsList: normalizeSql(`/* records:list */
    SELECT entity_id, payload_json FROM records
    WHERE owner_id = ? AND entity = ? AND deleted = 0
    ORDER BY updated_at DESC, entity_id ASC`),
  outboxList: normalizeSql(`/* outbox:list */
    SELECT owner_id, mutation_id, entity, entity_id, kind, base_version,
           payload_json, payload_hash, created_at, attempts, last_error
    FROM outbox
    WHERE owner_id = ? AND state IN ('pending', 'failed')
    ORDER BY sequence ASC`),
  cursorGet: normalizeSql(`/* sync-cursors:get */
    SELECT cursor FROM sync_cursors WHERE owner_id = ? AND entity = ?`),
  conflictGet: normalizeSql(`/* conflicts:get */
    SELECT conflict.mutation_id, outbox.kind AS mutation_kind,
           conflict.entity, conflict.entity_id, conflict.local_payload_json,
           conflict.cloud_payload_json, conflict.cloud_version, conflict.cloud_rows_json
    FROM conflicts AS conflict
    INNER JOIN outbox AS outbox
      ON outbox.owner_id = conflict.owner_id
     AND outbox.mutation_id = conflict.mutation_id
    WHERE conflict.owner_id = ? AND conflict.mutation_id = ?`),
  conflictCount: normalizeSql(`/* conflicts:count */
    SELECT COUNT(*) AS count FROM conflicts WHERE owner_id = ?`),
  initialPullUpsert: normalizeSql(`/* metadata:initial-pull:upsert */
    INSERT INTO metadata (owner_id, key, value)
    VALUES (?, ?, ?)
    ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value`),
  initialPullGet: normalizeSql(`/* metadata:initial-pull:get */
    SELECT value FROM metadata WHERE owner_id = ? AND key = ?`),
  reconciliationGet: normalizeSql(`/* metadata:reconciliation:get */
    SELECT value FROM metadata WHERE owner_id = ? AND key = ?`),
  reconciliationTerminalGet: normalizeSql(`/* metadata:reconciliation-terminal:get */
    SELECT value FROM metadata WHERE owner_id = ? AND key = ?`),
  acknowledgementSequence: normalizeSql(`/* outbox:acknowledgement-sequence */
    SELECT sequence FROM outbox
    WHERE owner_id = ? AND mutation_id = ? AND state <> 'complete'`),
  legacyFeedRepairMutation: normalizeSql(`/* outbox:legacy-feed-repair:get */
    SELECT entity, kind FROM outbox
    WHERE owner_id = ? AND mutation_id = ? AND state <> 'complete'`),
  laterLocalIntents: normalizeSql(`/* outbox:later-local-intents */
    SELECT sequence, mutation_id, entity, entity_id, kind, base_version,
           payload_json, created_at, attempts, payload_hash
    FROM outbox
    WHERE owner_id = ? AND sequence > ? AND state <> 'complete'
    ORDER BY sequence ASC`),
  allLocalIntents: normalizeSql(`/* outbox:all-local-intents */
    SELECT sequence, mutation_id, entity, entity_id, kind, base_version,
           payload_json, created_at, attempts, payload_hash
    FROM outbox
    WHERE owner_id = ? AND state <> 'complete'
    ORDER BY sequence ASC`),
  authorityGet: normalizeSql(`/* server-authority:get */
    SELECT owner_id, entity, entity_id, payload_json, version, deleted,
           updated_at, change_source, change_seq, change_id
    FROM sync_server_authority
    WHERE owner_id = ? AND entity = ? AND entity_id = ?`),
  authorityList: normalizeSql(`/* server-authority:list */
    SELECT owner_id, entity, entity_id, payload_json, version, deleted,
           updated_at, change_source, change_seq, change_id
    FROM sync_server_authority
    WHERE owner_id = ?`),
  localIntentSnapshots: normalizeSql(`/* records:local-intent-snapshots */
    SELECT entity, entity_id, payload_json, version, deleted, updated_at
    FROM records
    WHERE owner_id = ?`),
  bootstrapOutboxList: normalizeSql(`/* bootstrap:outbox:list */
    SELECT entity, entity_id, kind, payload_json
    FROM outbox
    WHERE owner_id = ? AND state <> 'complete'`),
  bootstrapRecordsList: normalizeSql(`/* bootstrap:records:list */
    SELECT entity, entity_id, payload_json, version, deleted, updated_at, change_seq, change_id
    FROM sync_bootstrap_records
    WHERE owner_id = ?`),
  bootstrapCurrentList: normalizeSql(`/* bootstrap:current:list */
    SELECT entity, entity_id FROM records WHERE owner_id = ?`),
} as const

const assertSql = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(`Invalid mock SQL: ${message}`)
}

const requireExactSql = (actual: string, expected: string, operation: string): void => {
  assertSql(actual === expected, `${operation} must match its complete supported statement`)
}

const requireOwnerPredicate = (sql: string): void => {
  assertSql(!/\bor\b/.test(sql), 'owner predicate boolean OR is not supported')
  assertSql(/\bowner_id\s*=\s*\?/.test(sql), 'query must include owner_id = ?')
}

class MockSQLiteDatabase {
  constructor(
    private readonly state: MockDatabaseState,
    private readonly control: MockDatabaseState = state,
  ) {}

  async closeAsync(): Promise<void> {
    this.control.closeCount += 1
  }

  async execAsync(source: string): Promise<void> {
    const sql = normalizeSql(source)
    if (sql.includes('create table if not exists records')) {
      for (const constraint of [
        'primary key (owner_id, entity, entity_id)',
        'primary key (owner_id, mutation_id)',
        'unique (owner_id, sequence)',
        'primary key (owner_id, entity)',
        'primary key (owner_id, key)',
      ]) {
        assertSql(sql.includes(constraint), `schema constraint must be owner-scoped: ${constraint}`)
      }
    }
    if (this.control.failNextMigration && source.includes('CREATE TABLE IF NOT EXISTS records')) {
      this.control.failNextMigration = false
      this.state.tables.add('records')
      throw new Error('simulated migration failure')
    }
    if (source.includes('CREATE TABLE IF NOT EXISTS sync_bootstrap_records')) {
      const legacyOwners = new Set<string>()
      for (const cursor of this.state.syncCursors as unknown as SyncCursorRow[]) {
        if (cursor.entity !== '__all__') continue
        try {
          const parsed = JSON.parse(cursor.cursor) as { updatedAt?: unknown; changeId?: unknown }
          if (typeof parsed.updatedAt !== 'string' || !Number.isInteger(parsed.changeId)) {
            legacyOwners.add(cursor.owner_id)
          }
        } catch {
          legacyOwners.add(cursor.owner_id)
        }
      }
      for (const ownerId of legacyOwners) {
        const marker = {
          owner_id: ownerId,
          key: 'sync-feed-v2-reconciliation-required',
          value: 'true',
        }
        const markerIndex = this.state.metadata.findIndex(
          (row) => row.owner_id === ownerId && row.key === marker.key,
        )
        if (markerIndex === -1) this.state.metadata.push(marker)
        else this.state.metadata[markerIndex] = marker
      }
      this.state.metadata = this.state.metadata.filter(
        (row) => row.key !== 'initial-cloud-pull-complete' || !legacyOwners.has(String(row.owner_id)),
      )
      this.state.syncCursors = this.state.syncCursors.filter(
        (row) => row.entity !== '__all__' || !legacyOwners.has(String(row.owner_id)),
      )
    }
    if (source.includes('ALTER TABLE sync_bootstrap_records ADD COLUMN change_id')) {
      const ambiguousOwners = new Set(this.state.bootstrapRecords.map((row) => row.owner_id))
      for (const ownerId of ambiguousOwners) {
        const marker = {
          owner_id: ownerId,
          key: 'sync-feed-v2-reconciliation-required',
          value: 'true',
        }
        const markerIndex = this.state.metadata.findIndex(
          (row) => row.owner_id === ownerId && row.key === marker.key,
        )
        if (markerIndex === -1) this.state.metadata.push(marker)
        else this.state.metadata[markerIndex] = marker
      }
      this.state.metadata = this.state.metadata.filter((row) => (
        !ambiguousOwners.has(String(row.owner_id)) ||
        !['initial-cloud-pull-complete', 'sync-feed-v2-terminal-reconciliation-pending'].includes(String(row.key))
      ))
      this.state.syncCursors = this.state.syncCursors.filter((row) => (
        row.entity !== '__all__' || !ambiguousOwners.has(String(row.owner_id))
      ))
      this.state.bootstrapRecords = []
    }
    if (source.includes('ALTER TABLE sync_bootstrap_records ADD COLUMN change_seq')) {
      const reconciliationOwners = new Set<string>()
      for (const rows of [
        this.state.records,
        this.state.outbox,
        this.state.conflicts,
        this.state.syncCursors,
        this.state.metadata,
        this.state.bootstrapRecords,
      ]) {
        for (const row of rows) reconciliationOwners.add(String(row.owner_id))
      }
      for (const ownerId of reconciliationOwners) {
        const marker = {
          owner_id: ownerId,
          key: 'sync-feed-v2-reconciliation-required',
          value: 'true',
        }
        const markerIndex = this.state.metadata.findIndex(
          (row) => row.owner_id === ownerId && row.key === marker.key,
        )
        if (markerIndex === -1) this.state.metadata.push(marker)
        else this.state.metadata[markerIndex] = marker
      }
      this.state.outbox = this.state.outbox.map((row) => row.state === 'conflict'
        ? { ...row, state: 'pending', last_error: null }
        : row)
      this.state.conflicts = []
      this.state.metadata = this.state.metadata.filter((row) => (
        !reconciliationOwners.has(String(row.owner_id)) ||
        !['initial-cloud-pull-complete', 'sync-feed-v2-terminal-reconciliation-pending'].includes(String(row.key))
      ))
      this.state.syncCursors = this.state.syncCursors.filter((row) => (
        row.entity !== '__all__' || !reconciliationOwners.has(String(row.owner_id))
      ))
      this.state.bootstrapRecords = []
    }
    for (const match of source.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi)) {
      this.state.tables.add(match[1])
    }
    const version = source.match(/PRAGMA\s+user_version\s*=\s*(\d+)/i)
    if (version) {
      this.state.userVersion = Number(version[1])
    }
    assertSql(
      sql.includes('create table if not exists records') ||
        sql.includes('create table if not exists sync_bootstrap_records') ||
        sql.includes('create table if not exists sync_server_authority') ||
        sql.includes('alter table sync_bootstrap_records add column change_id') ||
        sql.includes('alter table sync_bootstrap_records add column change_seq') ||
        /^pragma\s+user_version/.test(sql),
      'unsupported execAsync statement',
    )
  }

  async withExclusiveTransactionAsync(
    task: (transaction: MockSQLiteDatabase) => Promise<void>,
  ): Promise<void> {
    let release = () => {}
    const previous = this.control.transactionTail
    this.control.transactionTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    const transactionState = copyState(this.control)
    try {
      await task(new MockSQLiteDatabase(transactionState, this.control))
      commitState(this.control, transactionState)
    } finally {
      release()
    }
  }

  async runAsync(source: string, ...rawParams: unknown[]): Promise<{ changes: number; lastInsertRowId: number }> {
    const params = asParams(rawParams)
    const sql = normalizeSql(source)
    if (source.includes('bootstrap:stage:upsert')) {
      requireExactSql(sql, expectedSql.bootstrapUpsert, 'bootstrap stage upsert')
      const row: BootstrapRecordRow = {
        owner_id: String(params[0]),
        entity: String(params[1]),
        entity_id: String(params[2]),
        payload_json: String(params[3]),
        version: Number(params[4]),
        deleted: Number(params[5]),
        updated_at: String(params[6]),
        change_seq: Number(params[7]),
        change_id: Number(params[8]),
      }
      const index = this.state.bootstrapRecords.findIndex(
        (candidate) => candidate.owner_id === row.owner_id &&
          candidate.entity === row.entity && candidate.entity_id === row.entity_id,
      )
      if (index === -1) {
        this.state.bootstrapRecords.push(row)
        return { changes: 1, lastInsertRowId: 0 }
      }
      const existing = this.state.bootstrapRecords[index]
      const isAtLeastAsNew = row.change_seq! >= (existing.change_seq ?? -1)
      if (isAtLeastAsNew) this.state.bootstrapRecords[index] = row
      return { changes: isAtLeastAsNew ? 1 : 0, lastInsertRowId: 0 }
    }
    if (source.includes('server-authority:upsert')) {
      requireExactSql(sql, expectedSql.authorityUpsert, 'server authority upsert')
      const row: ServerAuthorityRow = {
        owner_id: String(params[0]),
        entity: String(params[1]),
        entity_id: String(params[2]),
        payload_json: String(params[3]),
        version: Number(params[4]),
        deleted: Number(params[5]),
        updated_at: String(params[6]),
        change_source: String(params[7]),
        change_seq: Number(params[8]),
        change_id: Number(params[9]),
      }
      const index = this.state.serverAuthorities.findIndex(
        (candidate) => candidate.owner_id === row.owner_id &&
          candidate.entity === row.entity && candidate.entity_id === row.entity_id,
      )
      if (index === -1) this.state.serverAuthorities.push(row)
      else this.state.serverAuthorities[index] = row
      return { changes: 1, lastInsertRowId: 0 }
    }
    if (source.includes('records:upsert')) {
      requireExactSql(sql, expectedSql.recordsUpsert, 'records upsert')
      assertSql(sql.includes('insert into records'), 'records upsert must insert into records')
      assertSql(
        /on conflict\s*\(owner_id,\s*entity,\s*entity_id\)/.test(sql),
        'records upsert conflict key must be owner scoped',
      )
      assertSql(params.length === 7 && String(params[0]).length > 0, 'records upsert parameters')
      const row: RecordRow = {
        owner_id: String(params[0]),
        entity: String(params[1]),
        entity_id: String(params[2]),
        payload_json: String(params[3]),
        version: Number(params[4]),
        deleted: Number(params[5]),
        updated_at: String(params[6]),
      }
      const index = this.state.records.findIndex(
        (candidate) =>
          candidate.owner_id === row.owner_id &&
          candidate.entity === row.entity &&
          candidate.entity_id === row.entity_id,
      )
      if (index === -1) this.state.records.push(row)
      else this.state.records[index] = row
      return { changes: 1, lastInsertRowId: 0 }
    }
    if (source.includes('outbox:insert')) {
      requireExactSql(sql, expectedSql.outboxInsert, 'outbox insert')
      assertSql(sql.includes('insert into outbox'), 'outbox insert must insert into outbox')
      assertSql(
        sql.includes('(owner_id, mutation_id, sequence, entity, entity_id, kind, base_version,'),
        'outbox insert must include owner-scoped key columns',
      )
      assertSql(params.length === 11 && String(params[0]).length > 0, 'outbox insert parameters')
      const pause = this.control.nextOutboxInsertPause
      if (pause) {
        this.control.nextOutboxInsertPause = null
        pause.markStarted()
        await pause.wait
      }
      if (this.control.failNextOutboxInsert) {
        this.control.failNextOutboxInsert = false
        throw new Error('simulated outbox insertion failure')
      }
      const row: OutboxRow = {
        owner_id: String(params[0]),
        mutation_id: String(params[1]),
        sequence: Number(params[2]),
        entity: String(params[3]),
        entity_id: String(params[4]),
        kind: String(params[5]),
        base_version: params[6] === null ? null : Number(params[6]),
        payload_json: String(params[7]),
        payload_hash: String(params[8]),
        created_at: String(params[9]),
        attempts: Number(params[10]),
        state: 'pending',
        last_error: null,
      }
      if (
        this.state.outbox.some(
          (candidate) =>
            candidate.owner_id === row.owner_id && candidate.mutation_id === row.mutation_id,
        )
      ) {
        throw new Error('UNIQUE constraint failed: outbox.owner_id, outbox.mutation_id')
      }
      if (
        this.state.outbox.some(
          (candidate) =>
            candidate.owner_id === row.owner_id && candidate.sequence === row.sequence,
        )
      ) {
        throw new Error('UNIQUE sequence constraint failed: outbox.owner_id, outbox.sequence')
      }
      this.state.outbox.push(row)
      return { changes: 1, lastInsertRowId: row.sequence }
    }
    if (source.includes('conflicts:upsert')) {
      requireExactSql(sql, expectedSql.conflictUpsert, 'conflict upsert')
      assertSql(sql.includes('insert into conflicts'), 'conflict upsert must insert into conflicts')
      assertSql(
        /on conflict\s*\(owner_id,\s*mutation_id\)/.test(sql),
        'conflict upsert key must be owner scoped',
      )
      assertSql(String(params[0]).length > 0, 'conflict owner parameter')
      const row: ConflictRow = {
        owner_id: String(params[0]),
        mutation_id: String(params[1]),
        entity: String(params[2]),
        entity_id: String(params[3]),
        local_payload_json: String(params[4]),
        cloud_payload_json: String(params[5]),
        cloud_version: Number(params[6]),
        cloud_rows_json: String(params[7]),
      }
      const conflicts = this.state.conflicts as unknown as ConflictRow[]
      const index = conflicts.findIndex(
        (candidate) => candidate.owner_id === row.owner_id && candidate.mutation_id === row.mutation_id,
      )
      if (index === -1) conflicts.push(row)
      else conflicts[index] = row
      return { changes: 1, lastInsertRowId: 0 }
    }
    if (source.includes('sync-cursors:upsert')) {
      requireExactSql(sql, expectedSql.cursorUpsert, 'sync cursor upsert')
      const row: SyncCursorRow = {
        owner_id: String(params[0]),
        entity: String(params[1]),
        cursor: String(params[2]),
      }
      const syncCursors = this.state.syncCursors as unknown as SyncCursorRow[]
      const index = syncCursors.findIndex(
        (candidate) => candidate.owner_id === row.owner_id && candidate.entity === row.entity,
      )
      if (index === -1) syncCursors.push(row)
      else syncCursors[index] = row
      return { changes: 1, lastInsertRowId: 0 }
    }
    if (source.includes('metadata:initial-pull:upsert')) {
      requireExactSql(sql, expectedSql.initialPullUpsert, 'initial pull metadata upsert')
      const row = { owner_id: params[0], key: params[1], value: params[2] }
      const index = this.state.metadata.findIndex(
        (item) => item.owner_id === params[0] && item.key === params[1],
      )
      if (index === -1) this.state.metadata.push(row)
      else this.state.metadata[index] = row
      return { changes: 1, lastInsertRowId: 0 }
    }
    if (source.includes('metadata:reconciliation-terminal:upsert')) {
      requireExactSql(sql, expectedSql.reconciliationTerminalUpsert, 'terminal reconciliation metadata upsert')
      const row = { owner_id: params[0], key: params[1], value: params[2] }
      const index = this.state.metadata.findIndex(
        (item) => item.owner_id === params[0] && item.key === params[1],
      )
      if (index === -1) this.state.metadata.push(row)
      else this.state.metadata[index] = row
      return { changes: 1, lastInsertRowId: 0 }
    }
    if (source.includes('metadata:reconciliation:schedule')) {
      requireExactSql(sql, expectedSql.reconciliationSchedule, 'bootstrap reconciliation schedule')
      const row = { owner_id: params[0], key: params[1], value: params[2] }
      const index = this.state.metadata.findIndex(
        (item) => item.owner_id === params[0] && item.key === params[1],
      )
      if (index === -1) this.state.metadata.push(row)
      else this.state.metadata[index] = row
      return { changes: 1, lastInsertRowId: 0 }
    }
    if (source.includes('metadata:initial-pull:delete')) {
      requireExactSql(sql, expectedSql.initialPullDelete, 'initial pull metadata delete')
      requireOwnerPredicate(sql)
      const before = this.state.metadata.length
      this.state.metadata = this.state.metadata.filter(
        (row) => !(row.owner_id === params[0] && row.key === params[1]),
      )
      return { changes: before - this.state.metadata.length, lastInsertRowId: 0 }
    }
    if (source.includes('sync-cursors:bootstrap-reset')) {
      requireExactSql(sql, expectedSql.bootstrapCursorReset, 'bootstrap cursor reset')
      requireOwnerPredicate(sql)
      const before = this.state.syncCursors.length
      this.state.syncCursors = this.state.syncCursors.filter(
        (row) => !(row.owner_id === params[0] && row.entity === params[1]),
      )
      return { changes: before - this.state.syncCursors.length, lastInsertRowId: 0 }
    }
    if (source.includes('outbox:acknowledge')) {
      requireExactSql(sql, expectedSql.outboxAcknowledge, 'outbox acknowledgement')
      requireOwnerPredicate(sql)
      if (this.control.failNextOutboxAcknowledge) {
        this.control.failNextOutboxAcknowledge = false
        throw new Error('simulated acknowledgement failure')
      }
      const row = this.state.outbox.find(
        (candidate) =>
          candidate.owner_id === params[0] &&
          candidate.mutation_id === params[1] &&
          ['pending', 'failed', 'syncing', 'conflict'].includes(candidate.state),
      )
      if (!row) return { changes: 0, lastInsertRowId: 0 }
      row.state = 'complete'
      row.last_error = null
      return { changes: 1, lastInsertRowId: 0 }
    }
    if (source.includes('outbox:failure')) {
      requireExactSql(sql, expectedSql.outboxFailure, 'outbox failure')
      requireOwnerPredicate(sql)
      const row = this.state.outbox.find(
        (candidate) =>
          candidate.owner_id === params[1] &&
          candidate.mutation_id === params[2] &&
          ['pending', 'failed', 'syncing'].includes(candidate.state),
      )
      if (!row) return { changes: 0, lastInsertRowId: 0 }
      row.state = 'failed'
      row.attempts += 1
      row.last_error = String(params[0])
      return { changes: 1, lastInsertRowId: 0 }
    }
    if (source.includes('outbox:conflict')) {
      requireExactSql(sql, expectedSql.outboxConflict, 'outbox conflict')
      requireOwnerPredicate(sql)
      const row = this.state.outbox.find(
        (candidate) =>
          candidate.owner_id === params[0] &&
          candidate.mutation_id === params[1] &&
          ['pending', 'failed', 'syncing'].includes(candidate.state),
      )
      if (!row) return { changes: 0, lastInsertRowId: 0 }
      row.state = 'conflict'
      row.last_error = null
      return { changes: 1, lastInsertRowId: 0 }
    }
    if (source.includes('outbox:resolve')) {
      requireExactSql(sql, expectedSql.outboxResolve, 'outbox conflict resolution')
      requireOwnerPredicate(sql)
      const row = this.state.outbox.find(
        (candidate) =>
          candidate.owner_id === params[0] &&
          candidate.mutation_id === params[1] &&
          candidate.state === 'conflict',
      )
      if (!row) return { changes: 0, lastInsertRowId: 0 }
      row.state = 'complete'
      row.last_error = null
      return { changes: 1, lastInsertRowId: 0 }
    }
    if (source.includes('conflicts:delete')) {
      requireExactSql(sql, expectedSql.conflictDelete, 'conflict delete')
      requireOwnerPredicate(sql)
      const before = this.state.conflicts.length
      this.state.conflicts = (this.state.conflicts as unknown as ConflictRow[]).filter(
        (row) => row.owner_id !== params[0] || row.mutation_id !== params[1],
      )
      return { changes: before - this.state.conflicts.length, lastInsertRowId: 0 }
    }
    if (source.includes('owner:clear:records')) {
      requireExactSql(sql, expectedSql.recordsClear, 'records clear')
      assertSql(/^\/\* owner:clear:records \*\/ delete from records where owner_id = \?$/.test(sql), 'records clear SQL')
      const pause = this.control.nextOwnerClearPause
      if (pause) {
        this.control.nextOwnerClearPause = null
        pause.markStarted()
        await pause.wait
      }
      const before = this.state.records.length
      this.state.records = this.state.records.filter((row) => row.owner_id !== params[0])
      return { changes: before - this.state.records.length, lastInsertRowId: 0 }
    }
    if (source.includes('owner:clear:outbox')) {
      requireExactSql(sql, expectedSql.outboxClear, 'outbox clear')
      assertSql(/^\/\* owner:clear:outbox \*\/ delete from outbox where owner_id = \?$/.test(sql), 'outbox clear SQL')
      if (this.control.failNextOwnerClear) {
        this.control.failNextOwnerClear = false
        throw new Error('simulated owner clear failure')
      }
      const before = this.state.outbox.length
      this.state.outbox = this.state.outbox.filter((row) => row.owner_id !== params[0])
      return { changes: before - this.state.outbox.length, lastInsertRowId: 0 }
    }
    if (source.includes('owner:clear:conflicts')) {
      requireExactSql(sql, expectedSql.conflictsClear, 'conflicts clear')
      assertSql(/^\/\* owner:clear:conflicts \*\/ delete from conflicts where owner_id = \?$/.test(sql), 'conflicts clear SQL')
      requireOwnerPredicate(sql)
      this.state.conflicts = this.state.conflicts.filter((row) => row.owner_id !== params[0])
      return { changes: 1, lastInsertRowId: 0 }
    }
    if (source.includes('owner:clear:sync_cursors')) {
      requireExactSql(sql, expectedSql.cursorsClear, 'sync cursor clear')
      assertSql(/^\/\* owner:clear:sync_cursors \*\/ delete from sync_cursors where owner_id = \?$/.test(sql), 'sync cursor clear SQL')
      requireOwnerPredicate(sql)
      this.state.syncCursors = this.state.syncCursors.filter((row) => row.owner_id !== params[0])
      return { changes: 1, lastInsertRowId: 0 }
    }
    if (source.includes('owner:clear:metadata')) {
      requireExactSql(sql, expectedSql.metadataClear, 'metadata clear')
      assertSql(/^\/\* owner:clear:metadata \*\/ delete from metadata where owner_id = \?$/.test(sql), 'metadata clear SQL')
      requireOwnerPredicate(sql)
      this.state.metadata = this.state.metadata.filter((row) => row.owner_id !== params[0])
      return { changes: 1, lastInsertRowId: 0 }
    }
    if (source.includes('owner:clear:sync_bootstrap_records')) {
      requireExactSql(sql, expectedSql.bootstrapClear, 'bootstrap owner clear')
      requireOwnerPredicate(sql)
      const before = this.state.bootstrapRecords.length
      this.state.bootstrapRecords = this.state.bootstrapRecords.filter((row) => row.owner_id !== params[0])
      return { changes: before - this.state.bootstrapRecords.length, lastInsertRowId: 0 }
    }
    if (source.includes('owner:clear:sync_server_authority')) {
      requireExactSql(sql, expectedSql.authorityClear, 'server authority owner clear')
      requireOwnerPredicate(sql)
      const before = this.state.serverAuthorities.length
      this.state.serverAuthorities = this.state.serverAuthorities.filter(
        (row) => row.owner_id !== params[0],
      )
      return { changes: before - this.state.serverAuthorities.length, lastInsertRowId: 0 }
    }
    if (source.includes('bootstrap:records:delete')) {
      requireExactSql(sql, expectedSql.bootstrapRecordDelete, 'bootstrap record delete')
      requireOwnerPredicate(sql)
      const before = this.state.records.length
      this.state.records = this.state.records.filter(
        (row) => row.owner_id !== params[0] || row.entity !== params[1] || row.entity_id !== params[2],
      )
      return { changes: before - this.state.records.length, lastInsertRowId: 0 }
    }
    if (source.includes('bootstrap:stage:clear')) {
      requireExactSql(sql, expectedSql.bootstrapStageClear, 'bootstrap stage clear')
      requireOwnerPredicate(sql)
      const before = this.state.bootstrapRecords.length
      this.state.bootstrapRecords = this.state.bootstrapRecords.filter((row) => row.owner_id !== params[0])
      return { changes: before - this.state.bootstrapRecords.length, lastInsertRowId: 0 }
    }
    if (source.includes('bootstrap:stage:delete-key')) {
      requireExactSql(sql, expectedSql.bootstrapStageDeleteKey, 'bootstrap stage key delete')
      requireOwnerPredicate(sql)
      const before = this.state.bootstrapRecords.length
      this.state.bootstrapRecords = this.state.bootstrapRecords.filter((row) => !(
        row.owner_id === params[0] && row.entity === params[1] && row.entity_id === params[2]
      ))
      return { changes: before - this.state.bootstrapRecords.length, lastInsertRowId: 0 }
    }
    if (source.includes('metadata:reconciliation-terminal:delete')) {
      requireExactSql(sql, expectedSql.reconciliationTerminalDelete, 'terminal reconciliation metadata delete')
      requireOwnerPredicate(sql)
      const before = this.state.metadata.length
      this.state.metadata = this.state.metadata.filter(
        (row) => !(row.owner_id === params[0] && row.key === params[1]),
      )
      return { changes: before - this.state.metadata.length, lastInsertRowId: 0 }
    }
    if (source.includes('metadata:reconciliation:delete')) {
      requireExactSql(sql, expectedSql.reconciliationDelete, 'reconciliation metadata delete')
      requireOwnerPredicate(sql)
      const before = this.state.metadata.length
      this.state.metadata = this.state.metadata.filter(
        (row) => row.owner_id !== params[0] || row.key !== params[1],
      )
      return { changes: before - this.state.metadata.length, lastInsertRowId: 0 }
    }
    throw new Error(`Unsupported mock runAsync SQL: ${source}`)
  }

  async getFirstAsync<T>(source: string, ...rawParams: unknown[]): Promise<T | null> {
    const params = asParams(rawParams)
    const sql = normalizeSql(source)
    if (/PRAGMA\s+user_version/i.test(source)) {
      requireExactSql(sql, 'pragma user_version', 'user version read')
      const pause = this.control.nextMigrationReadPause
      if (pause) {
        this.control.nextMigrationReadPause = null
        pause.markStarted()
        await pause.wait
      }
      return { user_version: this.state.userVersion } as T
    }
    if (source.includes('records:get')) {
      requireExactSql(sql, expectedSql.recordsGet, 'records get')
      requireOwnerPredicate(sql)
      assertSql(
        /where owner_id = \? and entity = \? and entity_id = \? and deleted = 0$/.test(sql),
        'records get WHERE clause and parameter order',
      )
      assertSql(sql.includes('from records'), 'records get must query records')
      assertSql(sql.includes('entity = ?'), 'records get must include entity = ?')
      assertSql(sql.includes('deleted = 0'), 'records get must exclude tombstones')
      assertSql(sql.includes('entity_id = ?'), 'records get must include entity_id = ?')
      assertSql(sql.includes('select entity_id, payload_json'), 'records get must select storage key')
      const row = this.state.records.find(
        (candidate) =>
          candidate.owner_id === params[0] &&
          candidate.entity === params[1] &&
          candidate.entity_id === params[2] &&
          candidate.deleted === 0,
      )
      return (row ? { ...row } : null) as T | null
    }
    if (source.includes('server-authority:get')) {
      requireExactSql(sql, expectedSql.authorityGet, 'server authority get')
      requireOwnerPredicate(sql)
      const row = this.state.serverAuthorities.find(
        (candidate) => candidate.owner_id === params[0] &&
          candidate.entity === params[1] && candidate.entity_id === params[2],
      )
      return (row ? { ...row } : null) as T | null
    }
    if (source.includes('outbox:duplicate')) {
      requireExactSql(sql, expectedSql.duplicate, 'duplicate lookup')
      requireOwnerPredicate(sql)
      assertSql(
        /from outbox where owner_id = \? and mutation_id = \?$/.test(sql),
        'duplicate query WHERE clause and parameter order',
      )
      assertSql(sql.includes('select payload_hash from outbox'), 'duplicate query must read outbox hash')
      assertSql(sql.includes('mutation_id = ?'), 'duplicate query mutation ID')
      const row = this.state.outbox.find(
        (candidate) => candidate.owner_id === params[0] && candidate.mutation_id === params[1],
      )
      return (row ? { payload_hash: row.payload_hash } : null) as T | null
    }
    if (source.includes('outbox:next-sequence')) {
      requireExactSql(sql, expectedSql.nextSequence, 'next sequence lookup')
      requireOwnerPredicate(sql)
      assertSql(
        /from outbox where owner_id = \?$/.test(sql),
        'sequence query WHERE clause and parameter order',
      )
      assertSql(sql.includes('max(sequence)'), 'sequence query must allocate from durable maximum')
      assertSql(sql.includes('from outbox'), 'sequence query must read outbox')
      const sequence = this.state.outbox
        .filter((row) => row.owner_id === params[0])
        .reduce((largest, row) => Math.max(largest, row.sequence), 0)
      return { next_sequence: sequence + 1 } as T
    }
    if (source.includes('outbox:acknowledgement-sequence')) {
      requireExactSql(sql, expectedSql.acknowledgementSequence, 'acknowledgement sequence lookup')
      requireOwnerPredicate(sql)
      const row = this.state.outbox.find((candidate) => (
        candidate.owner_id === params[0] &&
        candidate.mutation_id === params[1] &&
        candidate.state !== 'complete'
      ))
      return (row ? { sequence: row.sequence } : null) as T | null
    }
    if (source.includes('outbox:legacy-feed-repair:get')) {
      requireExactSql(sql, expectedSql.legacyFeedRepairMutation, 'legacy feed repair mutation lookup')
      requireOwnerPredicate(sql)
      const row = this.state.outbox.find((candidate) => (
        candidate.owner_id === params[0] &&
        candidate.mutation_id === params[1] &&
        candidate.state !== 'complete'
      ))
      return (row ? { entity: row.entity, kind: row.kind } : null) as T | null
    }
    if (source.includes('sync-cursors:get')) {
      requireExactSql(sql, expectedSql.cursorGet, 'sync cursor get')
      requireOwnerPredicate(sql)
      const row = (this.state.syncCursors as unknown as SyncCursorRow[]).find(
        (candidate) => candidate.owner_id === params[0] && candidate.entity === params[1],
      )
      return (row ? { cursor: row.cursor } : null) as T | null
    }
    if (source.includes('metadata:initial-pull:get')) {
      requireExactSql(sql, expectedSql.initialPullGet, 'initial pull metadata get')
      return this.state.metadata.find(
        (row) => row.owner_id === params[0] && row.key === params[1],
      ) as T | undefined ?? null
    }
    if (source.includes('metadata:reconciliation:get')) {
      requireExactSql(sql, expectedSql.reconciliationGet, 'reconciliation metadata get')
      return this.state.metadata.find(
        (row) => row.owner_id === params[0] && row.key === params[1],
      ) as T | undefined ?? null
    }
    if (source.includes('metadata:reconciliation-terminal:get')) {
      requireExactSql(sql, expectedSql.reconciliationTerminalGet, 'terminal reconciliation metadata get')
      return this.state.metadata.find(
        (row) => row.owner_id === params[0] && row.key === params[1],
      ) as T | undefined ?? null
    }
    if (source.includes('conflicts:get')) {
      requireExactSql(sql, expectedSql.conflictGet, 'conflict get')
      assertSql(sql.includes('conflict.owner_id = ?'), 'conflict get owner predicate')
      const row = (this.state.conflicts as unknown as ConflictRow[]).find(
        (candidate) => candidate.owner_id === params[0] && candidate.mutation_id === params[1],
      )
      const outbox = this.state.outbox.find(
        (candidate) => candidate.owner_id === params[0] && candidate.mutation_id === params[1],
      )
      return (row && outbox ? { ...row, mutation_kind: outbox.kind } : null) as T | null
    }
    if (source.includes('conflicts:count')) {
      requireExactSql(sql, expectedSql.conflictCount, 'conflict count')
      requireOwnerPredicate(sql)
      return {
        count: this.state.conflicts.filter((row) => row.owner_id === params[0]).length,
      } as T
    }
    throw new Error(`Unsupported mock getFirstAsync SQL: ${source}`)
  }

  async getAllAsync<T>(source: string, ...rawParams: unknown[]): Promise<T[]> {
    const params = asParams(rawParams)
    const sql = normalizeSql(source)
    if (source.includes('bootstrap:outbox:list')) {
      requireExactSql(sql, expectedSql.bootstrapOutboxList, 'bootstrap outbox list')
      requireOwnerPredicate(sql)
      return this.state.outbox
        .filter((row) => row.owner_id === params[0] && row.state !== 'complete')
        .map((row) => ({
          entity: row.entity,
          entity_id: row.entity_id,
          kind: row.kind,
          payload_json: row.payload_json,
        })) as T[]
    }
    if (source.includes('outbox:all-local-intents')) {
      requireExactSql(sql, expectedSql.allLocalIntents, 'all local intent lookup')
      requireOwnerPredicate(sql)
      return this.state.outbox
        .filter((row) => row.owner_id === params[0] && row.state !== 'complete')
        .sort((left, right) => left.sequence - right.sequence)
        .map((row) => ({
          sequence: row.sequence,
          mutation_id: row.mutation_id,
          entity: row.entity,
          entity_id: row.entity_id,
          kind: row.kind,
          base_version: row.base_version,
          payload_json: row.payload_json,
          created_at: row.created_at,
          attempts: row.attempts,
          payload_hash: row.payload_hash,
        })) as T[]
    }
    if (source.includes('server-authority:list')) {
      requireExactSql(sql, expectedSql.authorityList, 'server authority list')
      requireOwnerPredicate(sql)
      return this.state.serverAuthorities
        .filter((row) => row.owner_id === params[0])
        .map((row) => ({ ...row })) as T[]
    }
    if (source.includes('outbox:later-local-intents')) {
      requireExactSql(sql, expectedSql.laterLocalIntents, 'later local intent lookup')
      requireOwnerPredicate(sql)
      return this.state.outbox
        .filter((row) => (
          row.owner_id === params[0] &&
          row.sequence > Number(params[1]) &&
          row.state !== 'complete'
        ))
        .sort((left, right) => left.sequence - right.sequence)
        .map((row) => ({
          sequence: row.sequence,
          mutation_id: row.mutation_id,
          entity: row.entity,
          entity_id: row.entity_id,
          kind: row.kind,
          base_version: row.base_version,
          payload_json: row.payload_json,
          created_at: row.created_at,
          attempts: row.attempts,
          payload_hash: row.payload_hash,
        })) as T[]
    }
    if (source.includes('records:local-intent-snapshots')) {
      requireExactSql(sql, expectedSql.localIntentSnapshots, 'local intent record snapshots')
      requireOwnerPredicate(sql)
      return this.state.records
        .filter((row) => row.owner_id === params[0])
        .map((row) => ({ ...row })) as T[]
    }
    if (source.includes('bootstrap:records:list')) {
      requireExactSql(sql, expectedSql.bootstrapRecordsList, 'bootstrap records list')
      requireOwnerPredicate(sql)
      return this.state.bootstrapRecords
        .filter((row) => row.owner_id === params[0])
        .map((row) => ({ ...row })) as T[]
    }
    if (source.includes('bootstrap:current:list')) {
      requireExactSql(sql, expectedSql.bootstrapCurrentList, 'bootstrap current list')
      requireOwnerPredicate(sql)
      return this.state.records
        .filter((row) => row.owner_id === params[0])
        .map((row) => ({ entity: row.entity, entity_id: row.entity_id })) as T[]
    }
    if (source.includes('records:list')) {
      requireExactSql(sql, expectedSql.recordsList, 'records list')
      requireOwnerPredicate(sql)
      assertSql(
        /where owner_id = \? and entity = \? and deleted = 0 order by updated_at desc, entity_id asc$/.test(sql),
        'records list WHERE clause and parameter order',
      )
      assertSql(sql.includes('from records'), 'records list must query records')
      assertSql(sql.includes('entity = ?'), 'records list must include entity = ?')
      assertSql(sql.includes('deleted = 0'), 'records list must exclude tombstones')
      assertSql(sql.includes('select entity_id, payload_json'), 'records list must select storage key')
      const result = this.state.records
        .filter(
          (row) => row.owner_id === params[0] && row.entity === params[1] && row.deleted === 0,
        )
        .map((row) => ({ ...row }))
      const pause = this.control.nextReadPause
      if (pause) {
        this.control.nextReadPause = null
        pause.markStarted()
        await pause.wait
      }
      return result as T[]
    }
    if (source.includes('outbox:list')) {
      requireExactSql(sql, expectedSql.outboxList, 'outbox list')
      assertSql(/\bowner_id\s*=\s*\?/.test(sql), 'outbox list must include owner_id = ?')
      assertSql(
        /where owner_id = \? and state in \('pending', 'failed'\) order by sequence asc$/.test(sql),
        'outbox list WHERE clause and parameter order',
      )
      assertSql(sql.includes('from outbox'), 'outbox list must query outbox')
      assertSql(sql.includes("state in ('pending', 'failed')"), 'outbox list must retain failed FIFO heads')
      assertSql(sql.includes('payload_hash'), 'outbox list must select payload hash')
      assertSql(sql.includes('order by sequence asc'), 'outbox list must use FIFO sequence')
      const result = this.state.outbox
        .filter((row) =>
          row.owner_id === params[0] &&
          (row.state === 'pending' || row.state === 'failed'),
        )
        .sort((left, right) => left.sequence - right.sequence)
        .map((row) => ({ ...row }))
      const pause = this.control.nextOutboxReadPause
      if (pause) {
        this.control.nextOutboxReadPause = null
        pause.markStarted()
        await pause.wait
      }
      return result as T[]
    }
    throw new Error(`Unsupported mock getAllAsync SQL: ${source}`)
  }
}

export const openDatabaseAsync = async (name: string): Promise<MockSQLiteDatabase> => {
  const state = databases.get(name) ?? createState()
  databases.set(name, state)
  return new MockSQLiteDatabase(state)
}

export const __resetSQLiteMock = (): void => {
  databases.clear()
}

export const __getRawDatabase = (name: string): MockDatabaseState => {
  const database = databases.get(name)
  if (!database) throw new Error(`Mock database ${name} has not been opened`)
  return database
}

export const __failNextOutboxInsert = (name: string): void => {
  __getRawDatabase(name).failNextOutboxInsert = true
}

export const __failNextOutboxAcknowledge = (name: string): void => {
  __getRawDatabase(name).failNextOutboxAcknowledge = true
}

export const __failNextMigration = (name: string): void => {
  const state = databases.get(name) ?? createState()
  state.failNextMigration = true
  databases.set(name, state)
}

const createPause = (): ReadPause => {
  let markStarted: () => void = () => {}
  let release: () => void = () => {}
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  return { started, markStarted, wait, release }
}

export const __pauseNextRecordsRead = (
  name: string,
): { started: Promise<void>; release: () => void } => {
  const pause = createPause()
  __getRawDatabase(name).nextReadPause = pause
  return { started: pause.started, release: pause.release }
}

export const __pauseNextOutboxRead = (
  name: string,
): { started: Promise<void>; release: () => void } => {
  const pause = createPause()
  __getRawDatabase(name).nextOutboxReadPause = pause
  return { started: pause.started, release: pause.release }
}

export const __pauseNextMigrationRead = (
  name: string,
): { started: Promise<void>; release: () => void } => {
  const pause = createPause()
  __getRawDatabase(name).nextMigrationReadPause = pause
  return { started: pause.started, release: pause.release }
}

export const __pauseNextOwnerClear = (
  name: string,
): { started: Promise<void>; release: () => void } => {
  const pause = createPause()
  __getRawDatabase(name).nextOwnerClearPause = pause
  return { started: pause.started, release: pause.release }
}

export const __pauseNextOutboxInsert = (
  name: string,
): { started: Promise<void>; release: () => void } => {
  const pause = createPause()
  __getRawDatabase(name).nextOutboxInsertPause = pause
  return { started: pause.started, release: pause.release }
}

export const __failNextOwnerClear = (name: string): void => {
  __getRawDatabase(name).failNextOwnerClear = true
}

declare module 'expo-sqlite' {
  export const __resetSQLiteMock: () => void
  export const __getRawDatabase: (name: string) => MockDatabaseState
  export const __failNextOutboxInsert: (name: string) => void
  export const __failNextOutboxAcknowledge: (name: string) => void
  export const __failNextMigration: (name: string) => void
  export const __failNextOwnerClear: (name: string) => void
  export const __pauseNextRecordsRead: (
    name: string,
  ) => { started: Promise<void>; release: () => void }
  export const __pauseNextOutboxRead: (
    name: string,
  ) => { started: Promise<void>; release: () => void }
  export const __pauseNextMigrationRead: (
    name: string,
  ) => { started: Promise<void>; release: () => void }
  export const __pauseNextOwnerClear: (
    name: string,
  ) => { started: Promise<void>; release: () => void }
  export const __pauseNextOutboxInsert: (
    name: string,
  ) => { started: Promise<void>; release: () => void }
}
