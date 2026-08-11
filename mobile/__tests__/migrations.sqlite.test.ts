import { DatabaseSync } from 'node:sqlite'

import { applyMigrations, DATABASE_SCHEMA_VERSION } from '../src/data/migrations'

type MigrationTransaction = Parameters<Parameters<typeof applyMigrations>[0]['withExclusiveTransactionAsync']>[0] extends (
  transaction: infer Transaction,
) => Promise<void> ? Transaction : never

it('applies every FieldCraft migration using the SQLite grammar shipped on iOS', async () => {
  const database = new DatabaseSync(':memory:')
  const transaction = {
    async execAsync(source: string) {
      database.exec(source)
    },
    async getFirstAsync<T>(source: string): Promise<T | null> {
      return (database.prepare(source).get() as T | undefined) ?? null
    },
  } as MigrationTransaction
  const adapter = {
    async withExclusiveTransactionAsync(task: (value: MigrationTransaction) => Promise<void>) {
      database.exec('BEGIN EXCLUSIVE')
      try {
        await task(transaction)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },
  } as Parameters<typeof applyMigrations>[0]

  try {
    await expect(applyMigrations(adapter)).resolves.toBeUndefined()
    expect(database.prepare('PRAGMA user_version').get()).toEqual({
      user_version: DATABASE_SCHEMA_VERSION,
    })
    expect(database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'quarantined_outbox'",
    ).get()).toEqual({ name: 'quarantined_outbox' })
    expect(database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'outbox_dependencies'",
    ).get()).toEqual({ name: 'outbox_dependencies' })
  } finally {
    database.close()
  }
})
