import type {
  OOStructSnapshotEntry,
  OOStructStateEntry,
} from '../../.types/index.js'
import { isUuidV7 } from '../isUuidV7/index.js'
export function parseSnapshotEntryToStateEntry<V>(
  defaultValue: V,
  snapshotEntry: OOStructSnapshotEntry<V>
): OOStructStateEntry<V> | false {
  const overwrites = new Set<string>([])
  for (const overwrite of snapshotEntry.__overwrites) {
    if (
      !isUuidV7(overwrite) ||
      overwrite ===
        snapshotEntry.__uuidv7 /**if it was actually overwritten the current uuid would be different so this must be malicious*/
    )
      continue
    overwrites.add(overwrite)
  }
  const typeMatch = typeof snapshotEntry.__value === typeof defaultValue
  if (
    !isUuidV7(snapshotEntry.__uuidv7) ||
    !typeMatch ||
    !isUuidV7(snapshotEntry.__after) ||
    !overwrites.has(snapshotEntry.__after)
  )
    return false
  return {
    __uuidv7: snapshotEntry.__uuidv7,
    __value: snapshotEntry.__value,
    __after: snapshotEntry.__after,
    __overwrites: overwrites,
  }
}
