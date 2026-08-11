export type PrecisePostgresTimestamp = {
  wholeSecondMilliseconds: number
  microseconds: number
}

const POSTGRES_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/

const daysInMonth = (year: number, month: number): number => {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

export const parsePostgresTimestamp = (value: string): PrecisePostgresTimestamp => {
  const match = POSTGRES_TIMESTAMP_PATTERN.exec(value)
  if (!match) throw new Error('Invalid PostgreSQL timestamp')

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offset = match[8]
  const offsetHour = offset === 'Z' ? 0 : Number(offset.slice(1, 3))
  const offsetMinute = offset === 'Z' ? 0 : Number(offset.slice(4, 6))

  if (
    year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) ||
    hour > 23 || minute > 59 || second > 59 || offsetHour > 15 || offsetMinute > 59
  ) {
    throw new Error('Invalid PostgreSQL timestamp')
  }

  const wholeSecondMilliseconds = Date.parse(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${offset}`,
  )
  if (!Number.isFinite(wholeSecondMilliseconds)) {
    throw new Error('Invalid PostgreSQL timestamp')
  }
  return {
    wholeSecondMilliseconds,
    microseconds: Number((match[7] ?? '').padEnd(6, '0')),
  }
}
