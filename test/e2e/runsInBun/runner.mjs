import { createRequire } from 'node:module'
import * as esmApi from '../../../dist/index.js'
import {
  ensurePassing,
  printResults,
  runCRStructSuite,
} from '../shared/suite.mjs'

const require = createRequire(import.meta.url)
const cjsApi = require('../../../dist/index.cjs')

for (const [label, api] of [
  ['bun esm', esmApi],
  ['bun cjs', cjsApi],
]) {
  const results = await runCRStructSuite(api, { label })
  printResults(results)
  ensurePassing(results)
}
