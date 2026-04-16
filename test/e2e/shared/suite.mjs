const TEST_TIMEOUT_MS = 10_000

export async function runCRStructSuite(api, options = {}) {
  const {
    label = 'runtime',
    stressRounds = 12,
    includeStress = false,
    verbose = false,
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
  const fields = ['name', 'count', 'meta', 'tags']

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

  function tombstoneCount(snapshot) {
    return Object.values(snapshot).reduce(
      (total, entry) => total + entry.tombstones.length,
      0
    )
  }

  function hostilePayload(step) {
    return step % 4 === 0
      ? { name: null }
      : step % 4 === 1
        ? {
            name: {
              uuidv7: 'bad',
              predecessor: 'bad',
              value: 'x',
              tombstones: [],
            },
          }
        : step % 4 === 2
          ? {
              count: {
                uuidv7: 'bad',
                predecessor: 'bad',
                value: 'bad',
                tombstones: [],
              },
            }
          : { ghost: { uuidv7: 'bad' } }
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

  function shuffled(values, seed) {
    const next = values.slice()
    const rand = random(seed)
    for (let index = next.length - 1; index > 0; index--) {
      const other = Math.floor(rand() * (index + 1))
      ;[next[index], next[other]] = [next[other], next[index]]
    }
    return next
  }

  function shuffledIndices(length, seed) {
    return shuffled(
      Array.from({ length }, (_, index) => index),
      seed
    )
  }

  function settleReplicaSnapshots(replicas, rounds, seed, options = {}) {
    const { restartEveryRound = 0 } = options

    for (let round = 0; round < rounds; round++) {
      const snapshots = replicas.map((replica) => readSnapshot(replica))
      const deliveries = []

      for (let sourceIndex = 0; sourceIndex < snapshots.length; sourceIndex++) {
        for (
          let targetIndex = 0;
          targetIndex < replicas.length;
          targetIndex++
        ) {
          if (sourceIndex === targetIndex) continue
          deliveries.push({ sourceIndex, targetIndex })
        }
      }

      for (const deliveryIndex of shuffledIndices(
        deliveries.length,
        seed + round
      )) {
        const { sourceIndex, targetIndex } = deliveries[deliveryIndex]
        replicas[targetIndex].merge(snapshots[sourceIndex])
      }

      if (restartEveryRound > 0 && (round + 1) % restartEveryRound === 0) {
        const restartIndex = (seed + round) % replicas.length
        replicas[restartIndex] = createReplica(
          readSnapshot(replicas[restartIndex])
        )
      }
    }
  }

  function runRandomReplicaScenario(seed, options = {}) {
    const {
      replicaCount = 3,
      steps = 120,
      restartEvery = 0,
      settleRounds = 10,
      settleSeedOffset = 100_000,
    } = options
    const rng = random(seed)
    const replicas = Array.from({ length: replicaCount }, () => createReplica())

    for (let step = 0; step < steps; step++) {
      const actorIndex = Math.floor(rng() * replicas.length)
      const actor = replicas[actorIndex]
      const branch = rng()

      if (branch < 0.35) {
        const field = fields[Math.floor(rng() * fields.length)]
        assertEqual(
          Reflect.set(actor, field, nextValue(field, step, actorIndex)),
          true
        )
      } else if (branch < 0.5) {
        if (rng() < 0.5) actor.clear()
        else {
          Reflect.deleteProperty(
            actor,
            fields[Math.floor(rng() * fields.length)]
          )
        }
      } else if (branch < 0.75) {
        const sourceIndex = Math.floor(rng() * replicas.length)
        if (sourceIndex !== actorIndex)
          actor.merge(readSnapshot(replicas[sourceIndex]))
      } else if (branch < 0.9) {
        actor.merge(hostilePayload(step))
      } else {
        const frontiers = replicas.map(readAck)
        for (const replica of replicas) replica.garbageCollect(frontiers)
      }

      if (restartEvery > 0 && (step + 1) % restartEvery === 0) {
        const restartIndex = (seed + step) % replicas.length
        replicas[restartIndex] = createReplica(
          readSnapshot(replicas[restartIndex])
        )
      }
    }

    settleReplicaSnapshots(replicas, settleRounds, seed + settleSeedOffset)
    return replicas
  }

  function allOtherIndices(length, sourceIndex) {
    return Array.from({ length }, (_, index) => index).filter(
      (index) => index !== sourceIndex
    )
  }

  function queuePayload(queue, sourceIndex, payload, targets) {
    const uniqueTargets = [...new Set(targets)].filter(
      (targetIndex) => targetIndex !== sourceIndex
    )
    if (uniqueTargets.length === 0) return

    if (
      payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      Object.keys(payload).length === 0
    ) {
      return
    }

    queue.push({
      sourceIndex,
      targets: uniqueTargets,
      payload:
        payload && typeof payload === 'object'
          ? structuredClone(payload)
          : payload,
    })
  }

  function captureReplicaDeltas(replica, fn) {
    const deltas = []
    const listener = (event) => {
      deltas.push(event.detail)
    }
    replica.addEventListener('delta', listener)
    try {
      fn()
    } finally {
      replica.removeEventListener('delta', listener)
    }
    return deltas
  }

  function deliverOneReplicaMessage(replicas, queue, rand) {
    const messageIndex = Math.floor(rand() * queue.length)
    const message = queue[messageIndex]
    const targetOffset = Math.floor(rand() * message.targets.length)
    const targetIndex = message.targets.splice(targetOffset, 1)[0]
    const replyDeltas = captureReplicaDeltas(replicas[targetIndex], () => {
      replicas[targetIndex].merge(message.payload)
    })

    for (const replyDelta of replyDeltas) {
      queuePayload(
        queue,
        targetIndex,
        replyDelta,
        allOtherIndices(replicas.length, targetIndex)
      )
    }

    if (message.targets.length === 0) queue.splice(messageIndex, 1)
  }

  function drainReplicaQueue(replicas, queue, seed, options = {}) {
    const rand = random(seed)
    let deliveries = 0
    const maxDeliveries =
      options.maxDeliveries ??
      Math.max(2_000, queue.length * replicas.length * 8)

    while (queue.length > 0) {
      deliverOneReplicaMessage(replicas, queue, rand)
      deliveries++
      if (deliveries > maxDeliveries) {
        throw new Error(
          `replica gossip queue exceeded ${maxDeliveries} deliveries`
        )
      }
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
      if (verbose) console.log(`${label}: ${name}`)
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
        '__state',
        '__eventTarget',
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
    try {
      Reflect.set(replica, 'name', () => {})
      throw new Error('expected write error')
    } catch (error) {
      if (error instanceof Error && error.message === 'expected write error') {
        throw error
      }
      assertEqual(error.name, 'CRStructError')
      assertEqual(error.code, 'VALUE_NOT_CLONEABLE')
    }
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

  await runTest(
    'snapshot hydrate is independent of snapshot field order',
    () => {
      const replica = createReplica()
      replica.name = 'alice'
      replica.count = 7
      replica.meta = { enabled: true }
      replica.tags = ['a', 'b']

      const shuffledSnapshot = Object.fromEntries(
        shuffled(Object.entries(readSnapshot(replica)), 123)
      )
      const rebuilt = createReplica(shuffledSnapshot)

      assertJsonEqual(rebuilt.clone(), replica.clone())
    }
  )

  await runTest(
    'merge accepts valid fields and ignores invalid siblings in one delta',
    () => {
      const base = createReplica()
      const source = createReplica(readSnapshot(base))
      source.name = 'alice'
      source.meta = { enabled: true }
      source.count = 7
      const delta = readSnapshot(source)
      delta.count.value = 'bad'
      delta.tags = {
        uuidv7: 'bad',
        predecessor: 'bad',
        value: ['bad'],
        tombstones: [],
      }

      const target = createReplica(readSnapshot(base))
      const events = captureEvents(target)
      target.merge(delta)

      assertEqual(target.name, 'alice')
      assertEqual(target.count, 0)
      assertJsonEqual(target.meta, { enabled: true })
      assertJsonEqual(target.tags, [])
      assertEqual(events.change.length, 1)
      assertJsonEqual(Object.keys(events.change[0]).sort(), ['meta', 'name'])
    }
  )

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
    'garbageCollect respects the smallest valid frontier per field',
    () => {
      const replica = createReplica()
      replica.name = 'a'
      replica.name = 'b'
      replica.name = 'c'
      replica.count = 1
      replica.count = 2
      replica.count = 3

      const before = readSnapshot(replica)
      const nameFrontiers = [...before.name.tombstones].sort()
      const countFrontiers = [...before.count.tombstones].sort()

      assert(nameFrontiers.length >= 2, 'expected multiple name tombstones')
      assert(countFrontiers.length >= 2, 'expected multiple count tombstones')

      const nameLimit = nameFrontiers[1]
      const countLimit = countFrontiers[0]

      replica.garbageCollect([
        {
          name: nameFrontiers.at(-1),
          count: countFrontiers.at(-1),
        },
        {
          name: nameLimit,
          count: countLimit,
        },
        {
          ghost: nameFrontiers[0],
          name: 'bad',
        },
      ])

      const after = readSnapshot(replica)
      for (const uuidv7 of after.name.tombstones) {
        assert(
          uuidv7 === after.name.predecessor || uuidv7 > nameLimit,
          'name gc kept a tombstone at or below the selected frontier'
        )
      }
      for (const uuidv7 of after.count.tombstones) {
        assert(
          uuidv7 === after.count.predecessor || uuidv7 > countLimit,
          'count gc kept a tombstone at or below the selected frontier'
        )
      }
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
    'garbage collect with complete frontier set converges after recovery',
    () => {
      const replicaIds = ['replica-a', 'replica-b', 'replica-c']
      const base = createReplica()
      base.name = 'seed-a'
      base.name = 'seed-b'
      base.count = 1
      base.count = 2
      base.meta = { enabled: true }
      base.tags = ['seed']
      base.tags = ['seed-2']

      const replicas = Array.from({ length: replicaIds.length }, () =>
        createReplica(readSnapshot(base))
      )
      const ackMaps = replicaIds.map(() => new Map())

      const publishAck = (sourceIndex, targetIndexes) => {
        const ack = readAck(replicas[sourceIndex])
        for (const targetIndex of targetIndexes) {
          ackMaps[targetIndex].set(replicaIds[sourceIndex], ack)
        }
      }

      const gcReplica = (index) => {
        replicas[index].garbageCollect([...ackMaps[index].values()])
      }

      publishAck(0, [0, 1, 2])
      publishAck(1, [0, 1, 2])
      publishAck(2, [0, 1, 2])

      const sourceEvents = captureEvents(replicas[0])
      replicas[0].name = 'offline-name'
      replicas[0].count = 30
      replicas[0].meta = { enabled: false }
      replicas[0].tags = ['offline-a', 'offline-b', 'offline-c']
      Reflect.deleteProperty(replicas[0], 'name')

      for (const delta of sourceEvents.delta) {
        replicas[1].merge(delta)
        replicas[2].merge(delta)
      }

      for (let index = 0; index < replicas.length; index++) {
        publishAck(index, [0, 1, 2])
      }

      const beforeGc = replicas.map((replica) =>
        tombstoneCount(readSnapshot(replica))
      )
      for (let index = 0; index < replicas.length; index++) {
        gcReplica(index)
      }

      const expected = replicas[0].clone()
      for (let index = 0; index < replicas.length; index++) {
        const afterSnapshot = readSnapshot(replicas[index])
        assertJsonEqual(replicas[index].clone(), expected)
        assert(
          tombstoneCount(afterSnapshot) <= beforeGc[index],
          `gc failed to compact replica ${index}`
        )
        assertJsonEqual(
          createReplica(afterSnapshot).clone(),
          replicas[index].clone(),
          `snapshot hydrate diverged after gc for replica ${index}`
        )
      }
    }
  )

  await runTest(
    'partial-frontier garbage collection is caller misuse and does not guarantee convergence',
    () => {
      const replicaIds = ['replica-a', 'replica-b', 'replica-c']
      const base = createReplica()
      base.name = 'seed-a'
      base.name = 'seed-b'
      base.count = 1
      base.meta = { enabled: true }
      base.tags = ['seed']

      const replicas = Array.from({ length: replicaIds.length }, () =>
        createReplica(readSnapshot(base))
      )
      const ackMaps = replicaIds.map(() => new Map())

      const publishAck = (sourceIndex, targetIndexes) => {
        const ack = readAck(replicas[sourceIndex])
        for (const targetIndex of targetIndexes) {
          ackMaps[targetIndex].set(replicaIds[sourceIndex], ack)
        }
      }

      const gcReplica = (index) => {
        replicas[index].garbageCollect([...ackMaps[index].values()])
      }

      publishAck(0, [0, 1, 2])
      publishAck(1, [0, 1, 2])
      publishAck(2, [0, 1, 2])
      const stalePeerFrontier = ackMaps[0].get(replicaIds[2])

      const sourceEvents = captureEvents(replicas[0])
      replicas[0].name = 'offline-name'
      replicas[0].count = 31
      replicas[0].tags = ['offline-only']

      for (const delta of sourceEvents.delta) {
        replicas[1].merge(delta)
      }

      publishAck(0, [0, 1])
      publishAck(1, [0, 1])
      assertJsonEqual(
        ackMaps[0].get(replicaIds[2]),
        stalePeerFrontier,
        'replica 2 frontier unexpectedly advanced'
      )

      gcReplica(0)
      gcReplica(1)

      for (const delta of sourceEvents.delta) {
        assertEqual(replicas[2].merge(delta), undefined)
      }

      assertJsonEqual(replicas[0].clone(), replicas[1].clone())
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
        const queue = []

        for (let step = 0; step < stressRounds * 20; step++) {
          const actorIndex = Math.floor(rng() * replicas.length)
          const actor = replicas[actorIndex]
          const branch = rng()

          if (branch < 0.34) {
            const field = fields[Math.floor(rng() * fields.length)]
            const deltas = captureReplicaDeltas(actor, () => {
              assertEqual(
                Reflect.set(actor, field, nextValue(field, step, actorIndex)),
                true
              )
            })
            for (const delta of deltas) {
              queuePayload(
                queue,
                actorIndex,
                delta,
                allOtherIndices(replicas.length, actorIndex)
              )
            }
            continue
          }

          if (branch < 0.5) {
            const deltas = captureReplicaDeltas(actor, () => {
              if (rng() < 0.5) actor.clear()
              else {
                Reflect.deleteProperty(
                  actor,
                  fields[Math.floor(rng() * fields.length)]
                )
              }
            })
            for (const delta of deltas) {
              queuePayload(
                queue,
                actorIndex,
                delta,
                allOtherIndices(replicas.length, actorIndex)
              )
            }
            continue
          }

          if (branch < 0.8) {
            if (queue.length === 0) continue
            const deliveries = 1 + Math.floor(rng() * Math.min(4, queue.length))
            for (
              let index = 0;
              index < deliveries && queue.length > 0;
              index++
            ) {
              deliverOneReplicaMessage(replicas, queue, rng)
            }
            continue
          }

          if (queue.length > 0)
            drainReplicaQueue(replicas, queue, 90_000 + step)
          const frontiers = replicas.map(readAck)
          for (const replica of replicas) replica.garbageCollect(frontiers)
        }

        drainReplicaQueue(replicas, queue, 190_000)

        const expected = projection(replicas[0])
        for (let index = 1; index < replicas.length; index++) {
          assertJsonEqual(projection(replicas[index]), expected)
        }
      }
    )

    await runTest(
      'replicas converge after shuffled async delta delivery',
      () => {
        const replicas = runRandomReplicaScenario(0xc0ffee, {
          replicaCount: 5,
          steps: stressRounds * 40,
          settleRounds: 12,
          settleSeedOffset: 20_000,
        })

        const expected = projection(replicas[0])
        for (let index = 1; index < replicas.length; index++) {
          assertJsonEqual(projection(replicas[index]), expected)
        }
      }
    )

    await runTest(
      'replicas converge across shuffled delivery with restarts',
      () => {
        const replicas = runRandomReplicaScenario(0x5eed5eed, {
          replicaCount: 5,
          steps: stressRounds * 45,
          restartEvery: 9,
          settleRounds: 16,
          settleSeedOffset: 30_000,
        })

        const expected = projection(replicas[0])
        for (let index = 1; index < replicas.length; index++) {
          assertJsonEqual(projection(replicas[index]), expected)
        }
      }
    )

    await runTest('100 aggressive deterministic convergence scenarios', () => {
      for (let scenario = 0; scenario < 100; scenario++) {
        const replicas = runRandomReplicaScenario(50_000 + scenario, {
          replicaCount: 3 + (scenario % 3),
          steps: 30 + (scenario % 5) * 10,
          restartEvery: scenario % 2 === 0 ? 0 : 7 + (scenario % 4),
          settleRounds: 10,
          settleSeedOffset: 40_000,
        })

        const expected = projection(replicas[0])
        for (let index = 1; index < replicas.length; index++) {
          assertJsonEqual(
            projection(replicas[index]),
            expected,
            `scenario ${scenario} diverged`
          )
        }

        for (let index = 0; index < replicas.length; index++) {
          const hydrated = createReplica(readSnapshot(replicas[index]))
          assertJsonEqual(
            hydrated.clone(),
            replicas[index].clone(),
            `scenario ${scenario} hydrate mismatch on replica ${index}`
          )
        }
      }
    })
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
