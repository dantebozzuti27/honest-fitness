# Fitbit Integration Setup Guide

## Quick Setup (5 minutes)

### 1. Create Fitbit OAuth App

1. Go to https://dev.fitbit.com/apps
2. Click **"Register a New App"**
3. Fill in the form:
   - **Application Name:** HonestFitness (or your app name)
   - **Description:** Fitness tracking app
   - **Application Website:** Your website URL
   - **OAuth 2.0 Application Type:** Select **"Personal"**
   - **Callback URL:** `https://yourdomain.com/api/fitbit/callback`
     - For local development: `http://localhost:5173/api/fitbit/callback`
   - **Default Access Type:** Read Only
4. Click **"Register"**
5. Copy your **Client ID** and **Client Secret**

### 2. Add Environment Variables

Add to your `.env` file (or Vercel environment variables):

```env
# Fitbit OAuth
FITBIT_CLIENT_ID=your_client_id_here
FITBIT_CLIENT_SECRET=your_client_secret_here
FITBIT_REDIRECT_URI=https://yourdomain.com/api/fitbit/callback

# For local development:
# FITBIT_REDIRECT_URI=http://localhost:5173/api/fitbit/callback

# Also add to Vite env (for frontend):
VITE_FITBIT_CLIENT_ID=your_client_id_here
VITE_FITBIT_REDIRECT_URI=https://yourdomain.com/api/fitbit/callback
```

**For Vercel:**
1. Go to your project → Settings → Environment Variables
2. Add all three variables above
3. Make sure to add them for Production, Preview, and Development

### 3. Deploy API Routes

The Fitbit integration uses serverless functions:
- `app/api/fitbit/callback.js` - Handles OAuth callback
- `app/api/fitbit/refresh.js` - Refreshes expired tokens

These should work automatically with Vercel. For other platforms, you may need to configure serverless functions.

### 4. Test the Integration

1. Start your app
2. Navigate to **"Wearables"** from the Home page
3. Click **"Connect"** next to Fitbit
4. You'll be redirected to Fitbit to sign in
5. Authorize the app
6. You'll be redirected back - Fitbit should now show as "Connected"
7. Click **"Sync Now"** to fetch your data

## How It Works

### User Flow:
1. User clicks "Connect Fitbit" on Wearables page
2. Redirected to Fitbit OAuth page
3. User signs in with their Fitbit account
4. User authorizes the app
5. Redirected back to your app with authorization code
6. Server exchanges code for access/refresh tokens
7. Tokens saved to Supabase `connected_accounts` table
8. User can now sync their Fitbit data

### Data Sync:
- Click "Sync Now" to manually sync
- Fetches: steps, calories, heart rate, sleep data
- Data saved to `fitbit_daily` table
- Automatically merged into `daily_metrics` for readiness score

### Token Management:
- Access tokens expire after 8 hours
- Refresh tokens automatically used to get new access tokens
- No user action needed - handled automatically

## Troubleshooting

### "Fitbit Client ID not configured"
- Make sure `VITE_FITBIT_CLIENT_ID` is set in environment variables
- Restart your dev server after adding env vars

### "Invalid redirect URI"
- Make sure the callback URL in Fitbit app matches exactly
- Check for trailing slashes, http vs https, etc.
- For local dev: use `http://localhost:5173/api/fitbit/callback`

### "Failed to exchange token"
- Check that `FITBIT_CLIENT_SECRET` is set correctly
- Verify the callback URL matches in both places
- Check server logs for detailed error messages

### "Token refresh failed"
- User may need to reconnect their account
- Check that refresh token is still valid
- Re-authorization may be required

## Security Notes

- **Never commit** `FITBIT_CLIENT_SECRET` to git
- Use environment variables only
- Tokens are stored encrypted in Supabase
- Each user's tokens are isolated by user_id
- OAuth state parameter prevents CSRF attacks

## What Data is Synced

From Fitbit API:
- **Steps** - Daily step count
- **Calories** - Total calories burned
- **Active Calories** - Calories from activity
- **Distance** - Distance traveled
- **Floors** - Floors climbed
- **Resting Heart Rate** - Average resting HR
- **Sleep Duration** - Total sleep time (minutes)
- **Sleep Efficiency** - Sleep efficiency percentage

This data is used to:
- Improve Honest Readiness Score accuracy
- Track daily activity
- Provide better recovery insights

## Next Steps

Once Fitbit is working:
1. Test with real Fitbit data
2. Verify data appears in Analytics
3. Check that readiness score uses the data
4. Consider adding automatic daily sync (cron job)

## Support

- Fitbit API Docs: https://dev.fitbit.com/build/reference/web-api/
- Fitbit Developer Forums: https://community.fitbit.com/t5/Web-API-Development/bd-p/web-api

---

That's it! Users can now connect their own Fitbit accounts and sync their data. 🎉

