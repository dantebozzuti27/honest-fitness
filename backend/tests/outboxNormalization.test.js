import test from 'node:test'
import assert from 'node:assert/strict'

import { isUuidV4 } from '../../app/src/utils/uuid.js'
import { enqueueOutboxItem } from '../../app/src/lib/syncOutbox.js'

function installBrowserStubs() {
  const store = new Map()
  Object.defineProperty(globalThis, 'window', {
    value: { dispatchEvent: () => {} },
    configurable: true
  })
  Object.defineProperty(globalThis, 'CustomEvent', {
    value: class CustomEvent { constructor() {} },
    configurable: true
  })
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      key: (i) => Array.from(store.keys())[i] || null,
      get length() { return store.size }
    },
    configurable: true
  })
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    configurable: true
  })
  return store
}

test('syncOutbox: enqueueOutboxItem normalizes workout payload with stable UUID', () => {
  installBrowserStubs()
  enqueueOutboxItem({ userId: 'user_1', kind: 'workout', payload: { workout: { date: '2025-01-01', exercises: [] } } })
  const raw = global.localStorage.getItem('honest_outbox_v1')
  const arr = JSON.parse(raw)
  assert.equal(arr.length, 1)
  const id = arr[0]?.payload?.workout?.id
  assert.equal(isUuidV4(id), true)
})

test('syncOutbox: enqueueOutboxItem normalizes feed_item payload with stable UUID', () => {
  installBrowserStubs()
  enqueueOutboxItem({ userId: 'user_1', kind: 'feed_item', payload: { feedItem: { type: 'workout', date: '2025-01-01', title: 't' } } })
  const raw = global.localStorage.getItem('honest_outbox_v1')
  const arr = JSON.parse(raw)
  assert.equal(arr.length, 1)
  const id = arr[0]?.payload?.feedItem?.id
  assert.equal(isUuidV4(id), true)
})

test('syncOutbox: enqueueOutboxItem normalizes meal payload with stable string id', () => {
  installBrowserStubs()
  enqueueOutboxItem({ userId: 'user_1', kind: 'meal', payload: { date: '2025-01-01', meal: { name: 'Banana', calories: 105 } } })
  const raw = global.localStorage.getItem('honest_outbox_v1')
  const arr = JSON.parse(raw)
  assert.equal(arr.length, 1)
  const id = arr[0]?.payload?.meal?.id
  assert.equal(typeof id, 'string')
  assert.ok(id.length > 0)
})


