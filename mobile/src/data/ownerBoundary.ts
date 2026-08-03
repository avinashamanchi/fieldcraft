export type OwnerSnapshot = {
  ownerId: string | null
  dataRevision: number
  deleteEpoch: number
}

type Listener = () => void

export class OwnerBoundary {
  private snapshot: OwnerSnapshot = {
    ownerId: null,
    dataRevision: 0,
    deleteEpoch: 0,
  }
  private readonly listeners = new Set<Listener>()

  getSnapshot = (): OwnerSnapshot => this.snapshot

  capture(): OwnerSnapshot {
    return this.snapshot
  }

  isCurrent(snapshot: OwnerSnapshot): boolean {
    return (
      snapshot.ownerId === this.snapshot.ownerId &&
      snapshot.dataRevision === this.snapshot.dataRevision &&
      snapshot.deleteEpoch === this.snapshot.deleteEpoch
    )
  }

  isOwnerEpochCurrent(snapshot: OwnerSnapshot): boolean {
    return (
      snapshot.ownerId === this.snapshot.ownerId &&
      snapshot.deleteEpoch === this.snapshot.deleteEpoch
    )
  }

  switchOwner(ownerId: string | null): void {
    if (this.snapshot.ownerId === ownerId) return
    this.publish({
      ownerId,
      dataRevision: this.snapshot.dataRevision + 1,
      deleteEpoch: this.snapshot.deleteEpoch,
    })
  }

  markDataChanged(): void {
    this.publish({
      ...this.snapshot,
      dataRevision: this.snapshot.dataRevision + 1,
    })
  }

  beginDelete(ownerId: string): boolean {
    if (this.snapshot.ownerId !== ownerId) return false
    this.publish({
      ...this.snapshot,
      dataRevision: this.snapshot.dataRevision + 1,
      deleteEpoch: this.snapshot.deleteEpoch + 1,
    })
    return true
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private publish(next: OwnerSnapshot): void {
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}
