export type OOStructSnapshotEntry<V> = {
  __uuidv7: string
  __value: V
  __after: string
  __overwrites: Array<string>
}

export type OOStructStateEntry<V> = {
  __uuidv7: string
  __value: V
  __after: string
  __overwrites: Set<string>
}

export type OOStructSnapshot<T extends object> = {
  [K in keyof T]: OOStructSnapshotEntry<T[K]>
}

export type OOStructState<T extends object> = {
  [K in keyof T]: OOStructStateEntry<T[K]>
}

export type OOStructDelta<T extends object> = Partial<OOStructSnapshot<T>>

export type OOStructChanges<T extends object> = Partial<T>

export type OOStructEventMap<T extends object> = {
  snapshot: OOStructSnapshot<T>
  delta: OOStructDelta<T>
  change: OOStructChanges<T>
}

export type OOStructEventListener<
  T extends object,
  K extends keyof OOStructEventMap<T>,
> =
  | ((event: CustomEvent<OOStructEventMap<T>[K]>) => void)
  | { handleEvent(event: CustomEvent<OOStructEventMap<T>[K]>): void }

export type OOStructEventListenerFor<
  T extends object,
  K extends string,
> = K extends keyof OOStructEventMap<T>
  ? OOStructEventListener<T, K>
  : EventListenerOrEventListenerObject
