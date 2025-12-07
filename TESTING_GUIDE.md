# Testing Guide for Honest Fitness App

## Prerequisites

### 1. Environment Variables Required

The app needs the following environment variables to run:

**Frontend (app/.env):**
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_FITBIT_CLIENT_ID=your_fitbit_client_id (optional)
VITE_FITBIT_REDIRECT_URI=http://localhost:5173/api/fitbit/callback (optional)
```

**Backend (backend/.env):**
```env
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
PORT=3001 (optional, defaults to 3001)
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000 (optional)
```

### 2. Install Dependencies

```bash
# Frontend
cd app
npm install

# Backend (if testing backend features)
cd ../backend
npm install
```

## Starting the App

### Frontend Only (Most Common)
```bash
cd app
npm run dev
```

The app will be available at: **http://localhost:5173**

### With Backend (For Full Features)
```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd app
npm run dev
```

## Testing the Recent Changes

### 1. ✅ Plus Button Quick Log
- **Test**: Click the "+" button in the bottom navigation
- **Expected**: Should show a menu with:
  - "Start Workout" → Opens workout modal on Fitness page
  - "Log Meal" → Opens meal entry modal on Nutrition page
  - "Log Health Metrics" → Opens health metrics modal on Health page
- **Note**: Should open modals directly, not navigate to pages first

### 2. ✅ Workout Start Modal
- **Test**: Go to Fitness page → Click "Start Workout"
- **Expected**: Modal should show:
  - "Today's Scheduled Workout" (if you have one scheduled for today)
  - "Choose Template"
  - "Freestyle"
  - "Random Workout"
- **Note**: If you have a scheduled workout for today, it should appear as the first option

### 3. ✅ Health Metrics - Individual Logging
- **Test**: 
  1. Go to Health page → Today tab
  2. Sync Fitbit data (if connected)
  3. Click on any metric card (Weight, Steps, Calories, HRV, Sleep, Resting HR)
- **Expected**: 
  - Clicking a metric should open the log modal
  - Only that specific metric field should be populated
  - Button should say "Edit" if data exists, "Log" if empty
  - After syncing Fitbit, you should be able to manually override any metric

### 4. ✅ Analytics Zoom - Time Scale
- **Test**: 
  1. Go to Analytics page
  2. Click on any chart to open detail modal
  3. Use mouse wheel or pinch to zoom
- **Expected**: 
  - Zoom should change the time scale (show more/fewer days)
  - Zoom controls should show "X of Y days" instead of percentage
  - Zoom in = fewer days shown, Zoom out = more days shown
  - Should NOT zoom the image/chart itself

### 5. ✅ Ghost Mode (Documentation)
- **Test**: Check `GHOST_MODE_EXPLANATION.md`
- **Expected**: Should explain that Ghost Mode is just localStorage fallback, not a separate feature

## Common Issues

### Issue: "Missing required environment variables"
**Solution**: Create `app/.env` file with Supabase credentials

### Issue: "Cannot connect to Supabase"
**Solution**: 
1. Check your Supabase URL and keys are correct
2. Ensure Supabase project is active
3. Check network connection

### Issue: Backend not responding
**Solution**: 
1. Check backend is running on port 3001
2. Verify backend/.env has correct Supabase credentials
3. Check CORS settings if accessing from different origin

### Issue: Fitbit sync not working
**Solution**: 
1. Check Fitbit OAuth credentials in environment variables
2. Verify redirect URI matches Fitbit app settings
3. Check browser console for errors

## Testing Checklist

- [ ] Plus button opens quick log menu
- [ ] Quick log options navigate and open modals correctly
- [ ] Workout start modal shows "Today's Scheduled Workout" if available
- [ ] Health metrics cards are clickable
- [ ] Individual metrics can be logged/edited separately
- [ ] Analytics charts zoom changes time scale (not image zoom)
- [ ] All pages load without errors
- [ ] Database operations work (save/load data)
- [ ] Authentication works (if implemented)

## Browser Testing

Test in:
- [ ] Chrome/Edge (Chromium)
- [ ] Firefox
- [ ] Safari (if on Mac)
- [ ] Mobile browser (responsive design)

## Performance Testing

- [ ] Page load times are acceptable
- [ ] Charts render smoothly
- [ ] No console errors
- [ ] No memory leaks (check with DevTools)

## Next Steps After Testing

1. Report any bugs or issues
2. Verify all features work as expected
3. Test edge cases (empty data, network errors, etc.)
4. Check responsive design on different screen sizes

