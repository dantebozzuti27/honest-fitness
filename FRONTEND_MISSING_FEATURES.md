# Frontend Missing Features Audit

**Date:** Today  
**Purpose:** Identify all backend features, database tables, and data that exist but aren't displayed or accessible in the frontend UI

---

## 🚨 CRITICAL - Database Features Not Used

### 1. **Materialized Views** (Performance Optimization)
**Status:** ✅ SQL created, ❌ Never queried in frontend

**What exists:**
- `daily_workout_summaries` - Pre-aggregated daily workout stats
- `weekly_workout_summaries` - Pre-aggregated weekly stats
- `monthly_workout_summaries` - Pre-aggregated monthly stats
- `daily_health_summaries` - Pre-aggregated daily health metrics
- `weekly_health_summaries` - Pre-aggregated weekly health metrics
- `daily_nutrition_summaries` - Pre-aggregated daily nutrition stats

**Impact:** Analytics page is doing expensive aggregations on-the-fly instead of using pre-computed views. This could make charts 10-100x faster.

**Action:** Query materialized views in Analytics.jsx instead of aggregating raw data.

---

### 2. **Engineered Features Table** (ML Features)
**Status:** ✅ Table exists, ❌ Never displayed or used

**What exists:**
- `engineered_features` table stores:
  - Rolling statistics (7-day, 30-day averages)
  - Ratio features (volume/intensity ratios)
  - Interaction features (workout × sleep correlations)

**Impact:** ML features are calculated but never shown to users. Could display "Your workout intensity correlates with sleep quality" type insights.

**Action:** Create UI to display feature insights in Analytics or Insights page.

---

### 3. **A/B Testing Infrastructure**
**Status:** ✅ Tables exist (`ab_tests`, `ab_test_assignments`, `ab_test_events`), ❌ No UI

**What exists:**
- Complete A/B testing system in database
- Functions in `abTesting.js` to assign variants and track events

**Impact:** Can't run experiments or see test results. No way to test UI changes.

**Action:** Create admin/developer UI to:
- Create A/B tests
- View test results
- Assign users to variants
- See conversion metrics

---

### 4. **Pipeline Monitoring**
**Status:** ✅ Tables exist (`pipeline_jobs`, `pipeline_health`), ❌ No UI

**What exists:**
- Job execution tracking
- Health metrics calculation
- Alert system infrastructure

**Impact:** Can't monitor data pipeline health. No visibility into ETL job failures or performance.

**Action:** Create admin dashboard to show:
- Pipeline job status
- Health metrics
- Failed jobs
- Performance stats

---

### 5. **SLA Monitoring**
**Status:** ✅ Table exists (`sla_metrics`), ❌ No UI

**What exists:**
- Data freshness tracking
- Processing time monitoring
- Compliance reporting functions

**Impact:** Can't see if data is fresh or if SLAs are being met.

**Action:** Create admin dashboard or user-facing indicator showing:
- Data freshness status
- Last sync times
- SLA compliance rates

---

## 📊 Analytics Features Partially Integrated

### 6. **Advanced Analytics** (Cohort, Funnel, Retention)
**Status:** ✅ Functions exist, ⚠️ Partially displayed

**What exists:**
- `analyzeCohorts()` - User retention by signup date
- `analyzeFunnel()` - User journey analysis
- `analyzeRetention()` - User retention rates

**Current State:** 
- Functions are called in Analytics.jsx
- Only retention data is displayed (basic card)
- Cohort and funnel analysis results are never shown

**Action:** Create dedicated sections in Analytics page to display:
- Cohort retention table/heatmap
- Funnel visualization
- Retention charts

---

### 7. **Comparative Analytics** (Period Comparisons)
**Status:** ✅ Functions exist, ⚠️ Partially displayed

**What exists:**
- `comparePeriods()` - This week vs last week comparisons
- `compareToPeers()` - User vs anonymized peer data
- `compareToBenchmarks()` - User vs population benchmarks
- `compareGoalVsActual()` - Goal progress comparisons

**Current State:**
- `comparePeriods()` is called but only shows basic change percentage
- Peer comparisons and benchmarks are never displayed
- Goal vs actual comparisons are never shown

**Action:** Enhance Analytics page to show:
- Period-over-period comparison cards
- Peer percentile rankings ("You're in the top 20%")
- Benchmark comparisons
- Goal achievement predictions

---

## 🎯 ML & Predictive Features

### 8. **Advanced ML Predictions**
**Status:** ✅ Functions exist, ⚠️ Partially displayed

**What exists:**
- `forecastWorkoutPerformance()` - Predicts next workout performance
- `predictInjuryRisk()` - Calculates injury risk score
- `estimateGoalAchievementProbability()` - Goal success probability

**Current State:**
- `PredictiveInsights` component exists and displays some predictions
- But many predictions are calculated but not shown
- Injury risk warnings are never displayed prominently

**Action:** 
- Add injury risk alerts to Home/Health pages
- Show goal achievement probability in Goals page
- Display workout performance forecasts in Fitness page

---

### 9. **Feature Engineering Insights**
**Status:** ✅ Functions exist, ❌ Never displayed

**What exists:**
- Rolling statistics calculations
- Ratio feature calculations (volume/intensity)
- Interaction feature calculations (workout × sleep)

**Impact:** Rich insights about correlations and trends are calculated but never shown.

**Action:** Create "Insights" section showing:
- "Your workout volume correlates with sleep quality (r=0.72)"
- "Your intensity ratio is 15% above average"
- "Best performance days: Tuesday, Thursday"

