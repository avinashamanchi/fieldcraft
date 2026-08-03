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
}

export type MockDatabaseState = {
  userVersion: number
  tables: Set<string>
  records: RecordRow[]
  outbox: OutboxRow[]
  conflicts: Record<string, unknown>[]
  syncCursors: Record<string, unknown>[]
  metadata: Record<string, unknown>[]
  failNextOutboxInsert: boolean
  failNextMigration: boolean
  failNextOwnerClear: boolean
  closeCount: number
  nextReadPause: ReadPause | null
  nextOutboxReadPause: ReadPause | null
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
  outbox: [],
  conflicts: [],
  syncCursors: [],
  metadata: [],
  failNextOutboxInsert: false,
  failNextMigration: false,
  failNextOwnerClear: false,
  closeCount: 0,
  nextReadPause: null,
  nextOutboxReadPause: null,
  nextOwnerClearPause: null,
  nextOutboxInsertPause: null,
  transactionTail: Promise.resolve(),
})

const copyState = (state: MockDatabaseState): MockDatabaseState => ({
  userVersion: state.userVersion,
  tables: new Set(state.tables),
  records: state.records.map((row) => ({ ...row })),
  outbox: state.outbox.map((row) => ({ ...row })),
  conflicts: state.conflicts.map((row) => ({ ...row })),
  syncCursors: state.syncCursors.map((row) => ({ ...row })),
  metadata: state.metadata.map((row) => ({ ...row })),
  failNextOutboxInsert: state.failNextOutboxInsert,
  failNextMigration: state.failNextMigration,
  failNextOwnerClear: state.failNextOwnerClear,
  closeCount: state.closeCount,
  nextReadPause: state.nextReadPause,
  nextOutboxReadPause: state.nextOutboxReadPause,
  nextOwnerClearPause: state.nextOwnerClearPause,
  nextOutboxInsertPause: state.nextOutboxInsertPause,
  transactionTail: state.transactionTail,
})

const commitState = (target: MockDatabaseState, source: MockDatabaseState): void => {
  target.userVersion = source.userVersion
  target.tables = source.tables
  target.records = source.records
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
  outboxInsert: normalizeSql(`/* outbox:insert */
    INSERT INTO outbox
      (owner_id, mutation_id, sequence, entity, entity_id, kind, base_version,
       payload_json, payload_hash, created_at, attempts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  conflictUpsert: normalizeSql(`/* conflicts:upsert */
    INSERT INTO conflicts
      (owner_id, mutation_id, entity, entity_id, local_payload_json,
       cloud_payload_json, cloud_version)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, mutation_id) DO UPDATE SET
      entity = excluded.entity,
      entity_id = excluded.entity_id,
      local_payload_json = excluded.local_payload_json,
      cloud_payload_json = excluded.cloud_payload_json,
      cloud_version = excluded.cloud_version`),
  recordsClear: '/* owner:clear:records */ delete from records where owner_id = ?',
  outboxClear: '/* owner:clear:outbox */ delete from outbox where owner_id = ?',
  conflictsClear: '/* owner:clear:conflicts */ delete from conflicts where owner_id = ?',
  cursorsClear: '/* owner:clear:sync_cursors */ delete from sync_cursors where owner_id = ?',
  metadataClear: '/* owner:clear:metadata */ delete from metadata where owner_id = ?',
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
           payload_json, payload_hash, created_at, attempts
    FROM outbox
    WHERE owner_id = ? AND state IN ('pending', 'failed')
    ORDER BY sequence ASC`),
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
    for (const match of source.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi)) {
      this.state.tables.add(match[1])
    }
    const version = source.match(/PRAGMA\s+user_version\s*=\s*(\d+)/i)
    if (version) {
      this.state.userVersion = Number(version[1])
    }
    assertSql(
      sql.includes('create table if not exists records') || /^pragma\s+user_version/.test(sql),
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
      this.state.conflicts.push({ owner_id: params[0], params })
      return { changes: 1, lastInsertRowId: 0 }
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
    throw new Error(`Unsupported mock runAsync SQL: ${source}`)
  }

  async getFirstAsync<T>(source: string, ...rawParams: unknown[]): Promise<T | null> {
    const params = asParams(rawParams)
    const sql = normalizeSql(source)
    if (/PRAGMA\s+user_version/i.test(source)) {
      requireExactSql(sql, 'pragma user_version', 'user version read')
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
    throw new Error(`Unsupported mock getFirstAsync SQL: ${source}`)
  }

  async getAllAsync<T>(source: string, ...rawParams: unknown[]): Promise<T[]> {
    const params = asParams(rawParams)
    const sql = normalizeSql(source)
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
      requireOwnerPredicate(sql)
      assertSql(
        /where owner_id = \? and state in \('pending', 'failed'\) order by sequence asc$/.test(sql),
        'outbox list WHERE clause and parameter order',
      )
      assertSql(sql.includes('from outbox'), 'outbox list must query outbox')
      assertSql(sql.includes("state in ('pending', 'failed')"), 'outbox list must filter sendable states')
      assertSql(sql.includes('payload_hash'), 'outbox list must select payload hash')
      assertSql(sql.includes('order by sequence asc'), 'outbox list must use FIFO sequence')
      const result = this.state.outbox
        .filter((row) => row.owner_id === params[0])
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
  export const __failNextMigration: (name: string) => void
  export const __failNextOwnerClear: (name: string) => void
  export const __pauseNextRecordsRead: (
    name: string,
  ) => { started: Promise<void>; release: () => void }
  export const __pauseNextOutboxRead: (
    name: string,
  ) => { started: Promise<void>; release: () => void }
  export const __pauseNextOwnerClear: (
    name: string,
  ) => { started: Promise<void>; release: () => void }
  export const __pauseNextOutboxInsert: (
    name: string,
  ) => { started: Promise<void>; release: () => void }
}
