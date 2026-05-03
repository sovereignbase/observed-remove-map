import type {
  CRStructState,
  CRStructStateEntry,
  CRStructSnapshot,
} from '../../../.types/index.js'
import { safeStructuredClone, prototype } from '@sovereignbase/utils'
import { CRStructError } from '../../../.errors/class.js'
import { transformSnapshotEntryToStateEntry } from '../../../.helpers/index.js'
import { v7 as uuidv7 } from 'uuid'

/**
 * Creates internal CR-Struct state from default values and an optional snapshot.
 *
 * Default values define the replica field set. Compatible snapshot entries are
 * parsed into live state entries, and invalid snapshot entries are ignored so
 * the corresponding field falls back to a freshly initialized default-backed
 * entry.
 *
 * @param defaults - Default field values that define the replica shape.
 * @param snapshot - Optional serializable snapshot used to hydrate matching fields.
 *
 * @returns
 * A hydrated internal CR-Struct state object.
 *
 * @throws {CRStructError} Thrown when the default values are not supported by `structuredClone`.
 *
 * Time complexity: O(k + c + s + t), worst case O(k + c + s + t)
 *
 * k = default field count
 * c = total cloned payload size across defaults and accepted snapshot values
 * s = snapshot entries inspected for matching fields
 * t = tombstone count materialized for accepted snapshot entries
 *
 * Space complexity: O(k + c + t)
 */
export function __create<T extends Record<string, unknown>>(
  defaults: T,
  snapshot?: CRStructSnapshot<T>,
  allowMissing: boolean = false
): CRStructState<T> {
  const [cloned, copiedDefaults] = safeStructuredClone(defaults)
  if (!cloned)
    throw new CRStructError(
      'DEFAULTS_NOT_CLONEABLE',
      'Default values must be supported by structuredClone.'
    )
  const state: CRStructState<T> = {
    entries: {} as { [K in keyof T]: CRStructStateEntry<T[K]> },
    defaults: copiedDefaults,
  }

  const snapshotIsObject = snapshot && prototype(snapshot) === 'record'

  for (const key of Object.keys(defaults)) {
    const defaultValue = copiedDefaults[key as keyof T]
    if (snapshotIsObject && Object.hasOwn(snapshot, key)) {
      const valid = transformSnapshotEntryToStateEntry(
        defaultValue,
        snapshot[key as keyof T]
      )
      if (valid) {
        state.entries[key as keyof T] = valid
        continue
      }
    }

    if (allowMissing) continue

    const root = uuidv7()
    state.entries[key as keyof T] = {
      uuidv7: uuidv7(),
      predecessor: root,
      value: defaultValue,
      tombstones: new Set([root]),
    }
  }
  return state
}
