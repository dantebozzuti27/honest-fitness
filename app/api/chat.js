export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { messages } = req.body

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are HonestFitness AI, a fitness assistant. ONLY answer questions about:
- Workout plans and exercises
- Fitness goals and progress
- Nutrition and diet
- Recovery and rest
- Health and wellness

If asked about anything else, politely redirect to fitness topics. Keep responses concise and actionable.`
          },
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

    res.status(200).json({ message: data.choices[0].message.content })
  } catch (error) {
    console.error('OpenAI error:', error)
    res.status(500).json({ error: 'Failed to get response' })
  }
}

