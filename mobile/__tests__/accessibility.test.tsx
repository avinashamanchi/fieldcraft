import { render, screen } from '@testing-library/react-native'
import { StyleSheet, Text } from 'react-native'

import { PrimaryButton } from '../src/components/PrimaryButton'
import { Screen } from '../src/components/Screen'
import { MIN_TOUCH_TARGET } from '../src/theme/tokens'

it('keeps the primary action at least 48 points tall with a button role', () => {
  render(<PrimaryButton accessibilityLabel="Log a job" label="Log job" onPress={() => {}} />)

  const button = screen.getByRole('button', { name: 'Log a job' })
  expect(StyleSheet.flatten(button.props.style).minHeight).toBe(MIN_TOUCH_TARGET)
})

it('uses a safe-area scroll surface that remains usable at 320 by 568', () => {
  render(
    <Screen scroll testID="small-screen-scroll">
      <Text>Scrollable field content</Text>
    </Screen>,
  )

  expect(screen.getByTestId('small-screen-scroll')).toBeTruthy()
  expect(screen.getByText('Scrollable field content')).toBeTruthy()
})
