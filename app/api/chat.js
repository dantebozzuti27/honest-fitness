export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { messages } = req.body
  const lastMessage = messages[messages.length - 1]?.content?.toLowerCase() || ''
  const isWorkoutRequest = lastMessage.includes('workout') && 
    (lastMessage.includes('generate') || lastMessage.includes('create') || lastMessage.includes('suggest') || lastMessage.includes('give'))

  try {
    const systemPrompt = isWorkoutRequest 
      ? `You are HonestFitness AI. Generate a workout in this EXACT JSON format, no other text:
{
  "type": "workout",
  "name": "Workout Name",
  "exercises": [
    {"name": "Exercise Name", "sets": 3, "reps": 10, "bodyPart": "Chest"}
  ]
}
Use real exercises. Include 4-6 exercises. bodyPart must be one of: Chest, Back, Shoulders, Arms, Legs, Core, Cardio.`
      : `You are HonestFitness AI, a fitness assistant. ONLY answer questions about:
- Workout plans and exercises
- Fitness goals and progress
- Nutrition and diet
- Recovery and rest
- Health and wellness

If asked about anything else, politely redirect to fitness topics. Keep responses concise and actionable.`

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.XAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'grok-beta',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        max_tokens: 500,
        temperature: 0.7
      })
    })

    const data = await response.json()
    
    if (data.error) {
      throw new Error(data.error.message)
    }

    const content = data.choices[0].message.content

    // Try to parse as workout JSON
    if (isWorkoutRequest) {
      try {
        const workout = JSON.parse(content)
        if (workout.type === 'workout' && workout.exercises) {
          return res.status(200).json({ message: content, workout })
        }
      } catch (e) {
        // Not valid JSON, return as regular message
      }
    }

    res.status(200).json({ message: content })
  } catch (error) {
    console.error('OpenAI error:', error)
    res.status(500).json({ error: 'Failed to get response' })
  }
}

