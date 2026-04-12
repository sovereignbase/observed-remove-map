import assert from 'node:assert/strict'
import test from 'node:test'
import {
  captureEvents,
  cloneSnapshot,
  createReplica,
  createValidUuid,
  normalizeSnapshot,
  readSnapshot,
} from '../shared/oostruct.mjs'

test('merge ignores malformed ingress and hostile per-key payloads without throwing', () => {
  const replica = createReplica()
  const before = normalizeSnapshot(readSnapshot(replica))
  const validUuid = createValidUuid('valid')
  const validPredecessor = createValidUuid('predecessor')
  const corpus = [
    null,
    false,
    0,
    'bad',
    [],
    { ghost: { uuidv7: validUuid } },
    { name: null },
    {
      name: {
        uuidv7: 'bad',
        predecessor: 'bad',
        value: 'x',
        tombstones: [],
      },
    },
    {
      name: {
        uuidv7: validUuid,
        predecessor: validPredecessor,
        value: 123,
        tombstones: [validPredecessor],
      },
    },
    {
      name: {
        uuidv7: validUuid,
        predecessor: validPredecessor,
        value: 'ok',
        tombstones: 'bad',
      },
    },
    {
      name: {
        uuidv7: validUuid,
        predecessor: validPredecessor,
        value: () => {},
        tombstones: [validPredecessor],
      },
    },
  ]

  for (const payload of corpus) {
    assert.doesNotThrow(() => {
      replica.merge(payload)
    })
  }

  assert.deepEqual(normalizeSnapshot(readSnapshot(replica)), before)
})

test('merge adopts a direct successor and emits change', () => {
  const source = createReplica()
  const baseSnapshot = readSnapshot(source)
  const target = createReplica(baseSnapshot)
  const sourceEvents = captureEvents(source)
  source.name = 'alice'
  const delta = sourceEvents.events.delta[0]

  const targetEvents = captureEvents(target)
  target.merge(delta)

  assert.equal(target.name, 'alice')
  assert.equal(targetEvents.events.delta.length, 1)
  assert.equal(targetEvents.events.change.length, 1)
  assert.deepEqual(targetEvents.events.delta[0], {})
  assert.deepEqual(targetEvents.events.change[0], { name: 'alice' })
})

test('merge ignores candidates whose predecessor is missing from tombstones', () => {
  const replica = createReplica()
  const candidateUuid = createValidUuid('candidate')
  const predecessor = createValidUuid('predecessor')
  const before = normalizeSnapshot(readSnapshot(replica))

  replica.merge({
    name: {
      uuidv7: candidateUuid,
      predecessor,
      value: 'ignored',
      tombstones: [],
    },
  })

  assert.deepEqual(normalizeSnapshot(readSnapshot(replica)), before)
})

test('merge keeps the current winner and emits a rebuttal delta for stale concurrent ingress', () => {
  const base = createReplica()
  const baseSnapshot = readSnapshot(base)
  const older = createReplica(baseSnapshot)
  const newer = createReplica(baseSnapshot)

  older.name = 'older'
  const olderSnapshot = readSnapshot(older)
  newer.name = 'newer'

  const newerEvents = captureEvents(newer)
  newer.merge(olderSnapshot)

  assert.equal(newer.name, 'newer')
  assert.equal(newerEvents.events.delta.length, 1)
  assert.equal(newerEvents.events.change.length, 1)
  assert.deepEqual(newerEvents.events.change[0], {})

  older.merge(newerEvents.events.delta[0])

  assert.deepEqual(
    normalizeSnapshot(readSnapshot(older)),
    normalizeSnapshot(readSnapshot(newer))
  )
})

test('merge adopts a same-uuid candidate with a greater predecessor identifier', () => {
  const replica = createReplica()
  replica.name = 'local'
  const snapshot = cloneSnapshot(readSnapshot(replica))
  const greaterPredecessor = createValidUuid('greater-predecessor')

  snapshot.name.value = 'remote'
  snapshot.name.predecessor = greaterPredecessor
  snapshot.name.tombstones.push(greaterPredecessor)

  const { events } = captureEvents(replica)
  replica.merge({ name: snapshot.name })

  assert.equal(replica.name, 'remote')
  assert.equal(events.delta.length, 1)
  assert.equal(events.change.length, 1)
  assert.deepEqual(events.delta[0], {})
  assert.deepEqual(events.change[0], { name: 'remote' })
})

test('merge repairs a same-uuid conflict with a stale predecessor identifier', () => {
  const replica = createReplica()
  replica.name = 'local'
  const snapshot = cloneSnapshot(readSnapshot(replica))
  snapshot.name.value = 'conflict'

  const { events } = captureEvents(replica)
  replica.merge({ name: snapshot.name })

  assert.equal(replica.name, 'local')
  assert.equal(events.delta.length, 1)
  assert.equal(events.change.length, 1)
  assert.deepEqual(events.change[0], {})
})
