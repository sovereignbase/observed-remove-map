import { performance } from 'node:perf_hooks'
import { OOStruct } from '../dist/index.js'

function formatOps(iterations, durationMs) {
  const opsPerSec = Math.round((iterations / durationMs) * 1000)
  const ms = durationMs.toFixed(1)
  return `${opsPerSec.toLocaleString()} ops/s (${ms} ms)`
}

function section(name) {
  console.log(`\n${name}`)
}

function bench(name, iterations, fn) {
  const warmupIterations = Math.min(
    200,
    Math.max(10, Math.ceil(iterations / 20))
  )

  for (let index = 0; index < warmupIterations; index++) fn()

  const start = performance.now()
  for (let index = 0; index < iterations; index++) fn()
  const duration = performance.now() - start

  console.log(`${name.padEnd(32)} ${formatOps(iterations, duration)}`)
}

function createDefaults() {
  return {
    name: '',
    count: 0,
    meta: { enabled: false },
    tags: [],
  }
}

const fields = ['name', 'count', 'meta', 'tags']

function nextValue(step, prefix = 'value') {
  switch (fields[step % fields.length]) {
    case 'name':
      return `${prefix}-name-${step}`
    case 'count':
      return step
    case 'meta':
      return { enabled: step % 2 === 0 }
    case 'tags':
      return [`${prefix}-tag-${step}`, `${prefix}-${step}`]
    default:
      throw new Error(`Unknown field at step ${step}`)
  }
}

function createReplicaWithHistory(updateCount, prefix = 'history') {
  const replica = new OOStruct(createDefaults())

  for (let step = 0; step < updateCount; step++) {
    replica.update(fields[step % fields.length], nextValue(step, prefix))
  }

  return replica
}

function readDelta(replica, action) {
  let delta

  replica.addEventListener(
    'delta',
    (event) => {
      delta = event.detail
    },
    { once: true }
  )
  action()

  return delta
}

function readSnapshot(replica) {
  let snapshot

  replica.addEventListener(
    'snapshot',
    (event) => {
      snapshot = event.detail
    },
    { once: true }
  )
  replica.snapshot()

  return snapshot
}

function readAck(replica) {
  let ack

  replica.addEventListener(
    'ack',
    (event) => {
      ack = event.detail
    },
    { once: true }
  )
  replica.acknowledge()

  return ack
}

console.log(
  `Benchmarking @sovereignbase/observed-overwrite-struct on Node ${process.versions.node}...`
)

const stableReplica = createReplicaWithHistory(64, 'stable')
const hydrate64Snapshot = readSnapshot(
  createReplicaWithHistory(64, 'hydrate64')
)
const hydrate256Snapshot = readSnapshot(
  createReplicaWithHistory(256, 'hydrate256')
)
const hydrate1024Snapshot = readSnapshot(
  createReplicaWithHistory(1024, 'hydrate1024')
)

const directBaseSnapshot = readSnapshot(new OOStruct(createDefaults()))
const directSource = new OOStruct(createDefaults(), directBaseSnapshot)
const directSuccessorDelta = readDelta(directSource, () => {
  directSource.update('name', 'alice')
})

const staleBaseSnapshot = readSnapshot(new OOStruct(createDefaults()))
const staleOlder = new OOStruct(createDefaults(), staleBaseSnapshot)
const staleIncomingDelta = readDelta(staleOlder, () => {
  staleOlder.update('name', 'older')
})
const staleNewer = new OOStruct(createDefaults(), staleBaseSnapshot)
staleNewer.update('name', 'newer')
const staleTargetSnapshot = readSnapshot(staleNewer)

const noOpReplica = createReplicaWithHistory(64, 'noop')
const noOpSnapshot = readSnapshot(noOpReplica)

const gcSnapshot = readSnapshot(createReplicaWithHistory(512, 'gc'))
const gcFrontiers = [
  readAck(new OOStruct(createDefaults(), gcSnapshot)),
  readAck(new OOStruct(createDefaults(), gcSnapshot)),
  readAck(new OOStruct(createDefaults(), gcSnapshot)),
]

