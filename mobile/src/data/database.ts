import * as SQLite from 'expo-sqlite'

export const DEFAULT_DATABASE_NAME = 'fieldcraft.db'

export const openFieldCraftDatabase = (
  databaseName: string = DEFAULT_DATABASE_NAME,
): Promise<SQLite.SQLiteDatabase> =>
  SQLite.openDatabaseAsync(databaseName, {
    enableChangeListener: false,
    useNewConnection: true,
  })
