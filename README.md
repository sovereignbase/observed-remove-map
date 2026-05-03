[![npm version](https://img.shields.io/npm/v/@sovereignbase/convergent-replicated-struct)](https://www.npmjs.com/package/@sovereignbase/convergent-replicated-struct)
[![CI](https://github.com/sovereignbase/convergent-replicated-struct/actions/workflows/ci.yaml/badge.svg?branch=master)](https://github.com/sovereignbase/convergent-replicated-struct/actions/workflows/ci.yaml)
[![codecov](https://codecov.io/gh/sovereignbase/convergent-replicated-struct/branch/master/graph/badge.svg)](https://codecov.io/gh/sovereignbase/convergent-replicated-struct)
[![license](https://img.shields.io/npm/l/@sovereignbase/convergent-replicated-struct)](LICENSE)

# convergent-replicated-struct

Convergent Replicated Struct (CR-Struct), a delta CRDT for an fixed-key object structs.

- [Check the docs](https://sovereignbase.dev/convergent-replicated-struct/docs/)
- [Read the specification](https://sovereignbase.dev/convergent-replicated-struct/)

## Compatibility

- Runtimes: Node >= 20, modern browsers, Bun, Deno, Cloudflare Workers, Edge Runtime.
- Module format: ESM + CommonJS.
- Required globals / APIs: `EventTarget`, `CustomEvent`, `structuredClone`.
- TypeScript: bundled types.

## Goals

- Deterministic convergence of the live struct projection under asynchronous gossip delivery.
- Consistent behavior across Node, browsers, worker, and edge runtimes.
- Garbage collection possibility without breaking live-view convergence.
- Event-driven API

## Installation

```sh
npm install @sovereignbase/convergent-replicated-struct
# or
pnpm add @sovereignbase/convergent-replicated-struct
# or
yarn add @sovereignbase/convergent-replicated-struct
# or
bun add @sovereignbase/convergent-replicated-struct
# or
deno add jsr:@sovereignbase/convergent-replicated-struct
# or
vlt install jsr:@sovereignbase/convergent-replicated-struct
```

## Usage

### Copy-paste example

```ts
import {
  CRStruct,
  type CRStructSnapshot,
} from '@sovereignbase/convergent-replicated-struct'

type MetaStruct = {
  done: boolean
}

type TodoStruct = {
  title: string
  count: number
  meta: CRStructSnapshot<MetaStruct>
  tags: string[]
}

const aliceMeta = new CRStruct<MetaStruct>({ done: false })

const alice = new CRStruct<TodoStruct>({
  title: '',
  count: 0,
  meta: aliceMeta.toJSON(),
  tags: [],
})

const bobMeta = new CRStruct<MetaStruct>({ done: false })

const bob = new CRStruct<TodoStruct>({
  title: '',
  count: 0,
  meta: bobMeta.toJSON(),
  tags: [],
})

alice.addEventListener('delta', (event) => {
  bob.merge(event.detail)
})

bob.addEventListener('change', (event) => {
  if (event.detail.meta) bobMeta.merge(event.detail.meta)
})

aliceMeta.done = true

alice.title = 'hello world'
alice.meta = aliceMeta.toJSON()

console.log(bob.title) // 'hello world'
console.log(bobMeta.done) // true
```

### Hydrating from a snapshot

```ts
import {
  CRStruct,
  type CRStructSnapshot,
} from '@sovereignbase/convergent-replicated-struct'

type DraftStruct = {
  title: string
  count: number
}

const source = new CRStruct<DraftStruct>({
  title: '',
  count: 0,
})
let snapshot!: CRStructSnapshot<DraftStruct>

source.addEventListener('snapshot', (event) => {
  localStorage.setItem('snapshot', JSON.stringify(event.detail))
})

source.title = 'draft'
source.snapshot()

const restored = new CRStruct<DraftStruct>(
  { title: '', count: 0 },
  JSON.parse(localStorage.getItem('snapshot'))
)

console.log(restored.entries()) // [['title', 'draft'], ['count', 0]]
```

This `localStorage` example assumes your field values are JSON-compatible.
For general `structuredClone`-compatible values such as `Date`, `Map`, or
`BigInt`, persist snapshots with a structured-clone-capable store or an
application-level codec instead of plain `JSON.stringify` / `JSON.parse`.

### Event channels

```ts
import { CRStruct } from '@sovereignbase/convergent-replicated-struct'

const replica = new CRStruct({
  name: '',
  count: 0,
})

replica.addEventListener('delta', (event) => {
  console.log('delta', event.detail)
})

replica.addEventListener('change', (event) => {
  console.log('change', event.detail)
})

replica.addEventListener('ack', (event) => {
  console.log('ack', event.detail)
})

replica.addEventListener('snapshot', (event) => {
  console.log('snapshot', event.detail)
})

replica.name = 'alice'
delete replica.name
replica.snapshot()
replica.acknowledge()
```

### Iteration and JSON serialization

```ts
import { CRStruct } from '@sovereignbase/convergent-replicated-struct'

const struct = new CRStruct({
  givenName: '',
  familyName: '',
})

struct.givenName = 'Jori'
struct.familyName = 'Lehtinen'

for (const key in struct) console.log(key)
for (const [key, val] of struct) console.log(key, val)
console.log(struct.keys())
console.log(struct.values())
console.log(struct.entries())
console.log(struct.clone())
```

Direct property reads, `for...of`, `values()`, `entries()`, and `clone()`
return detached copies of visible values. Mutating those returned values does
not mutate the underlying replica state.

### Acknowledgements and garbage collection

```ts
import {
  CRStruct,
  type CRStructAck,
} from '@sovereignbase/convergent-replicated-struct'

type CounterStruct = {
  title: string
  count: number
}

const alice = new CRStruct<CounterStruct>({
  title: '',
  count: 0,
})
const bob = new CRStruct<CounterStruct>({
  title: '',
  count: 0,
})

const frontiers = new Map<string, CRStructAck<CounterStruct>>()

alice.addEventListener('delta', (event) => {
  bob.merge(event.detail)
})

bob.addEventListener('delta', (event) => {
  alice.merge(event.detail)
})

alice.addEventListener('ack', (event) => {
  frontiers.set('alice', event.detail)
})

bob.addEventListener('ack', (event) => {
  frontiers.set('bob', event.detail)
})

alice.title = 'x'
alice.title = 'y'
delete alice.title

alice.acknowledge()
bob.acknowledge()

alice.garbageCollect([...frontiers.values()])
bob.garbageCollect([...frontiers.values()])
```

### Advanced exports

If you need to build your own fixed-key CRDT binding instead of using the
high-level `CRStruct` class, the package also exports the core CRUD and MAGS
functions together with the replica and payload types.

Those low-level exports let you build custom struct abstractions, protocol
wrappers, or framework-specific bindings while preserving the same convergence
rules as the default `CRStruct` binding.

```ts
import {
  __create,
  __update,
  __merge,
  __snapshot,
  type CRStructDelta,
  type CRStructSnapshot,
} from '@sovereignbase/convergent-replicated-struct'

type DraftStruct = {
  title: string
  count: number
}

const defaults: DraftStruct = {
  title: '',
  count: 0,
}

const source = __create(defaults)
const target = __create(defaults)
const local = __update('title', 'draft', source)

if (local) {
  const outgoing: CRStructDelta<DraftStruct> = local.delta
  const remoteChange = __merge(outgoing, target)

  console.log(remoteChange)
}

const snapshot: CRStructSnapshot<DraftStruct> = __snapshot(target)
console.log(snapshot)
```

The intended split is:

- `__create`, `__read`, `__update`, `__delete` for local replica mutations.
- `__merge`, `__acknowledge`, `__garbageCollect`, `__snapshot` for gossip,
  compaction, and serialization.
- `CRStruct` when you want the default event-driven class API.

## Runtime behavior

### Validation and errors

Low-level exports and invalid public field writes can throw `CRStructError`
with stable error codes:

- `DEFAULTS_NOT_CLONEABLE`
- `VALUE_NOT_CLONEABLE`
- `VALUE_TYPE_MISMATCH`

Ingress stays tolerant:

- malformed top-level merge payloads are ignored
- malformed snapshot values are dropped during hydration
- unknown keys are ignored
- invalid UUIDs and malformed field entries are ignored
- mismatched runtime kinds do not break live-state convergence

### Safety and copying semantics

- Snapshots are detached structured-clone payloads keyed by field name.
- Deltas are detached structured-clone gossip payloads keyed by field name.
- `change` is a minimal field-keyed visible patch.
- `toJSON()` returns a detached structured-clone snapshot.
- `JSON.stringify()` and `toString()` are only reliable when field values are
  JSON-compatible.
- Direct property reads, `for...of`, `values()`, `entries()`, and `clone()`
  expose detached copies of visible values rather than mutable references into
  replica state.
- Property assignment, `delete`, `clear()`, `merge()`, `snapshot()`,
  `acknowledge()`, and `garbageCollect()` all operate on the live struct
  projection.

### Convergence and compaction

- The convergence target is the live struct projection, not identical internal
  tombstone sets.
- Tombstones remain until acknowledgement frontiers make them safe to collect.
- Garbage collection compacts overwritten identifiers below the smallest valid
  acknowledgement frontier for a field while preserving the active predecessor
  link.
- Internal overwrite history may differ between replicas after
  acknowledgement-based garbage collection while the resolved live struct still
  converges.

## Tests

```sh
npm run test
```

What the current test suite covers:

- Coverage on built `dist/**/*.js`: `100%` statements, `100%` branches,
  `100%` functions, and `100%` lines via `c8`.
- Public `CRStruct` surface: proxy property access, deletes, `clear()`,
  iteration, events, and JSON / inspect behavior.
- Core edge paths and hostile ingress handling for `__create`, `__read`,
  `__update`, `__delete`, `__merge`, `__snapshot`, `__acknowledge`, and
  `__garbageCollect`.
- Snapshot hydration independent of field order, acknowledgement and garbage
  collection recovery, and deterministic multi-replica gossip scenarios.
- End-to-end runtime matrix for:
  - Node ESM
  - Node CJS
  - Bun ESM
  - Bun CJS
  - Deno ESM
  - Cloudflare Workers ESM
  - Edge Runtime ESM
  - Browsers via Playwright: Chromium, Firefox, WebKit, mobile Chrome, mobile Safari
- Current status: `npm run test` passes on Node `v22.14.0` (`win32 x64`).

## Benchmarks

```sh
npm run bench
```

Last measured on Node `v22.14.0` (`win32 x64`):

| group   | scenario                         |     n | ops |     ms | ms/op |    ops/sec |
| ------- | -------------------------------- | ----: | --: | -----: | ----: | ---------: |
| `crud`  | `create / hydrate snapshot`      | 5,000 | 250 | 714.80 |  2.86 |     349.75 |
| `crud`  | `read / primitive field`         | 5,000 | 250 |   0.55 |  0.00 | 450,531.63 |
| `crud`  | `read / object field`            | 5,000 | 250 |   0.83 |  0.00 | 301,568.15 |
| `crud`  | `update / overwrite string`      | 5,000 | 250 |   5.77 |  0.02 |  43,291.54 |
| `crud`  | `update / overwrite object`      | 5,000 | 250 |   4.79 |  0.02 |  52,198.61 |
| `crud`  | `delete / reset single field`    | 5,000 | 250 |   3.67 |  0.01 |  68,162.61 |
| `crud`  | `delete / reset all fields`      | 5,000 | 250 |  18.86 |  0.08 |  13,253.95 |
| `mags`  | `snapshot`                       | 5,000 | 250 |   7.80 |  0.03 |  32,062.38 |
| `mags`  | `acknowledge`                    | 5,000 | 250 |  39.72 |  0.16 |   6,294.04 |
| `mags`  | `garbage collect`                | 5,000 | 250 | 260.93 |  1.04 |     958.12 |
| `mags`  | `merge ordered deltas`           | 5,000 | 250 | 204.53 |  0.82 |   1,222.32 |
| `mags`  | `merge direct successor`         | 5,000 | 250 |   1.46 |  0.01 | 171,385.48 |
| `mags`  | `merge shuffled gossip`          | 5,000 | 250 | 263.91 |  1.06 |     947.29 |
| `mags`  | `merge stale conflict`           | 5,000 | 250 |   2.11 |  0.01 | 118,315.19 |
| `class` | `constructor / hydrate snapshot` | 5,000 | 250 | 781.32 |  3.13 |     319.97 |
| `class` | `property read / primitive`      | 5,000 | 250 |   0.45 |  0.00 | 559,659.73 |
| `class` | `property read / object`         | 5,000 | 250 |   0.95 |  0.00 | 262,687.82 |
| `class` | `property write / string`        | 5,000 | 250 |   5.04 |  0.02 |  49,613.02 |
| `class` | `property write / object`        | 5,000 | 250 |   8.57 |  0.03 |  29,157.24 |
| `class` | `delete property`                | 5,000 | 250 |   4.80 |  0.02 |  52,128.95 |
| `class` | `clear()`                        | 5,000 | 250 |  15.35 |  0.06 |  16,283.14 |
| `class` | `snapshot`                       | 5,000 | 250 |   9.49 |  0.04 |  26,356.29 |
| `class` | `acknowledge`                    | 5,000 | 250 |  45.49 |  0.18 |   5,495.59 |
| `class` | `garbage collect`                | 5,000 | 250 | 162.70 |  0.65 |   1,536.53 |
| `class` | `merge ordered deltas`           | 5,000 | 250 | 193.20 |  0.77 |   1,293.98 |
| `class` | `merge direct successor`         | 5,000 | 250 |   2.90 |  0.01 |  86,331.93 |
| `class` | `merge shuffled gossip`          | 5,000 | 250 | 264.43 |  1.06 |     945.44 |

## License

Apache-2.0
