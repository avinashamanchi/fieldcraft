import { Platform } from 'react-native'

export const colors = {
  charcoal: '#1A1A1A',
  panel: '#242424',
  warmWhite: '#F5F0EB',
  orange: '#FF6B2B',
  orangePressed: '#E55A1F',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  muted: '#9CA3AF',
} as const

export const MIN_TOUCH_TARGET = 48

export const typography = {
  display: Platform.select({ ios: 'Avenir Next Condensed', default: 'sans-serif-condensed' }),
  body: Platform.select({ ios: 'Avenir Next', default: 'sans-serif' }),
  utility: Platform.select({ ios: 'Menlo', default: 'monospace' }),
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const

export const radius = { sm: 8, md: 14, lg: 22 } as const
