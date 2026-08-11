import { useEffect, useState } from 'react'
import { AppState, Pressable, StyleSheet, Text, type AppStateStatus } from 'react-native'

import { FormField } from '../../components/FormField'
import { PrimaryButton } from '../../components/PrimaryButton'
import { speechPort, type SpeechAvailability, type SpeechPort } from '../../native/speech'
import { colors, MIN_TOUCH_TARGET, spacing, typography } from '../../theme/tokens'

type AppStatePort = {
  addEventListener(event: 'change', listener: (state: AppStateStatus | string) => void): { remove(): void }
}

type VoiceTranscriptInputProps = {
  appState?: AppStatePort
  onChangeText(value: string): void
  port?: SpeechPort
  value: string
}

export const VoiceTranscriptInput = ({ appState = AppState, onChangeText, port = speechPort, value }: VoiceTranscriptInputProps) => {
  const [availability, setAvailability] = useState<SpeechAvailability>('manual-only')
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void port.availability().then((result) => { if (active) setAvailability(result) })
    const transcriptSubscription = port.subscribe?.((event) => {
      if (active && event.transcript.trim()) {
        onChangeText(event.transcript.slice(0, 20_000))
        if (event.isFinal) setRecording(false)
      }
    })
    const errorSubscription = port.subscribeError?.(() => {
      if (active) {
        setRecording(false)
        setError('On-device recognition stopped. Your transcript so far is still editable.')
      }
    })
    return () => {
      active = false
      transcriptSubscription?.remove()
      errorSubscription?.remove()
      void port.cancel()
    }
  }, [onChangeText, port])

  useEffect(() => appState.addEventListener('change', (state) => {
    if (state !== 'active') {
      setRecording(false)
      void port.cancel()
    }
  }).remove, [appState, port])

  const start = async () => {
    setError(null)
    try {
      await port.start({ locale: 'en-US', maxDurationMs: 120_000 })
      setRecording(true)
    } catch {
      setError('Voice recording could not start. Type the transcript below.')
    }
  }
  const stop = async () => {
    try {
      const result = await port.stop()
      onChangeText(result.transcript)
    } catch {
      setError('No usable on-device transcript was produced. Your typed text is unchanged.')
    } finally {
      setRecording(false)
    }
  }

  return (
    <>
      {availability === 'manual-only' ? <Text style={styles.notice}>Voice entry requires the FieldCraft development build. Type the job details below.</Text> : null}
      {availability === 'permission-denied' ? <Text style={styles.notice}>Microphone or speech permission is denied. Enable it in iOS Settings, or type below.</Text> : null}
      {availability === 'available' && !recording ? <PrimaryButton label="Record on this device" onPress={() => { void start() }} testID="start-voice" /> : null}
      {availability === 'available' && recording ? <PrimaryButton label="Stop recording" onPress={() => { void stop() }} testID="stop-voice" /> : null}
      {recording ? <Text accessibilityLiveRegion="polite" style={styles.recording}>Recording on this device · stops after 2 minutes</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <FormField label="Job transcript" maxLength={20_000} multiline onChangeText={onChangeText} testID="voice-transcript-input" value={value} />
      {recording ? <Pressable accessibilityRole="button" onPress={() => { setRecording(false); void port.cancel() }} style={styles.cancel}><Text style={styles.cancelText}>Cancel recording</Text></Pressable> : null}
    </>
  )
}

const styles = StyleSheet.create({
  cancel: { alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH_TARGET },
  cancelText: { color: colors.danger, fontFamily: typography.body, fontWeight: '700' },
  error: { color: colors.danger, fontFamily: typography.body, fontSize: 14 },
  notice: { color: colors.muted, fontFamily: typography.body, fontSize: 14, lineHeight: 20 },
  recording: { color: colors.orange, fontFamily: typography.utility, fontSize: 12, marginVertical: spacing.sm },
})
