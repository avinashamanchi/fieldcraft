import { render, screen } from '@testing-library/react-native'
jest.mock('expo-router', () => {
  const mockReact = require('react')
  const { Text: MockText, View: MockView } = require('react-native')
  const MockTabs = ({ children }: { children: unknown }) =>
    mockReact.createElement(MockView, null, children)
  MockTabs.Screen = ({ options }: {
    options: {
      title: string
      href?: string | null
      tabBarButton?: (props: Record<string, unknown>) => unknown
    }
  }) => options.href === null || !options.tabBarButton
    ? null
    : options.tabBarButton({ children: mockReact.createElement(MockText, null, options.title) })
  return { Tabs: MockTabs }
})
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }))

import TabsLayout from '../app/(tabs)/_layout'

it('renders exactly five ordered native tabs and no voice tab', () => {
  render(<TabsLayout />)

  const tabs = screen.getAllByRole('tab')
  expect(tabs.map((tab) => tab.props.testID)).toEqual([
    'tab-dashboard',
    'tab-jobs',
    'tab-estimates',
    'tab-clients',
    'tab-settings',
  ])
  expect(screen.queryByTestId('tab-voice')).toBeNull()
})

it('gives each tab a plain-language VoiceOver label', () => {
  render(<TabsLayout />)
  expect(screen.getByLabelText('Dashboard tab')).toBeTruthy()
  expect(screen.getByLabelText('Jobs tab')).toBeTruthy()
  expect(screen.getByLabelText('Estimates tab')).toBeTruthy()
  expect(screen.getByLabelText('Clients tab')).toBeTruthy()
  expect(screen.getByLabelText('Settings tab')).toBeTruthy()
})
