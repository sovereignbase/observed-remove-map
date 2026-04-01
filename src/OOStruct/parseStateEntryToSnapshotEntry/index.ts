import type {
  OOStructStateEntry,
  OOStructSnapshotEntry,
} from '../../.types/index.js'

export function parseStateEntryToSnapshotEntry<K>(
  stateEntry: OOStructStateEntry<K>
): OOStructSnapshotEntry<K> {
  return {
    __uuidv7: stateEntry.__uuidv7,
    __value: structuredClone(stateEntry.__value),
    __after: stateEntry.__after,
    __overwrites: Array.from(stateEntry.__overwrites),
  }
}
