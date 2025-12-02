# API Setup Guide for HonestFitness v3

## Required APIs

### 1. Cal AI (Food Photo Analysis) ⚠️ REQUIRED for Ghost Mode

**Purpose:** Analyze meal photos and text descriptions to extract calories and macros

**Setup:**
1. Go to https://dashboard.calai.app
2. Sign up for a free account
3. Get your API key from the dashboard
4. Add to environment variables:
   ```env
   VITE_CALAI_API_KEY=your_api_key_here
   ```

**Pricing:**
- Free tier: 100 calls/day
- Paid plans available if you need more

**API Endpoint:**
- URL: `https://api.calai.app/v1/analyze`
- Method: POST
- Auth: Bearer token
- Docs: https://docs.calai.app

**Status:** ✅ Already integrated in code, just needs API key

---

## Optional APIs (For Wearables Integration)

### 2. Oura Ring API

**Purpose:** Get HRV, sleep, activity, and readiness data

**Setup:**
1. Go to https://cloud.ouraring.com/oauth/apps
2. Create a new OAuth application
3. Set redirect URI: `https://yourdomain.com/auth/oura/callback`
4. Get Client ID and Client Secret
5. Add to environment:
   ```env
   OURA_CLIENT_ID=your_client_id
   OURA_CLIENT_SECRET=your_client_secret
   OURA_REDIRECT_URI=https://yourdomain.com/auth/oura/callback
   ```

**API Endpoints:**
- OAuth: `https://cloud.ouraring.com/oauth/authorize`
- Token: `https://api.ouraring.com/oauth/token`
- Daily Readiness: `https://api.ouraring.com/v2/usercollection/daily_readiness`
- Daily Sleep: `https://api.ouraring.com/v2/usercollection/daily_sleep`
- Daily Activity: `https://api.ouraring.com/v2/usercollection/daily_activity`

**Docs:** https://cloud.ouraring.com/docs

**Status:** ⚠️ Framework ready, needs OAuth implementation

---

### 3. Fitbit API

**Purpose:** Get steps, heart rate, sleep, and activity data

**Setup:**
1. Go to https://dev.fitbit.com/apps
2. Register a new application
3. Set OAuth 2.0 Application Type: "Personal"
4. Set Callback URL: `https://yourdomain.com/auth/fitbit/callback`
5. Get Client ID and Client Secret
6. Add to environment:
   ```env
   FITBIT_CLIENT_ID=your_client_id
   FITBIT_CLIENT_SECRET=your_client_secret
   FITBIT_REDIRECT_URI=https://yourdomain.com/auth/fitbit/callback
   ```

**API Endpoints:**
- OAuth: `https://www.fitbit.com/oauth2/authorize`
- Token: `https://api.fitbit.com/oauth2/token`
- Sleep: `https://api.fitbit.com/1.2/user/-/sleep/date/{date}.json`
- Heart Rate: `https://api.fitbit.com/1/user/-/activities/heart/date/{date}/1d.json`
- Activity: `https://api.fitbit.com/1/user/-/activities/date/{date}.json`

**Docs:** https://dev.fitbit.com/build/reference/web-api/

**Status:** ⚠️ Framework ready, needs OAuth implementation

---

### 4. Garmin Connect API

**Purpose:** Get activity, sleep, and health metrics

**Setup:**
1. Go to https://developer.garmin.com/garmin-connect-api/
2. Register as a developer
3. Create an OAuth application
4. Get Client ID and Client Secret
5. Add to environment:
   ```env
   GARMIN_CLIENT_ID=your_client_id
   GARMIN_CLIENT_SECRET=your_client_secret
   GARMIN_REDIRECT_URI=https://yourdomain.com/auth/garmin/callback
   ```

**API Endpoints:**
- OAuth: `https://connect.garmin.com/oauthConfirm`
- Token: `https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0`
- Activity: `https://connectapi.garmin.com/wellness-api/rest/activity`

**Docs:** https://developer.garmin.com/garmin-connect-api/

**Status:** ⚠️ Framework ready, needs OAuth implementation

**Note:** Garmin API access requires approval and may have restrictions.

---

### 5. Whoop API

**Purpose:** Get recovery, strain, and sleep data

**Setup:**
1. Go to https://developer.whoop.com/
2. Register as a developer
3. Create an application
4. Get API credentials
5. Add to environment:
   ```env
   WHOOP_CLIENT_ID=your_client_id
   WHOOP_CLIENT_SECRET=your_client_secret
   WHOOP_REDIRECT_URI=https://yourdomain.com/auth/whoop/callback
   ```

**API Endpoints:**
- OAuth: `https://api.prod.whoop.com/oauth/oauth2/auth`
- Token: `https://api.prod.whoop.com/oauth/oauth2/token`
- Recovery: `https://api.prod.whoop.com/developer/v1/recovery`
- Sleep: `https://api.prod.whoop.com/developer/v1/sleep`

**Docs:** https://developer.whoop.com/api-docs

**Status:** ⚠️ Framework ready, needs OAuth implementation

**Note:** Whoop API may require approval and has usage limits.

---

### 6. Apple HealthKit (iOS/macOS only)

**Purpose:** Get health data from Apple Health app

**Setup:**
1. Requires native iOS/macOS app or React Native
2. Configure HealthKit entitlements in Xcode
3. Request permissions for:
   - Heart Rate Variability
   - Resting Heart Rate
   - Sleep Analysis
   - Body Temperature
   - Active Energy

