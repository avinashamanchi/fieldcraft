import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import { ErrorState } from '../../src/components/ErrorState'
import { PrimaryButton } from '../../src/components/PrimaryButton'
import { Screen } from '../../src/components/Screen'
import { useFieldCraftData } from '../../src/data/DataProvider'
import type { Client, Invoice, Job } from '../../src/domain/entities'
import { calculateInvoice } from '../../src/domain/invoice'
import { InvoiceSummary } from '../../src/features/invoices/InvoiceSummary'
import { colors, radius, spacing, typography } from '../../src/theme/tokens'

type Detail = { invoice: Invoice; client: Client | null; job: Job | null }

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { repository } = useFieldCraftData()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    let active = true
    const load = async () => {
      const invoice = await repository.get<Invoice>('invoice', id)
      if (!active) return
      if (!invoice) { setMissing(true); return }
      const [client, job] = await Promise.all([
        repository.get<Client>('client', invoice.clientId),
        invoice.jobId ? repository.get<Job>('job', invoice.jobId) : Promise.resolve(null),
      ])
      if (active) setDetail({ invoice, client, job })
    }
    void load()
    const unsubscribe = repository.subscribeToLocalMutations(() => { void load() })
    return () => { active = false; unsubscribe() }
  }, [id, repository])
  if (missing) return <Screen><ErrorState message="This invoice is no longer available." /></Screen>
  if (!detail) return <Screen><ActivityIndicator color={colors.orange} /></Screen>
  const calculated = calculateInvoice(detail.invoice.draft)
  return (
    <Screen contentContainerStyle={styles.screen} scroll>
      <Text style={styles.eyebrow}>INVOICE · {detail.invoice.syncState.toUpperCase()}</Text>
      <Text accessibilityRole="header" style={styles.heading}>{detail.job?.title ?? detail.invoice.draft.jobTitle}</Text>
      <Text style={styles.client}>{detail.client?.name ?? detail.invoice.draft.clientName}</Text>
      <View style={styles.card}>
        {calculated.lineItems.map((line, index) => (
          <View key={line.id ?? `${line.description}-${index}`} style={styles.line}>
            <Text style={styles.lineDescription}>{line.description}</Text>
            <Text style={styles.lineAmount}>${(Math.round(line.quantity * line.unitPriceCents / 1000) / 100).toFixed(2)}</Text>
          </View>
        ))}
      </View>
      <InvoiceSummary invoice={calculated} />
      <PrimaryButton label="Create PDF to share" onPress={() => router.push(`/invoices/${detail.invoice.id}/share` as never)} />
      <Text style={styles.copy}>{detail.invoice.draft.paymentTerms}</Text>
      {detail.invoice.draft.notes ? <Text style={styles.copy}>{detail.invoice.draft.notes}</Text> : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.panel, borderRadius: radius.md, gap: spacing.md, padding: spacing.lg },
  client: { color: colors.muted, fontFamily: typography.body, fontSize: 18 },
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 15 },
  eyebrow: { color: colors.orange, fontFamily: typography.utility, fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
  lineAmount: { color: colors.warmWhite, fontFamily: typography.utility, fontSize: 14 },
  lineDescription: { color: colors.warmWhite, flex: 1, fontFamily: typography.body, fontSize: 15 },
  screen: { gap: spacing.lg },
})
