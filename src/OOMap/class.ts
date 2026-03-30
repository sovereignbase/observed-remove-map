import { v7 as uuidv7 } from 'uuid'
import { OOMapError } from '../.errors/class.js'
import type {
  OOMapSnapshot,
  OOMapSnapshotEntry,
  OOMapState,
} from '../.types/index.js'
import { isUuidV7 } from './isUuidV7/index.js'

export class OOMap<T extends object> {
  private __live: T
  private __state: OOMapState<T>

  constructor(defaults: { [K in keyof T]: T[K] }, snapshot?: OOMapSnapshot<T>) {
    this.__live = {} as T
    this.__state = {} as OOMapState<T>

    if (snapshot === undefined) {
      for (const [rawKey, rawValue] of Object.entries(defaults)) {
        const key = rawKey as keyof T
        const value = rawValue as T[keyof T]

        this.__live[key] = value
        this.__state[key] = {
          __uuidv7: uuidv7(),
          __value: value,
          __overwrites: new Set([]),
        }
      }

      return
    }

    for (const [rawKey, rawEntry] of Object.entries(snapshot)) {
      const key = rawKey as keyof T
      const entry = rawEntry as OOMapSnapshotEntry<T[keyof T]>

      if (
        !entry ||
        typeof entry !== 'object' ||
        Array.isArray(entry) ||
        !isUuidV7(entry.__uuidv7) ||
        !Array.isArray(entry.__overwrites) ||
        !Object.hasOwn(entry, '__value')
      ) {
        throw new OOMapError('BAD_SNAPSHOT', 'Malformed snapshot.')
      }
      this.__live[key] = entry.__value
      this.__state[key] = {
        __uuidv7: entry.__uuidv7,
        __value: entry.__value,
        __overwrites: new Set([]),
      }
      for (const overwrite of entry.__overwrites) {
        if (!isUuidV7(overwrite)) continue
        this.__state[key].__overwrites.add(overwrite)
      }
    }
  }

  get(key: keyof T): T[keyof T] {
    return this.__live[key]
  }
  set(key: keyof T, value: T[keyof T]): void {}
}
