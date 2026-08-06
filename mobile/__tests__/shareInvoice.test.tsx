import { act, fireEvent, render, screen } from '@testing-library/react-native'

import { InvoiceSharePreview } from '../src/components/InvoiceSharePreview'
import { shareInvoicePdf } from '../src/files/shareInvoice'

it('opens the share sheet explicitly, never claims delivery, and always cleans up', async () => {
  const cleanup = jest.fn(async () => {})
  const shareAsync = jest.fn(async () => {})
  await expect(shareInvoicePdf({ uri: 'file:///invoice.pdf', cleanup }, { isAvailableAsync: async () => true, shareAsync })).resolves.toBe('Share sheet opened')
  expect(shareAsync).toHaveBeenCalledWith('file:///invoice.pdf', expect.objectContaining({ mimeType: 'application/pdf' }))
  expect(cleanup).toHaveBeenCalled()
  await expect(shareInvoicePdf({ uri: 'file:///invoice.pdf', cleanup }, { isAvailableAsync: async () => false, shareAsync })).rejects.toMatchObject({ code: 'SHARE_UNAVAILABLE' })
  expect(cleanup).toHaveBeenCalledTimes(2)
})

it('suppresses duplicate share taps and uses truthful UI copy', async () => {
  let resolve!: (value: string) => void
  const share = jest.fn(() => new Promise<string>((done) => { resolve = done }))
  render(<InvoiceSharePreview createPdf={async () => ({ uri: 'file:///invoice.pdf', cleanup: async () => {} })} share={share} />)
  fireEvent.press(screen.getByTestId('share-invoice'))
  fireEvent.press(screen.getByTestId('share-invoice'))
  await act(async () => { await Promise.resolve() })
  expect(share).toHaveBeenCalledTimes(1)
  await act(async () => { resolve('Share sheet opened'); await Promise.resolve() })
  expect(screen.getByText('Share sheet opened')).toBeTruthy()
  expect(screen.queryByText(/invoice sent/i)).toBeNull()
})
