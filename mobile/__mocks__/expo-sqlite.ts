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
  closeCount: number
  nextReadPause: ReadPause | null
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
  closeCount: 0,
  nextReadPause: null,
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
  closeCount: state.closeCount,
  nextReadPause: state.nextReadPause,
})

const restoreState = (target: MockDatabaseState, source: MockDatabaseState): void => {
  target.userVersion = source.userVersion
  target.tables = source.tables
  target.records = source.records
  target.outbox = source.outbox
  target.conflicts = source.conflicts
  target.syncCursors = source.syncCursors
  target.metadata = source.metadata
  target.failNextOutboxInsert = source.failNextOutboxInsert
  target.failNextMigration = source.failNextMigration
  target.closeCount = source.closeCount
  target.nextReadPause = source.nextReadPause
}

const asParams = (params: unknown[]): BindValue[] => {
  if (params.length === 1 && Array.isArray(params[0])) {
    return params[0] as BindValue[]
  }
  return params as BindValue[]
}

class MockSQLiteDatabase {
  constructor(private readonly state: MockDatabaseState) {}

  async closeAsync(): Promise<void> {
    this.state.closeCount += 1
  }

  async execAsync(source: string): Promise<void> {
    if (this.state.failNextMigration && source.includes('CREATE TABLE IF NOT EXISTS records')) {
      this.state.failNextMigration = false
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
  }

  async withExclusiveTransactionAsync(
    task: (transaction: MockSQLiteDatabase) => Promise<void>,
  ): Promise<void> {
    const before = copyState(this.state)
    try {
      await task(this)
    } catch (error) {
      restoreState(this.state, before)
      throw error
    }
  }

  async runAsync(source: string, ...rawParams: unknown[]): Promise<{ changes: number; lastInsertRowId: number }> {
    const params = asParams(rawParams)
    if (source.includes('records:upsert')) {
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
      if (this.state.failNextOutboxInsert) {
        this.state.failNextOutboxInsert = false
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
      this.state.outbox.push(row)
      return { changes: 1, lastInsertRowId: row.sequence }
    }
    if (source.includes('conflicts:upsert')) {
      this.state.conflicts.push({ params })
      return { changes: 1, lastInsertRowId: 0 }
    }
    if (source.includes('owner:clear:records')) {
      const before = this.state.records.length
      this.state.records = this.state.records.filter((row) => row.owner_id !== params[0])
      return { changes: before - this.state.records.length, lastInsertRowId: 0 }
    }
    if (source.includes('owner:clear:outbox')) {
      const before = this.state.outbox.length
      this.state.outbox = this.state.outbox.filter((row) => row.owner_id !== params[0])
      return { changes: before - this.state.outbox.length, lastInsertRowId: 0 }
    }
    if (source.includes('owner:clear:conflicts')) {
      this.state.conflicts = []
      return { changes: 1, lastInsertRowId: 0 }
    }
    if (source.includes('owner:clear:sync_cursors')) {
      this.state.syncCursors = []
      return { changes: 1, lastInsertRowId: 0 }
    }
    if (source.includes('owner:clear:metadata')) {
      this.state.metadata = []
      return { changes: 1, lastInsertRowId: 0 }
    }
    throw new Error(`Unsupported mock runAsync SQL: ${source}`)
  }

  async getFirstAsync<T>(source: string, ...rawParams: unknown[]): Promise<T | null> {
    const params = asParams(rawParams)
    if (/PRAGMA\s+user_version/i.test(source)) {
      return { user_version: this.state.userVersion } as T
    }
    if (source.includes('records:get')) {
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
      const row = this.state.outbox.find(
        (candidate) => candidate.owner_id === params[0] && candidate.mutation_id === params[1],
      )
      return (row ? { payload_hash: row.payload_hash } : null) as T | null
    }
    if (source.includes('outbox:next-sequence')) {
      const sequence = this.state.outbox
        .filter((row) => row.owner_id === params[0])
        .reduce((largest, row) => Math.max(largest, row.sequence), 0)
      return { next_sequence: sequence + 1 } as T
    }
    throw new Error(`Unsupported mock getFirstAsync SQL: ${source}`)
  }

  async getAllAsync<T>(source: string, ...rawParams: unknown[]): Promise<T[]> {
    const params = asParams(rawParams)
    if (source.includes('records:list')) {
      const result = this.state.records
        .filter(
          (row) => row.owner_id === params[0] && row.entity === params[1] && row.deleted === 0,
        )
        .map((row) => ({ ...row }))
      const pause = this.state.nextReadPause
      if (pause) {
        this.state.nextReadPause = null
        pause.markStarted()
        await pause.wait
      }
      return result as T[]
    }
    if (source.includes('outbox:list')) {
      return this.state.outbox
        .filter((row) => row.owner_id === params[0])
        .sort((left, right) => left.sequence - right.sequence)
        .map((row) => ({ ...row })) as T[]
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

export const __pauseNextRecordsRead = (
  name: string,
): { started: Promise<void>; release: () => void } => {
  let markStarted: () => void = () => {}
  let release: () => void = () => {}
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  __getRawDatabase(name).nextReadPause = { started, markStarted, wait, release }
  return { started, release }
}

declare module 'expo-sqlite' {
  export const __resetSQLiteMock: () => void
  export const __getRawDatabase: (name: string) => MockDatabaseState
  export const __failNextOutboxInsert: (name: string) => void
  export const __failNextMigration: (name: string) => void
  export const __pauseNextRecordsRead: (
    name: string,
  ) => { started: Promise<void>; release: () => void }
}
