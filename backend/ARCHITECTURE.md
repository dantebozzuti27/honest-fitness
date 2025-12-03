# Backend System Architecture

This document describes the complete backend system architecture as specified in the requirements.

## System Overview

The backend processes all user fitness, nutrition, and health data, integrates with third-party APIs (Fitbit and CalAI), runs machine learning models, and produces personalized recommendations.

## Component Structure

### 1. User Data Input Layer

**Location:** `src/routes/input.js`, `src/layers/abstraction/`

Handles all incoming data from:
- Mobile app inputs (workouts, nutrition, user profile)
- Fitbit API (health metrics)
- Apple Health / Google Fit (future)
- CalAI API (workout/nutrition plans)

**Normalization:**
- All data is normalized to standard formats
- Schema validation using Zod
- Source tracking for data provenance

### 2. Backend Infrastructure

**API Gateway:** Express.js server (`src/index.js`)
- Routes all incoming traffic
- Handles authentication (via Supabase)
- Error handling middleware

**Abstraction Layer:** `src/layers/abstraction/`
- Normalizes all incoming data
- Validates data shapes
- Enforces schemas
- Converts to standardized formats for ML processing

### 3. AI & ML Engine

**ML Component:** `src/engines/ml/`
- `workoutAnalysis.js` - Analyzes workout trends
- `nutritionAnalysis.js` - Analyzes nutrition patterns
- `readiness.js` - Computes readiness scores
- `anomalyDetection.js` - Detects unusual patterns
- `prediction.js` - Predicts future performance

**AI Wrapper (LLM Layer):** `src/engines/ai/`
- `workoutPlan.js` - Generates workout plans using OpenAI
- `nutritionPlan.js` - Generates nutrition plans using OpenAI
- `weeklySummary.js` - Generates weekly summaries
- `insights.js` - Generates contextual insights
- `promptInterpreter.js` - Interprets user free-text prompts

**Integration:**
- OpenAI API for natural language generation
- CalAI API for workout/nutrition plan generation
- Bidirectional data exchange between ML and AI components

### 4. Personalization Engine

**Location:** `src/engines/personalization/`

**Workout Generator:** `workoutGenerator.js`
- Generates/updates workout programming
- Scales difficulty dynamically
- Adjusts based on performance data
- Integrates CalAI workout output

**Nutrition Strategy:** `nutritionStrategy.js`
- Calculates daily macro targets
- Builds/modifies meal plans
- Interprets nutrition logs
- Integrates CalAI nutrition outputs

**Adjustment Strategy:** `adjustmentStrategy.js`
- Adjusts goals dynamically
- Corrects behavior deviations
- Produces weekly summaries (AI + ML powered)
- Modifies recommendations based on adherence

### 5. Databases & Pipelines

**Database Layer:** `src/database/index.js`
- Workout Database (Supabase `workouts` table)
- Nutrition Database (Supabase `daily_metrics` table)
- Health Database (Supabase `fitbit_daily`, `daily_metrics` tables)
- User Profile Database (Supabase `user_preferences` table)

**Data Pipelines:** `src/pipelines/index.js`
- Normalizes raw API data
- Validates data
- Stores in appropriate databases
- Batch processing support

### 6. Output Layer

**Location:** `src/routes/output.js`

**AI Coach:**
- Daily guidance
- Behavior nudges
- Workout reminders
- Contextual insights (based on wearable data, logs, trends)

**Analytics Dashboard:**
- Trends across all categories
- Long-term history
- ML summaries
- Readiness scores
- Predictive insights

## Data Flow

1. **Input** → User/wearable data enters via Input Layer routes
2. **Normalization** → Abstraction Layer normalizes and validates
3. **Storage** → Data Pipelines store in appropriate databases
4. **Analysis** → ML Engine analyzes data, detects trends
5. **AI Processing** → AI Wrapper generates insights and plans
6. **Personalization** → Personalization Engine creates recommendations
7. **Output** → AI Coach and Analytics Dashboard serve results

## API Integrations

### Fitbit API
- OAuth2 authentication
- Daily data sync (sleep, HRV, heart rate, activity)
- Automatic token refresh
- Location: `src/integrations/fitbit.js`

### CalAI API
- Workout plan generation
- Nutrition plan generation
- Meal analysis from images
- Location: `src/integrations/calai.js`

### OpenAI API
- Natural language generation
- Plan generation (fallback if CalAI unavailable)
- Insight generation
- Location: `src/engines/ai/`

## Extensibility

The system is designed for future extensibility:
- Additional wearable integrations (Apple Health, Garmin, Whoop)
- More ML models (can be added to `src/engines/ml/`)
- Additional AI providers
- New data sources

## Security

- Supabase Service Role Key used for server-side operations
- Environment variables for all sensitive credentials
- Input validation on all endpoints
- Error handling prevents data leakage

