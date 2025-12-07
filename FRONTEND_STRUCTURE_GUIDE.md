# Frontend Structure Guide - In Plain English

This document explains how your fitness app is organized and how users navigate between different pages. Think of it like a map of your app!

---

## 🏠 The Big Picture

Your app is like a house with different rooms (pages). Each room has a specific purpose:
- **Home** = Your main dashboard where you see everything at a glance
- **Fitness** = Where you log and track workouts
- **Nutrition** = Where you log meals and track food
- **Health** = Where you track health metrics (sleep, HRV, steps, etc.)
- **Analytics** = Where you see charts and trends
- **Goals** = Where you set and track your fitness goals
- **Profile** = Your account settings and preferences
- **Wearables** = Connect and sync your fitness devices (Fitbit, Oura, etc.)

---

## 🚪 How Navigation Works

### Main Navigation (Bottom Bar)
At the bottom of most pages, you'll see 5 buttons:

1. **Fitness** → Takes you to workout tracking
2. **Nutrition** → Takes you to meal tracking  
3. **+ (Plus Button)** → Quick menu to log something fast
4. **Health** → Takes you to health metrics
5. **Analytics** → Takes you to charts and trends

### Side Menu (Hamburger Menu)
The three-line menu button (☰) in the top-left opens a side menu with:
- Fitness
- Nutrition
- Health
- Analytics
- Goals
- Calendar
- Profile

### Home Button
The home icon (🏠) in the top-left takes you back to the main dashboard.

---

## 📄 All Available Pages

### 1. **Home Page** (`/`)
**What it is:** Your main dashboard - the first thing you see after logging in.

**What you can do:**
- See your workout streak
- View today's steps (from Fitbit if connected)
- See recent activity logs
- Quick access to log workouts, meals, or health metrics
- View your profile picture

**URL:** `http://yourapp.com/` or just `/`

---

### 2. **Fitness Page** (`/fitness`)
**What it is:** Your workout hub - everything related to exercise.

**Tabs inside this page:**
- **Workout Tab:** 
  - Start a new workout
  - See today's planned workout
  - View workout templates
  - Quick log health metrics
  
- **Templates Tab:**
  - Create workout templates
  - Edit existing templates
  - Delete templates
  
- **History Tab:**
  - View all past workouts
  - See workout details
  - Share workouts
  
- **Goals Tab:**
  - View fitness-related goals
  - See progress toward goals

**URL:** `/fitness` or `/workout` (both go to the same page)

---

### 3. **Active Workout Page** (`/workout/active`)
**What it is:** The screen you see while doing a workout.

**What you can do:**
- Add exercises
- Log sets (weight, reps, time)
- Track rest time
- Finish and save the workout
- See workout timer

**How you get here:** Click "Start Workout" from the Fitness page.

**URL:** `/workout/active`

---

### 4. **Nutrition Page** (`/nutrition`)
**What it is:** Your food and meal tracking center.

**What you can do:**
- Log meals (breakfast, lunch, dinner, snacks)
- Track calories consumed
- Track macros (protein, carbs, fat)
- Log water intake
- Set calorie and macro targets
- View nutrition history
- Use "Ghost Mode" (offline mode)

**URL:** `/nutrition` or `/ghost-mode` (legacy route)

---

### 5. **Health Page** (`/health`)
**What it is:** Where you track all your health metrics.

**Tabs inside this page:**
- **Today Tab:**
  - View today's health metrics
  - See readiness score
  - View wearable data (Fitbit, Oura)
  - Sync wearable devices
  
- **History Tab:**
  - View past health data
  - See trends over time
  - Filter by time period (week, month, 90 days)
  
- **Log Tab:**
  - Manually enter health metrics:
    - Sleep score
    - Sleep duration
    - HRV (Heart Rate Variability)
    - Steps
    - Calories burned
    - Weight
    - Resting heart rate
    - Body temperature
  
- **Goals Tab:**
  - View health-related goals
  - Track progress

**URL:** `/health`

---

### 6. **Analytics Page** (`/analytics`)
**What it is:** Charts and graphs showing your progress over time.

**What you can see:**
- Workout frequency charts
- Nutrition trends
- Health metric trends
- Body part training distribution
- Progress over time

**URL:** `/analytics`

---

### 7. **Goals Page** (`/goals`)
**What it is:** Set and track your fitness, nutrition, and health goals.

**What you can do:**
- Create new goals (fitness, nutrition, health)
- View active goals
- See progress toward goals
- Archive completed goals
- Set daily goals (like calorie intake)
- Track progress goals (like weight loss)

**URL:** `/goals`

---

### 8. **Calendar Page** (`/calendar`)
**What it is:** A calendar view of your workouts and activities.

**What you can see:**
- Workouts scheduled for each day
- Past workouts
- Plan future workouts

**URL:** `/calendar`

---

### 9. **Profile Page** (`/profile`)
**What it is:** Your account settings and personal information.

**What you can do:**
- Update profile picture
- Change username
- Set date of birth
- Set gender
- Set height
- Update fitness preferences
- View account information

**URL:** `/profile` or `/account` (legacy route)

---

### 10. **Wearables Page** (`/wearables`)
**What it is:** Connect and manage your fitness devices.

**What you can do:**
- Connect Fitbit account
- Connect Oura ring
- Connect Apple Watch (when available)
- Sync data from devices
- Disconnect devices
- View connection status

**URL:** `/wearables`

---

### 11. **Auth Page** (`/auth`)
**What it is:** Login and signup screen.

**What you can do:**
- Sign in with email and password
- Create a new account
- Reset password (if implemented)

