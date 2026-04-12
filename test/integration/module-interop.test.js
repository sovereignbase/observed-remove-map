import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { CRStruct as CRStructEsm } from '../../dist/index.js'
import { createDefaults, readAck, readSnapshot } from '../shared/oostruct.mjs'

const require = createRequire(import.meta.url)
const { CRStruct: CRStructCjs } = require('../../dist/index.cjs')

test('esm and cjs replicas converge after interleaved writes merges and garbage collection', () => {
  const esm = new CRStructEsm(createDefaults())
  const cjs = new CRStructCjs(createDefaults())

  esm.name = 'alice'
  cjs.merge(readSnapshot(esm))
  cjs.count = 7
  esm.merge(readSnapshot(cjs))
  esm.meta = { enabled: true }
  cjs.tags = ['cjs']
  Reflect.deleteProperty(esm, 'name')
  cjs.merge(readSnapshot(esm))
  esm.merge(readSnapshot(cjs))

  const frontiers = [readAck(esm), readAck(cjs)]
  esm.garbageCollect(frontiers)
  cjs.garbageCollect(frontiers)

  esm.merge(readSnapshot(cjs))
  cjs.merge(readSnapshot(esm))

  assert.deepEqual(esm.clone(), cjs.clone())
})