const eventfulListener = () => {}

section('Construction')
bench('constructor empty', 100000, () => {
  new OOStruct(createDefaults())
})
bench('constructor hydrate x64', 5000, () => {
  new OOStruct(createDefaults(), hydrate64Snapshot)
})
bench('constructor hydrate x256', 2000, () => {
  new OOStruct(createDefaults(), hydrate256Snapshot)
})
bench('constructor hydrate x1024', 500, () => {
  new OOStruct(createDefaults(), hydrate1024Snapshot)
})
bench('create() empty', 100000, () => {
  OOStruct.create(createDefaults())
})
bench('create() hydrate x256', 2000, () => {
  OOStruct.create(createDefaults(), hydrate256Snapshot)
})

section('Read Methods')
bench('read primitive', 200000, () => {
  stableReplica.read('name')
})
bench('read object', 200000, () => {
  stableReplica.read('meta')
})
bench('read array', 200000, () => {
  stableReplica.read('tags')
})
bench('keys()', 200000, () => {
  stableReplica.keys()
})
bench('values()', 100000, () => {
  stableReplica.values()
})
bench('entries()', 100000, () => {
  stableReplica.entries()
})
bench('snapshot()', 20000, () => {
  readSnapshot(stableReplica)
})
bench('acknowledge()', 50000, () => {
  readAck(stableReplica)
})

section('Write Methods')
bench('update string', 50000, () => {
  const replica = new OOStruct(createDefaults(), directBaseSnapshot)
  replica.update('name', 'bench-name')
})
bench('update number', 50000, () => {
  const replica = new OOStruct(createDefaults(), directBaseSnapshot)
  replica.update('count', 42)
})
bench('update object', 50000, () => {
  const replica = new OOStruct(createDefaults(), directBaseSnapshot)
  replica.update('meta', { enabled: true })
})
bench('update array', 50000, () => {
  const replica = new OOStruct(createDefaults(), directBaseSnapshot)
  replica.update('tags', ['a', 'b'])
})
bench('delete(key)', 50000, () => {
  const replica = createReplicaWithHistory(8, 'delete-one')
  replica.delete('name')
})
bench('delete() reset all', 20000, () => {
  const replica = createReplicaWithHistory(8, 'delete-all')
  replica.delete()
})

section('Replication And GC')
bench('merge direct successor', 50000, () => {
  const replica = new OOStruct(createDefaults(), directBaseSnapshot)
  replica.merge(directSuccessorDelta)
})
bench('merge stale conflict', 20000, () => {
  const replica = new OOStruct(createDefaults(), staleTargetSnapshot)
  replica.merge(staleIncomingDelta)
})
bench('merge hydrate snapshot x256', 5000, () => {
  const replica = new OOStruct(createDefaults())
  replica.merge(hydrate256Snapshot)
})
bench('merge noop duplicate', 50000, () => {
  const replica = new OOStruct(createDefaults(), noOpSnapshot)
  replica.merge(noOpSnapshot)
})
bench('garbageCollect() x512 history', 5000, () => {
  const replica = new OOStruct(createDefaults(), gcSnapshot)
  replica.garbageCollect(gcFrontiers)
})

section('Event Methods')
bench('add/remove listener roundtrip', 200000, () => {
  const replica = new OOStruct(createDefaults())
  replica.addEventListener('delta', eventfulListener)
  replica.removeEventListener('delta', eventfulListener)
})
bench('update with listeners', 30000, () => {
  const replica = new OOStruct(createDefaults(), directBaseSnapshot)
  replica.addEventListener('delta', eventfulListener)
  replica.addEventListener('change', eventfulListener)
  replica.update('name', 'eventful')
})
bench('merge with listeners', 20000, () => {
  const replica = new OOStruct(createDefaults(), directBaseSnapshot)
  replica.addEventListener('delta', eventfulListener)
  replica.addEventListener('change', eventfulListener)
  replica.merge(directSuccessorDelta)
})

console.log('\nBenchmark complete.')
