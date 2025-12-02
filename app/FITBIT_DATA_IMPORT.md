# What Fitbit Data Gets Imported

## Data Synced from Fitbit

When you click "Sync Now", Fitbit imports these metrics:

### Activity Data:
- ✅ **Steps** → `daily_metrics.steps`
- ✅ **Calories** (total burned) → `daily_metrics.calories`
- ✅ **Active Calories** → stored in `fitbit_daily` table
- ✅ **Distance** (km) → stored in `fitbit_daily` table
- ✅ **Floors** → stored in `fitbit_daily` table

### Sleep Data:
- ✅ **Sleep Duration** (minutes) → `daily_metrics.sleep_time`
- ✅ **Sleep Efficiency** (%) → stored in `fitbit_daily` table

### Heart Rate:
- ✅ **Resting Heart Rate** → stored in `fitbit_daily` table
- ✅ **HRV (Heart Rate Variability)** → `daily_metrics.hrv` (if available from device)

### Not Available from Fitbit:
- ⚠️ **HRV** - Available on some Fitbit devices (Charge 5, Sense, Versa 3+)
- ❌ Body Temperature - Not in current Fitbit API calls
- ❌ Sleep Score - Fitbit doesn't provide this metric

## How It Works

1. **Sync Process:**
   - Click "Sync Now" on Wearables page
   - Fetches today's data from Fitbit API
   - Saves to `fitbit_daily` table
   - Automatically merges into `daily_metrics` table

2. **Data Merging:**
   - Steps → `daily_metrics.steps`
   - Calories → `daily_metrics.calories`
   - Sleep Duration → `daily_metrics.sleep_time`
   - Other data stays in `fitbit_daily` for reference

3. **Used For:**
   - **Honest Readiness Score** - Uses sleep_time and steps
   - **Analytics** - All metrics available in charts
   - **Health Page** - Shows complete picture

## Historical Data

**Current behavior:** Only syncs today's data when you click "Sync Now"

**To sync historical data:**
- You'd need to call `syncFitbitData(userId, '2024-01-15')` for each date
- Or set up a daily cron job to auto-sync
- Future feature: "Sync Last 30 Days" button

## Summary

✅ **Yes, Fitbit imports your daily metrics:**
- Steps, Calories, Sleep Duration automatically go to `daily_metrics`
- Resting HR, Sleep Efficiency stored in `fitbit_daily`
- This improves your Honest Readiness Score accuracy

⚠️ **Limitations:**
- No HRV (need Oura for that)
- Only syncs one day at a time (today)
- Manual sync required (or set up auto-sync)

