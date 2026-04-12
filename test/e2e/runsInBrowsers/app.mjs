import * as api from '/dist/index.js'
import { printResults, runCRStructSuite } from '../shared/suite.mjs'

const results = await runCRStructSuite(api, { label: 'browser esm' })
printResults(results)
window.__CRSTRUCT_RESULTS__ = results

const status = document.getElementById('status')
if (status) {
  status.textContent = results.ok ? 'ok' : `failed: ${results.errors.length}`
}
