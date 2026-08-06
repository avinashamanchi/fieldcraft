import type { EntityName, MutationEnvelope } from '../domain/sync'
import type { VersionedEntity } from '../domain/entities'

export type MutationBuildInput<T extends VersionedEntity> = {
  current?: T
  entityId: string
  mutationId: string
  now: string
  ownerId: string
}

export const recordMutation = <T extends VersionedEntity>(
  entity: EntityName,
  input: MutationBuildInput<T>,
  payload: T,
): MutationEnvelope => ({
  id: input.mutationId,
  ownerId: input.ownerId,
  entity,
  entityId: input.entityId,
  kind: input.current ? 'update' : 'create',
  baseVersion: input.current?.version ?? null,
  payload,
  createdAt: input.now,
  attempts: 0,
})

export const deleteRecordMutation = (
  entity: EntityName,
  current: VersionedEntity,
  mutationId: string,
  now: string,
): MutationEnvelope => ({
  id: mutationId,
  ownerId: current.ownerId,
  entity,
  entityId: current.id,
  kind: 'delete',
  baseVersion: current.version,
  payload: null,
  createdAt: now,
  attempts: 0,
})

export const codePointLength = (value: string): number => Array.from(value).length
export const literalSearch = (value: string, query: string): boolean => value
  .normalize('NFKD')
  .replace(/\p{M}/gu, '')
  .toLocaleLowerCase()
  .includes(query.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase())
