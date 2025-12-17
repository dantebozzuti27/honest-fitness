# APP STORE CONNECT — APP PRIVACY ANSWERS (DRAFT)

LAST UPDATED: 2025-12-17

THIS IS A WORKING DRAFT TO HELP YOU FILL OUT **APP STORE CONNECT → APP PRIVACY** CONSISTENTLY WITH HOW THE APP IS BUILT TODAY.

YOU MUST REVIEW THIS AGAINST YOUR ACTUAL PRODUCTION CONFIG (SENTRY/ANALYTICS, AI, ETC.) BEFORE SUBMISSION.

---

## DATA YOU COLLECT (LIKELY)

### HEALTH & FITNESS (USER-GENERATED)
- **Workout data**: exercises, sets, reps, weight, duration, notes.
- **Nutrition data**: meals, calories/macros, food entries, barcode (IF USED).
- **Health metrics**: readiness/sleep/steps (IF WEARABLES CONNECTED), weight, other metrics.

**Purpose**: App functionality (tracking and personalization), analytics (aggregate product usage if telemetry enabled).

### IDENTIFIERS
- **User ID / Account ID** (Supabase auth user id).
- Optional: **email** (auth).
- Optional: **username / display name**.

**Purpose**: App functionality (login, syncing, personalization).

### DIAGNOSTICS (LIMITED)
- Error events and crash context **IF** telemetry is enabled (`VITE_ENABLE_TELEMETRY=true`).

**Purpose**: App functionality / debugging, performance.

---

## DATA YOU DO NOT COLLECT (SHOULD BE “NO” UNLESS YOU ADD IT)
- Precise location
- Contacts
- Photos library access (unless you add explicit import)
- Advertising ID for tracking across apps (unless you add ad SDKs)

---

## TRACKING (APPLE DEFINITION)

**Tracking** = linking user data across apps/websites owned by other companies for advertising/measurement.

CURRENT INTENT:
- **NO TRACKING** (unless you add ad networks / cross-app measurement).

---

## DATA LINKED TO THE USER (YES)

LIKELY “LINKED TO USER”:
- Account identifiers (email, user id)
- Workout / nutrition / health data
- Social/friends data (if enabled)

---

## DATA NOT LINKED TO THE USER (POSSIBLY)
- Aggregated, anonymized analytics (only if you implement true aggregation/anonymization).

---

## PURPOSE MAPPING (APPLE CATEGORIES)

### APP FUNCTIONALITY
- Auth, syncing, offline outbox, saving workouts/nutrition/health, program enrollment.

### ANALYTICS
- Usage analytics events (only when telemetry enabled).

### PRODUCT PERSONALIZATION
- Templates, progression recommendations, readiness-based adjustments.

### DEVELOPER’S ADVERTISING / THIRD‑PARTY ADVERTISING
- **NO** (unless you add ads).

---

## REQUIRED DISCLOSURES TO ENSURE YOU’RE “5/5”

- **In-app privacy policy URL works**: `/privacy`
- **Support URL works**: `/support`
- **Support email is real**: `support@honestfitness.app` (update if needed)
- **Account deletion in-app** (already exists)
- **Explain health data usage clearly** (readiness, personalization, analytics)



