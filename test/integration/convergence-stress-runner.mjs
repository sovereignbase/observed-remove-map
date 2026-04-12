import assert from 'node:assert/strict'
import { CRStruct } from '../../dist/index.js'
import {
  createDefaults,
  createValidUuid,
  mulberry32,
  readAck,
  readSnapshot,
} from '../shared/oostruct.mjs'

setTimeout(() => {
  console.error('integration stress watchdog timeout')
  process.exit(124)
}, 8_000).unref()

function nextValue(field, step, replicaIndex) {
  switch (field) {
    case 'name':
      return `name-${replicaIndex}-${step}`
    case 'count':
      return step + replicaIndex
    case 'meta':
      return { enabled: (step + replicaIndex) % 2 === 0 }
    case 'tags':
      return [`tag-${replicaIndex}-${step}`, `tag-${step}`]
    default:
      throw new Error(`Unknown field: ${field}`)
  }
}

function hostileDelta(step) {
  const uuid = createValidUuid(`hostile-${step}`)
  const predecessor = createValidUuid(`hostile-predecessor-${step}`)
  return step % 5 === 0
    ? { name: null }
    : step % 5 === 1
      ? {
          name: {
            uuidv7: 'bad',
            predecessor: 'bad',
            value: 'x',
            tombstones: [],
          },
        }
      : step % 5 === 2
        ? {
            count: {
              uuidv7: uuid,
              predecessor,
              value: 'bad',
              tombstones: [predecessor],
            },
          }
        : step % 5 === 3
          ? {
              tags: {
                uuidv7: uuid,
                predecessor,
                value: () => {},
                tombstones: [predecessor],
              },
            }
          : { ghost: { uuidv7: uuid } }
}

for (let scenario = 0; scenario < 64; scenario++) {
  const rng = mulberry32(0x0ddc0ffe + scenario)
  const base = new CRStruct(createDefaults())
  const replicas = Array.from(
    { length: 3 + (scenario % 3) },
    () => new CRStruct(createDefaults(), readSnapshot(base))
  )
  const fields = ['name', 'count', 'meta', 'tags']

  for (let step = 0; step < 32 + (scenario % 16); step++) {
    const actorIndex = Math.floor(rng() * replicas.length)
    let actor = replicas[actorIndex]
    const branch = rng()

    if (branch < 0.32) {
      const field = fields[Math.floor(rng() * fields.length)]
      assert.equal(
        Reflect.set(actor, field, nextValue(field, step, actorIndex)),
        true
      )
      continue
    }

    if (branch < 0.46) {
      if (rng() < 0.45) actor.clear()
      else
        Reflect.deleteProperty(actor, fields[Math.floor(rng() * fields.length)])
      continue
    }

    if (branch < 0.74) {
      const sourceIndex = Math.floor(rng() * replicas.length)
      if (sourceIndex === actorIndex) continue
      actor.merge(readSnapshot(replicas[sourceIndex]))
      continue
    }

    if (branch < 0.88) {
      assert.doesNotThrow(() => {
        actor.merge(hostileDelta(step))
      })
      continue
    }

    const frontiers = replicas.map(readAck)
    for (let index = 0; index < replicas.length; index++) {
      replicas[index].garbageCollect(frontiers)
    }

    if (rng() < 0.18) {
      actor = new CRStruct(createDefaults(), readSnapshot(actor))
      replicas[actorIndex] = actor
    }
  }

  for (let round = 0; round < 4; round++) {
    const snapshots = replicas.map(readSnapshot)
    for (let targetIndex = 0; targetIndex < replicas.length; targetIndex++) {
      for (let sourceIndex = 0; sourceIndex < snapshots.length; sourceIndex++) {
        if (sourceIndex === targetIndex) continue
        replicas[targetIndex].merge(snapshots[sourceIndex])
      }
    }
  }

  const projections = replicas.map((replica) => replica.clone())
  for (let index = 1; index < projections.length; index++) {
    assert.deepEqual(projections[index], projections[0])
    assert.deepEqual(
      new CRStruct(createDefaults(), readSnapshot(replicas[index])).clone(),
      projections[index]
    )
  }
}
