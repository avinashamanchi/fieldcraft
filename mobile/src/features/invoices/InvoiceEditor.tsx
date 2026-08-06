import { Pressable, StyleSheet, Text, View } from 'react-native'

import { FormField } from '../../components/FormField'
import { PrimaryButton } from '../../components/PrimaryButton'
import type { InvoiceDraft, LineItemDraft, PaymentTerms, TradeType } from '../../domain/entities'
import { calculateInvoice, InvoiceDraftSchema } from '../../domain/invoice'
import { MAX_INVOICE_LINE_ITEMS } from '../../domain/limits'
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '../../theme/tokens'
import { InvoiceSummary } from './InvoiceSummary'

const TRADES: TradeType[] = ['Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'General', 'Roofing', 'Flooring', 'Painting']
const TERMS: PaymentTerms[] = ['Due on receipt', 'Net 14', 'Net 30']
const emptyLine = (): LineItemDraft => ({ description: '', type: 'labor', quantity: 1000, unitPriceCents: 0 })

export const canAddInvoiceLine = (lines: unknown[]): boolean => lines.length < MAX_INVOICE_LINE_ITEMS

type InvoiceEditorProps = {
  continueLabel?: string
  draft: InvoiceDraft
  onChange(draft: InvoiceDraft): void
  onContinue(): void
  saving?: boolean
}

export const InvoiceEditor = ({ continueLabel = 'Review invoice', draft, onChange, onContinue, saving = false }: InvoiceEditorProps) => {
  const update = <K extends keyof InvoiceDraft>(key: K, value: InvoiceDraft[K]) => onChange({ ...draft, [key]: value })
  const updateLine = (index: number, patch: Partial<LineItemDraft>) => update('lineItems', draft.lineItems.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line))
  const validation = InvoiceDraftSchema.safeParse(draft)
  let calculated = null
  if (validation.success) {
    try { calculated = calculateInvoice(draft) } catch { calculated = null }
  }
  return (
    <View style={styles.form}>
      <FormField label="Client name" maxLength={200} onChangeText={(value) => update('clientName', value)} testID="invoice-client" value={draft.clientName} />
      <FormField label="Job title" maxLength={200} onChangeText={(value) => update('jobTitle', value)} testID="invoice-job-title" value={draft.jobTitle} />
      <FormField label="Job address" maxLength={500} onChangeText={(value) => update('jobAddress', value)} value={draft.jobAddress ?? ''} />
      <FormField label="Job description" maxLength={4000} multiline onChangeText={(value) => update('jobDescription', value)} value={draft.jobDescription ?? ''} />
      <Text style={styles.label}>Trade</Text>
      <View style={styles.choices}>{TRADES.map((trade) => (
        <Pressable accessibilityRole="radio" accessibilityState={{ checked: draft.tradeType === trade }} key={trade} onPress={() => update('tradeType', trade)} style={[styles.choice, draft.tradeType === trade && styles.selected]}>
          <Text style={styles.choiceText}>{trade}</Text>
        </Pressable>
      ))}</View>
      <Text accessibilityRole="header" style={styles.section}>Line items</Text>
      {draft.lineItems.map((line, index) => (
        <View key={line.id ?? `line-${index}`} style={styles.lineCard}>
          <FormField label={`Description ${index + 1}`} maxLength={500} onChangeText={(value) => updateLine(index, { description: value })} testID={`line-description-${index}`} value={line.description} />
          <View style={styles.choices}>{(['labor', 'material'] as const).map((type) => (
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: line.type === type }} key={type} onPress={() => updateLine(index, { type })} style={[styles.choice, line.type === type && styles.selected]}>
              <Text style={styles.choiceText}>{type === 'labor' ? 'Labor' : 'Material'}</Text>
            </Pressable>
          ))}</View>
          <FormField keyboardType="decimal-pad" label="Quantity" onChangeText={(value) => updateLine(index, { quantity: Math.round((Number(value) || 0) * 1000) })} testID={`line-quantity-${index}`} value={String(line.quantity / 1000)} />
          <FormField keyboardType="decimal-pad" label="Unit price ($)" onChangeText={(value) => updateLine(index, { unitPriceCents: Math.round((Number(value) || 0) * 100) })} testID={`line-price-${index}`} value={(line.unitPriceCents / 100).toFixed(2)} />
          {draft.lineItems.length > 1 ? <Pressable accessibilityRole="button" onPress={() => update('lineItems', draft.lineItems.filter((_item, lineIndex) => lineIndex !== index))} style={styles.remove}><Text style={styles.removeText}>Remove line</Text></Pressable> : null}
        </View>
      ))}
      <PrimaryButton disabled={!canAddInvoiceLine(draft.lineItems)} label="Add line item" onPress={() => update('lineItems', [...draft.lineItems, emptyLine()])} />
      <FormField keyboardType="decimal-pad" label="Tax rate (%)" onChangeText={(value) => update('taxBasisPoints', Math.round((Number(value) || 0) * 100))} value={(draft.taxBasisPoints / 100).toFixed(2)} />
      <Text style={styles.label}>Payment terms</Text>
      <View style={styles.choices}>{TERMS.map((term) => (
        <Pressable accessibilityRole="radio" accessibilityState={{ checked: draft.paymentTerms === term }} key={term} onPress={() => update('paymentTerms', term)} style={[styles.choice, draft.paymentTerms === term && styles.selected]}><Text style={styles.choiceText}>{term}</Text></Pressable>
      ))}</View>
      <FormField label="Notes" maxLength={4000} multiline onChangeText={(value) => update('notes', value)} value={draft.notes ?? ''} />
      {calculated ? <InvoiceSummary invoice={calculated} /> : <Text accessibilityRole="alert" style={styles.error}>Complete the required fields with valid amounts to continue.</Text>}
      <PrimaryButton disabled={!calculated || saving} label={saving ? 'Saving…' : continueLabel} onPress={onContinue} testID="continue-invoice" />
    </View>
  )
}

const styles = StyleSheet.create({
  choice: { borderColor: '#444', borderRadius: radius.sm, borderWidth: 1, justifyContent: 'center', minHeight: MIN_TOUCH_TARGET, paddingHorizontal: spacing.md },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choiceText: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 14 },
  error: { color: colors.danger, fontFamily: typography.body, fontSize: 14 },
  form: { gap: spacing.lg },
  label: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 14, fontWeight: '700' },
  lineCard: { backgroundColor: colors.panel, borderRadius: radius.md, gap: spacing.md, padding: spacing.md },
  remove: { alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH_TARGET },
  removeText: { color: colors.danger, fontFamily: typography.body, fontWeight: '700' },
  section: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 24, fontWeight: '800' },
  selected: { borderColor: colors.orange },
})
