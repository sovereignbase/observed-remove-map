import assert from 'node:assert/strict'
import { isUuidV7 } from '@sovereignbase/utils'
import { CRStruct } from '../../dist/index.js'

export function createDefaults() {
  return {
    name: '',
    count: 0,
    meta: { enabled: false },
    tags: [],
  }
}

export function createReplica(snapshot) {
  return new CRStruct(createDefaults(), snapshot)
}

export function captureEvents(replica) {
  const events = {
    delta: [],
    change: [],
    snapshot: [],
    ack: [],
  }

  const listeners = {
    delta(event) {
      events.delta.push(event.detail)
    },
    change(event) {
      events.change.push(event.detail)
    },
    snapshot(event) {
      events.snapshot.push(event.detail)
    },
    ack(event) {
      events.ack.push(event.detail)
    },
  }

  replica.addEventListener('delta', listeners.delta)
  replica.addEventListener('change', listeners.change)
  replica.addEventListener('snapshot', listeners.snapshot)
  replica.addEventListener('ack', listeners.ack)

  return { events, listeners }
}

export function readSnapshot(replica) {
  return replica.toJSON()
}

export function emitSnapshot(replica) {
  let snapshot
  replica.addEventListener(
    'snapshot',
    (event) => {
      snapshot = event.detail
    },
    { once: true }
  )
  assert.equal(replica.snapshot(), undefined)
  assert.ok(snapshot)
  return snapshot
}

export function readAck(replica) {
  let ack
  replica.addEventListener(
    'ack',
    (event) => {
      ack = event.detail
    },
    { once: true }
  )
  assert.equal(replica.acknowledge(), undefined)
  assert.ok(ack)
  return ack
}

export function readState(replica) {
  const descriptor = Reflect.getOwnPropertyDescriptor(replica, 'state')
  assert.ok(descriptor)
  return descriptor.value
}

export function createValidUuid(seed = 'seed') {
  const replica = createReplica()
  assert.equal(Reflect.set(replica, 'name', seed), true)
  return readSnapshot(replica).name.uuidv7
}

export function cloneSnapshot(snapshot) {
  return structuredClone(snapshot)
}

export function normalizeSnapshot(snapshot) {
  const normalized = {}
  for (const key of Object.keys(snapshot).sort()) {
    const entry = snapshot[key]
    normalized[key] = {
      uuidv7: entry.uuidv7,
      value: structuredClone(entry.value),
      predecessor: entry.predecessor,
      tombstones: [...entry.tombstones].sort(),
    }
  }
  return normalized
}

export function assertSnapshotShape(snapshot) {
  assert.deepEqual(Object.keys(snapshot), ['name', 'count', 'meta', 'tags'])
  for (const entry of Object.values(snapshot)) {
    assert.equal(typeof entry, 'object')
    assert.equal(Array.isArray(entry.tombstones), true)
    assert.equal(isUuidV7(entry.uuidv7), true)
    assert.equal(isUuidV7(entry.predecessor), true)
    assert.equal(entry.tombstones.includes(entry.predecessor), true)
  }
}

export function assertCRStructError(error, code) {
  assert.ok(error)
  assert.equal(error.name, 'CRStructError')
  assert.equal(error.code, code)
  assert.match(
    String(error.message),
    /\{@sovereignbase\/convergent-replicated-struct\}/
  )
  return true
}

export function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
