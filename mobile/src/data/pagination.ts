export const MAX_LOCAL_PAGE_SIZE = 50

export type PageCursor = {
  updatedAt: string
  id: string
}

export type PageRequest = {
  limit: number
  after: PageCursor | null
}

export type Page<T> = {
  items: T[]
  next: PageCursor | null
}

export const validatePageRequest = (request: PageRequest): PageRequest => {
  if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > MAX_LOCAL_PAGE_SIZE) {
    throw new RangeError(`PAGE_LIMIT: expected an integer from 1 to ${MAX_LOCAL_PAGE_SIZE}`)
  }
  if (request.after !== null) {
    if (!request.after.id || !request.after.updatedAt || !Number.isFinite(Date.parse(request.after.updatedAt))) {
      throw new Error('PAGE_CURSOR: expected a valid updatedAt and id')
    }
  }
  return request
}