**URL:** `/auth`

**Note:** If you're not logged in and try to visit any other page, you'll be redirected here automatically.

---

## 🔒 Protected Routes

Most pages require you to be logged in. If you try to visit them without logging in, you'll be automatically redirected to the login page (`/auth`).

**Protected pages:**
- Home (`/`)
- Fitness (`/fitness`)
- Nutrition (`/nutrition`)
- Health (`/health`)
- Analytics (`/analytics`)
- Goals (`/goals`)
- Calendar (`/calendar`)
- Profile (`/profile`)
- Wearables (`/wearables`)
- Active Workout (`/workout/active`)

**Public pages:**
- Auth (`/auth`) - Login/Signup

---

## 🗺️ Route Map (URL Structure)

Here's a simple map of all the URLs:

```
/                    → Home (Dashboard)
/auth                → Login/Signup
/fitness             → Fitness Page
/workout             → Fitness Page (same as /fitness)
/workout/active      → Active Workout Screen
/nutrition           → Nutrition Page
/health              → Health Page
/analytics           → Analytics Page
/goals               → Goals Page
/calendar            → Calendar Page
/profile             → Profile Page
/wearables           → Wearables Page

// Legacy routes (still work, but redirect):
/ghost-mode          → Nutrition Page
/account             → Profile Page
```

---

## 🎯 User Flow Examples

### Example 1: Logging a Workout
1. User opens app → **Home Page** (`/`)
2. Clicks "Fitness" in bottom nav → **Fitness Page** (`/fitness`)
3. Clicks "Start Workout" → **Active Workout Page** (`/workout/active`)
4. Adds exercises and sets
5. Clicks "Finish Workout" → Back to **Fitness Page** (`/fitness`)

### Example 2: Logging a Meal
1. User opens app → **Home Page** (`/`)
2. Clicks "+" button in bottom nav → Quick Log menu appears
3. Clicks "Log Meal" → **Nutrition Page** (`/nutrition`)
4. Adds meal details
5. Meal is saved

### Example 3: Syncing Fitbit Data
1. User opens app → **Home Page** (`/`)
2. Clicks hamburger menu (☰) → Side menu opens
3. Clicks "Wearables" → **Wearables Page** (`/wearables`)
4. Clicks "Sync Fitbit" → Data syncs
5. Data appears on **Health Page** (`/health`)

### Example 4: Viewing Progress
1. User opens app → **Home Page** (`/`)
2. Clicks "Analytics" in bottom nav → **Analytics Page** (`/analytics`)
3. Views charts and trends
4. Can switch to **Goals Page** (`/goals`) to see goal progress

---

## 🧩 Page Components

Each page typically has these common elements:

1. **Top Bar:**
   - Home button (🏠) - goes to dashboard
   - Hamburger menu (☰) - opens side menu
   - Page title

2. **Main Content:**
   - Page-specific content
   - Tabs (if the page has multiple sections)
   - Forms, lists, charts, etc.

3. **Bottom Navigation:**
   - 5 main navigation buttons
   - Quick Log button (+)

4. **Modals/Popups:**
   - Some pages have popup windows for:
     - Adding data
     - Editing information
     - Confirming actions
     - Sharing content

---

## 📱 Mobile-First Design

The app is designed for mobile phones first, which is why:
- Navigation is at the bottom (easy thumb reach)
- Side menu slides in from the left
- Pages are full-screen
- Touch-friendly buttons and inputs

---

## 🔄 How Pages Communicate

Pages share data through:
1. **Database (Supabase)** - All data is stored here
2. **Context (React Context)** - User authentication state
3. **URL Parameters** - Some pages can pass data via URL
4. **Local Storage** - Temporary data storage (like "Ghost Mode")

---

## 🎨 Visual Structure

```
┌─────────────────────────────────┐
│  🏠  ☰  Page Title              │  ← Top Bar
├─────────────────────────────────┤
│                                 │
│      Main Page Content          │  ← Content Area
│      (Tabs, Forms, Lists, etc.) │
│                                 │
│                                 │
├─────────────────────────────────┤
│  🏋️  🍎  +  ❤️  📊            │  ← Bottom Nav
└─────────────────────────────────┘
```

---

## 🚀 Quick Tips

1. **Always start at Home** - The dashboard gives you the best overview
2. **Use the + button** - Quick way to log something without navigating
3. **Check the side menu** - Access less-used pages like Calendar and Goals
4. **Bottom nav is your friend** - The 5 main pages are always one tap away
5. **Active workout is special** - It's a full-screen experience, not a regular page

---

## 📝 Notes for Developers

- All routes are defined in `app/src/App.jsx`
- Protected routes use the `ProtectedRoute` component
- Navigation components: `BottomNav.jsx` and `SideMenu.jsx`
- Pages are in `app/src/pages/`
- Each page has its own CSS module file (e.g., `Home.module.css`)

---

## 🎯 Summary

Your app has **11 main pages** organized into:
- **1 Dashboard** (Home)
- **3 Core Tracking Pages** (Fitness, Nutrition, Health)
- **2 Analysis Pages** (Analytics, Goals)
- **3 Utility Pages** (Calendar, Profile, Wearables)
- **1 Special Page** (Active Workout)
- **1 Auth Page** (Login/Signup)

Navigation happens through:
- **Bottom navigation bar** (5 main buttons)
- **Side menu** (hamburger menu)
- **Home button** (top-left)
- **Quick Log menu** (+ button)

All pages (except Auth) require login and will redirect to `/auth` if not authenticated.

---

*Last Updated: After database migration alignment*

