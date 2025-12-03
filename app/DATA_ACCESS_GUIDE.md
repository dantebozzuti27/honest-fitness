# Data Access Guide

## Overview

Users now have comprehensive access to all their fitness, health, and nutrition data with powerful filtering, trending, and analysis capabilities.

## Available Data Sources

1. **Fitbit Data** (`fitbit_daily` table)
   - Steps, calories, active calories
   - Sleep duration and efficiency
   - Heart rate (resting, average)
   - HRV (Heart Rate Variability)
   - Activity zones (sedentary, lightly active, fairly active, very active minutes)
   - Distance, floors
   - Body composition (weight, BMI, fat)

2. **Workout Data** (`workouts` table)
   - Workout history with exercises and sets
   - Duration, perceived effort
   - Body part distribution
   - Exercise frequency

3. **Daily Metrics** (`daily_metrics` table)
   - Merged health metrics
   - Sleep, HRV, steps, calories
   - Weight tracking

4. **Nutrition Data** (from `daily_metrics` or separate tables)
   - Calorie intake
   - Macro tracking

## Data Access Features

### 1. Date Range Filtering
Filter any data by custom date ranges:
```javascript
const data = await getFitbitDataRange(userId, '2024-01-01', '2024-01-31')
```

### 2. Trend Analysis
Calculate trends over different periods (daily, weekly, monthly, yearly):
```javascript
const trends = calculateTrend(fitbitData, 'steps', 'week')
// Returns: average, min, max, count, trend direction, change percent
```

### 3. Data Slicing
Group data by time periods:
```javascript
const sliced = sliceDataByPeriod(data, 'week')
// Groups data by week for easy comparison
```

### 4. Period Comparison
Compare two time periods:
```javascript
const comparison = comparePeriods(
  data, 
  '2024-01-01', '2024-01-31',  // Period 1
  '2024-02-01', '2024-02-29',  // Period 2
  'steps'                       // Metric
)
// Returns: averages, counts, change percentage, absolute change
```

### 5. Summary Statistics
Get comprehensive stats for any metric:
```javascript
const summary = getMetricSummary(data, 'steps')
// Returns: count, average, min, max, median, sum, standard deviation
```

### 6. Correlation Analysis
Find relationships between metrics:
```javascript
const correlation = getCorrelation(data, 'steps', 'calories')
// Returns: correlation coefficient (-1 to 1)
```

### 7. Extremes
Find top/bottom performing days:
```javascript
const topDays = getExtremes(data, 'steps', 5, 'top')
const bottomDays = getExtremes(data, 'steps', 5, 'bottom')
```

## Data Explorer Page

Access via `/data` route or "Data Explorer" button on Home page.

### Features:
- **Filters**: Date range, period grouping, metric selection
- **Summary Stats**: Average, min, max, median for selected metric
- **Trends View**: See how metrics change over time periods
- **Extremes View**: Top 5 and bottom 5 days for any metric
- **Raw Data Table**: View all data points with filtering

### Available Metrics:
- Steps
- Calories (total and active)
- Sleep duration and efficiency
- Heart rate (resting, average)
- HRV
- Distance
- Floors
- Activity minutes (sedentary, lightly active, fairly active, very active)
- Body composition (weight, BMI, fat)

## Usage Examples

### Get all Fitbit data for last 30 days
```javascript
import { getFitbitDataRange } from '../lib/dataAccess'

const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  .toISOString().split('T')[0]
const endDate = getTodayEST()

const data = await getFitbitDataRange(userId, startDate, endDate)
```

### Calculate weekly trends for steps
```javascript
import { calculateTrend } from '../lib/dataAccess'

const trends = calculateTrend(fitbitData, 'steps', 'week')
trends.forEach(trend => {
  console.log(`Week ${trend.period}: ${trend.average} steps/day`)
  if (trend.trend) {
    console.log(`Trend: ${trend.trend} (${trend.changePercent}%)`)
  }
})
```

### Compare this month vs last month
```javascript
import { comparePeriods } from '../lib/dataAccess'

const thisMonth = comparePeriods(
  data,
  '2024-01-01', '2024-01-31',  // Last month
  '2024-02-01', '2024-02-29',  // This month
  'steps'
)

console.log(`Steps increased by ${thisMonth.change}%`)
```

### Get summary for all metrics
```javascript
import { getMetricSummary } from '../lib/dataAccess'

const metrics = ['steps', 'calories', 'sleep_duration', 'hrv']
metrics.forEach(metric => {
  const summary = getMetricSummary(fitbitData, metric)
  console.log(`${metric}: avg=${summary.average}, min=${summary.min}, max=${summary.max}`)
})
```

## Integration with Backend

The data access functions work with the existing Supabase database. For advanced analysis, you can also use the backend API:

```javascript
import { getMLAnalysis } from '../lib/backend'

// Get ML-powered analysis
const analysis = await getMLAnalysis(userId, {
  startDate: '2024-01-01',
  endDate: '2024-01-31'
})

// Returns: workout trends, nutrition patterns, readiness scores, anomalies, predictions
```

## Best Practices

1. **Use date ranges**: Always filter data by date range to avoid loading too much data
2. **Cache results**: Store computed trends/summaries to avoid recalculating
3. **Handle nulls**: Many metrics may be null on certain days - filter them out before calculations
4. **Period selection**: Use appropriate periods (daily for recent data, weekly/monthly for trends)
5. **Visualization**: Use the LineChart and BarChart components to visualize trends

## Future Enhancements

- Export data to CSV/JSON
- Custom metric calculations
- Goal tracking and progress
- Predictive analytics
- Data correlations dashboard
- Automated insights generation

