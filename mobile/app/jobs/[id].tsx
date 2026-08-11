import * as Crypto from 'expo-crypto'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator } from 'react-native'

import { ConfirmRecordDeleteSheet } from '../../src/components/ConfirmRecordDeleteSheet'
import { ErrorState } from '../../src/components/ErrorState'
import { Screen } from '../../src/components/Screen'
import { useFieldCraftData } from '../../src/data/DataProvider'
import type { Client, Invoice, Job } from '../../src/domain/entities'
import { JobEditor } from '../../src/features/jobs/JobEditor'
import { deleteRecordMutation } from '../../src/features/recordMutation'
import { colors } from '../../src/theme/tokens'

export default function EditJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { owner, repository } = useFieldCraftData()
  const [state, setState] = useState<{ clients: Client[]; current: Job; linkedCount: number } | null>(null)
  const [missing, setMissing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => {
    let current = true
    void Promise.all([
      repository.get<Job>('job', id),
      repository.list<Client>('client'),
      repository.list<Invoice>('invoice'),
    ]).then(([job, clients, invoices]) => {
      if (!current) return
      if (!job) setMissing(true)
      else setState({ clients, current: job, linkedCount: invoices.filter((invoice) => invoice.jobId === id).length })
    })
    return () => { current = false }
  }, [id, repository])
  if (missing) return <Screen><ErrorState message="This job is no longer available." /></Screen>
  if (!owner.ownerId || !state) return <Screen><ActivityIndicator color={colors.orange} /></Screen>
  const remove = async () => {
    setDeleting(true)
    try {
      await repository.transactLocalMutation(deleteRecordMutation('job', state.current, Crypto.randomUUID(), new Date().toISOString()))
      router.replace('/(tabs)/jobs')
    } finally {
      setDeleting(false)
    }
  }
  return (
    <>
      <JobEditor clients={state.clients} current={state.current} onRequestDelete={() => setConfirming(true)} ownerId={owner.ownerId} repository={repository} />
      <ConfirmRecordDeleteSheet busy={deleting} linkedCount={state.linkedCount} onCancel={() => setConfirming(false)} onConfirm={() => { void remove() }} recordLabel="job" visible={confirming} />
    </>
  )
}
