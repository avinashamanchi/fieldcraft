import { render, screen } from '@testing-library/react-native'
import RootLayout from '../app/_layout'
import appConfig from '../app.config'

jest.mock('expo-router', () => ({ Stack: () => null }))

it('uses the exact FieldCraft iOS identity', () => {
  const config = appConfig({ config: {} } as never)
  expect(config.name).toBe('FieldCraft')
  expect(config.scheme).toBe('fieldcraft')
  expect(config.ios?.bundleIdentifier).toBe('com.avinashamanchi.fieldcraft')
  expect(config.ios?.buildNumber).toBe('1')
})

it('mounts the native root', () => {
  render(<RootLayout />)
  expect(screen.queryByText(/vite/i)).toBeNull()
})
