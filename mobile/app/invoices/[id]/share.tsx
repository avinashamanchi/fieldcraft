import { useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text } from 'react-native'

import { ErrorState } from '../../../src/components/ErrorState'
import { InvoiceSharePreview } from '../../../src/components/InvoiceSharePreview'
import { Screen } from '../../../src/components/Screen'
import { useFieldCraftData } from '../../../src/data/DataProvider'
import type { Client, Invoice, Job, UserProfile } from '../../../src/domain/entities'
import { createInvoicePdf, type InvoicePdfInput } from '../../../src/files/invoicePdf'
import { colors, spacing, typography } from '../../../src/theme/tokens'

export default function ShareInvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { owner, repository } = useFieldCraftData()
  const [input, setInput] = useState<InvoicePdfInput | null>(null)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    let active = true
    const load = async () => {
      const invoice = await repository.get<Invoice>('invoice', id)
      if (!invoice || !invoice.jobId || !owner.ownerId) { if (active) setMissing(true); return }
      const [client, job, profile] = await Promise.all([
        repository.get<Client>('client', invoice.clientId),
        repository.get<Job>('job', invoice.jobId),
        repository.get<UserProfile>('profile', owner.ownerId),
      ])
      if (!client || !job) { if (active) setMissing(true); return }
      if (active) setInput({
        businessName: profile?.businessName || 'FieldCraft', client, invoice,
        invoiceNumber: invoice.id, job,
      })
    }
    void load().catch(() => { if (active) setMissing(true) })
    return () => { active = false }
  }, [id, owner.ownerId, repository])
  if (missing) return <Screen><ErrorState message="This invoice cannot be prepared for sharing." /></Screen>
  if (!input) return <Screen><ActivityIndicator color={colors.orange} /></Screen>
  return (
    <Screen contentContainerStyle={styles.screen}>
      <Text style={styles.eyebrow}>USER-INITIATED SHARE</Text>
      <Text accessibilityRole="header" style={styles.heading}>Review, then open the share sheet.</Text>
      <Text style={styles.copy}>FieldCraft creates a temporary PDF from the saved invoice. It is deleted after the share sheet closes.</Text>
      <InvoiceSharePreview createPdf={() => createInvoicePdf(input)} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 15, lineHeight: 22 },
  eyebrow: { color: colors.orange, fontFamily: typography.utility, fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  screen: { gap: spacing.lg },
})
