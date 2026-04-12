import type {
  CRStructDelta,
  CRStructEventListenerFor,
  CRStructEventMap,
  CRStructSnapshot,
  CRStructState,
  CRStructAck,
} from '../.types/index.js'

import {
  __merge,
  __acknowledge,
  __garbageCollect,
  __snapshot,
} from '../core/mags/index.js'
import { __create, __read, __update, __delete } from '../core/crud/index.js'

/**
 * Represents an observed-overwrite struct replica.
 *
 * The struct shape is fixed by the provided default values.
 */
export class CRStruct<T extends Record<string, unknown>> {
  [key: keyof T]: T[keyof T]
  declare private readonly state: CRStructState<T>
  declare private readonly eventTarget: EventTarget

  /**
   * Creates a replica from default values and an optional snapshot.
   *
   * @param defaults - The default field values that define the struct shape.
   * @param snapshot - An optional serialized snapshot used for hydration.
   * @throws {CRStructError} Thrown when the default values are not supported by `structuredClone`.
   */
  constructor(
    defaults: { [K in keyof T]: T[K] },
    snapshot?: CRStructSnapshot<T>
  ) {
    Object.defineProperties(this, {
      state: {
        value: __create<T>(defaults, snapshot),
        enumerable: false,
        configurable: false,
        writable: false,
      },
      eventTarget: {
        value: new EventTarget(),
        enumerable: false,
        configurable: false,
        writable: false,
      },
    })
    const keys = new Set(Object.keys(defaults))
    return new Proxy(this, {
      get(target, key, receiver) {
        // Preserve normal property access for unkown keys.
        if (typeof key !== 'string' || !keys.has(key))
          return Reflect.get(target, key, receiver)
        return __read(key, target.state)
      },
      has(target, key) {
        // Preserve normal property checks for unknown keys.
        if (typeof key !== 'string' || !keys.has(key))
          return Reflect.has(target, key)
        return true
      },
      set(target, key, value) {
        if (typeof key !== 'string' || !keys.has(key)) return false
        try {
          const result = __update<T>(key, value, target.state)
          if (!result) return false
          const { delta, change } = result
          if (delta)
            void target.eventTarget.dispatchEvent(
              new CustomEvent('delta', { detail: delta })
            )
          if (change)
            void target.eventTarget.dispatchEvent(
              new CustomEvent('change', { detail: change })
            )
          return true
        } catch {
          return false
        }
      },
      deleteProperty(target, key) {
        if (typeof key !== 'string' || !keys.has(key)) return false
        try {
          const result = __delete<T>(target.state, key)
          if (!result) return false
          const { delta, change } = result
          if (delta) {
            void target.eventTarget.dispatchEvent(
              new CustomEvent('delta', { detail: delta })
            )
          }
          if (change) {
            void target.eventTarget.dispatchEvent(
              new CustomEvent('change', { detail: change })
            )
          }
          return true
        } catch {
          return false
        }
      },
      ownKeys(target) {
        return [...Reflect.ownKeys(target.state.defaults)]
      },

      getOwnPropertyDescriptor(target, key) {
        // Preserve normal property checks for unknown keys.
        if (typeof key !== 'string' || !keys.has(key))
          return Reflect.getOwnPropertyDescriptor(target, key)
        return {
          value: __read(key, target.state),
          writable: true,
          enumerable: true,
          configurable: true,
        }
      },
    })
  }

  merge(crStructDelta: CRStructDelta<T>): void {
    const result = __merge<T>(crStructDelta, this.state)
    if (!result) return
    const { delta, change } = result
    if (delta) {
      void this.eventTarget.dispatchEvent(
        new CustomEvent('delta', { detail: delta })
      )
    }
    if (change) {
      void this.eventTarget.dispatchEvent(
        new CustomEvent('change', { detail: change })
      )
    }
  }