**Implementation:**
- Use HealthKit framework (native)
- Or use `react-native-health` package
- Bridge data to web app via API

**Status:** ⚠️ Requires native app or React Native

**Note:** Apple HealthKit cannot be accessed directly from web browsers.

---

## Database (Already Set Up)

### Supabase

**Purpose:** Store all app data (workouts, metrics, readiness scores, wearable data)

**Status:** ✅ Already configured

**Tables:**
- `workouts` - Workout logs
- `daily_metrics` - Daily health metrics
- `connected_accounts` - OAuth tokens for wearables
- `oura_daily` - Oura data
- `fitbit_daily` - Fitbit data
- `honest_readiness` - Readiness scores

**No additional setup needed** - just run the migration SQL file.

---

## Implementation Priority

### Phase 1: Essential (Launch Now)
1. ✅ **Cal AI** - Required for Ghost Mode
   - Just add API key
   - Already fully integrated

### Phase 2: Core Features (Week 1-2)
2. ⚠️ **Oura** - Most popular, best data quality
   - Implement OAuth flow
   - Add daily sync function
3. ⚠️ **Fitbit** - Large user base
   - Implement OAuth flow
   - Add daily sync function

### Phase 3: Expansion (Month 1-2)
4. ⚠️ **Garmin** - Active users
5. ⚠️ **Whoop** - Serious athletes
6. ⚠️ **Apple Health** - iOS users (requires native app)

---

## OAuth Implementation Pattern

All wearables use OAuth 2.0. Here's the general pattern:

### 1. Authorization Flow
```javascript
// Redirect user to provider's OAuth page
const authUrl = `${PROVIDER_AUTH_URL}?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=${SCOPES}`

// User authorizes → redirects back with code
// Exchange code for tokens
const tokens = await exchangeCodeForTokens(code)
```

### 2. Token Storage
```javascript
// Save tokens to Supabase
await saveConnectedAccount(userId, 'oura', {
  access_token: tokens.access_token,
  refresh_token: tokens.refresh_token,
  expires_at: tokens.expires_at
})
```

### 3. Daily Sync
```javascript
// Use stored tokens to fetch daily data
const account = await getConnectedAccount(userId, 'oura')
const response = await fetch(OURA_API_URL, {
  headers: { 'Authorization': `Bearer ${account.access_token}` }
})
const data = await response.json()
await saveOuraDaily(userId, date, data)
```

### 4. Token Refresh
```javascript
// Refresh expired tokens
if (account.expires_at < new Date()) {
  const newTokens = await refreshToken(account.refresh_token)
  await saveConnectedAccount(userId, 'oura', newTokens)
}
```

---

## Environment Variables Summary

Create a `.env` file in the `app/` directory:

```env
# Required
VITE_CALAI_API_KEY=your_calai_api_key

# Optional - Oura
OURA_CLIENT_ID=your_oura_client_id
OURA_CLIENT_SECRET=your_oura_client_secret
OURA_REDIRECT_URI=https://yourdomain.com/auth/oura/callback

# Optional - Fitbit
FITBIT_CLIENT_ID=your_fitbit_client_id
FITBIT_CLIENT_SECRET=your_fitbit_client_secret
FITBIT_REDIRECT_URI=https://yourdomain.com/auth/fitbit/callback

# Optional - Garmin
GARMIN_CLIENT_ID=your_garmin_client_id
GARMIN_CLIENT_SECRET=your_garmin_client_secret
GARMIN_REDIRECT_URI=https://yourdomain.com/auth/garmin/callback

# Optional - Whoop
WHOOP_CLIENT_ID=your_whoop_client_id
WHOOP_CLIENT_SECRET=your_whoop_client_secret
WHOOP_REDIRECT_URI=https://yourdomain.com/auth/whoop/callback

# Supabase (already configured)
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

**Note:** For Vercel deployment, add these in Vercel Dashboard → Settings → Environment Variables

---

## Quick Start Checklist

### Minimum to Launch:
- [ ] Get Cal AI API key
- [ ] Add `VITE_CALAI_API_KEY` to environment
- [ ] Test Ghost Mode photo analysis

### Full Feature Set:
- [ ] Set up Oura OAuth app
- [ ] Set up Fitbit OAuth app
- [ ] Implement OAuth callback routes
- [ ] Add daily sync cron job (Supabase Edge Functions or external)
- [ ] Test end-to-end wearable sync

---

## Cost Estimates

- **Cal AI:** Free (100 calls/day) or ~$10-50/month for higher limits
- **Oura API:** Free
- **Fitbit API:** Free
- **Garmin API:** Free (may require approval)
- **Whoop API:** Free (may require approval)
- **Supabase:** Free tier (500MB database, 2GB bandwidth) or $25/month Pro

**Total:** ~$0-75/month depending on usage

---

## Support & Documentation

- Cal AI: https://docs.calai.app
- Oura: https://cloud.ouraring.com/docs
- Fitbit: https://dev.fitbit.com/build/reference/web-api/
- Garmin: https://developer.garmin.com/garmin-connect-api/
- Whoop: https://developer.whoop.com/api-docs
- Supabase: https://supabase.com/docs

---

## Next Steps

1. **Start with Cal AI** - Get API key and test Ghost Mode
2. **Choose 1-2 wearables** - Start with Oura (best data) or Fitbit (most users)
3. **Implement OAuth flow** - Create callback routes in your app
4. **Add sync function** - Daily cron job or webhook
5. **Test thoroughly** - Verify data accuracy and token refresh

Good luck! 🚀

