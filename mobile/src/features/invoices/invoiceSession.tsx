import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { getAiClient } from '../../ai/aiClient'
import { AI_CONSENT_VERSION } from '../../ai/contracts'
import type { Client, InvoiceDraft, TradeType } from '../../domain/entities'
import { InvoiceDraftSchema } from '../../domain/invoice'
import type { MutationEnvelope } from '../../domain/sync'
import {
  createInvoiceBundleSaveOperation,
  matchClientByName,
  type BundleIds,
  type InvoiceBundleSaveOperation,
} from './saveInvoiceBundle'

export type InvoiceFlowErrorCode =
  | 'ai-consent-required'
  | 'ai-invalid-response'
  | 'ai-unavailable'
  | 'local-save-failed'
  | 'owner-unavailable'

export type InvoiceSessionState =
  | { step: 'entry'; inputMode: 'manual' | 'voice'; transcript: string }
  | { step: 'parsing'; transcript: string; requestId: string }
  | { step: 'review'; draft: InvoiceDraft; source: 'manual' | 'ai' }
  | { step: 'saving'; draft: InvoiceDraft; mutationId: string }
  | { step: 'complete'; ids: BundleIds; syncState: 'pending' | 'current' }
  | { step: 'error'; draft: InvoiceDraft | null; code: InvoiceFlowErrorCode }

type InvoiceRepository = {
  list<T>(entity: 'client'): Promise<T[]>
  transactLocalMutation(mutation: MutationEnvelope): Promise<void>
}

type InvoiceAi = {
  parseInvoice(ownerId: string, transcript: string, signal: AbortSignal): Promise<InvoiceDraft>
}

type InvoiceDefaults = { tradeType: TradeType; hourlyRateCents: number; taxBasisPoints: number }

export type InvoiceSessionContextValue = {
  state: InvoiceSessionState
  cancel(): void
  editDraft(draft: InvoiceDraft): void
  parseTranscript(transcript: string): Promise<void>
  reset(inputMode?: 'manual' | 'voice'): void
  reviewManual(draft: InvoiceDraft): void
  save(): Promise<void>
  setTranscript(transcript: string): void
}

type InvoiceSessionProviderProps = PropsWithChildren<{
  ai?: InvoiceAi
  defaults?: InvoiceDefaults
  ownerId: string | null
  repository: InvoiceRepository
}>

const entryState = (inputMode: 'manual' | 'voice' = 'manual'): InvoiceSessionState => ({
  step: 'entry', inputMode, transcript: '',
})

const InvoiceSessionContext = createContext<InvoiceSessionContextValue | null>(null)

const errorReason = (cause: unknown): InvoiceFlowErrorCode => {
  if (typeof cause === 'object' && cause !== null && 'reason' in cause) {
    if ((cause as { reason?: unknown }).reason === 'consent-required') return 'ai-consent-required'
    if ((cause as { reason?: unknown }).reason === 'invalid-response' || (cause as { reason?: unknown }).reason === 'validation') return 'ai-invalid-response'
  }
  return 'ai-unavailable'
}

