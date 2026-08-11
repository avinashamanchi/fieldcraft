import { canonicalStringify } from '../data/outbox'
import type { ExportRecord } from './exportSchemas'

const formulaPrefix = /^[=+\-@]/

export const escapeCsvCell = (value: string): string => {
  const safe = formulaPrefix.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

export const exportRecordsToCsv = (records: readonly ExportRecord[]): string => {
  const header = ['entity', 'id', 'label', 'version', 'createdAt', 'updatedAt', 'data'].map(escapeCsvCell).join(',')
  const rows = records.map(({ entity, data }) => [
    entity,
    String(data.id ?? ''),
    String(data.name ?? data.title ?? data.vendor ?? data.number ?? ''),
    String(data.version ?? ''),
    String(data.createdAt ?? ''),
    String(data.updatedAt ?? ''),
    canonicalStringify(data),
  ].map(escapeCsvCell).join(','))
  return `${[header, ...rows].join('\n')}\n`
}
