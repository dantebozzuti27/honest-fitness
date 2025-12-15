/**
 * Test Setup
 * Basic test infrastructure for backend
 */

import net from 'node:net'

export const testConfig = {
  supabaseUrl: process.env.TEST_SUPABASE_URL || 'http://localhost:54321',
  supabaseKey: process.env.TEST_SUPABASE_KEY || 'test-key',
  port: null,
  baseUrl: null
}

let server = null
let app = null

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const s = net.createServer()
    s.unref()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

async function waitForHealthy(baseUrl, timeoutMs = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`)
      if (res.ok) return true
    } catch (e) {
      // ignore until ready
    }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`Server did not become healthy within ${timeoutMs}ms at ${baseUrl}`)
}

/**
 * Setup test environment
 */
export async function setupTests() {
  // Ensure backend doesn't exit on missing env and auth client can initialize.
  process.env.NODE_ENV = 'test'
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || testConfig.supabaseUrl
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || testConfig.supabaseKey

  const port = await getFreePort()
  testConfig.port = port
  testConfig.baseUrl = `http://127.0.0.1:${port}`

  // Import the app only AFTER env vars are set (prevents import-time crashes)
  const mod = await import('../src/index.js')
  app = mod?.default
  if (!app) {
    throw new Error('Failed to import backend app for tests')
  }

  server = app.listen(port)
  await waitForHealthy(testConfig.baseUrl)

  console.log(`Test environment setup complete (server ${testConfig.baseUrl})`)
}

/**
 * Teardown test environment
 */
export async function teardownTests() {
  if (server) {
    await new Promise((resolve) => server.close(resolve))
    server = null
  }
  console.log('Test environment teardown complete')
}

