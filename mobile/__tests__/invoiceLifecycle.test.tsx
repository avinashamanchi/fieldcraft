import { act, render } from '@testing-library/react-native'
import { useEffect } from 'react'

import type { InvoiceDraft } from '../src/domain/entities'
import {
  InvoiceSessionProvider,
  useInvoiceSession,
  type InvoiceSessionContextValue,
} from '../src/features/invoices/invoiceSession'

const draft: InvoiceDraft = {
  clientName: 'Mina', jobTitle: 'Valve replacement', tradeType: 'Plumbing', taxBasisPoints: 0,
  paymentTerms: 'Due on receipt', lineItems: [{ description: 'Labor', type: 'labor', quantity: 1000, unitPriceCents: 10_000 }],
}

const Harness = ({ onValue }: { onValue(value: InvoiceSessionContextValue): void }) => {
  const value = useInvoiceSession()
  useEffect(() => onValue(value), [onValue, value])
  return null
}

it('invalidates a stale AI result after a manual edit', async () => {
  let resolveAi!: (value: InvoiceDraft) => void
  const ai = { parseInvoice: jest.fn(() => new Promise<InvoiceDraft>((resolve) => { resolveAi = resolve })) }
  const repository = { list: jest.fn(async () => []), transactLocalMutation: jest.fn(async () => {}) }
  let session!: InvoiceSessionContextValue
  render(
    <InvoiceSessionProvider ai={ai} ownerId="owner-a" repository={repository}>
      <Harness onValue={(value) => { session = value }} />
    </InvoiceSessionProvider>,
  )
  await act(async () => { void session.parseTranscript('replace a valve') })
  act(() => session.reviewManual(draft))
  await act(async () => { resolveAi({ ...draft, clientName: 'Stale AI' }); await Promise.resolve() })
  expect(session.state).toMatchObject({ step: 'review', source: 'manual', draft: { clientName: 'Mina' } })
})

it('suppresses duplicate saves and retains the same draft after failure', async () => {
  let rejectSave!: (error: Error) => void
  const commit = new Promise<void>((_resolve, reject) => { rejectSave = reject })
  const repository = { list: jest.fn(async () => []), transactLocalMutation: jest.fn(() => commit) }
  let session!: InvoiceSessionContextValue
  render(
    <InvoiceSessionProvider ownerId="owner-a" repository={repository}>
      <Harness onValue={(value) => { session = value }} />
    </InvoiceSessionProvider>,
  )
  act(() => session.reviewManual(draft))
  await act(async () => {
    const first = session.save()
    const second = session.save()
    await Promise.resolve()
    expect(repository.transactLocalMutation).toHaveBeenCalledTimes(1)
    rejectSave(new Error('disk busy'))
    await Promise.all([first, second])
  })
  expect(session.state).toMatchObject({ step: 'error', draft: { clientName: 'Mina' }, code: 'local-save-failed' })
})

it('cancels active work when the owner changes', async () => {
  const ai = { parseInvoice: jest.fn((_owner: string, _transcript: string, signal: AbortSignal) => new Promise<InvoiceDraft>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
  })) }
  const repository = { list: jest.fn(async () => []), transactLocalMutation: jest.fn(async () => {}) }
  let session!: InvoiceSessionContextValue
  const view = render(
    <InvoiceSessionProvider ai={ai} ownerId="owner-a" repository={repository}>
      <Harness onValue={(value) => { session = value }} />
    </InvoiceSessionProvider>,
  )
  await act(async () => { void session.parseTranscript('replace a valve') })
  view.rerender(
    <InvoiceSessionProvider ai={ai} ownerId={null} repository={repository}>
      <Harness onValue={(value) => { session = value }} />
    </InvoiceSessionProvider>,
  )
  expect(session.state).toMatchObject({ step: 'entry', transcript: '' })
})
