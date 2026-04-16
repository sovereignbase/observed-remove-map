import type {
  CRStructDelta,
  CRStructEventListenerFor,
  CRStructEventMap,
  CRStructSnapshot,
  CRStructState,
  CRStructAck,
} from '../.types/index.js'
import { CRStructError } from '../.errors/class.js'

import {
  __merge,
  __acknowledge,
  __garbageCollect,
  __snapshot,
} from '../core/mags/index.js'
import { __create, __read, __update, __delete } from '../core/crud/index.js'

/**
 * Runtime implementation for a proxy-backed CR-Struct replica.
 */
class CRStructRaw<T extends Record<string, unknown>> {
  declare private readonly __state: CRStructState<T>
  declare private readonly __eventTarget: EventTarget

  /**
   * Creates a replica from default values and an optional snapshot.
   *
   * The struct shape is fixed by the provided default values. The returned
   * proxy exposes those fields as direct properties on the instance.
   *
   * @param defaults - The default field values that define the struct shape.
   * @param snapshot - An optional serialized snapshot used to hydrate the replica.
   * @throws {CRStructError} Thrown when the default values are not supported by `structuredClone`.
   */
  constructor(defaults: T, snapshot?: CRStructSnapshot<T>) {
    Object.defineProperties(this, {
      __state: {
        value: __create<T>(defaults, snapshot),
        enumerable: false,
        configurable: false,
        writable: false,
      },
      __eventTarget: {
        value: new EventTarget(),
        enumerable: false,
        configurable: false,
        writable: false,
      },
    })
    const keys = new Set(Object.keys(defaults))
    return new Proxy(this, {
      get(target, key, receiver) {
        // Preserve normal property access for unknown keys.
        if (typeof key !== 'string' || !keys.has(key))
          return Reflect.get(target, key, receiver)
        return __read(key, target.__state)
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
          const result = __update<T>(key, value, target.__state)
          /* c8 ignore next -- __update either throws or returns a result object. */
          if (!result) return false
          const { delta, change } = result
          if (delta)
            void target.__eventTarget.dispatchEvent(
              new CustomEvent('delta', { detail: delta })
            )
          if (change)
            void target.__eventTarget.dispatchEvent(
              new CustomEvent('change', { detail: change })
            )
          return true
        } catch (error) {
          if (error instanceof CRStructError) throw error
          return false
        }
      },
      deleteProperty(target, key) {
        if (typeof key !== 'string' || !keys.has(key)) return false
        try {
          const result = __delete<T>(target.__state, key)
          if (!result) return false
          const { delta, change } = result
          if (delta) {
            void target.__eventTarget.dispatchEvent(
              new CustomEvent('delta', { detail: delta })
            )
          }
          if (change) {
            void target.__eventTarget.dispatchEvent(
              new CustomEvent('change', { detail: change })
            )
          }
          return true
        } catch {
          return false
        }
      },
      ownKeys(target) {
        return [
          ...Reflect.ownKeys(target),
          ...Reflect.ownKeys(target.__state.defaults),
        ]
      },
      getOwnPropertyDescriptor(target, key) {
        // Preserve normal property checks for unknown keys.
        if (typeof key !== 'string' || !keys.has(key))
          return Reflect.getOwnPropertyDescriptor(target, key)
        return {
          value: __read(key, target.__state),
          writable: true,
          enumerable: true,
          configurable: true,
        }
      },
    })
  }

  /**
   * Applies a remote or local delta to the replica state.
   *
   * @param crStructDelta - The partial serialized field state to merge.
   */
  merge(crStructDelta: CRStructDelta<T>): void {
    const result = __merge<T>(crStructDelta, this.__state)
    if (!result) return
    const { delta, change } = result
    if (Object.keys(delta).length > 0) {
      void this.__eventTarget.dispatchEvent(
        new CustomEvent('delta', { detail: delta })
      )
    }
    if (Object.keys(change).length > 0) {
      void this.__eventTarget.dispatchEvent(
        new CustomEvent('change', { detail: change })
      )
    }
  }

  /**
   * Emits the current acknowledgement frontier for each field.
   */
  acknowledge(): void {
    const ack = __acknowledge<T>(this.__state)
    if (ack) {
      void this.__eventTarget.dispatchEvent(
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
    void __garbageCollect<T>(frontiers, this.__state)
  }

  /**
   * Emits a serialized snapshot of the current replica state.
   */
  snapshot(): void {
    const snapshot = __snapshot<T>(this.__state)
    if (snapshot) {
      void this.__eventTarget.dispatchEvent(
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
    return Object.keys(this.__state.entries) as Array<K>
  }

  /**
   * Resets every field in the replica back to its default value.
   */
  clear(): void {
    const result = __delete(this.__state)
    if (result) {
      const { delta, change } = result
      if (delta) {
        void this.__eventTarget.dispatchEvent(
          new CustomEvent('delta', { detail: delta })
        )
      }
      if (change) {
        void this.__eventTarget.dispatchEvent(
          new CustomEvent('change', { detail: change })
        )
      }
    }
  }

  /**
   * Returns a cloned plain object view of the current replica fields.
   *
   * @returns The current field values keyed by field name.
   */
  clone(): T {
    const out = {} as T
    for (const [key, entry] of Object.entries(this.__state.entries)) {
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
    return Object.values(this.__state.entries).map((entry) =>
      structuredClone(entry.value)
    ) as Array<T[K]>
  }

  /**
   * Returns cloned key-value pairs for the current replica state.
   *
   * @returns The current field entries.
   */
  entries<K extends keyof T>(): Array<[K, T[K]]> {
    return Object.entries(this.__state.entries).map(([key, entry]) => [
      key as K,
      structuredClone(entry.value as T[K]),
    ])
  }

  /**
   * Returns a serializable snapshot representation of this replica.
   *
   * Called automatically by `JSON.stringify`.
   */
  toJSON(): CRStructSnapshot<T> {
    return __snapshot<T>(this.__state)
  }
  /**
   * Returns this replica as a JSON string.
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
   * Iterates over the current live field entries.
   */
  *[Symbol.iterator](): IterableIterator<[keyof T, T[keyof T]]> {
    for (const [key, entry] of Object.entries(this.__state.entries)) {
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
  removeEventListener<K extends keyof CRStructEventMap<T>>(
    type: K,
    listener: CRStructEventListenerFor<T, K> | null,
    options?: boolean | EventListenerOptions
  ): void {
    this.__eventTarget.removeEventListener(
      type,
      listener as EventListenerOrEventListenerObject | null,
      options
    )
  }
}

export type CRStruct<T extends Record<string, unknown>> = CRStructRaw<T> & T

export const CRStruct = CRStructRaw as {
  new <T extends Record<string, unknown>>(
    defaults: T,
    snapshot?: CRStructSnapshot<T>
  ): CRStruct<T>
}
