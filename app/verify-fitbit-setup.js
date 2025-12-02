/**
 * Fitbit Setup Verification Script
 * Run this to check if your Fitbit integration is configured correctly
 * 
 * Usage: node verify-fitbit-setup.js
 */

import { config } from 'dotenv'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load .env file
config({ path: join(__dirname, '.env') })

console.log('\n🔍 Fitbit Setup Verification\n')
console.log('=' .repeat(50))

let allGood = true

// Check environment variables
console.log('\n📋 Environment Variables:')

const requiredVars = {
  'FITBIT_CLIENT_ID': process.env.FITBIT_CLIENT_ID,
  'FITBIT_CLIENT_SECRET': process.env.FITBIT_CLIENT_SECRET,
  'FITBIT_REDIRECT_URI': process.env.FITBIT_REDIRECT_URI,
  'VITE_FITBIT_CLIENT_ID': process.env.VITE_FITBIT_CLIENT_ID,
  'VITE_FITBIT_REDIRECT_URI': process.env.VITE_FITBIT_REDIRECT_URI
}

for (const [key, value] of Object.entries(requiredVars)) {
  if (value && value !== 'your_client_id_here' && value !== 'your_client_secret_here') {
    console.log(`✅ ${key}: Set`)
  } else {
    console.log(`❌ ${key}: Missing or not configured`)
    allGood = false
  }
}

// Check API routes exist
console.log('\n📁 API Routes:')

const apiRoutes = [
  'api/fitbit/callback.js',
  'api/fitbit/refresh.js'
]

for (const route of apiRoutes) {
  try {
    readFileSync(join(__dirname, route))
    console.log(`✅ ${route}: Exists`)
  } catch (error) {
    console.log(`❌ ${route}: Missing`)
    allGood = false
  }
}

// Check frontend files
console.log('\n📱 Frontend Files:')

const frontendFiles = [
  'src/lib/fitbitAuth.js',
  'src/lib/wearables.js',
  'src/pages/Wearables.jsx'
]

for (const file of frontendFiles) {
  try {
    readFileSync(join(__dirname, file))
    console.log(`✅ ${file}: Exists`)
  } catch (error) {
    console.log(`❌ ${file}: Missing`)
    allGood = false
  }
}

// Summary
console.log('\n' + '='.repeat(50))
if (allGood) {
  console.log('\n✅ All checks passed! Fitbit integration is ready.')
  console.log('\n📝 Next steps:')
  console.log('1. Make sure Supabase migration has been run')
  console.log('2. Start your dev server: npm run dev')
  console.log('3. Navigate to /wearables and click "Sign In with Fitbit"')
} else {
  console.log('\n❌ Some checks failed. Please fix the issues above.')
  console.log('\n📖 See FITBIT_QUICK_START.md for detailed setup instructions.')
}
console.log('\n')

