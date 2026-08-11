import type { AuthenticatedOwnerLease } from '../auth/AuthProvider'
import { SQLiteFieldCraftRepository, type SQLiteFieldCraftRepositoryOptions } from '../data/sqliteRepository'
import type { Client, Estimate, Invoice, Job } from '../domain/entities'
import type { MutationEnvelope } from '../domain/sync'
import {
  evaluateFeature,
  ownerLeasesEqual,
  type Feature,
  type FeatureCounts,
  type FeatureDecision,
  type ProEntitlement,
} from '../domain/monetization'
import { EntitlementStore } from './entitlementStore'

export type AdmissionReceipt = Readonly<{
  ownerId: string
  mutationId: string
  feature: Feature
  decision: FeatureDecision
}>

export type FeatureAdmissionGateway = Readonly<{
  reserve(
    lease: AuthenticatedOwnerLease,
    mutationId: string,
    feature: Feature,
  ): Promise<AdmissionReceipt>
}>

type Options = FeatureAdmissionGateway & Readonly<{
  currentLease(): AuthenticatedOwnerLease | null
  currentEntitlement(): ProEntitlement
}>

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const stale: FeatureDecision = { allowed: false, reason: 'ENTITLEMENT_STALE' }
const isAtOrAbove = (value: number, limit: number): boolean => (
  !Number.isSafeInteger(value) || value < 0 || value >= limit
)

export class FeatureAdmissionService {
  private readonly completed = new Map<string, FeatureDecision>()
  private readonly inFlight = new Map<string, Promise<FeatureDecision>>()

  constructor(private readonly options: Options) {}

  async admit(
    mutationId: string,
    feature: Feature,
    counts: FeatureCounts,
  ): Promise<FeatureDecision> {
    if (!UUID_V4.test(mutationId)) return stale
    const entitlement = this.options.currentEntitlement()
    const local = evaluateFeature(feature, entitlement, counts)
    const requiresAdmission = local.allowed && (
      feature === 'stripe-payment-link' ||
      feature === 'scheduled-reminder' ||
      feature === 'revenue-dashboard' ||
      (feature === 'create-client' && isAtOrAbove(counts.clients, 10)) ||
      (feature === 'create-open-job' && isAtOrAbove(counts.openJobs, 3)) ||
      (feature === 'issue-document' && isAtOrAbove(counts.issuedDocumentsPerRolling30Days, 5))
    )
    if (!requiresAdmission) return local
    const lease = this.options.currentLease()
    if (!lease || entitlement.state !== 'pro') return stale
    const key = [
      lease.ownerId,
      lease.sessionGeneration,
      lease.repositoryRevision,
      mutationId,
      feature,
    ].join(':')
    const prior = this.completed.get(key)
    if (prior) return prior
    const pending = this.inFlight.get(key)
    if (pending) return pending

    const reservation = this.reserveBound(lease, mutationId, feature, key)
    this.inFlight.set(key, reservation)
    try {
      return await reservation
    } finally {
      this.inFlight.delete(key)
    }
  }

  private async reserveBound(
    lease: AuthenticatedOwnerLease,
    mutationId: string,
    feature: Feature,
    key: string,
  ): Promise<FeatureDecision> {
    try {
      const receipt = await this.options.reserve(lease, mutationId, feature)
      if (
        !ownerLeasesEqual(this.options.currentLease(), lease) ||
        receipt.ownerId !== lease.ownerId ||
        receipt.mutationId !== mutationId ||
        receipt.feature !== feature
      ) return stale
      this.completed.set(key, receipt.decision)
      return receipt.decision
    } catch {
      return stale
    }
  }
}

type ControlledRepositoryOptions = SQLiteFieldCraftRepositoryOptions & Readonly<{
  entitlementStore: EntitlementStore
  gateway: FeatureAdmissionGateway
}>

const OPEN_JOB_STATUSES = new Set(['Scheduled', 'In Progress'])
const ISSUED_DOCUMENT_STATUSES = new Set(['Issued', 'Viewed', 'Partially Paid', 'Paid'])

const rawRecord = (value: unknown): Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
)

const readableDenial = (decision: Exclude<FeatureDecision, { allowed: true }>): string => {
  if (decision.reason === 'FREE_LIMIT') {
    return `The Free plan limit of ${decision.limit ?? 'this feature'} has been reached. Upgrade to FieldCraft Pro to continue.`
  }
  if (decision.reason === 'PRO_REQUIRED') return 'This feature requires a verified FieldCraft Pro subscription.'
  return 'FieldCraft could not verify Pro securely. Connect to the internet and try again.'
}

export class AdmissionControlledFieldCraftRepository extends SQLiteFieldCraftRepository {
  private readonly admissions: FeatureAdmissionService