  /**
   * Emits the current acknowledgement frontier for each field.
   */
  acknowledge(): void {
    const ack = __acknowledge<T>(this.state)
    if (ack) {
      void this.eventTarget.dispatchEvent(
        new CustomEvent('ack', { detail: ack })
      )
    }
  }

  /**
   * Removes overwritten identifiers that every provided frontier has acknowledged.
   *
   * @param frontiers - A collection of acknowledgement frontiers to compact against.
   */
  garbageCollect(frontiers: Array<CRStructAck<T>>): void {
    void __garbageCollect<T>(frontiers, this.state)
  }

  /**
   * Emits a serialized snapshot of the current replica state.
   */
  snapshot(): void {
    const snapshot = __snapshot<T>(this.state)
    if (snapshot) {
      void this.eventTarget.dispatchEvent(
        new CustomEvent('snapshot', { detail: snapshot })
      )
    }
  }

  /**
   * Returns the struct field keys.
   *
   * @returns The field keys in the current replica.
   */
  keys<K extends keyof T>(): Array<K> {
    return Object.keys(this.state.entries) as Array<K>
  }

  clear(): void {
    const result = __delete(this.state)
    if (result) {
      const { delta, change } = result
      if (delta) {
        void this.eventTarget.dispatchEvent(
          new CustomEvent('delta', { detail: delta })
        )
      }
      if (change) {
        void this.eventTarget.dispatchEvent(
          new CustomEvent('change', { detail: change })
        )
      }
    }
  }

  clone(): T {
    const out = {} as T
    for (const [key, entry] of Object.entries(this.state.entries)) {
      out[key as keyof T] = structuredClone(entry.value as T[keyof T])
    }
    return out
  }

  /**
   * Returns cloned copies of the current field values.
   *
   * @returns The current field values.
   */
  values<K extends keyof T>(): Array<T[K]> {
    return Object.values(this.state.entries).map((entry) =>
      structuredClone(entry.value)
    ) as Array<T[K]>
  }

  /**
   * Returns cloned key-value pairs for the current replica state.
   *
   * @returns The current field entries.
   */
  entries<K extends keyof T>(): Array<[K, T[K]]> {
    return Object.entries(this.state.entries).map(([key, entry]) => [
      key as K,
      structuredClone(entry.value as T[K]),
    ])
  }

  /**
   * Returns a serializable snapshot representation of this list.
   *
   * Called automatically by `JSON.stringify`.
   */
  toJSON(): CRStructSnapshot<T> {
    return __snapshot<T>(this.state)
  }
  /**
   * Returns this list as a JSON string.
   */
  toString(): string {
    return JSON.stringify(this)
  }
  /**
   * Returns the Node.js console inspection representation.
   */
  [Symbol.for('nodejs.util.inspect.custom')](): CRStructSnapshot<T> {
    return this.toJSON()
  }
  /**
   * Returns the Deno console inspection representation.
   */
  [Symbol.for('Deno.customInspect')](): CRStructSnapshot<T> {
    return this.toJSON()
  }
  /**
   * Iterates over the current live values in index order.
   */
  *[Symbol.iterator](): IterableIterator<[keyof T, T[keyof T]]> {
    for (const [key, entry] of Object.entries(this.state.entries)) {
      yield [key, structuredClone(entry.value)]
    }
  }

  /**
   * Registers an event listener.
   *
   * @param type - The event type to listen for.
   * @param listener - The listener to register.
   * @param options - Listener registration options.
   */
  addEventListener<K extends keyof CRStructEventMap<T>>(
    type: K,
    listener: CRStructEventListenerFor<T, K> | null,
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
  removeEventListener<K extends keyof CRStructEventMap<T>>(
    type: K,
    listener: CRStructEventListenerFor<T, K> | null,
    options?: boolean | EventListenerOptions
  ): void {
    this.eventTarget.removeEventListener(
      type,
      listener as EventListenerOrEventListenerObject | null,
      options
    )
  }
}
