import { StyleSheet, Text, View } from 'react-native'

import type { Invoice, Payment } from '../../domain/entities'
import { calculatePaymentSummary } from '../../domain/payments'
import { colors, radius, spacing, typography } from '../../theme/tokens'

const money = (cents: number): string => `$${(cents / 100).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`

export const PaymentHistory = ({ invoice, payments }: Readonly<{
  invoice: Invoice
  payments: readonly Payment[]
}>) => {
  const summary = calculatePaymentSummary(invoice.totalCents, payments.map((payment) => ({
    amountCents: payment.amountCents,
    currency: payment.currency,
    status: payment.status,
    refundedCents: payment.refundedCents,
  })))
  const displayed = payments.slice(0, 50)
  return (
    <View accessibilityLabel="Payment history and balance" style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>Payments</Text>
      {payments.length === 0 ? <Text style={styles.copy}>No payments recorded.</Text> : displayed.map((payment) => (
        <View key={payment.id} style={styles.row}>
          <View style={styles.rowCopy}>
            <Text style={styles.amount}>{money(payment.amountCents)}</Text>
            <Text style={styles.copy}>{payment.manual ? `Owner recorded · ${payment.method}` : `Provider recorded · ${payment.method}`}</Text>
            <Text style={styles.copy}>{payment.status}{payment.refundedCents ? ` · ${money(payment.refundedCents)} refunded` : ''}</Text>
          </View>
          <Text style={styles.sync}>{payment.syncState === 'current' ? 'Cloud' : 'Pending'}</Text>
        </View>
      ))}
      {payments.length > displayed.length ? <Text style={styles.copy}>Showing the newest 50 of {payments.length.toLocaleString()} payment records.</Text> : null}
      <View style={styles.summary}>
        <Text style={styles.copy}>Paid {money(summary.paidCents)}</Text>
        <Text style={styles.balance}>Balance {money(summary.balanceCents)}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  amount: { color: colors.warmWhite, fontFamily: typography.utility, fontSize: 16, fontWeight: '800' },
  balance: { color: colors.warmWhite, fontFamily: typography.utility, fontSize: 18, fontWeight: '800' },
  card: { backgroundColor: colors.panel, borderRadius: radius.md, gap: spacing.md, padding: spacing.lg },
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 14, lineHeight: 20 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 22, fontWeight: '800' },
  row: { alignItems: 'flex-start', borderBottomColor: '#444', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between', paddingBottom: spacing.md },
  rowCopy: { flex: 1, gap: spacing.xs },
  summary: { alignItems: 'flex-end', gap: spacing.xs },
  sync: { color: colors.orange, fontFamily: typography.utility, fontSize: 12 },
})
