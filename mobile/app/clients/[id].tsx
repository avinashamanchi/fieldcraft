import * as Crypto from 'expo-crypto'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator } from 'react-native'

import { ConfirmRecordDeleteSheet } from '../../src/components/ConfirmRecordDeleteSheet'
import { ErrorState } from '../../src/components/ErrorState'
import { Screen } from '../../src/components/Screen'
import { useFieldCraftData } from '../../src/data/DataProvider'
import type { Client, Job } from '../../src/domain/entities'
import { ClientEditor } from '../../src/features/clients/ClientEditor'
import { deleteRecordMutation } from '../../src/features/recordMutation'
import { colors } from '../../src/theme/tokens'

export default function EditClientScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { owner, repository } = useFieldCraftData()
  const [state, setState] = useState<{ current: Client; linkedCount: number } | null>(null)
  const [missing, setMissing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => {
    let active = true
    void Promise.all([repository.get<Client>('client', id), repository.list<Job>('job')]).then(([client, jobs]) => {
      if (!active) return
      if (!client) setMissing(true)
      else setState({ current: client, linkedCount: jobs.filter((job) => job.clientId === id).length })
    })
    return () => { active = false }
  }, [id, repository])
  if (missing) return <Screen><ErrorState message="This client is no longer available." /></Screen>
  if (!owner.ownerId || !state) return <Screen><ActivityIndicator color={colors.orange} /></Screen>
  const remove = async () => {
    setDeleting(true)
    try {
      await repository.transactLocalMutation(deleteRecordMutation('client', state.current, Crypto.randomUUID(), new Date().toISOString()))
      router.replace('/(tabs)/clients')
    } finally {
      setDeleting(false)
    }
  }
  return (
    <>
      <ClientEditor current={state.current} onRequestDelete={() => setConfirming(true)} ownerId={owner.ownerId} repository={repository} />
      <ConfirmRecordDeleteSheet busy={deleting} linkedCount={state.linkedCount} onCancel={() => setConfirming(false)} onConfirm={() => { void remove() }} recordLabel="client" visible={confirming} />
    </>
  )
}
