# Unified Chart Design Specification
## Enterprise Analytics + Apple Design Language

### Core Principles

1. **Consistency First**: All charts share the same interaction model, controls, and behavior
2. **Trends & Correlations**: Charts surface insights, not just data
3. **Mobile-First**: Touch-optimized, one-handed friendly, gesture-driven
4. **Semi-Customizable**: Smart presets + user fine-tuning
5. **Shareable**: Easy export and sharing from any chart
6. **Readable**: Clear typography, proper contrast, intelligent defaults

---

## Unified Chart Component Architecture

```
<ChartCard>
  ├─ ChartHeader
  │   ├─ Title + Context
  │   ├─ Data Freshness Indicator
  │   └─ Share/Export Button
  ├─ ChartControls (Collapsible)
  │   ├─ Date Range Selector (Presets + Custom)
  │   ├─ Chart Type Switcher (Bar/Line/Area)
  │   ├─ Metric Selector (if applicable)
  │   └─ Comparison Toggle (vs Previous Period)
  ├─ ChartVisualization
  │   ├─ Main Chart (Touch-optimized)
  │   ├─ Trend Indicators
  │   ├─ Correlation Hints
  │   └─ Insight Callouts
  ├─ ChartInsights (Auto-generated)
  │   ├─ Key Trends
  │   ├─ Anomalies Detected
  │   └─ Recommendations
  └─ ChartActions
      ├─ Primary Action (e.g., "Log Workout")
      └─ Secondary Actions (e.g., "Set Goal", "View Details")
```

---

## Interaction Model (All Charts)

### Touch Gestures

1. **Pinch to Zoom Date Range**
   - Pinch out = Expand date range (show more time)
   - Pinch in = Narrow date range (focus on specific period)
   - Visual feedback: Overlay shows selected range
   - Smooth animation with haptic feedback

2. **Swipe to Navigate**
   - Swipe left = Move to earlier period
   - Swipe right = Move to later period
   - Maintains zoom level

3. **Tap to Select**
   - Single tap = Show data point details (tooltip)
   - Double tap = Reset to default view
   - Long press = Show action menu

4. **Drag to Pan**
   - When zoomed in, drag to pan across time
   - Smooth momentum scrolling

### Visual Feedback

- **Active State**: Selected date range highlighted with glass overlay
- **Hover/Touch**: Data points scale up, show value
- **Loading**: Skeleton screens with shimmer effect
- **Empty States**: Beautiful illustrations with actionable CTAs

---

## Chart Types (Unified API)

### 1. Time Series Charts (Bar, Line, Area)
**Use Cases**: Workout frequency, metrics over time, trends

**Features**:
- Pinch-to-zoom date range
- Multi-metric overlay (e.g., workouts + sleep quality)
- Correlation lines (show related metrics)
- Period comparison (this week vs last week)
- Trend lines (moving averages, regression)

**Customization**:
- Chart type: Bar / Line / Area / Combo
- Date range: Presets (Week/Month/Quarter/Year) + Custom
- Aggregation: Daily / Weekly / Monthly
- Comparison: Previous period / Goal / Average

### 2. Distribution Charts (Pie, Donut)
**Use Cases**: Body part distribution, exercise breakdown

**Features**:
- Interactive segments (tap to highlight)
- Drill-down capability
- Percentage labels with smart positioning
- Legend with values

**Customization**:
- Chart type: Pie / Donut
- Grouping threshold (combine small segments)
- Sort order: Value / Alphabetical / Custom

### 3. Comparison Charts (Grouped Bar, Stacked)
**Use Cases**: Week-over-week, goal vs actual

**Features**:
- Side-by-side comparison
- Difference indicators (↑↓ with %)
- Goal lines/bands
- Color coding (above/below target)

**Customization**:
- Comparison type: Side-by-side / Stacked
- Reference lines: Goals / Averages / Targets

### 4. Correlation Charts (Scatter, Heatmap)
**Use Cases**: Workout intensity vs sleep, volume vs recovery

**Features**:
- Dual-axis support
- Correlation coefficient display
- Trend line overlay
- Interactive point selection

**Customization**:
- X-axis metric
- Y-axis metric
- Time window
- Aggregation level

---

## Design System (Apple Liquid Glass)

### Visual Style

**Colors**:
- Primary: Gradient fills (red to orange for workouts, blue for health)
- Background: Glass morphism (backdrop blur, subtle borders)
- Text: SF Pro font family, proper hierarchy
- Accents: Subtle glows, soft shadows

**Typography**:
- Chart titles: SF Pro Display, 20px, semibold
- Axis labels: SF Pro Text, 12px, regular
- Values: SF Pro Text Mono, 14px, semibold
- Insights: SF Pro Text, 15px, regular

