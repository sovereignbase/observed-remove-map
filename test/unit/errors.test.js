import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CRStruct,
  __create,
  __read,
  __snapshot,
  __update,
} from '../../dist/index.js'
import {
  assertCRStructError,
  createDefaults,
  createReplica,
} from '../shared/oostruct.mjs'

test('constructor exposes DEFAULTS_NOT_CLONEABLE for unsupported defaults', () => {
  assert.throws(
    () =>
      new CRStruct({
        ...createDefaults(),
        bad: () => {},
      }),
    (error) => {
      assertCRStructError(error, 'DEFAULTS_NOT_CLONEABLE')
      assert.match(
        error.message,
        /Default values must be supported by structuredClone\./
      )
      return true
    }
  )
})

test('__update exposes VALUE_NOT_CLONEABLE and leaves state unchanged', () => {
  const state = __create(createDefaults())

  assert.throws(
    () => __update('name', () => {}, state),
    (error) => {
      assertCRStructError(error, 'VALUE_NOT_CLONEABLE')
      assert.match(
        error.message,
        /Updated values must be supported by structuredClone\./
      )
      return true
    }
  )

  assert.equal(__read('name', state), '')
})

test('__update exposes VALUE_TYPE_MISMATCH and leaves state unchanged', () => {
  const state = __create(createDefaults())
  const before = __snapshot(state)

  assert.throws(
    () => __update('count', 'bad', state),
    (error) => {
      assertCRStructError(error, 'VALUE_TYPE_MISMATCH')
      assert.match(
        error.message,
        /Updated value must match the default value runtime type\./
      )
      return true
    }
  )

  assert.deepEqual(__snapshot(state), before)
})

test('captured CRStructError constructor falls back to the code when message is omitted', () => {
  let ErrorCtor

  try {
    new CRStruct({
      ...createDefaults(),
      bad: () => {},
    })
  } catch (error) {
    ErrorCtor = error.constructor
  }

  assert.equal(typeof ErrorCtor, 'function')

  const error = new ErrorCtor('VALUE_TYPE_MISMATCH')

  assert.equal(error.code, 'VALUE_TYPE_MISMATCH')
  assert.equal(error.name, 'CRStructError')
  assert.match(error.message, /VALUE_TYPE_MISMATCH/)
})

test('public invalid property assignment throws CRStructError and preserves state', () => {
  const replica = createReplica()

  assert.throws(
    () => Reflect.set(replica, 'count', 'bad'),
    (error) => assertCRStructError(error, 'VALUE_TYPE_MISMATCH')
  )
  assert.equal(replica.count, 0)
})
