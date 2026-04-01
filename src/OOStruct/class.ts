import { v7 as uuidv7 } from 'uuid'
import type {
  OOStructChange,
  OOStructDelta,
  OOStructEventListenerFor,
  OOStructEventMap,
  OOStructSnapshot,
  OOStructSnapshotEntry,
  OOStructState,
  OOStructStateEntry,
  OOStructAck,
} from '../.types/index.js'
import { OOStructError } from '../.errors/class.js'
import { parseSnapshotEntryToStateEntry } from './parseSnapshotEntryToStateEntry/index.js'
import { parseStateEntryToSnapshotEntry } from './parseStateEntryToSnapshotEntry/index.js'
import { isUuidV7, prototype } from '@sovereignbase/utils'

export class OOStruct<T extends Record<string, unknown>> {
  private readonly __eventTarget = new EventTarget()
  private readonly __defaults: T
  private readonly __state: OOStructState<T>
  private __live: T
  constructor(
    defaults: { [K in keyof T]: T[K] },
    snapshot?: OOStructSnapshot<T>
  ) {
    this.__defaults = { ...defaults }
    this.__state = {} as OOStructState<T>
    this.__live = {} as T

    const snapshotIsObject =
      snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)

    for (const key of Object.keys(defaults)) {
      const defaultValue = defaults[key as keyof T]
      if (snapshotIsObject && Object.hasOwn(snapshot, key)) {
        const valid = parseSnapshotEntryToStateEntry(
          defaultValue,
          snapshot[key as keyof T]
        )
        if (valid) {
          this.__live[key as keyof T] = valid.__value
          this.__state[key as keyof T] = valid
          continue
        }
      }
      this.__live[key as keyof T] = defaultValue
      const root = uuidv7()
      this.__state[key as keyof T] = {
        __uuidv7: uuidv7(),
        __after: root,
        __value: defaultValue,
        __overwrites: new Set([root]),
      }
    }
  }

  /**CRUD*/
  static create<T extends Record<string, unknown>>(
    defaults: { [K in keyof T]: T[K] },
    snapshot?: OOStructSnapshot<T>
  ): OOStruct<T> {
    return new OOStruct(defaults, snapshot)
  }

  read<K extends keyof T>(key: K): T[K] {
    return structuredClone(this.__live[key])
  }

  update<K extends keyof T>(key: K, value: T[K]): void {
    if (prototype(value) !== prototype(this.__defaults[key]))
      throw new OOStructError(
        'TYPE_MISSMATCH',
        'Values type does not match default values type.'
      )
    const delta: OOStructDelta<T> = {}
    const change: OOStructChange<T> = {}
    delta[key] = this.overwriteAndReturnSnapshotEntry(
      key,
      structuredClone(value)
    )
    change[key] = value
    this.__eventTarget.dispatchEvent(
      new CustomEvent('delta', { detail: delta })
    )
    this.__eventTarget.dispatchEvent(
      new CustomEvent('change', { detail: change })
    )
  }

  delete<K extends keyof T>(key?: K): void {
    const delta: OOStructDelta<T> = {}
    const change: OOStructChange<T> = {}

    if (key !== undefined) {
      if (!Object.hasOwn(this.__defaults, key)) return
      const value = this.__defaults[key]
      delta[key] = this.overwriteAndReturnSnapshotEntry(key, value)
      change[key] = value
    } else {
      for (const [key, value] of Object.entries(this.__defaults)) {
        delta[key as K] = this.overwriteAndReturnSnapshotEntry(
          key as K,
          value as T[K]
        )
        change[key as K] = value as T[K]
      }
    }
    this.__eventTarget.dispatchEvent(
      new CustomEvent('delta', { detail: delta })
    )
    this.__eventTarget.dispatchEvent(
      new CustomEvent('change', { detail: change })
    )
  }

  /**MAGS*/
  merge<K extends keyof T>(replica: OOStructDelta<T>): void {
    if (!replica || typeof replica !== 'object' || Array.isArray(replica))
      return

    const delta: OOStructDelta<T> = {}
    const change: OOStructChange<T> = {}

    for (const [key, value] of Object.entries(replica)) {
      if (!Object.hasOwn(this.__state, key)) continue

      const canditate = parseSnapshotEntryToStateEntry(
        this.__defaults[key as K],
        value as OOStructSnapshotEntry<T[K]>
      )
      if (!canditate) continue

      const target = this.__state[key as K]
      const current = { ...target }
      let floor = ''
      for (const overwrite of target.__overwrites) {
        if (floor < overwrite) floor = overwrite
      }

      for (const overwrite of canditate.__overwrites) {
        if (overwrite <= floor || target.__overwrites.has(overwrite)) continue
        target.__overwrites.add(overwrite)
      }

      if (target.__overwrites.has(canditate.__uuidv7)) continue

      if (current.__uuidv7 === canditate.__uuidv7) {
        if (current.__after < canditate.__after) {
          target.__value = canditate.__value
          target.__after = canditate.__after
          target.__overwrites.add(canditate.__after)
          this.__live[key as K] = canditate.__value
          change[key as K] = canditate.__value
        } else {
          delta[key as K] = this.overwriteAndReturnSnapshotEntry(
            key as K,
            current.__value
          )
        }
        continue
      }

      if (
        current.__uuidv7 === canditate.__after ||
        target.__overwrites.has(current.__uuidv7) ||
        canditate.__uuidv7 > current.__uuidv7
      ) {
        target.__uuidv7 = canditate.__uuidv7
        target.__value = canditate.__value
        target.__after = canditate.__after
        target.__overwrites.add(canditate.__after)
        target.__overwrites.add(current.__uuidv7)
        this.__live[key as K] = canditate.__value
        change[key as K] = canditate.__value
        continue
      }

      target.__overwrites.add(canditate.__uuidv7)
      delta[key as K] = parseStateEntryToSnapshotEntry(target)
    }
    if (Object.keys(delta).length > 0)
      this.__eventTarget.dispatchEvent(
        new CustomEvent('delta', { detail: delta })
      )
    if (Object.keys(change).length > 0)
      this.__eventTarget.dispatchEvent(
        new CustomEvent('change', { detail: change })
      )
  }

  acknowledge<K extends Extract<keyof T, string>>(): void {
    const ack: OOStructAck<T> = {}
    for (const [key, value] of Object.entries(this.__state)) {
      let max = ''
      for (const overwrite of (value as OOStructStateEntry<T[K]>)
        .__overwrites) {
        if (max < overwrite) max = overwrite
      }
      ack[key as K] = max
    }
    this.__eventTarget.dispatchEvent(new CustomEvent('ack', { detail: ack }))
  }

  garbageCollect<K extends Extract<keyof T, string>>(
    frontiers: Array<OOStructAck<T>>
  ): void {
    if (!Array.isArray(frontiers) || frontiers.length < 1) return
    const smallestAcknowledgementsPerKey: OOStructAck<T> = {}

    for (const frontier of frontiers) {
      for (const [key, value] of Object.entries(frontier)) {
        if (!Object.hasOwn(this.__state, key) || !isUuidV7(value)) continue

        const current = smallestAcknowledgementsPerKey[key as K]
        if (typeof current === 'string' && current <= value) continue
        smallestAcknowledgementsPerKey[key as K] = value
      }
    }

    for (const [key, value] of Object.entries(smallestAcknowledgementsPerKey)) {
      const target = this.__state[key]
      const smallest = value as string
      for (const uuidv7 of target.__overwrites) {
        if (uuidv7 === target.__after || uuidv7 > smallest) continue
        target.__overwrites.delete(uuidv7)
      }
    }
  }

  snapshot(): void {
    const snapshot = {} as OOStructSnapshot<T>

    for (const [key, value] of Object.entries(this.__state)) {
      snapshot[key as keyof T] = parseStateEntryToSnapshotEntry(
        value as OOStructStateEntry<T[keyof T]>
      )
    }

    this.__eventTarget.dispatchEvent(
      new CustomEvent('snapshot', { detail: snapshot })
    )
  }

  /**ADDITIONAL*/

  keys<K extends keyof T>(): Array<K> {
    return Object.keys(this.__live) as Array<K>
  }

  values<K extends keyof T>(): Array<T[K]> {
    return Object.values(this.__live) as Array<T[K]>
  }

  entries<K extends keyof T>(): Array<[K, T[K]]> {
    return Object.entries(this.__live) as Array<[K, T[K]]>
  }

  /**EVENTS*/

  /**
   * Registers an event listener.
   *
   * @param type - The event type to listen for.
   * @param listener - The listener to register.
   * @param options - Listener registration options.
   */
  addEventListener<K extends keyof OOStructEventMap<T>>(
    type: K,
    listener: OOStructEventListenerFor<T, K> | null,
    options?: boolean | AddEventListenerOptions
  ): void {
    this.__eventTarget.addEventListener(
      type,
      listener as EventListenerOrEventListenerObject | null,
      options
    )
  }

  /**
   * Removes an event listener.
   *
   * @param type - The event type to stop listening for.
   * @param listener - The listener to remove.
   * @param options - Listener removal options.
   */
  removeEventListener<K extends keyof OOStructEventMap<T>>(
    type: K,
    listener: OOStructEventListenerFor<T, K> | null,
    options?: boolean | EventListenerOptions
  ): void {
    this.__eventTarget.removeEventListener(
      type,
      listener as EventListenerOrEventListenerObject | null,
      options
    )
  }

  /**HELPERS*/

  private overwriteAndReturnSnapshotEntry<K extends keyof T>(
    key: K,
    value: T[K]
  ): OOStructSnapshotEntry<T[K]> {
    const target = this.__state[key]
    const old = { ...target }
    target.__uuidv7 = uuidv7()
    target.__value = value
    target.__after = old.__uuidv7
    target.__overwrites.add(old.__uuidv7)
    this.__live[key] = value
    return parseStateEntryToSnapshotEntry(target)
  }
}
