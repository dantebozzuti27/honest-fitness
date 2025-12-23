# Honest Fitness — Release Playbook (Web + iOS)

This is the pragmatic checklist to ship reliably and rollback safely.

## Preconditions (every release)

- DB migrations are applied: `app/supabase_run_all.sql`
- Env vars set (see `docs/ENVIRONMENT.md`)
- Run repo checks:

```bash
npm run check:env
npm run check:rls
cd backend && npm test
```

## Versioning

### Web
- Prefer Vercel deployments to be immutable + tagged.
- Optional: set `VITE_APP_VERSION` (e.g. Git SHA or semver) in Vercel env to help correlate logs/bugs to a build.

### iOS (Capacitor)
- Increment **CFBundleShortVersionString** (marketing version) and **CFBundleVersion** (build number) in Xcode.
- Keep a note of the deployed web version that the native wrapper points to.

## Web release (Vercel)

### 1) Environment
- Set required server env:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `OPENAI_API_KEY` (if AI features are enabled)
  - `ALLOWED_ORIGINS` (comma-separated, include your production domain and localhost for dev)
- Set required frontend env:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_PUBLIC_SITE_URL=https://YOUR_DOMAIN` (recommended for OAuth on iOS)

### 2) Deploy
- Trigger deployment.
- Verify `vercel.json` rewrites are working:
  - `/api/*` hits `api/index.js`
  - SPA routes render app via `app/dist/index.html`

### 3) Smoke test (web)
- Auth:
  - Sign up + sign in
  - Logout + re-login
- Core flows:
  - Start workout → add sets → finish → verify it appears in history/progress
  - Log meal → verify today totals update
  - Log metrics → verify Health/Analytics reflect it
- Offline:
  - Turn on airplane mode → do a small write (meal/metric/workout) → confirm “pending sync”
  - Re-enable network → confirm pending sync clears
- API:
  - Hit `/health` (should return ok)
  - Hit an authenticated `/api/*` endpoint (should return JSON and include `X-Request-Id`)

## iOS release (Capacitor)

### 1) Build
From `app/`:

```bash
npm run build
npm run ios:build
npx cap sync ios
```

### 2) Xcode
- Open iOS project:

```bash
npx cap open ios
```

- Validate:
  - `VITE_PUBLIC_SITE_URL` is set for OAuth redirects
  - Deep links / redirects work (Fitbit/Oura callbacks)
  - Safe-area layout is correct on iPhone (content not hidden behind the bottom nav)

### 3) Smoke test (iOS)
- Same smoke tests as web, plus:
  - Background/foreground app (no “blank screen”)
  - OAuth connect flows

## Rollback strategy

### Web rollback
- Roll back to the previous Vercel deployment (instant).
- If the issue is data-corruption-related, **do not roll back DB** (prefer forward fixes).

### DB rollback
- Treat DB migrations as **forward-only**.
- Use feature flags (`VITE_ENABLE_*`) to disable risky surfaces while shipping a fix.

## Operational debugging

- Every API response should include `X-Request-Id` (useful to correlate client errors ↔ server logs).
- Perf budgets:
  - Startup + key routes emit warnings when budgets are exceeded (see `app/src/utils/perfBudget.js`).


