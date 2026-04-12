import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertSnapshotShape,
  captureEvents,
  createReplica,
  readSnapshot,
  readState,
} from '../shared/oostruct.mjs'

test('field reads clone values across direct access clone values entries descriptors and iteration', () => {
  const replica = createReplica()

  const meta = replica.meta
  meta.enabled = true
  const tags = replica.tags
  tags.push('property')

  const entries = Object.fromEntries(replica.entries())
  entries.meta.enabled = true
  entries.tags.push('entry')

  const values = replica.values()
  values[2].enabled = true
  values[3].push('value')

  const cloned = replica.clone()
  cloned.meta.enabled = true
  cloned.tags.push('clone')

  const iterated = [...replica]
  iterated[2][1].enabled = true
  iterated[3][1].push('iterator')

  const descriptor = Object.getOwnPropertyDescriptor(replica, 'meta')
  descriptor.value.enabled = true

  assert.deepEqual(replica.meta, { enabled: false })
  assert.deepEqual(replica.tags, [])
})

test('property writes emit detached delta and change payloads', () => {
  const replica = createReplica()
  const { events } = captureEvents(replica)

  assert.equal(Reflect.set(replica, 'meta', { enabled: true }), true)

  assert.deepEqual(replica.meta, { enabled: true })
  assert.equal(events.delta.length, 1)
  assert.equal(events.change.length, 1)

  events.delta[0].meta.value.enabled = false
  events.change[0].meta.enabled = false

  assert.deepEqual(replica.meta, { enabled: true })
})

test('delete resets a single field and clear resets the whole struct', () => {
  const replica = createReplica()
  replica.name = 'alice'
  replica.count = 3
  replica.meta = { enabled: true }
  replica.tags = ['x']

  const deleteEvents = captureEvents(replica)
  assert.equal(Reflect.deleteProperty(replica, 'name'), true)
  assert.equal(replica.name, '')
  assert.equal(replica.count, 3)
  assert.deepEqual(Object.keys(deleteEvents.events.delta[0]), ['name'])
  assert.deepEqual(Object.keys(deleteEvents.events.change[0]), ['name'])

  const clearReplica = createReplica()
  clearReplica.name = 'alice'
  clearReplica.count = 3
  clearReplica.meta = { enabled: true }
  clearReplica.tags = ['x']
  const clearEvents = captureEvents(clearReplica)

  clearReplica.clear()

  assert.equal(clearReplica.name, '')
  assert.equal(clearReplica.count, 0)
  assert.deepEqual(clearReplica.meta, { enabled: false })
  assert.deepEqual(clearReplica.tags, [])
  assert.deepEqual(Object.keys(clearEvents.events.delta[0]).sort(), [
    'count',
    'meta',
    'name',
    'tags',
  ])
  assert.deepEqual(Object.keys(clearEvents.events.change[0]).sort(), [
    'count',
    'meta',
    'name',
    'tags',
  ])
})

test('proxy reflection json and defensive false branches stay coherent', () => {
  const replica = createReplica()

  assert.equal('name' in replica, true)
  assert.equal('clear' in replica, true)
  assert.equal('ghost' in replica, false)
  assert.equal(Reflect.get(replica, 'ghost'), undefined)
  assert.equal(Reflect.set(replica, 'ghost', 'bad'), false)
  assert.equal(Reflect.deleteProperty(replica, 'ghost'), false)
  assert.equal(
    Reflect.set(replica, 'name', () => {}),
    false
  )
  assert.equal(replica.name, '')

  replica.name = 'alice'
  const json = readSnapshot(replica)
  assertSnapshotShape(json)
  assert.equal(replica.toString(), JSON.stringify(json))
  assert.deepEqual(replica[Symbol.for('nodejs.util.inspect.custom')](), json)
  assert.deepEqual(replica[Symbol.for('Deno.customInspect')](), json)

  const state = readState(replica)
  delete state.defaults.name
  assert.equal(Reflect.deleteProperty(replica, 'name'), false)
  state.defaults = null
  assert.equal(Reflect.set(replica, 'count', 1), false)
})
