import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createReplica,
  emitSnapshot,
  readSnapshot,
} from '../shared/oostruct.mjs'

test('event listener object handleEvent receives delta detail', () => {
  const replica = createReplica()
  let detail

  replica.addEventListener('delta', {
    handleEvent(event) {
      detail = event.detail
    },
  })

  replica.name = 'alice'

  assert.equal(detail.name.value, 'alice')
})

test('removeEventListener stops function and object listeners', () => {
  const replica = createReplica()
  let fnCalls = 0
  let objectCalls = 0
  const fnListener = () => {
    fnCalls++
  }
  const objectListener = {
    handleEvent() {
      objectCalls++
    },
  }

  replica.addEventListener('delta', fnListener)
  replica.addEventListener('snapshot', objectListener)
  replica.removeEventListener('delta', fnListener)
  replica.removeEventListener('snapshot', objectListener)
  replica.name = 'alice'
  replica.snapshot()

  assert.equal(fnCalls, 0)
  assert.equal(objectCalls, 0)
})

test('event channels remain independent across local writes merges snapshot acknowledge and clear', () => {
  const local = createReplica()
  const remote = createReplica(readSnapshot(local))
  const counts = { delta: 0, change: 0, snapshot: 0, ack: 0 }

  local.addEventListener('delta', () => {
    counts.delta++
  })
  local.addEventListener('change', () => {
    counts.change++
  })
  local.addEventListener('snapshot', () => {
    counts.snapshot++
  })
  local.addEventListener('ack', () => {
    counts.ack++
  })

  local.name = 'alice'
  remote.count = 7
  local.merge(readSnapshot(remote))
  local.snapshot()
  local.acknowledge()
  local.clear()

  assert.deepEqual(counts, {
    delta: 3,
    change: 3,
    snapshot: 1,
    ack: 1,
  })
})

test('snapshot payloads are detached from live state', () => {
  const replica = createReplica()
  replica.meta = { enabled: true }
  const snapshot = emitSnapshot(replica)

  snapshot.meta.value.enabled = false
  snapshot.tags.value.push('mutated')
  snapshot.name.tombstones.length = 0

  assert.deepEqual(replica.meta, { enabled: true })
  assert.deepEqual(replica.tags, [])
  assert.equal(readSnapshot(replica).name.tombstones.length > 0, true)
})