export const InvoiceSessionProvider = ({
  ai,
  children,
  defaults = { tradeType: 'General', hourlyRateCents: 0, taxBasisPoints: 0 },
  ownerId,
  repository,
}: InvoiceSessionProviderProps) => {
  const [state, setState] = useState<InvoiceSessionState>(() => entryState())
  const stateRef = useRef(state)
  const generation = useRef(0)
  const activeAi = useRef<AbortController | null>(null)
  const operation = useRef<InvoiceBundleSaveOperation | null>(null)
  const savePromise = useRef<Promise<void> | null>(null)

  const publish = useCallback((next: InvoiceSessionState) => {
    stateRef.current = next
    setState(next)
  }, [])

  const invalidate = useCallback(() => {
    generation.current += 1
    activeAi.current?.abort()
    activeAi.current = null
  }, [])

  const reset = useCallback((inputMode: 'manual' | 'voice' = 'manual') => {
    invalidate()
    operation.current = null
    publish(entryState(inputMode))
  }, [invalidate, publish])

  useEffect(() => {
    reset()
    return invalidate
  }, [invalidate, ownerId, reset])

  const reviewManual = useCallback((draft: InvoiceDraft) => {
    invalidate()
    operation.current = null
    publish({ step: 'review', draft, source: 'manual' })
  }, [invalidate, publish])

  const editDraft = useCallback((draft: InvoiceDraft) => {
    invalidate()
    operation.current = null
    publish({ step: 'review', draft, source: 'manual' })
  }, [invalidate, publish])

  const setTranscript = useCallback((transcript: string) => {
    const current = stateRef.current
    if (current.step !== 'entry') return
    publish({ ...current, transcript })
  }, [publish])

  const parseTranscript = useCallback(async (transcript: string) => {
    if (!ownerId) {
      publish({ step: 'error', draft: null, code: 'owner-unavailable' })
      return
    }
    invalidate()
    operation.current = null
    const requestGeneration = generation.current
    const controller = new AbortController()
    activeAi.current = controller
    const requestId = `${requestGeneration}-${Date.now()}`
    publish({ step: 'parsing', transcript, requestId })
    try {
      const parsed = ai
        ? await ai.parseInvoice(ownerId, transcript, controller.signal)
        : await getAiClient().request(ownerId, {
            route: 'invoice.parse.v1', consentVersion: AI_CONSENT_VERSION,
            transcript, defaults,
          }, controller.signal)
      if (controller.signal.aborted || requestGeneration !== generation.current) return
      const validated = InvoiceDraftSchema.safeParse(parsed)
      if (!validated.success) {
        publish({ step: 'error', draft: null, code: 'ai-invalid-response' })
        return
      }
      publish({ step: 'review', draft: validated.data as InvoiceDraft, source: 'ai' })
    } catch (cause) {
      if (controller.signal.aborted || requestGeneration !== generation.current) return
      publish({ step: 'error', draft: null, code: errorReason(cause) })
    } finally {
      if (activeAi.current === controller) activeAi.current = null
    }
  }, [ai, defaults, invalidate, ownerId, publish])

  const save = useCallback((): Promise<void> => {
    if (savePromise.current) return savePromise.current
    const current = stateRef.current
    const draft = current.step === 'review' ? current.draft : current.step === 'error' ? current.draft : null
    if (!draft || !ownerId) {
      if (!ownerId) publish({ step: 'error', draft, code: 'owner-unavailable' })
      return Promise.resolve()
    }
    const saveGeneration = generation.current
    const pending = (async () => {
      try {
        if (!operation.current) {
          const clients = await repository.list<Client>('client')
          if (saveGeneration !== generation.current) return
          operation.current = createInvoiceBundleSaveOperation(draft, {
            ownerId, repository, existingClient: matchClientByName(clients, draft.clientName),
          })
        }
        publish({ step: 'saving', draft, mutationId: operation.current.ids.mutationId })
        const ids = await operation.current.save()
        if (saveGeneration === generation.current) publish({ step: 'complete', ids, syncState: 'pending' })
      } catch {
        if (saveGeneration === generation.current) publish({ step: 'error', draft, code: 'local-save-failed' })
      }
    })()
    savePromise.current = pending
    void pending.finally(() => {
      if (savePromise.current === pending) savePromise.current = null
    })
    return pending
  }, [ownerId, publish, repository])

  const value = useMemo<InvoiceSessionContextValue>(() => ({
    state, cancel: () => reset(), editDraft, parseTranscript, reset, reviewManual, save, setTranscript,
  }), [editDraft, parseTranscript, reset, reviewManual, save, setTranscript, state])

  return <InvoiceSessionContext.Provider value={value}>{children}</InvoiceSessionContext.Provider>
}

export const useInvoiceSession = (): InvoiceSessionContextValue => {
  const context = useContext(InvoiceSessionContext)
  if (!context) throw new Error('useInvoiceSession must be used inside InvoiceSessionProvider')
  return context
}
