import dotenv from 'dotenv'
import { createApp } from './config/expressApp.js'
import { logInfo } from './utils/logger.js'

dotenv.config()

const app = createApp()
const PORT = process.env.PORT || 3001

export default app

if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logInfo(`HonestFitness Backend running on port ${PORT}`)
  })
}
