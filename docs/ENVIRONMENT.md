# Honest Fitness — Environment Contract (Web + iOS + Serverless)

This doc is the **source of truth** for environment variables across:
- **Frontend** (Vite/React in `app/`)
- **Backend API** (Express in `backend/`, plus Vercel serverless in `api/`)
- **iOS wrapper** (Capacitor in `app/`)

If these are not configured, the app will either:
- Show a **configuration error screen** (frontend), or
- Return a **server configuration error** (API).

## Frontend (Vite) — required

Set these in `app/.env` for local dev, and in Vercel env vars for production builds.

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Frontend (Vite) — recommended (web + iOS)

- `VITE_PUBLIC_SITE_URL`
  - Use this for OAuth redirects in native builds (Capacitor), where `window.location.origin` is often `capacitor://localhost`.
  - Example: `https://YOUR_DOMAIN`

### Frontend (Vite) — optional flags

- `VITE_ENABLE_TELEMETRY` (`true|false`, default off)
- `VITE_ENABLE_PASSIVE_COLLECTION` (`true|false`, default off)
- `VITE_ENABLE_WORKOUT_CLEANUP` (`true|false`, default off)
- `VITE_ENABLE_SOCIAL` (`true|false`, default off)

## API (Vercel serverless in `api/`) — required

Set these in Vercel project env vars.

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY` (required if AI/chat endpoints are enabled/used)

### API — recommended

- `OPENAI_MODEL` (default falls back in code)
- `ALLOWED_ORIGINS`
  - Comma-separated allowlist for CORS (e.g. `https://YOUR_DOMAIN,http://localhost:5173`)

## Backend (Express in `backend/`) — required

For local backend dev (when running `node backend/src/index.js`):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Backend — recommended

- `ALLOWED_ORIGINS` (same format as above)
- `OPENAI_API_KEY` (only required for AI routes)
- `OPENAI_MODEL`

## Wearables OAuth — optional (Fitbit/Oura)

### Fitbit

- `FITBIT_CLIENT_ID`
- `FITBIT_CLIENT_SECRET`
- `FITBIT_REDIRECT_URI` (recommended: `https://YOUR_DOMAIN/api/fitbit/callback`)
- `VITE_FITBIT_CLIENT_ID` (frontend convenience)
- `VITE_FITBIT_REDIRECT_URI` (frontend convenience)

### Oura

- `OURA_CLIENT_ID`
- `OURA_CLIENT_SECRET`
- `OURA_REDIRECT_URI` (recommended: `https://YOUR_DOMAIN/api/oura/callback`)
- `VITE_OURA_CLIENT_ID` (frontend convenience)
- `VITE_OURA_REDIRECT_URI` (frontend convenience)

### OAuth state hardening (recommended for production)

- `OAUTH_STATE_SECRET` (required in production for signed OAuth state)
- `ALLOW_LEGACY_OAUTH_STATE` (default false; only set to `true` temporarily if migrating legacy state flows)

## Quick verification

Run (from repo root):

```bash
node scripts/check-env.mjs
```


