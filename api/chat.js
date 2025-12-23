export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed', status: 405 } })
  }

  try {
    // -----------------------------
    // Auth (required)
    // -----------------------------
    const authHeader = req.headers?.authorization || req.headers?.Authorization
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: { message: 'Missing authorization', status: 401 } })
    }
    const token = authHeader.slice('Bearer '.length).trim()
    if (!token) {
      return res.status(401).json({ success: false, error: { message: 'Missing authorization token', status: 401 } })
    }

    const { createClient } = await import('@supabase/supabase-js')
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ success: false, error: { message: 'Server configuration error', status: 500 } })
    }
    const supabase = createClient(supabaseUrl, supabaseKey)
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !user) {
      return res.status(401).json({ success: false, error: { message: 'Invalid or expired token', status: 401 } })
    }

    // -----------------------------
    // Lightweight per-user rate limit (best-effort, in-memory)
    // -----------------------------
    globalThis.__HF_CHAT_RL__ = globalThis.__HF_CHAT_RL__ || new Map()
    const rlKey = `${user.id}:${Math.floor(Date.now() / 60000)}` // per minute
    const used = globalThis.__HF_CHAT_RL__.get(rlKey) || 0
    const MAX_PER_MIN = 20
    if (used >= MAX_PER_MIN) {
      return res.status(429).json({ success: false, error: { message: 'Rate limit exceeded. Please wait a minute and try again.', status: 429 } })
    }
    globalThis.__HF_CHAT_RL__.set(rlKey, used + 1)

    const { messages, context } = req.body
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ success: false, error: { message: 'Invalid request', status: 400 } })
    }
    if (messages.length > 30) {
      return res.status(400).json({ success: false, error: { message: 'Too many messages', status: 400 } })
    }
    const last = messages[messages.length - 1]
    if (!last || typeof last.content !== 'string' || last.content.length > 8000) {
      return res.status(400).json({ success: false, error: { message: 'Invalid message content', status: 400 } })
    }

    const lastMessage = messages[messages.length - 1]?.content?.toLowerCase() || ''
    
    // Detect workout generation requests
    const isWorkoutRequest = 
      (lastMessage.includes('workout') || lastMessage.includes('routine') || lastMessage.includes('exercise')) && 
      (lastMessage.includes('generate') || lastMessage.includes('create') || lastMessage.includes('give') || 
       lastMessage.includes('make') || lastMessage.includes('build') || lastMessage.includes('suggest') ||
       lastMessage.includes('leg') || lastMessage.includes('arm') || lastMessage.includes('chest') ||
       lastMessage.includes('back') || lastMessage.includes('shoulder') || lastMessage.includes('full body') ||
       lastMessage.includes('push') || lastMessage.includes('pull') || lastMessage.includes('upper') || lastMessage.includes('lower'))

    const systemPrompt = isWorkoutRequest 
      ? `You are HonestFitness AI, a fitness coach. The user wants a workout.

RESPOND WITH ONLY THIS JSON FORMAT, NO OTHER TEXT:
{
  "type": "workout",
  "name": "Descriptive Workout Name",
  "exercises": [
    {"name": "Exercise Name", "sets": 3, "reps": 10, "bodyPart": "Chest"}
  ]
}

Rules:
- Include 5-7 exercises
- Use real exercise names (Barbell Squat, Bench Press, Lat Pulldown, etc.)
- bodyPart must be: Chest, Back, Shoulders, Arms, Legs, or Core
- Match the workout to what they asked for (leg day = leg exercises, etc.)
- Vary sets (3-5) and reps (6-15) based on exercise type
${context ? `\nUser context: ${context}` : ''}`
      : `You are HonestFitness AI, a knowledgeable fitness and health assistant.

You help with:
- Workout advice and exercise form
- Training programs and periodization  
- Nutrition and diet guidance
- Recovery, sleep, and injury prevention
- Fitness goal setting and motivation
- Health and wellness tips

Keep responses helpful, concise, and actionable. If asked about non-fitness topics, politely redirect to health and fitness.
${context ? `\nUser context: ${context}` : ''}`

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      console.error('OPENAI_API_KEY not set')
      return res.status(500).json({ success: false, error: { message: 'API configuration error. Please try again later.', status: 500 } })
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        max_tokens: 800,
        temperature: 0.7
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenAI API error:', response.status, errorText)
      return res.status(502).json({ success: false, error: { message: 'AI service temporarily unavailable. Please try again.', status: 502 } })
    }

    const data = await response.json()
    
    if (!data.choices?.[0]?.message?.content) {
      console.error('Invalid OpenAI response:', data)
      return res.status(502).json({ success: false, error: { message: 'Received invalid response from AI. Please try again.', status: 502 } })
    }

    const content = data.choices[0].message.content.trim()

    // Try to parse as workout JSON
    if (isWorkoutRequest) {
      try {
        // Extract JSON if wrapped in markdown code blocks
        let jsonStr = content
        if (content.includes('```')) {
          const match = content.match(/```(?:json)?\s*([\s\S]*?)```/)
          if (match) jsonStr = match[1].trim()
        }
        
        const workout = JSON.parse(jsonStr)
        if (workout.type === 'workout' && Array.isArray(workout.exercises) && workout.exercises.length > 0) {
          return res.status(200).json({ success: true, message: content, workout })
        }
      } catch (e) {
        console.error('Failed to parse workout JSON:', e.message)
        // Return as regular message if JSON parsing fails
      }
    }

    return res.status(200).json({ success: true, message: content })
    
  } catch (error) {
    console.error('Chat handler error:', error)
    return res.status(500).json({ success: false, error: { message: 'Something went wrong. Please try again.', status: 500 } })
  }
}
