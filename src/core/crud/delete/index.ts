import { overwriteAndReturnSnapshotEntry } from '../../../.helpers/index.js'
import type {
  CRStructState,
  CRStructDelta,
  CRStructChange,
} from '../../../.types/index.js'

/**
 * Resets one field or the entire struct back to default values.
 *
 * @param key - The optional field key to reset. When omitted, every field is reset.
 */
export function __delete<T extends Record<string, unknown>>(
  crStructReplica: CRStructState<T>,
  key?: keyof T
): { change: CRStructChange<T>; delta: CRStructDelta<T> } | false {
  const delta: CRStructDelta<T> = {}
  const change: CRStructChange<T> = {}

  if (key !== undefined) {
    if (!Object.hasOwn(crStructReplica.defaults, key)) return false
    const value = crStructReplica.defaults[key]
    delta[key] = overwriteAndReturnSnapshotEntry<T>(key, value, crStructReplica)
    change[key] = structuredClone(value)
  } else {
    for (const [key, value] of Object.entries(crStructReplica.defaults)) {
      delta[key as keyof T] = overwriteAndReturnSnapshotEntry<T>(
        key,
        value as T[keyof T],
        crStructReplica
      )
      change[key as keyof T] = structuredClone(value as T[keyof T])
    }
  }
  return { change, delta }
}
