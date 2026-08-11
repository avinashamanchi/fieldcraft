import { fireEvent, render, screen } from '@testing-library/react-native'

import { buildClientMutation, ClientDraftSchema, filterClients } from '../src/features/clients/clientForm'
import type { Client } from '../src/domain/entities'
import { ClientEditor } from '../src/features/clients/ClientEditor'
import { ConfirmRecordDeleteSheet } from '../src/components/ConfirmRecordDeleteSheet'

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }))
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000899' }))

const OWNER = 'owner-a'
const ID = '00000000-0000-4000-8000-000000000811'
const draft = { name: 'Mina García', phone: '+1 555 0100', email: 'mina@example.test', address: '', city: '', state: '', postalCode: '', notes: '' }

it('builds client create/update/delete mutations and preserves the owner contract', () => {
  const created = buildClientMutation({ draft, entityId: ID, mutationId: '00000000-0000-4000-8000-000000000812', now: '2026-08-06T10:00:00.000Z', ownerId: OWNER })
  const current = created.payload as Client
  expect(created).toMatchObject({ kind: 'create', baseVersion: null })
  expect(buildClientMutation({ current, draft: { ...draft, notes: 'Gate code 42' }, entityId: ID, mutationId: '00000000-0000-4000-8000-000000000813', now: '2026-08-06T11:00:00.000Z', ownerId: OWNER })).toMatchObject({ kind: 'update', baseVersion: 1 })
})

it('enforces client backend limits and literal Unicode search', () => {
  expect(() => ClientDraftSchema.parse({ ...draft, name: 'x'.repeat(201) })).toThrow()
  expect(() => ClientDraftSchema.parse({ ...draft, phone: '1'.repeat(65) })).toThrow()
  const client = buildClientMutation({ draft, entityId: ID, mutationId: '00000000-0000-4000-8000-000000000814', now: '2026-08-06T10:00:00.000Z', ownerId: OWNER }).payload as Client
  expect(filterClients([client], 'MINA GARCI\u0301A')).toEqual([client])
  expect(filterClients([client], '[invalid regex')).toEqual([])
})

it('suppresses duplicate save taps and retains the form after local failure', async () => {
  let rejectCommit: (error: Error) => void = () => {}
  const transaction = new Promise<void>((_resolve, reject) => { rejectCommit = reject })
  const repository = { transactLocalMutation: jest.fn(() => transaction) }
  render(<ClientEditor ownerId={OWNER} repository={repository as never} />)
  fireEvent.changeText(screen.getByTestId('client-name'), 'Retained Client')
  fireEvent.press(screen.getByTestId('save-client'))
  fireEvent.press(screen.getByTestId('save-client'))
  expect(repository.transactLocalMutation).toHaveBeenCalledTimes(1)

  rejectCommit(new Error('Local storage is unavailable'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Local storage is unavailable')
  expect(screen.getByTestId('client-name').props.value).toBe('Retained Client')
})

it('requires an explicit second action and blocks cloud-restricted linked deletion', () => {
  const onConfirm = jest.fn()
  render(
    <ConfirmRecordDeleteSheet
      linkedCount={2}
      onCancel={() => {}}
      onConfirm={onConfirm}
      recordLabel="client"
      visible
    />,
  )
  expect(screen.getByText(/cloud deletion is blocked while linked records exist/i)).toBeTruthy()
  fireEvent.press(screen.getByTestId('confirm-record-delete'))
  expect(onConfirm).not.toHaveBeenCalled()
})
