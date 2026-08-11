import { act, fireEvent, render, screen } from '@testing-library/react-native'

import { VoiceTranscriptInput } from '../src/features/invoices/VoiceTranscriptInput'
import type { SpeechPort } from '../src/native/speech'

it('keeps manual transcript entry usable in Expo Go', async () => {
  const onChange = jest.fn()
  const port: SpeechPort = {
    availability: async () => 'manual-only', start: async () => {},
    stop: async () => ({ transcript: '' }), cancel: async () => {},
  }
  render(<VoiceTranscriptInput onChangeText={onChange} port={port} value="" />)
  expect(await screen.findByText('Voice entry requires the FieldCraft development build. Type the job details below.')).toBeTruthy()
  fireEvent.changeText(screen.getByTestId('voice-transcript-input'), 'Typed fallback')
  expect(onChange).toHaveBeenCalledWith('Typed fallback')
})

it('shows partial text, stops to final text, and cancels on background', async () => {
  let listener: ((event: { transcript: string; isFinal: boolean }) => void) | null = null
  const onChange = jest.fn()
  const cancel = jest.fn(async () => {})
  const port: SpeechPort = {
    availability: async () => 'available', start: jest.fn(async () => {}),
    stop: async () => ({ transcript: 'Final transcript' }), cancel,
    subscribe(next) { listener = next; return { remove: () => { listener = null } } },
  }
  let appListener: ((state: string) => void) | null = null
  const appState = { addEventListener: (_event: 'change', next: (state: string) => void) => { appListener = next; return { remove: () => { appListener = null } } } }
  render(<VoiceTranscriptInput appState={appState} onChangeText={onChange} port={port} value="" />)
  await screen.findByTestId('start-voice')
  await act(async () => { fireEvent.press(screen.getByTestId('start-voice')) })
  act(() => { listener?.({ transcript: 'Partial', isFinal: false }) })
  expect(onChange).toHaveBeenCalledWith('Partial')
  await act(async () => { fireEvent.press(screen.getByTestId('stop-voice')) })
  expect(onChange).toHaveBeenCalledWith('Final transcript')
  await act(async () => { fireEvent.press(screen.getByTestId('start-voice')); appListener?.('background') })
  expect(cancel).toHaveBeenCalled()
})
