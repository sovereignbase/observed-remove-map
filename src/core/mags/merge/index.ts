import type {
  CRStructState,
  CRStructDelta,
  CRStructChange,
  CRStructStateEntry,
} from '../../../.types/index.js'
import {
  parseSnapshotEntryToStateEntry,
  parseStateEntryToSnapshotEntry,
  overwriteAndReturnSnapshotEntry,
} from '../../../.helpers/index.js'

/**
 * Merges an incoming delta into the current replica.
 *
 * @param replica - The incoming partial snapshot projection to merge.
 */
export function __merge<T extends Record<string, unknown>>(
  crStructDelta: CRStructDelta<T>,
  crStructReplica: CRStructState<T>
): { change: CRStructChange<T>; delta: CRStructDelta<T> } | false {
  if (
    !crStructDelta ||
    typeof crStructDelta !== 'object' ||
    Array.isArray(crStructDelta)
  )
    return false

  const delta: CRStructDelta<T> = {}
  const change: CRStructChange<T> = {}
  let hasDelta = false
  let hasChange = false

  for (const [key, value] of Object.entries(crStructDelta)) {
    if (!Object.hasOwn(crStructReplica.defaults, key)) continue

    const candidate = parseSnapshotEntryToStateEntry(
      crStructReplica.defaults[key],
      value
    ) as CRStructStateEntry<T[keyof T]>
    if (!candidate) continue

    const target = crStructReplica.entries[key] as CRStructStateEntry<
      T[keyof T]
    >
    const current = { ...target }
    let frontier = ''
    for (const overwrite of target.tombstones) {
      if (frontier < overwrite) frontier = overwrite
    }

    for (const overwrite of candidate.tombstones) {
      if (overwrite <= frontier || target.tombstones.has(overwrite)) continue
      target.tombstones.add(overwrite)
    }

    if (target.tombstones.has(candidate.uuidv7)) continue

    if (current.uuidv7 === candidate.uuidv7) {
      if (current.predecessor < candidate.predecessor) {
        target.value = candidate.value
        target.predecessor = candidate.predecessor
        target.tombstones.add(candidate.predecessor)
        change[key as keyof T] = structuredClone(candidate.value)
        hasChange = true
      } else {
        delta[key as keyof T] = overwriteAndReturnSnapshotEntry(
          key,
          current.value,
          crStructReplica
        )
        hasDelta = true
      }
      continue
    }

    if (
      current.uuidv7 === candidate.predecessor ||
      target.tombstones.has(current.uuidv7) ||
      candidate.uuidv7 > current.uuidv7
    ) {
      target.uuidv7 = candidate.uuidv7
      target.value = candidate.value
      target.predecessor = candidate.predecessor
      target.tombstones.add(candidate.predecessor)
      target.tombstones.add(current.uuidv7)
      change[key as keyof T] = structuredClone(candidate.value)
      hasChange = true
      continue
    }

    target.tombstones.add(candidate.uuidv7)
    delta[key as keyof T] = parseStateEntryToSnapshotEntry(target)
    hasDelta = true
  }
  if (!hasDelta && !hasChange) return false
  return { change, delta }
}
