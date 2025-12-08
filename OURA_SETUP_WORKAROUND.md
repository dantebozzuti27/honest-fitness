# Oura Integration Setup Workaround

## Problem
You need an Oura account to register an OAuth application, but you don't have one.

## Solutions (Choose One)

### Option 1: Create a Free Oura Account (Recommended - 5 minutes)
This is the simplest solution:

1. **Download Oura App** (iOS/Android) or visit https://ouraring.com
2. **Sign up** with your email (no ring required for account creation)
3. **Go to OAuth Applications**: https://cloud.ouraring.com/oauth/applications
4. **Sign in** with your Oura account
5. **Create Application**:
   - Application Name: "Honest Fitness"
   - Redirect URI: `https://your-domain.vercel.app/api/oura/callback`
   - Description: "Fitness tracking app"
6. **Copy credentials**: Client ID and Client Secret
7. **Add to Vercel**: Environment Variables → Add `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`, `OURA_REDIRECT_URI`

**Note**: You don't need to own an Oura Ring to create an account or register an OAuth app. The account is free.

---

### Option 2: Use a Team Member's Account
If someone on your team has an Oura account:

1. Have them create the OAuth application
2. Share the Client ID and Client Secret securely (use a password manager)
3. Add credentials to Vercel environment variables
4. The OAuth app can be used by all your users (up to 10 users by default, can request more)

---

### Option 3: Use Test/Dummy Credentials (Development Only)
For local development without real OAuth:

1. Create placeholder environment variables:
   ```
   VITE_OURA_CLIENT_ID=test_client_id
   OURA_CLIENT_ID=test_client_id
   OURA_CLIENT_SECRET=test_secret
   OURA_REDIRECT_URI=http://localhost:5173/api/oura/callback
   ```

2. The app will show a warning but won't crash
3. Users won't be able to connect until real credentials are added

**Note**: This only works for UI development. Actual Oura data sync requires real OAuth credentials.

---

### Option 4: Defer Oura Integration
If you want to launch without Oura:

1. The integration is already built and ready
2. Users will see a message that Oura is not configured
3. You can add credentials later when ready
4. No code changes needed - just add environment variables

---

## Quick Start (Recommended Path)

**Fastest way to get Oura working:**

1. **Create Oura account** (2 minutes):
   - Go to https://ouraring.com
   - Click "Sign Up"
   - Use any email address
   - Verify email

2. **Register OAuth app** (3 minutes):
   - Go to https://cloud.ouraring.com/oauth/applications
   - Click "Create Application"
   - Fill in:
     - Name: "Honest Fitness"
     - Redirect URI: `https://your-domain.vercel.app/api/oura/callback`
   - Save and copy Client ID and Secret

3. **Add to Vercel** (2 minutes):
   - Vercel Dashboard → Your Project → Settings → Environment Variables
   - Add:
     - `OURA_CLIENT_ID` = (your client ID)
     - `OURA_CLIENT_SECRET` = (your client secret)
     - `OURA_REDIRECT_URI` = `https://your-domain.vercel.app/api/oura/callback`
     - `VITE_OURA_CLIENT_ID` = (same client ID)
     - `VITE_OURA_REDIRECT_URI` = (same redirect URI)

4. **Redeploy** your Vercel app

5. **Test**: Go to Wearables page → Click "Sign In with Oura"

**Total time: ~7 minutes**

---

## Why You Need an Oura Account

Oura requires account verification to prevent abuse of their API. This is standard for OAuth providers (same as Fitbit, Google, etc.). The account is free and doesn't require owning a ring.

---

## Troubleshooting

**"Oura OAuth is not configured" error:**
- Check that `VITE_OURA_CLIENT_ID` is set in Vercel
- Make sure you redeployed after adding environment variables

**"Invalid redirect URI" error:**
- Make sure the redirect URI in Oura matches exactly what's in Vercel
- Must be `https://your-domain.vercel.app/api/oura/callback` (not `/`)

**"Client ID not found" error:**
- Verify the Client ID in Vercel matches what's in Oura dashboard
- Check for typos or extra spaces

---

## Current Status

✅ **Code is ready** - Integration is fully implemented
⏳ **Waiting for OAuth credentials** - Just need to add environment variables
🚀 **Will work immediately** - Once credentials are added, users can connect

The app will gracefully handle missing credentials and show helpful error messages to users.


