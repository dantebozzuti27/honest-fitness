# Fitbit Integration - Quick Start Guide

## Step 1: Create Fitbit OAuth App

1. **Go to Fitbit Developer Portal:**
   - Visit: https://dev.fitbit.com/apps
   - Sign in with your Fitbit account (or create one)

2. **Register New App:**
   - Click **"Register a New App"**
   - Fill in the form:

### Required Fields:

- **Application Name:** `honest-fitness` (or your app name)
- **Description:** `Fitness tracking app with workout and health metrics`
- **Application Website URL:** Your website URL
  - For production: `https://yourdomain.com`
  - For local dev: `http://localhost:5173`
- **Organization:** Your name or company
- **Organization Website URL:** Your website
- **OAuth 2.0 Application Type:** Select **"Personal"** ⚠️ Important!
- **Redirect URL:** 
  - Production: `https://yourdomain.com/api/fitbit/callback`
  - Local dev: `http://localhost:5173/api/fitbit/callback`
- **Default Access Type:** **Read Only**

3. **Click "Register"**

4. **Copy Your Credentials:**
   - **Client ID** (OAuth 2.0 Client ID)
   - **Client Secret** (OAuth 2.0 Client Secret)
   - ⚠️ Save these - you'll need them!

---

## Step 2: Set Environment Variables

### For Local Development:

Create/update `.env` file in the `app/` directory:

```env
# Fitbit OAuth (Server-side - for API routes)
FITBIT_CLIENT_ID=your_client_id_here
FITBIT_CLIENT_SECRET=your_client_secret_here
FITBIT_REDIRECT_URI=http://localhost:5173/api/fitbit/callback

# Fitbit OAuth (Client-side - for frontend)
VITE_FITBIT_CLIENT_ID=your_client_id_here
VITE_FITBIT_REDIRECT_URI=http://localhost:5173/api/fitbit/callback

# Supabase (if not already set)
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### For Production (Vercel):

1. Go to your Vercel project → **Settings** → **Environment Variables**
2. Add these variables:

| Name | Value | Environment |
|------|-------|-------------|
| `FITBIT_CLIENT_ID` | Your Client ID | Production, Preview, Development |
| `FITBIT_CLIENT_SECRET` | Your Client Secret | Production, Preview, Development |
| `FITBIT_REDIRECT_URI` | `https://yourdomain.com/api/fitbit/callback` | Production |
| `VITE_FITBIT_CLIENT_ID` | Your Client ID | Production, Preview, Development |
| `VITE_FITBIT_REDIRECT_URI` | `https://yourdomain.com/api/fitbit/callback` | Production |

**Important:** 
- Use `http://localhost:5173/api/fitbit/callback` for local dev
- Use `https://yourdomain.com/api/fitbit/callback` for production
- Make sure the redirect URI matches EXACTLY in both Fitbit app settings and environment variables

---

## Step 3: Run Database Migration

Make sure you've run the Supabase migration to create the required tables:

1. Go to your Supabase project → **SQL Editor**
2. Open `app/supabase_migrations.sql`
3. Copy and paste the entire file
4. Click **Run**

This creates:
- `connected_accounts` table (stores OAuth tokens)
- `fitbit_daily` table (stores Fitbit data)

---

## Step 4: Test the Integration

### Local Testing:

1. **Start your dev server:**
   ```bash
   npm run dev
   ```

2. **Navigate to Wearables page:**
   - Go to Home → Click "Wearables" (or navigate to `/wearables`)

3. **Connect Fitbit:**
   - Click **"Sign In with Fitbit"**
   - You'll be redirected to Fitbit login
   - Sign in with your Fitbit account
   - Authorize the app
   - You'll be redirected back - should show "Connected"

4. **Sync Data:**
   - Click **"Sync Now"**
   - Should fetch your Fitbit data (steps, calories, sleep, etc.)

### Production Testing:

1. Deploy to Vercel (or your hosting)
2. Make sure environment variables are set
3. Test the same flow on production URL

---

## Step 5: Verify It's Working

After connecting and syncing:

1. **Check Supabase:**
   - Go to Supabase → Table Editor
   - Check `connected_accounts` table - should have your Fitbit entry
   - Check `fitbit_daily` table - should have today's data

2. **Check Health Page:**
   - Go to Home → Health
   - Should show "Wearables: 1 connected"
   - Readiness score should use Fitbit data if available

3. **Check Analytics:**
   - Go to Analytics page
   - Should see Fitbit data integrated

---

## Troubleshooting

### "Fitbit Client ID not configured"
- Make sure `VITE_FITBIT_CLIENT_ID` is set in `.env`
- Restart your dev server after adding env vars
- Check that the variable name is exactly correct

### "Invalid redirect URI"
- The redirect URI in Fitbit app settings must match EXACTLY
- Check for:
  - `http` vs `https`
  - Trailing slashes
  - Port numbers
  - Domain spelling

### "Failed to exchange token"
- Check that `FITBIT_CLIENT_SECRET` is set correctly
- Verify the Client ID matches in both places
- Check server logs for detailed error

### "Token refresh failed"
- User may need to reconnect
- Check that refresh token is still valid
- Re-authorization may be required

### API Routes Not Working (Vercel)
- Make sure files are in `app/api/fitbit/` directory
- Vercel should auto-detect serverless functions
- Check Vercel function logs for errors

---

## What Data Gets Synced

When you click "Sync Now", the app fetches:

- **Steps** - Daily step count
- **Calories** - Total calories burned
- **Active Calories** - Calories from activity
- **Distance** - Distance traveled (km)
- **Floors** - Floors climbed
- **Resting Heart Rate** - Average resting HR
- **Sleep Duration** - Total sleep (minutes)
- **Sleep Efficiency** - Sleep efficiency %

This data is:
1. Saved to `fitbit_daily` table
2. Merged into `daily_metrics` table
3. Used to improve Honest Readiness Score
4. Available in Analytics and Health pages

---

## Next Steps

Once Fitbit is working:

1. **Set up automatic sync** (optional):
   - Use Supabase Edge Functions or external cron
   - Sync data daily at a set time
   - Example: Sync every morning at 6 AM

2. **Test with real users:**
   - Have users connect their Fitbit accounts
   - Verify data syncs correctly
   - Check that readiness score improves with Fitbit data

3. **Monitor usage:**
   - Check Fitbit API rate limits
   - Monitor token refresh success rate
   - Track sync errors

---

## Support

- **Fitbit API Docs:** https://dev.fitbit.com/build/reference/web-api/
- **Fitbit Developer Forums:** https://community.fitbit.com/t5/Web-API-Development/bd-p/web-api
- **OAuth 2.0 Guide:** https://dev.fitbit.com/build/reference/web-api/developer-guide/authorization/

---

## Quick Checklist

- [ ] Created Fitbit OAuth app
- [ ] Copied Client ID and Client Secret
- [ ] Set redirect URI in Fitbit app settings
- [ ] Added environment variables (local and/or production)
- [ ] Ran Supabase migration
- [ ] Tested connection flow
- [ ] Tested data sync
- [ ] Verified data in Supabase
- [ ] Checked Health page shows connected

**You're all set!** 🎉

