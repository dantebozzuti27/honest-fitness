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

import { describe, it, expect, beforeAll, afterAll } from 'node:test'
import { setupTests, teardownTests } from './setup.js'

describe('Backend API Tests', () => {
  beforeAll(async () => {
    await setupTests()
  })

  afterAll(async () => {
    await teardownTests()
  })

  describe('Health Check', () => {
    it('should return 200 for health endpoint', async () => {
      const response = await fetch('http://localhost:3001/health')
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.status).toBe('ok')
    })
  })

  describe('Authentication', () => {
    it('should reject requests without auth token', async () => {
      const response = await fetch('http://localhost:3001/api/ml/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'test', dateRange: {} })
      })
      expect(response.status).toBe(401)
    })
  })

  // Add more tests here
})

