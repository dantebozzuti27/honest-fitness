import { createApp } from '../backend/src/config/expressApp.js'

const app = createApp({ trustProxy: true })

export default app
