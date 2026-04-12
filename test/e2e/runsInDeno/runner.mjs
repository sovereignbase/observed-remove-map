import * as api from '../../../dist/index.js'
import {
  ensurePassing,
  printResults,
  runCRStructSuite,
} from '../shared/suite.mjs'

const results = await runCRStructSuite(api, { label: 'deno esm' })
printResults(results)
ensurePassing(results)
