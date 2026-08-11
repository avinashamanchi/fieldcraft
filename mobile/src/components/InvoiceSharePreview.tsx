import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import type { PdfArtifact } from '../files/invoicePdf'
import { shareInvoicePdf } from '../files/shareInvoice'
import { colors, radius, spacing, typography } from '../theme/tokens'
import { PrimaryButton } from './PrimaryButton'

type InvoiceSharePreviewProps = {
  createPdf(): Promise<PdfArtifact>
  share?: (artifact: PdfArtifact) => Promise<string>
}

export const InvoiceSharePreview = ({ createPdf, share = shareInvoicePdf }: InvoiceSharePreviewProps) => {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const active = useRef<PdfArtifact | null>(null)
  const sharing = useRef(false)
  const mounted = useRef(true)
  useEffect(() => () => {
    mounted.current = false
    if (active.current) void active.current.cleanup().catch(() => {})
  }, [])
  const open = async () => {
    if (sharing.current) return
    sharing.current = true
    setBusy(true)
    setMessage(null)
    try {
      const artifact = await createPdf()
      active.current = artifact
      const result = await share(artifact)
      if (mounted.current) setMessage(result === 'Share sheet opened' ? result : 'Share sheet opened')
    } catch {
      if (mounted.current) setMessage('The share sheet could not be opened. Try again.')
    } finally {
      if (active.current) await active.current.cleanup().catch(() => {})
      active.current = null
      sharing.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <View style={styles.card}>
      <Text style={styles.title}>PDF preview</Text>
      <Text style={styles.copy}>A PDF is generated only after you press Share invoice. Opening the share sheet does not prove delivery.</Text>
      <PrimaryButton disabled={busy} label={busy ? 'Preparing PDF…' : 'Share invoice'} onPress={() => { void open() }} testID="share-invoice" />
      {message ? <Text accessibilityLiveRegion="polite" style={message === 'Share sheet opened' ? styles.success : styles.error}>{message}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.panel, borderRadius: radius.md, gap: spacing.md, padding: spacing.lg },
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontFamily: typography.body, fontSize: 14 },
  success: { color: colors.success, fontFamily: typography.body, fontSize: 14 },
  title: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 20, fontWeight: '800' },
})
