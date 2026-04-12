const TEST_TIMEOUT_MS = 10_000

export async function runCRStructSuite(api, options = {}) {
  const {
    label = 'runtime',
    stressRounds = 12,
    includeStress = false,
  } = options
  const results = { label, ok: true, errors: [], tests: [] }
  const {
    CRStruct,
    __acknowledge,
    __create,
    __delete,
    __garbageCollect,
    __merge,
    __read,
    __snapshot,
    __update,
  } = api

  function assert(condition, message) {
    if (!condition) throw new Error(message || 'assertion failed')
  }

  function assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(message || `expected ${actual} to equal ${expected}`)
    }
  }

  function assertJsonEqual(actual, expected, message) {
    const actualJson = JSON.stringify(actual)
    const expectedJson = JSON.stringify(expected)
    if (actualJson !== expectedJson) {
      throw new Error(
        message || `expected ${actualJson} to equal ${expectedJson}`
      )
    }
  }

  function createDefaults() {
    return {
      name: '',
      count: 0,
      meta: { enabled: false },
      tags: [],
    }
  }

  function createReplica(snapshot) {
    return new CRStruct(createDefaults(), snapshot)
  }

  function captureEvents(replica) {
    const events = {
      delta: [],
      change: [],
      snapshot: [],
      ack: [],
    }

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

    return events
  }

  function readSnapshot(replica) {
    return replica.toJSON()
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
    assertEqual(replica.acknowledge(), undefined)
    assert(ack, 'expected ack detail')
    return ack
  }

  function normalizeSnapshot(snapshot) {
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

  function projection(replica) {
    return replica.clone()
  }

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
        throw new Error(`unknown field: ${field}`)
    }
  }

  function random(seed) {
    let state = seed >>> 0
    return () => {
      state = (state + 0x6d2b79f5) >>> 0
      let t = Math.imul(state ^ (state >>> 15), 1 | state)
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  async function withTimeout(promise, ms, name) {
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`timeout after ${ms}ms${name ? `: ${name}` : ''}`))
      }, ms)
    })
    return Promise.race([promise.finally(() => clearTimeout(timer)), timeout])
  }

  async function runTest(name, fn) {
    try {
      await withTimeout(Promise.resolve().then(fn), TEST_TIMEOUT_MS, name)
      results.tests.push({ name, ok: true })
    } catch (error) {
      results.ok = false
      results.tests.push({ name, ok: false })
      results.errors.push({ name, message: String(error) })
    }
  }

  await runTest('exports shape', () => {
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
      assert(typeof value === 'function', 'missing public export')
    }
  })

  await runTest(
    'constructor proxy reflection and serialization surface',
    () => {
      const replica = createReplica()

      assertEqual(replica.name, '')
      assertEqual(replica.count, 0)
      assertJsonEqual(replica.meta, { enabled: false })
      assertJsonEqual(replica.tags, [])
      assertJsonEqual(replica.keys(), ['name', 'count', 'meta', 'tags'])
      assertJsonEqual(Object.keys(replica), ['name', 'count', 'meta', 'tags'])

      const enumerated = []
      for (const key in replica) enumerated.push(key)
      assertJsonEqual(enumerated, ['name', 'count', 'meta', 'tags'])

      const ownKeys = Reflect.ownKeys(replica)
      for (const key of [
        'state',
        'eventTarget',
        'name',
        'count',
        'meta',
        'tags',
      ]) {
        assert(ownKeys.includes(key), `missing own key ${String(key)}`)
      }

      const json = readSnapshot(replica)
      assertJsonEqual(Object.keys(json), ['name', 'count', 'meta', 'tags'])
      assertEqual(replica.toString(), JSON.stringify(json))
    }
  )

  await runTest('local writes deletes clears and detached payloads', () => {
    const replica = createReplica()
    const events = captureEvents(replica)

    assertEqual(Reflect.set(replica, 'meta', { enabled: true }), true)
    assertEqual(Reflect.set(replica, 'tags', ['x']), true)
    assertEqual('meta' in replica, true)
    assertEqual('ghost' in replica, false)
    assertEqual(Reflect.set(replica, 'ghost', 'bad'), false)
    assertEqual(Reflect.deleteProperty(replica, 'ghost'), false)
    assertEqual(
      Reflect.set(replica, 'name', () => {}),
      false
    )
    assertEqual(Reflect.deleteProperty(replica, 'tags'), true)

    events.delta[0].meta.value.enabled = false
    events.change[0].meta.enabled = false
    assertJsonEqual(replica.meta, { enabled: true })

    replica.clear()

    assertJsonEqual(replica.clone(), createDefaults())
    assert(events.delta.length >= 2, 'expected delta events from local writes')
    assert(
      events.change.length >= 2,
      'expected change events from local writes'
    )
  })

  await runTest('core create read update delete and snapshot roundtrip', () => {
    const state = __create(createDefaults())
    assertEqual(__read('name', state), '')

    const update = __update('name', 'alice', state)
    assertJsonEqual(update.change, { name: 'alice' })
    assertEqual(__read('name', state), 'alice')

    const snapshot = __snapshot(state)
    const rebuilt = __create(createDefaults(), snapshot)
    assertEqual(__read('name', rebuilt), 'alice')

    const deleted = __delete(rebuilt, 'name')
    assertJsonEqual(deleted.change, { name: '' })
    assertEqual(__read('name', rebuilt), '')
  })

  await runTest('typed errors remain explicit in core operations', () => {
    try {
      __create({
        ...createDefaults(),
        bad: () => {},
      })
      throw new Error('expected defaults error')
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'expected defaults error'
      ) {
        throw error
      }
      assertEqual(error.name, 'CRStructError')
      assertEqual(error.code, 'DEFAULTS_NOT_CLONEABLE')
    }

    try {
      __update('count', 'bad', __create(createDefaults()))
      throw new Error('expected update error')
    } catch (error) {
      if (error instanceof Error && error.message === 'expected update error') {
        throw error
      }
      assertEqual(error.name, 'CRStructError')
      assertEqual(error.code, 'VALUE_TYPE_MISMATCH')
    }
  })

  await runTest(
    'merge remains non-throwing for hostile ingress and converges peers',
    () => {
      const local = createReplica()
      const remote = createReplica(readSnapshot(local))
      const before = normalizeSnapshot(readSnapshot(local))

      for (const payload of [
        null,
        false,
        [],
        { ghost: { uuidv7: 'bad' } },
        {
          name: {
            uuidv7: 'bad',
            predecessor: 'bad',
            value: 'x',
            tombstones: [],
          },
        },
      ]) {
        assertEqual(local.merge(payload), undefined)
      }

      assertJsonEqual(normalizeSnapshot(readSnapshot(local)), before)

      local.name = 'alice'
      remote.merge(readSnapshot(local))
      remote.count = 7
      local.merge(readSnapshot(remote))

      assertJsonEqual(projection(local), projection(remote))
    }
  )

  await runTest(
    'acknowledge and garbageCollect compact retained tombstones',
    () => {
      const replica = createReplica()
      replica.name = 'a'
      replica.name = 'b'
      replica.name = 'c'
      const before = readSnapshot(replica)
      const ack = readAck(replica)

      replica.garbageCollect([ack])

      const after = readSnapshot(replica)
      assert(after.name.tombstones.length < before.name.tombstones.length)
      assert(
        after.name.tombstones.includes(after.name.predecessor),
        'expected current predecessor to survive gc'
      )
    }
  )

  await runTest(
    'listener objects snapshot events and removal behave consistently',
    () => {
      const replica = createReplica()
      let detail
      let calls = 0
      const listener = {
        handleEvent(event) {
          calls++
          detail = event.detail
        },
      }

      replica.addEventListener('snapshot', listener)
      replica.snapshot()
      replica.removeEventListener('snapshot', listener)
      replica.snapshot()

      detail.meta.value.enabled = true

      assertEqual(calls, 1)
      assertJsonEqual(replica.meta, { enabled: false })
    }
  )

  if (includeStress) {
    await runTest(
      'replicas converge under deterministic shuffled gossip',
      () => {
        const rng = random(0x0ddc0ffe)
        const replicas = Array.from({ length: 4 }, () => createReplica())
        const fields = ['name', 'count', 'meta', 'tags']

        for (let step = 0; step < stressRounds * 20; step++) {
          const actorIndex = Math.floor(rng() * replicas.length)
          const actor = replicas[actorIndex]
          const branch = rng()

          if (branch < 0.34) {
            const field = fields[Math.floor(rng() * fields.length)]
            assertEqual(
              Reflect.set(actor, field, nextValue(field, step, actorIndex)),
              true
            )
            continue
          }

          if (branch < 0.5) {
            if (rng() < 0.5) actor.clear()
            else
              Reflect.deleteProperty(
                actor,
                fields[Math.floor(rng() * fields.length)]
              )
            continue
          }

          if (branch < 0.8) {
            const sourceIndex = Math.floor(rng() * replicas.length)
            if (sourceIndex === actorIndex) continue
            actor.merge(readSnapshot(replicas[sourceIndex]))
            continue
          }

          const frontiers = replicas.map(readAck)
          for (const replica of replicas) replica.garbageCollect(frontiers)
        }

        for (let round = 0; round < 4; round++) {
          const snapshots = replicas.map(readSnapshot)
          for (
            let targetIndex = 0;
            targetIndex < replicas.length;
            targetIndex++
          ) {
            for (
              let sourceIndex = 0;
              sourceIndex < snapshots.length;
              sourceIndex++
            ) {
              if (sourceIndex === targetIndex) continue
              replicas[targetIndex].merge(snapshots[sourceIndex])
            }
          }
        }

        const expected = projection(replicas[0])
        for (let index = 1; index < replicas.length; index++) {
          assertJsonEqual(projection(replicas[index]), expected)
        }
      }
    )
  }

  return results
}

export function printResults(results) {
  const passed = results.tests.filter((test) => test.ok).length
  console.log(`${results.label}: ${passed}/${results.tests.length} passed`)
  if (!results.ok) {
    for (const error of results.errors) {
      console.error(`  - ${error.name}: ${error.message}`)
    }
  }
}

export function ensurePassing(results) {
  if (results.ok) return
  throw new Error(
    `${results.label} failed with ${results.errors.length} failing tests`
  )
}
