import assert from 'node:assert/strict'
import test from 'node:test'
import { CRStruct } from '../../dist/index.js'
import {
  assertSnapshotShape,
  cloneSnapshot,
  createReplica,
  readSnapshot,
} from '../shared/oostruct.mjs'

test('constructor starts from defaults and exposes proxy-backed field reflection', () => {
  const replica = createReplica()

  assert.equal(replica instanceof CRStruct, true)
  assert.equal(replica.constructor, CRStruct)
  assert.deepEqual(replica.keys(), ['name', 'count', 'meta', 'tags'])
  assert.equal(replica.name, '')
  assert.equal(replica.count, 0)
  assert.deepEqual(replica.meta, { enabled: false })
  assert.deepEqual(replica.tags, [])
  assert.deepEqual(Object.keys(replica), ['name', 'count', 'meta', 'tags'])

  const enumerated = []
  for (const key in replica) enumerated.push(key)
  assert.deepEqual(enumerated, ['name', 'count', 'meta', 'tags'])

  const ownKeys = Reflect.ownKeys(replica)
  for (const key of ['__state', '__eventTarget', 'name', 'count', 'meta', 'tags']) {
    assert.equal(ownKeys.includes(key), true)
  }
  assert.equal(new Set(ownKeys).size, ownKeys.length)

  const stateDescriptor = Object.getOwnPropertyDescriptor(replica, '__state')
  assert.equal(stateDescriptor.enumerable, false)
  const nameDescriptor = Object.getOwnPropertyDescriptor(replica, 'name')
  assert.equal(nameDescriptor.enumerable, true)
  assert.equal(nameDescriptor.writable, true)
  assert.equal(nameDescriptor.configurable, true)
  assert.equal(nameDescriptor.value, '')

  assertSnapshotShape(readSnapshot(replica))
})

test('constructor hydrates a valid snapshot and ignores unknown keys', () => {
  const source = createReplica()
  source.name = 'alice'
  source.count = 7
  source.meta = { enabled: true }
  source.tags = ['a', 'b']
  const snapshot = cloneSnapshot(readSnapshot(source))
  snapshot.ghost = snapshot.name

  const target = createReplica(snapshot)

  assert.equal(target.name, 'alice')
  assert.equal(target.count, 7)
  assert.deepEqual(target.meta, { enabled: true })
  assert.deepEqual(target.tags, ['a', 'b'])
  assert.equal(Object.keys(target).includes('ghost'), false)
})

test('constructor falls back to defaults for invalid field entries only', () => {
  const source = createReplica()
  source.count = 3
  source.meta = { enabled: true }
  const snapshot = cloneSnapshot(readSnapshot(source))
  snapshot.name = {
    uuidv7: 'bad',
    predecessor: 'bad',
    value: 'broken',
    tombstones: [],
  }

  const target = createReplica(snapshot)

  assert.equal(target.name, '')
  assert.equal(target.count, 3)
  assert.deepEqual(target.meta, { enabled: true })
  assert.deepEqual(target.tags, [])
})

test('constructor filters invalid and self tombstones from accepted entries', () => {
  const source = createReplica()
  source.name = 'alice'
  const snapshot = cloneSnapshot(readSnapshot(source))
  snapshot.name.tombstones = [
    'bad',
    snapshot.name.uuidv7,
    snapshot.name.predecessor,
  ]

  const target = createReplica(snapshot)
  const hydrated = readSnapshot(target)

  assert.equal(target.name, 'alice')
  assert.deepEqual(hydrated.name.tombstones, [snapshot.name.predecessor])
})

test('constructor allows public state and eventTarget field keys without proxy invariant breaks', () => {
  const replica = new CRStruct({ state: 1, eventTarget: 2 })
  assert.equal(replica.state, 1)
  assert.equal(replica.eventTarget, 2)
  assert.equal(JSON.stringify(replica).includes('"state"'), true)
  assert.equal(new Set(Reflect.ownKeys(replica)).size, Reflect.ownKeys(replica).length)
})
