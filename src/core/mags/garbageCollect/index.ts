import { CRStructState, CRStructAck } from '../../../.types/index.js'
import { isUuidV7 } from '@sovereignbase/utils'

/**
 * Removes overwritten identifiers that every provided frontier has acknowledged.
 *
 * @param frontiers - A collection of acknowledgement frontiers to compact against.
 */
export function __garbageCollect<T extends Record<string, unknown>>(
  frontiers: Array<CRStructAck<T>>,
  crStructReplica: CRStructState<T>
): void {
  if (!Array.isArray(frontiers) || frontiers.length < 1) return
  const smallestAcknowledgementsPerKey: CRStructAck<T> = {}

  for (const frontier of frontiers) {
    for (const [key, value] of Object.entries(frontier)) {
      if (!Object.hasOwn(crStructReplica.entries, key) || !isUuidV7(value))
        continue

      const current = smallestAcknowledgementsPerKey[key]
      if (typeof current === 'string' && current <= value) continue
      smallestAcknowledgementsPerKey[key as keyof T] = value
    }
  }

  for (const [key, value] of Object.entries(smallestAcknowledgementsPerKey)) {
    const target = crStructReplica.entries[key]
    const smallest = value as string
    for (const uuidv7 of target.tombstones) {
      if (uuidv7 === target.predecessor || uuidv7 > smallest) continue
      target.tombstones.delete(uuidv7)
    }
  }
}
