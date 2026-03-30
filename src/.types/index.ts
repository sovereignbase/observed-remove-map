import type { ORSetSnapshot, ORSetValue } from '@sovereignbase/observed-remove-set'

export type ORMapKey<T extends object> = Extract<keyof T, string>

export type ORMapEntry<T extends object> = {
  value: T[ORMapKey<T>]
}

export type ORMapLiveEntry<T extends object> = Readonly<ORSetValue<ORMapEntry<T>>>

export type ORMapSnapshot<T extends object> = Partial<
  Record<ORMapKey<T>, ORSetSnapshot<ORMapEntry<T>>>
>

export type ORMapTombstones<T extends object> = Partial<Record<ORMapKey<T>, Set<string>>>