  constructor({ entitlementStore, gateway, ...options }: ControlledRepositoryOptions) {
    super(options)
    this.admissions = new FeatureAdmissionService({
      ...gateway,
      currentLease: entitlementStore.getLease,
      currentEntitlement: entitlementStore.get,
    })
  }

  override async transactLocalMutation(mutation: MutationEnvelope): Promise<void> {
    const features = await this.featuresFor(mutation)
    if (features.length > 0) {
      const counts = await this.featureCounts()
      for (const feature of features) {
        const decision = await this.admissions.admit(mutation.id, feature, counts)
        if (!decision.allowed) throw new Error(readableDenial(decision))
      }
    }
    await super.transactLocalMutation(mutation)
  }

  private async featuresFor(mutation: MutationEnvelope): Promise<Feature[]> {
    const payload = rawRecord(mutation.payload)
    if (mutation.kind === 'issue_invoice') return ['issue-document']
    if (mutation.kind === 'save_estimate') {
      const local = rawRecord(payload.localEstimate)
      if (local.status !== 'Issued') return []
      const current = await this.get<Estimate>('estimate', mutation.entityId)
      return current && current.status !== 'Draft' ? [] : ['issue-document']
    }
    if (mutation.kind === 'create') {
      if (mutation.entity === 'client') return ['create-client']
      if (mutation.entity === 'job' && OPEN_JOB_STATUSES.has(String(payload.status))) {
        return ['create-open-job']
      }
      if (mutation.entity === 'invoice' && ISSUED_DOCUMENT_STATUSES.has(String(payload.status))) {
        return ['issue-document']
      }
      return []
    }
    if (mutation.kind === 'update' && mutation.entity === 'job' && OPEN_JOB_STATUSES.has(String(payload.status))) {
      const current = await this.get<Job>('job', mutation.entityId)
      return current && !OPEN_JOB_STATUSES.has(current.status) ? ['create-open-job'] : []
    }
    if (mutation.kind === 'update' && mutation.entity === 'invoice' && ISSUED_DOCUMENT_STATUSES.has(String(payload.status))) {
      const current = rawRecord(await this.get<Invoice>('invoice', mutation.entityId))
      return !ISSUED_DOCUMENT_STATUSES.has(String(current.status)) ? ['issue-document'] : []
    }
    if (mutation.kind !== 'save_invoice_bundle') return []
    const features: Feature[] = []
    const client = rawRecord(payload.client)
    const job = rawRecord(payload.job)
    const invoice = rawRecord(payload.invoice)
    if (typeof client.id === 'string' && await this.get<Client>('client', client.id) === null) {
      features.push('create-client')
    }
    if (
      typeof job.id === 'string' && OPEN_JOB_STATUSES.has(String(job.status)) &&
      await this.get<Job>('job', job.id) === null
    ) features.push('create-open-job')
    if (
      typeof invoice.id === 'string' && ISSUED_DOCUMENT_STATUSES.has(String(invoice.status)) &&
      await this.get<Invoice>('invoice', invoice.id) === null
    ) features.push('issue-document')
    return features
  }

  private async featureCounts(): Promise<FeatureCounts> {
    const rollingBoundary = Date.now() - 30 * 24 * 60 * 60 * 1000
    const count = async <T>(
      entity: 'client' | 'job' | 'invoice' | 'estimate',
      include: (value: T) => boolean,
    ): Promise<number> => {
      let total = 0
      let after: { updatedAt: string; id: string } | null = null
      do {
        const page: { items: T[]; next: { updatedAt: string; id: string } | null } =
          await this.listPage<T>(entity, { limit: 50, after })
        for (const item of page.items) if (include(item)) total += 1
        after = page.next
      } while (after !== null)
      return total
    }
    const [clients, openJobs, issuedInvoices, issuedEstimates] = await Promise.all([
      count<Client>('client', () => true),
      count<Job>('job', (job) => OPEN_JOB_STATUSES.has(job.status)),
      count<Invoice>('invoice', (invoice) => {
        const raw = rawRecord(invoice)
        const issuedAt = raw.sentAt ?? (
          ISSUED_DOCUMENT_STATUSES.has(String(raw.status)) ? invoice.issuedAt ?? invoice.createdAt : null
        )
        return typeof issuedAt === 'string' && Date.parse(issuedAt) >= rollingBoundary
      }),
      count<Estimate>('estimate', (estimate) => (
        ['Issued', 'Accepted', 'Converted'].includes(estimate.status) &&
        typeof estimate.issuedAt === 'string' && Date.parse(estimate.issuedAt) >= rollingBoundary
      )),
    ])
    return {
      clients,
      openJobs,
      issuedDocumentsPerRolling30Days: issuedInvoices + issuedEstimates,
    }
  }
}
