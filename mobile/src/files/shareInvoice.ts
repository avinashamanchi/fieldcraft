import * as Sharing from 'expo-sharing'

import type { PdfArtifact } from './invoicePdf'

export class InvoiceShareError extends Error {
  constructor(readonly code: 'SHARE_FAILED' | 'SHARE_UNAVAILABLE') {
    super('The invoice share sheet could not be opened.')
    this.name = 'InvoiceShareError'
  }
}

type SharingPort = {
  isAvailableAsync(): Promise<boolean>
  shareAsync(uri: string, options: { mimeType: string; UTI: string; dialogTitle: string }): Promise<void>
}

export const shareInvoicePdf = async (artifact: PdfArtifact, sharing: SharingPort = Sharing): Promise<'Share sheet opened'> => {
  try {
    if (!await sharing.isAvailableAsync()) throw new InvoiceShareError('SHARE_UNAVAILABLE')
    await sharing.shareAsync(artifact.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Share invoice' })
    return 'Share sheet opened'
  } catch (cause) {
    if (cause instanceof InvoiceShareError) throw cause
    throw new InvoiceShareError('SHARE_FAILED')
  } finally {
    await artifact.cleanup().catch(() => {})
  }
}