---

## 📱 User-Facing Features Missing UI

### 10. **Data Catalog** (Data Dictionary)
**Status:** ✅ Functions exist (`dataCatalog.js`), ❌ No UI page

**What exists:**
- Data dictionary with all tables/columns
- Metric definitions
- Search functionality

**Impact:** Users can't understand what their data means or how metrics are calculated.

**Action:** Create "Data Catalog" or "Help" page showing:
- What each metric means
- How calculations work
- Data sources
- Units and ranges

---

### 11. **Nutrition Settings**
**Status:** ✅ Functions exist, ⚠️ Limited UI

**What exists:**
- `saveNutritionSettingsToSupabase()` - Save calorie/macro targets
- `getNutritionSettingsFromSupabase()` - Get settings
- `nutrition_settings` column in `user_preferences`

**Current State:**
- Settings can be saved but there's no dedicated UI to edit them
- No way to set calorie targets, macro ratios, or fasting schedules

**Action:** Create Nutrition Settings page or section in Profile to:
- Set daily calorie targets
- Configure macro ratios (protein/carbs/fat %)
- Enable/configure intermittent fasting
- Set meal timing preferences

---

### 12. **Food Library**
**Status:** ✅ Tables exist (`food_library`, `user_food_preferences`), ⚠️ Underutilized

**What exists:**
- Comprehensive food database
- User favorites system
- Recent foods tracking

**Current State:**
- Food library exists but nutrition logging may not use it fully
- Favorites and recent foods features may not be implemented

**Action:** Enhance Nutrition page to:
- Show food library search
- Display favorite foods
- Show recently used foods
- Allow adding custom foods

---

### 13. **Scheduled Workouts**
**Status:** ✅ Functions exist, ⚠️ Limited visibility

**What exists:**
- `scheduleWorkoutSupabase()` - Schedule workouts
- `getScheduledWorkoutsFromSupabase()` - Get scheduled workouts
- `scheduled_workouts` table

**Current State:**
- Scheduled workouts are shown in Fitness page modal
- But no calendar view or list view of all scheduled workouts
- No way to see upcoming scheduled workouts easily

**Action:** 
- Add scheduled workouts to Calendar page
- Show upcoming scheduled workouts in Home page
- Create "Scheduled" tab in Fitness page

---

### 14. **User Events & Analytics**
**Status:** ✅ Tracking exists (`user_events` table), ❌ Never displayed

**What exists:**
- Complete event tracking system
- Session tracking
- User behavior data

**Impact:** Rich analytics data about how users interact with the app is collected but never shown.

**Action:** Create "Activity" or "Usage" section in Profile showing:
- App usage stats (sessions, time spent)
- Feature usage (most used features)
- Activity timeline

---

## 🔧 Developer/Admin Features

### 15. **Data Lineage Tracking**
**Status:** ✅ Functions exist (`dataLineage.js`), ❌ No UI

**What exists:**
- Source tracking for data
- Transformation mapping
- Impact analysis functions

**Action:** Create admin/developer UI to visualize data flows and dependencies.

---

### 16. **Event Tracking Dashboard**
**Status:** ✅ Events are tracked, ❌ No dashboard

**What exists:**
- `user_events` table with all user interactions
- Event tracking functions

**Action:** Create analytics dashboard showing:
- Most clicked features
- User journey paths
- Drop-off points
- Feature adoption rates

---

## 📋 Quick Wins (Easy to Add)

### High Impact, Low Effort:
1. **Query Materialized Views** - Replace expensive aggregations with pre-computed views
2. **Show Scheduled Workouts in Calendar** - Already have the data, just display it
3. **Display Nutrition Settings UI** - Functions exist, just need form
4. **Add Food Library Search** - Database exists, add search UI
5. **Show Data Freshness Indicators** - Use SLA monitoring data
6. **Display User Events Stats** - Show basic usage stats in Profile

---

## 🎯 Priority Recommendations

### This Week:
1. **Use Materialized Views** - Biggest performance win
2. **Add Nutrition Settings UI** - High user value
3. **Show Scheduled Workouts in Calendar** - Easy win

### Next Week:
4. **Complete Advanced Analytics Display** - Show cohort/funnel/retention
5. **Enhance Comparative Analytics** - Show peer comparisons and benchmarks
6. **Add Data Catalog Page** - Help users understand their data

### This Month:
7. **Create Admin Dashboards** - Pipeline monitoring, A/B testing, SLA monitoring
8. **Display Feature Engineering Insights** - Show correlations and trends
9. **Add User Activity Dashboard** - Show usage stats and behavior

---

## 📊 Summary Statistics

**Total Backend Features Found:** 16 major features
- ✅ Fully Integrated: 2 (Data Export, Paused Workouts)
- ⚠️ Partially Integrated: 4 (Advanced Analytics, Comparative Analytics, ML Predictions, Scheduled Workouts)
- ❌ Not Integrated: 10 (Materialized Views, Engineered Features, A/B Testing, Pipeline Monitoring, SLA Monitoring, Data Catalog, Nutrition Settings, Food Library, User Events, Data Lineage)

**Estimated Performance Impact:**
- Materialized Views: 10-100x faster analytics queries
- Missing UI features: Significant user experience improvements

**Estimated Development Time:**
- Quick Wins: 8-12 hours
- Medium Priority: 20-30 hours
- Full Integration: 60-80 hours

