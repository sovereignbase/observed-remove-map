import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as uuid from 'uuid'
import * as utils from '@sovereignbase/utils'
import { EdgeRuntime } from 'edge-runtime'
import {
  ensurePassing,
  printResults,
  runCRStructSuite,
} from '../shared/suite.mjs'

const root = process.cwd()
const esmDistPath = resolve(root, 'dist', 'index.js')

function toDestructure(specifiers, globalName) {
  const members = specifiers
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [left, right] = part.split(/\s+as\s+/)
      return right ? `${left.trim()}: ${right.trim()}` : left.trim()
    })
    .join(', ')

  return `const { ${members} } = ${globalName};\n`
}

function replaceNamedImports(bundleCode, packageName, globalName) {
  const pattern = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${packageName.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    )}["'];\\s*`,
    'g'
  )

  return bundleCode.replace(pattern, (_, specifiers) =>
    toDestructure(specifiers, globalName)
  )
}

function toExecutableEdgeEsm(bundleCode) {
  const withoutImports = replaceNamedImports(
    replaceNamedImports(bundleCode, 'uuid', 'globalThis.__CRSTRUCT_UUID'),
    '@sovereignbase/utils',
    'globalThis.__CRSTRUCT_UTILS'
  )
  const exportMatch = withoutImports.match(
    /export\s*\{[\s\S]*?\};\s*(\/\/# sourceMappingURL=.*)?\s*$/
  )
  if (!exportMatch) {
    throw new Error(
      'edge-runtime esm harness could not find convergent-replicated-struct exports'
    )
  }

  const sourceMapComment = exportMatch[1] ? `${exportMatch[1]}\n` : ''
  return (
    withoutImports.slice(0, exportMatch.index) +
    'globalThis.__CRSTRUCT_EXPORTS__ = { CRStruct, __acknowledge, __create, __delete, __garbageCollect, __merge, __read, __snapshot, __update };\n' +
    sourceMapComment
  )
}

const runtime = new EdgeRuntime()
runtime.context.__CRSTRUCT_UUID = uuid
runtime.context.__CRSTRUCT_UTILS = utils
runtime.evaluate(`
  if (typeof globalThis.CustomEvent === 'undefined') {
    globalThis.CustomEvent = class CustomEvent extends Event {
      constructor(type, init = {}) {
        super(type, init)
        this.detail = init.detail ?? null
      }
    }
  }
`)
const moduleCode = await readFile(esmDistPath, 'utf8')
runtime.evaluate(toExecutableEdgeEsm(moduleCode))

const results = await runCRStructSuite(runtime.context.__CRSTRUCT_EXPORTS__, {
  label: 'edge-runtime esm',
})
printResults(results)
ensurePassing(results)
