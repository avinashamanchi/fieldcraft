import { render, screen } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import RootLayout from '../app/_layout'
import appConfig from '../app.config'

let mockAuthState: { status: string; userId?: string; hydrated?: boolean } = { status: 'signedOut' }
const mockRepository = { list: jest.fn(async () => []), transactLocalMutation: jest.fn(async () => {}) }

jest.mock('expo-router', () => ({ Stack: () => null }))
jest.mock('../src/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => mockAuthState,
}))
jest.mock('../src/data/DataProvider', () => ({
  DataProvider: ({ children }: { children: ReactNode }) => children,
  useFieldCraftData: () => ({
    owner: { ownerId: mockAuthState.userId ?? null },
    repository: mockRepository,
  }),
}))
jest.mock('../src/data/SyncProvider', () => ({
  SyncProvider: ({ children }: { children: ReactNode }) => children,
}))
jest.mock('../src/data/sqliteRepository', () => ({
  SQLiteFieldCraftRepository: class SQLiteFieldCraftRepository {},
}))

it('uses the exact FieldCraft iOS identity', () => {
  const config = appConfig({ config: {} } as never)
  expect(config.name).toBe('FieldCraft')
  expect(config.scheme).toBe('fieldcraft')
  expect(config.ios?.bundleIdentifier).toBe('com.avinashamanchi.fieldcraft')
  expect(config.ios?.buildNumber).toBe('1')
})

it('mounts the native root', () => {
  mockAuthState = { status: 'signedOut' }
  render(<RootLayout />)
  expect(screen.queryByText(/vite/i)).toBeNull()
})

it('keeps the application tree hidden while first cloud hydration is incomplete', () => {
  mockAuthState = { status: 'signedIn', userId: 'owner-a', hydrated: false }
  render(<RootLayout />)

  expect(screen.getByText('Preparing your secure workspace…')).toBeTruthy()
})
