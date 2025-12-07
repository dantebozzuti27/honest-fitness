# What is "Ghost Mode" in the Nutrition Page?

## Quick Answer
**Ghost Mode** is a legacy term that refers to the offline/localStorage fallback functionality in the Nutrition page. It's not a separate mode or feature - it's just the name used internally for the localStorage backup system.

## Detailed Explanation

### Historical Context
The Nutrition page (`app/src/pages/Nutrition.jsx`) was originally based on a page called "GhostMode" (`app/src/pages/GhostMode.jsx`). The comment at the top of the Nutrition page says:

```javascript
// Nutrition page - based on GhostMode but without CalAI
```

### What It Actually Does
"Ghost Mode" refers to the **localStorage fallback system** that:

1. **Saves nutrition data locally** when Supabase is unavailable
2. **Loads from localStorage** if Supabase queries fail
3. **Migrates data** from localStorage to Supabase when possible

### How It Works
The code uses localStorage keys like `ghostMode_${user.id}` to store:
- Target calories and macros
- Favorites
- Fasting settings
- Meal history (as a fallback)

### Current Status
- The Nutrition page now primarily uses **Supabase** (`health_metrics` table)
- localStorage is only used as a **fallback** if Supabase fails
- The term "Ghost Mode" is just a legacy name - there's no separate "ghost mode" to enable/disable
- Users don't see "Ghost Mode" anywhere in the UI

### Why It's Called "Ghost Mode"
The name likely comes from the idea that data "ghosts" (persists) locally even when offline or when the database connection fails. It's essentially an offline-first backup system.

### In Practice
When you use the Nutrition page:
- ✅ Data is saved to Supabase (`health_metrics` table)
- ✅ If Supabase fails, data is saved to localStorage as backup
- ✅ On next load, it tries Supabase first, then falls back to localStorage
- ✅ If localStorage data exists, it's automatically migrated to Supabase

**Bottom line:** "Ghost Mode" is just the internal name for the localStorage backup system. You don't need to enable or disable anything - it works automatically in the background.

