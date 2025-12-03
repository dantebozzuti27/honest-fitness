# Backend Quick Start Guide

## Prerequisites

- Node.js 18+ installed
- Supabase project set up
- API keys for OpenAI, CalAI (optional), and Fitbit (optional)

## Installation

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

4. Fill in your environment variables in `.env`:
```env
PORT=3001
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
OPENAI_API_KEY=sk-...
CALAI_API_KEY=your_calai_key (optional)
FITBIT_CLIENT_ID=your_fitbit_id (optional)
FITBIT_CLIENT_SECRET=your_fitbit_secret (optional)
```

## Running the Server

### Development Mode
```bash
npm run dev
```

The server will start on `http://localhost:3001`

### Production Mode
```bash
npm start
```

## Testing the API

### Health Check
```bash
curl http://localhost:3001/health
```

### Submit Workout Data
```bash
curl -X POST http://localhost:3001/api/input/workout \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-uuid",
    "date": "2024-01-15",
    "exercises": [
      {
        "name": "Bench Press",
        "sets": [
          {"weight": 100, "reps": 10},
          {"weight": 100, "reps": 8}
        ]
      }
    ]
  }'
```

### Get ML Analysis
```bash
curl -X POST http://localhost:3001/api/ml/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-uuid"
  }'
```

### Get Personalized Recommendations
```bash
curl -X POST http://localhost:3001/api/personalization/generate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-uuid"
  }'
```

## Integration with Frontend

Update your frontend API calls to use the backend server:

```javascript
// Example: In your frontend code
const API_BASE = process.env.NODE_ENV === 'production' 
  ? 'https://your-backend-domain.com'
  : 'http://localhost:3001'

// Get personalized recommendations
const response = await fetch(`${API_BASE}/api/personalization/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId: currentUser.id })
})
```

## Next Steps

1. Set up your Supabase database tables (see `app/supabase_migrations.sql`)
2. Configure your API keys
3. Test the endpoints
4. Integrate with your frontend
5. Deploy to production (Vercel, Railway, etc.)

## Troubleshooting

### "Missing Supabase credentials"
- Ensure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in `.env`

### "OpenAI API key not configured"
- Add `OPENAI_API_KEY` to `.env` (required for AI features)

### "CalAI API key not configured"
- This is optional - AI features will fallback to OpenAI if CalAI is unavailable

### Database errors
- Ensure your Supabase tables are created
- Check that RLS policies allow service role key access

