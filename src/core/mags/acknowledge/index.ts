import type {
  CRStructAck,
  CRStructState,
  CRStructStateEntry,
} from '../../../.types/index.js'
/**
 * Emits the current acknowledgement frontier for each field.
 */
export function __acknowledge<T extends Record<string, unknown>>(
  crStructReplica: CRStructState<T>
): CRStructAck<T> | false {
  const ack: CRStructAck<T> = {}
  for (const [key, value] of Object.entries(crStructReplica.entries)) {
    let max = ''
    for (const tombstone of (value as CRStructStateEntry<T[keyof T]>)
      .tombstones) {
      if (max < tombstone) max = tombstone
    }
    ack[key as keyof T] = max
  }
  return ack
}
