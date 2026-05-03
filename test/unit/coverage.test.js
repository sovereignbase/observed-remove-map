import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CRStruct,
  __acknowledge,
  __create,
  __delete,
  __garbageCollect,
  __merge,
  __read,
  __snapshot,
  __update,
} from '../../dist/index.js'
import {
  assertSnapshotShape,
  createDefaults,
  createReplica,
  createValidUuid,
  readState,
} from '../shared/oostruct.mjs'

test('core export surface and raw state operations remain coherent', () => {
  for (const value of [
    CRStruct,
    __acknowledge,
    __create,
    __delete,
    __garbageCollect,
    __merge,
    __read,
    __snapshot,
    __update,
  ]) {
    assert.equal(typeof value, 'function')
  }

  const state = __create(createDefaults())

  assert.equal(__read('name', state), '')
  assert.deepEqual(Object.keys(__snapshot(state)), [
    'name',
    'count',
    'meta',
    'tags',
  ])

  const update = __update('name', 'alice', state)
  assert.deepEqual(update.change, { name: 'alice' })
  assert.deepEqual(Object.keys(update.delta), ['name'])
  assert.equal(__read('name', state), 'alice')

  const singleDelete = __delete(state, 'name')
  assert.deepEqual(singleDelete.change, { name: '' })
  const fullDelete = __delete(state)
  assert.deepEqual(Object.keys(fullDelete.change).sort(), [
    'count',
    'meta',
    'name',
    'tags',
  ])

  const ack = __acknowledge(state)
  assert.deepEqual(Object.keys(ack).sort(), ['count', 'meta', 'name', 'tags'])
  __garbageCollect([ack], state)
  assertSnapshotShape(__snapshot(state))
})

test('core merge and hostile raw inputs stay non-throwing and converge', () => {
  const source = __create(createDefaults())
  const target = __create(createDefaults())

  assert.equal(__merge(null, target), false)
  assert.equal(__merge(false, target), false)
  assert.equal(__merge([], target), false)
  assert.equal(__merge('bad', target), false)

  const delta = __update('name', 'alice', source).delta
  const mergeResult = __merge(delta, target)
  assert.deepEqual(mergeResult.change, { name: 'alice' })
  assert.equal(__read('name', target), 'alice')
  const rebuttal = __merge(delta, target)
  assert.deepEqual(rebuttal.change, {})
  assert.deepEqual(Object.keys(rebuttal.delta), ['name'])

  const badUuid = createValidUuid('bad-uuid')
  assert.doesNotThrow(() => {
    __merge(
      {
        name: {
          uuidv7: badUuid,
          predecessor: 'bad',
          value: 'ignored',
          tombstones: [],
        },
      },
      target
    )
  })

  __garbageCollect(false, target)
  __garbageCollect([], target)
  __garbageCollect([null, []], target)
})

test('empty struct instances preserve reflection events and serialization semantics', () => {
  const replica = new CRStruct({})
  const events = { delta: [], change: [], snapshot: [], ack: [] }

  replica.addEventListener('delta', (event) => {
    events.delta.push(event.detail)
  })
  replica.addEventListener('change', (event) => {
    events.change.push(event.detail)
  })
  replica.addEventListener('snapshot', (event) => {
    events.snapshot.push(event.detail)
  })
  replica.addEventListener('ack', (event) => {
    events.ack.push(event.detail)
  })

  assert.deepEqual(replica.keys(), [])
  assert.deepEqual(Object.keys(replica), [])
  assert.deepEqual(Reflect.ownKeys(replica).sort(), [
    '__eventTarget',
    '__state',
  ])
  assert.deepEqual(replica.values(), [])
  assert.deepEqual(replica.entries(), [])
  assert.deepEqual([...replica], [])
  assert.deepEqual(replica.clone(), {})
  assert.deepEqual(replica.toJSON(), {})

  replica.snapshot()
  replica.acknowledge()
  replica.clear()

  assert.deepEqual(events.snapshot, [{}])
  assert.deepEqual(events.ack, [{}])
  assert.deepEqual(events.delta, [{}])
  assert.deepEqual(events.change, [{}])
})

test('proxy defensive branches stay stable under corrupted internal state', () => {
  const replica = createReplica()
  const state = readState(replica)

  assert.equal(Reflect.deleteProperty(replica, 'ghost'), false)
  delete state.defaults.name
  assert.equal(Reflect.deleteProperty(replica, 'name'), false)

  state.defaults = null
  assert.equal(Reflect.set(replica, 'name', 'alice'), false)
  assert.equal(Reflect.deleteProperty(replica, 'count'), false)
})
