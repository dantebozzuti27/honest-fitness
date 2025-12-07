# Git Commit Commands

## Option 1: Commit All Changes (Recommended)

```bash
# Stage all modified and new files
git add .

# Commit with descriptive message
git commit -m "feat: Improve UX with direct modal access and enhanced features

- Plus button now opens modals directly instead of navigating to pages
- Workout start modal includes 'Today's Scheduled Workout' option
- Health metrics are individually clickable for manual override after Fitbit sync
- Analytics zoom now changes time scale instead of image zoom
- Added documentation for Ghost Mode and testing guide
- Updated all database interactions to use new unified health_metrics table
- Enhanced workout, nutrition, and health pages with better user flows"
```

## Option 2: Commit in Separate Groups

### 1. UI/UX Improvements
```bash
git add app/src/components/BottomNav.jsx
git add app/src/pages/Fitness.jsx
git add app/src/pages/Health.jsx
git add app/src/pages/Nutrition.jsx
git add app/src/components/BarChart.jsx
git commit -m "feat: Improve UX with direct modal access and enhanced interactions

- Plus button opens modals directly (workout, meal, health metrics)
- Workout start modal shows today's scheduled workout
- Health metrics cards are clickable for individual editing
- Analytics zoom changes time scale instead of image zoom"
```

### 2. Documentation
```bash
git add GHOST_MODE_EXPLANATION.md
git add TESTING_GUIDE.md
git add CODE_UPDATES_SUMMARY.md
git add DATABASE_OVERVIEW.md
git add FRONTEND_STRUCTURE_GUIDE.md
git add MIGRATION_EXECUTION_GUIDE.md
git add MIGRATION_PLAN.md
git commit -m "docs: Add comprehensive documentation

- Ghost Mode explanation
- Testing guide for new features
- Database migration documentation
- Code updates summary"
```

### 3. Database Migrations
```bash
git add app/supabase_migrations_*.sql
git add database\ upgrades.txt
git commit -m "feat: Add database migrations for unified health metrics and enhancements

- Unified health_metrics table
- Exercise and food libraries
- Goals enhancements
- User profile enhancements"
```

### 4. Database Integration Updates
```bash
git add app/src/lib/*.js
git add api/fitbit/sync.js
git add backend/src/database/index.js
git add backend/src/layers/abstraction/user.js
git commit -m "refactor: Update all database interactions to use new schema

- Migrate to unified health_metrics table
- Update wearables integration
- Update nutrition and goals database functions
- Align backend with new database structure"
```

## Option 3: Quick Commit (All at Once)

```bash
git add .
git commit -m "feat: Major UX improvements and database migration

- Direct modal access from plus button
- Enhanced workout, health, and nutrition flows
- Time scale zoom in analytics
- Complete database migration to unified schema
- Comprehensive documentation"
```

## Push to Remote

After committing, push to remote:

```bash
git push origin main
```

Or if you're on a different branch:

```bash
git push origin <your-branch-name>
```

## Check Before Committing

```bash
# See what will be committed
git status

# See the diff of changes
git diff

# See summary of changes
git diff --stat
```

