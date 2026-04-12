import assert from 'node:assert/strict'
import test from 'node:test'
import { isUuidV7 } from '@sovereignbase/utils'
import {
  createValidUuid,
  createReplica,
  readAck,
  readSnapshot,
} from '../shared/oostruct.mjs'

test('acknowledge emits valid frontier identifiers for every field', () => {
  const replica = createReplica()
  replica.name = 'alice'
  replica.count = 1
  replica.meta = { enabled: true }
  const ack = readAck(replica)

  assert.deepEqual(Object.keys(ack).sort(), ['count', 'meta', 'name', 'tags'])
  for (const value of Object.values(ack)) {
    assert.equal(isUuidV7(value), true)
  }
})

test('garbageCollect removes acknowledged tombstones but preserves current predecessor', () => {
  const replica = createReplica()
  replica.name = 'a'
  replica.name = 'b'
  replica.name = 'c'
  const before = readSnapshot(replica)
  const ack = readAck(replica)

  replica.garbageCollect([{ ghost: createValidUuid('ghost'), name: '' }, ack])

  const after = readSnapshot(replica)

  assert.equal(after.name.tombstones.includes(after.name.predecessor), true)
  assert(after.name.tombstones.length < before.name.tombstones.length)
  assert.deepEqual(after.name.tombstones, [after.name.predecessor])
})

test('garbageCollect ignores non-array empty and invalid frontier inputs', () => {
  const replica = createReplica()
  replica.name = 'alice'
  const before = readSnapshot(replica)

  replica.garbageCollect(false)
  replica.garbageCollect([])
  replica.garbageCollect([{ name: 'bad' }])

  assert.deepEqual(readSnapshot(replica), before)
})
