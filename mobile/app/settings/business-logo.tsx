import * as Crypto from 'expo-crypto'
import * as ImagePicker from 'expo-image-picker'
import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text } from 'react-native'

import { PrimaryButton } from '../../src/components/PrimaryButton'
import { Screen } from '../../src/components/Screen'
import { useFieldCraftData } from '../../src/data/DataProvider'
import { getSupabaseClient } from '../../src/auth/supabase'
import type { UserProfile } from '../../src/domain/entities'
import { buildProfileLogoMutation, importBusinessLogo, uploadBusinessLogo } from '../../src/files/logoImport'
import { colors, spacing, typography } from '../../src/theme/tokens'

export default function BusinessLogoScreen() {
  const { owner, repository } = useFieldCraftData()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    if (owner.ownerId) void repository.get<UserProfile>('profile', owner.ownerId).then(setProfile)
  }, [owner.ownerId, repository])

  const choose = async () => {
    if (!profile || busy) return
    setBusy(true)
    setMessage(null)
    let logo: Awaited<ReturnType<typeof importBusinessLogo>> | null = null
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permission.granted) { setMessage('Photo permission was not granted.'); return }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 })
      if (result.canceled || !result.assets[0]) return
      logo = await importBusinessLogo({ uri: result.assets[0].uri, mimeType: result.assets[0].mimeType }, profile.ownerId)
      const logoPath = await uploadBusinessLogo(logo, getSupabaseClient().storage)
      await repository.transactLocalMutation(buildProfileLogoMutation(profile, logoPath, Crypto.randomUUID(), new Date().toISOString()))
      setProfile((current) => current ? { ...current, logoPath, syncState: 'pending' } : current)
      setMessage('Business logo saved to your account.')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'The business logo could not be saved.')
    } finally {
      if (logo) await logo.cleanup().catch(() => {})
      setBusy(false)
    }
  }

  if (!owner.ownerId) return <Screen><ActivityIndicator color={colors.orange} /></Screen>
  return (
    <Screen contentContainerStyle={styles.screen}>
      <Text style={styles.eyebrow}>BUSINESS IDENTITY</Text>
      <Text accessibilityRole="header" style={styles.heading}>Invoice logo</Text>
      <Text style={styles.copy}>JPEG, PNG, or HEIC only. FieldCraft decodes and rasterizes the selected image to a maximum of 512×512 before upload.</Text>
      <Text style={styles.path}>{profile?.logoPath ? 'A logo is configured for this account.' : 'No logo configured.'}</Text>
      <PrimaryButton disabled={!profile || busy} label={busy ? 'Processing logo…' : 'Choose business logo'} onPress={() => { void choose() }} />
      {message ? <Text accessibilityLiveRegion="polite" style={styles.copy}>{message}</Text> : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 15, lineHeight: 22 },
  eyebrow: { color: colors.orange, fontFamily: typography.utility, fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  path: { color: colors.orange, fontFamily: typography.utility, fontSize: 13 },
  screen: { gap: spacing.lg },
})
