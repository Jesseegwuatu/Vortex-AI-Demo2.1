// ==================== VORTEX AI BACKEND PROXY ====================
// Enhanced with better context handling

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const POLLINATIONS_URL = "https://text.pollinations.ai/";

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, image } = req.body;
    
    if (!message && !image) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const systemPrompt = `You are Vortex AI, a helpful, friendly assistant with perfect memory. 
You remember everything users tell you across conversations.
Respond naturally in plain text without markdown symbols like # or ** except for code blocks.
Use triple backticks for code blocks with language identifiers.
Be concise, warm, and helpful. If the user has given you personal information, use it to personalize your responses.
Never ask "who is him" or similar - you have context from the conversation.`;

    // Build user content with memory context
    let userContent = message;
    
    // ATTEMPT 1: OpenRouter with openrouter/auto
    try {
      console.log("Attempting OpenRouter...");
      
      let apiUserContent = message;
      if (image && image.data) {
        apiUserContent = [
          { type: "text", text: message },
          { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } }
        ];
      }
      
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': process.env.VERCEL_URL || 'https://vortex-ai.vercel.app',
          'X-Title': 'Vortex AI'
        },
        body: JSON.stringify({
          model: "openrouter/auto",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: apiUserContent }
          ],
          temperature: 0.7,
          max_tokens: 4096
        })
      });

      const data = await response.json();

      if (response.ok && data.choices && data.choices[0] && data.choices[0].message) {
        return res.status(200).json({
          choices: [{ message: { content: data.choices[0].message.content } }],
          source: "openrouter"
        });
      }
    } catch (orError) {
      console.log("OpenRouter error:", orError.message);
    }

    // ATTEMPT 2: Pollinations.ai fallback
    try {
      console.log("Falling back to Pollinations.ai...");
      
      const fullPrompt = `${systemPrompt}\n\nUser: ${message}\n\nAssistant:`;
      const encodedPrompt = encodeURIComponent(fullPrompt);
      
      const pollResponse = await fetch(`${POLLINATIONS_URL}${encodedPrompt}`, {
        method: 'GET',
        headers: { 'Content-Type': 'text/plain' }
      });
      
      if (pollResponse.ok) {
        const textResponse = await pollResponse.text();
        return res.status(200).json({
          choices: [{ message: { content: textResponse } }],
          source: "pollinations"
        });
      }
    } catch (pollError) {
      console.log("Pollinations error:", pollError.message);
    }

    // ATTEMPT 3: Specific free models
    const freeModels = [
      "google/gemini-2.0-flash-exp:free",
      "microsoft/phi-3-mini-128k:free",
      "qwen/qwen-2-7b-instruct:free"
    ];
    
    for (const model of freeModels) {
      try {
        let apiUserContent = message;
        if (image && image.data) {
          apiUserContent = [
            { type: "text", text: message },
            { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } }
          ];
        }
        
        const response = await fetch(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': process.env.VERCEL_URL || 'https://vortex-ai.vercel.app',
            'X-Title': 'Vortex AI'
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: apiUserContent }
            ],
            temperature: 0.7,
            max_tokens: 4096
          })
        });

        const data = await response.json();

        if (response.ok && data.choices && data.choices[0] && data.choices[0].message) {
          return res.status(200).json({
            choices: [{ message: { content: data.choices[0].message.content } }],
            source: model
          });
        }
      } catch (modelError) {
        console.log(`Model ${model} failed:`, modelError.message);
      }
    }

    // All failed - return helpful message
    return res.status(503).json({ 
      error: "AI service busy. Please try again in a moment.",
      fallbackMessage: "I'm currently experiencing high demand. Please try your message again in a few seconds. Your message has been saved locally."
    });
    
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}
