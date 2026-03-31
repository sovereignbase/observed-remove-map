import { v7 as uuidv7 } from 'uuid'
import type {
  OOStructChanges,
  OOStructDelta,
  OOStructEventListenerFor,
  OOStructEventMap,
  OOStructSnapshot,
  OOStructSnapshotEntry,
  OOStructState,
  OOStructStateEntry,
} from '../.types/index.js'
import { parseSnapshotEntryToStateEntry } from './parseSnapshotEntryToStateEntry/index.js'
import { parseStateEntryToSnapshotEntry } from './parseStateEntryToSnapshotEntry/index.js'

export class OOStruct<T extends Record<string, unknown>> {
  private readonly eventTarget = new EventTarget()
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

  static create<T extends Record<string, unknown>>(
    defaults: { [K in keyof T]: T[K] },
    snapshot?: OOStructSnapshot<T>
  ): OOStruct<T> {
    return new OOStruct(defaults, snapshot)
  }

  read<K extends keyof T>(key: K): T[K] {
    return this.__live[key]
  }

  update<K extends keyof T>(key: K, value: T[K]): void {
    const delta: OOStructDelta<T> = {}
    const changes: OOStructChanges<T> = {}
    delta[key] = this.overwriteAndReturnSnapshotEntry(key, value)
    changes[key] = value
    this.eventTarget.dispatchEvent(new CustomEvent('delta', { detail: delta }))
    this.eventTarget.dispatchEvent(
      new CustomEvent('change', { detail: changes })
    )
  }

  delete<K extends keyof T>(key?: K): void {
    const delta: OOStructDelta<T> = {}
    const changes: OOStructChanges<T> = {}

    if (key !== undefined) {
      if (!Object.hasOwn(this.__defaults, key)) return
      const value = this.__defaults[key]
      delta[key] = this.overwriteAndReturnSnapshotEntry(key, value)
      changes[key] = value
    } else {
      for (const [key, value] of Object.entries(this.__defaults)) {
        delta[key as K] = this.overwriteAndReturnSnapshotEntry(
          key as K,
          value as T[K]
        )
        changes[key as K] = value as T[K]
      }
    }
    this.eventTarget.dispatchEvent(new CustomEvent('delta', { detail: delta }))
    this.eventTarget.dispatchEvent(
      new CustomEvent('change', { detail: changes })
    )
  }

  merge<K extends keyof T>(replica: OOStructDelta<T>): void {
    if (!replica || typeof replica !== 'object' || Array.isArray(replica))
      return

    const delta: OOStructDelta<T> = {}
    const changes: OOStructChanges<T> = {}

    for (const [key, value] of Object.entries(replica)) {
      if (!Object.hasOwn(this.__state, key)) continue

      const canditate = parseSnapshotEntryToStateEntry(
        this.__defaults[key as K],
        value as OOStructSnapshotEntry<T[K]>
      )
      if (!canditate) continue

      const target = this.__state[key as K]
      const current = { ...target }

      for (const overwrite of canditate.__overwrites) {
        if (target.__overwrites.has(overwrite)) continue
        target.__overwrites.add(overwrite)
      }

      if (target.__overwrites.has(canditate.__uuidv7)) continue

      if (
        current.__uuidv7 === canditate.__after ||
        target.__overwrites.has(current.__uuidv7) ||
        canditate.__uuidv7 > current.__uuidv7
      ) {
        target.__uuidv7 = canditate.__uuidv7
        target.__value = canditate.__value
        target.__after = canditate.__after
        this.__live[key as K] = canditate.__value
        changes[key as K] = canditate.__value
        continue
      }

      target.__overwrites.add(canditate.__uuidv7)
      delta[key as K] = parseStateEntryToSnapshotEntry(target)
    }
    if (Object.keys(delta).length > 0)
      this.eventTarget.dispatchEvent(
        new CustomEvent('delta', { detail: delta })
      )
    if (Object.keys(changes).length > 0)
      this.eventTarget.dispatchEvent(
        new CustomEvent('change', { detail: changes })
      )
  }

  snapshot(): void {
    const snapshot = {} as OOStructSnapshot<T>

    for (const [key, value] of Object.entries(this.__state)) {
      snapshot[key as keyof T] = parseStateEntryToSnapshotEntry(
        value as OOStructStateEntry<T[keyof T]>
      )
    }

    this.eventTarget.dispatchEvent(
      new CustomEvent('snapshot', { detail: snapshot })
    )
  }

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
    this.eventTarget.addEventListener(
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
    this.eventTarget.removeEventListener(
      type,
      listener as EventListenerOrEventListenerObject | null,
      options
    )
  }

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