**Animations**:
- Chart load: Staggered bar/line animation (0.03s delay per element)
- Interactions: Spring physics (damping: 0.8, stiffness: 100)
- Transitions: 0.3s ease-out
- Haptic feedback on key interactions

**Spacing**:
- Chart padding: 20px all sides
- Element spacing: 8px base unit
- Touch targets: Minimum 44x44px

---

## Smart Features (Enterprise Analytics)

### 1. Auto-Insights Engine

**Trend Detection**:
- "Workouts increased 23% this week"
- "Sleep quality declining over last 7 days"
- "Volume plateau detected"

**Anomaly Detection**:
- "Unusual spike in volume on [date]"
- "Missing data detected - log workout?"
- "Below average performance period"

**Correlation Discovery**:
- "Better sleep correlates with higher workout volume"
- "Rest days improve next-day performance"
- "Nutrition quality impacts recovery"

### 2. Predictive Insights

- "At current rate, you'll hit goal in 12 days"
- "Trend suggests 15% improvement this month"
- "Risk of overtraining detected"

### 3. Contextual Recommendations

- "Try logging workouts 3x this week to maintain streak"
- "Your best performance days are Tuesdays"
- "Consider rest day - volume is high"

---

## Customization (Semi-Customizable)

### User Controls

**Preset Options**:
- Date ranges: Last 7/14/30/90 days, This Week/Month/Quarter/Year, All Time
- Chart types: Bar, Line, Area (context-appropriate)
- Metrics: Pre-selected based on context, with option to change

**Fine-Tuning**:
- Custom date range picker (calendar)
- Metric selector (if multiple available)
- Comparison toggle (on/off)
- Aggregation level (daily/weekly/monthly)

**Saved Views**:
- Users can save favorite chart configurations
- Quick access to saved views
- Share saved views with others

---

## Sharing & Export

### Share Options

1. **Image Export**
   - High-res PNG with chart + insights
   - Watermark with app branding
   - Share to social, messages, email

2. **Data Export**
   - CSV download
   - JSON for developers
   - Includes selected date range

3. **Link Share**
   - Shareable link to chart view
   - Preserves date range and settings
   - Requires authentication

---

## Implementation Plan

### Phase 1: Foundation
- [ ] Unified `ChartCard` wrapper component
- [ ] Base chart rendering (SVG-based)
- [ ] Touch gesture handlers (pinch, swipe, tap)
- [ ] Date range state management

### Phase 2: Core Features
- [ ] Pinch-to-zoom date range selection
- [ ] Chart type switching
- [ ] Preset date ranges
- [ ] Basic insights display

### Phase 3: Advanced Features
- [ ] Auto-insights engine
- [ ] Correlation detection
- [ ] Comparison mode
- [ ] Share/export functionality

### Phase 4: Polish
- [ ] Animations and transitions
- [ ] Haptic feedback
- [ ] Empty states
- [ ] Loading states
- [ ] Error handling

---

## Technical Stack

**Rendering**: 
- SVG-based (lightweight, scalable)
- React hooks for state management
- CSS modules for styling

**Libraries to Consider**:
- `react-spring` for animations
- `date-fns` for date manipulation
- `d3-scale` for axis calculations (lightweight)

**Avoid**:
- Heavy charting libraries (Chart.js, Recharts) - we want full control
- Canvas-based (harder to style, less accessible)

---

## Success Metrics

1. **Usability**: Users can adjust date range in < 3 seconds
2. **Readability**: 95% of users can identify key trends at a glance
3. **Engagement**: 40% of users share charts weekly
4. **Performance**: Charts render in < 200ms
5. **Accessibility**: WCAG AA compliant

---

## Example User Flow

1. User opens Analytics → sees workout frequency chart
2. Wants to see last 30 days → taps "Last 30 Days" preset
3. Notices interesting pattern → pinches to zoom into specific week
4. Sees auto-insight: "23% increase vs previous week"
5. Taps "View Details" → sees day-by-day breakdown
6. Shares chart → exports as image, sends to coach

---

## Questions to Finalize

1. **Default date range**: What should charts show by default? (Last 30 days? This month?)
2. **Chart type defaults**: Should we auto-select chart type based on data, or always show bar first?
3. **Insights frequency**: How often should we show insights? (Always? On demand? Smart timing?)
4. **Comparison default**: Should comparison mode be on by default or opt-in?
5. **Sharing permissions**: Should shared charts be public or require authentication?

---

## Next Steps

1. Review and approve this spec
2. Create detailed component API documentation
3. Build Phase 1 foundation
4. Test with real data
5. Iterate based on feedback

