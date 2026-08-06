import { StyleSheet, Text, View } from 'react-native'

import type { CalculatedInvoice } from '../../domain/invoice'
import { colors, radius, spacing, typography } from '../../theme/tokens'

const money = (cents: number): string => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2,
}).format(cents / 100)

export const InvoiceSummary = ({ invoice }: { invoice: CalculatedInvoice }) => (
  <View accessibilityLabel="Invoice totals" style={styles.card}>
    <View style={styles.row}><Text style={styles.label}>Subtotal</Text><Text style={styles.value}>{money(invoice.subtotalCents)}</Text></View>
    <View style={styles.row}><Text style={styles.label}>Tax</Text><Text style={styles.value}>{money(invoice.taxCents)}</Text></View>
    <View style={[styles.row, styles.totalRow]}><Text style={styles.totalLabel}>Total</Text><Text style={styles.total}>{money(invoice.totalCents)}</Text></View>
    <Text style={styles.note}>Totals are calculated on this device from the editable line items.</Text>
  </View>
)

const styles = StyleSheet.create({
  card: { backgroundColor: colors.panel, borderRadius: radius.md, gap: spacing.sm, padding: spacing.lg },
  label: { color: colors.muted, fontFamily: typography.body, fontSize: 15 },
  note: { color: colors.muted, fontFamily: typography.body, fontSize: 12, marginTop: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  total: { color: colors.orange, fontFamily: typography.utility, fontSize: 24, fontWeight: '800' },
  totalLabel: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 18, fontWeight: '800' },
  totalRow: { alignItems: 'center', borderTopColor: '#3A3A3A', borderTopWidth: 1, paddingTop: spacing.md },
  value: { color: colors.warmWhite, fontFamily: typography.utility, fontSize: 15 },
})
