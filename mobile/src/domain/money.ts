import * as Crypto from 'expo-crypto'

export type MoneyCents = number

export const createEntityId = (): string => Crypto.randomUUID()
