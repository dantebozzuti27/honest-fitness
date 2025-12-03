# HonestFitness Backend System

Complete backend system for processing fitness, nutrition, and health data with AI/ML-powered personalization.

## Architecture

The system follows a modular architecture with clear separation of concerns:

1. **Input Layer** - Normalizes and validates all incoming data
2. **Abstraction Layer** - Standardizes data formats for processing
3. **ML/AI Engine** - Analyzes data, detects trends, generates insights
4. **Personalization Engine** - Creates personalized recommendations
5. **Output Layer** - Provides AI Coach and Analytics Dashboard
6. **Data Pipelines** - Handles data flow and storage

## Setup

1. Install dependencies:
```bash
cd backend
npm install
```

2. Configure environment variables (create `.env` file):
```
PORT=3001
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
OPENAI_API_KEY=your_openai_key
CALAI_API_KEY=your_calai_key
FITBIT_CLIENT_ID=your_fitbit_client_id
FITBIT_CLIENT_SECRET=your_fitbit_client_secret
```

3. Start the server:
```bash
npm run dev
```

## API Endpoints

### Input Layer (`/api/input`)
- `POST /api/input/workout` - Submit workout data
- `POST /api/input/nutrition` - Submit nutrition data
- `POST /api/input/health` - Submit health data
- `POST /api/input/user` - Submit user profile data
- `POST /api/input/fitbit/sync` - Sync Fitbit data

### ML/AI Engine (`/api/ml`)
- `POST /api/ml/analyze` - Run ML analysis
- `POST /api/ml/workout-plan` - Generate workout plan
- `POST /api/ml/nutrition-plan` - Generate nutrition plan
- `POST /api/ml/weekly-summary` - Generate weekly summary
- `POST /api/ml/insights` - Generate insights
- `POST /api/ml/interpret` - Interpret user prompt

### Personalization (`/api/personalization`)
- `POST /api/personalization/generate` - Generate personalized recommendations

### Output Layer (`/api/output`)
- `POST /api/output/coach/guidance` - Get AI Coach guidance
- `POST /api/output/analytics/dashboard` - Get analytics dashboard data

### Pipelines (`/api/pipeline`)
- `POST /api/pipeline/process` - Process single data point
- `POST /api/pipeline/process-batch` - Process batch data

## Features

- **Data Normalization** - All data sources normalized to standard formats
- **ML Analysis** - Trend detection, anomaly detection, performance prediction
- **AI Integration** - OpenAI and CalAI for plan generation
- **Personalization** - Dynamic workout and nutrition recommendations
- **Fitbit Integration** - Automatic health data syncing
- **Readiness Scoring** - Computes daily readiness based on multiple factors

## Integration with Frontend

The backend is designed to work with the existing React frontend. Update your frontend API calls to point to the backend server (default: `http://localhost:3001`).

