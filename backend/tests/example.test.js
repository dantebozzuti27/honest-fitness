/**
 * Example Test File
 * Demonstrates test structure for backend
 * 
 * To run tests:
 * npm test
 * 
 * To run with coverage:
 * npm test -- --coverage
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { setupTests, teardownTests, testConfig } from './setup.js'

describe('Backend API Tests', () => {
  before(async () => {
    await setupTests()
  })

  after(async () => {
    await teardownTests()
  })

  describe('Health Check', () => {
    it('should return 200 for health endpoint', async () => {
      const response = await fetch(`${testConfig.baseUrl}/health`)
      assert.equal(response.status, 200)
      const data = await response.json()
      assert.equal(data.status, 'ok')
    })
  })

  describe('Authentication', () => {
    it('should reject requests without auth token', async () => {
      const response = await fetch(`${testConfig.baseUrl}/api/ml/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'test', dateRange: {} })
      })
      assert.equal(response.status, 401)
    })
  })

  // Add more tests here
})

