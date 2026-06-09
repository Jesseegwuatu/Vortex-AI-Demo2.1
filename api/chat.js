// ==================== VORTEX AI BACKEND PROXY ====================
// This file runs on Vercel server. Your API key is stored in Vercel Environment Variables.
// Users NEVER see this key because this code runs on the server, not in the browser.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// List of free models that OpenRouter will auto-route to
// Using openrouter/auto for smart routing, restricted to these free models
const FREE_MODELS = [
  "google/gemini-2.0-flash-exp:free",
  "microsoft/phi-3-mini-128k:free",
  "qwen/qwen-2-7b-instruct:free",
  "mistralai/mistral-7b-instruct:free"
];

// Helper to delay between retries
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, image } = req.body;
    
    if (!message && !image) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Build the user message content
    let userContent = message || "Describe this image in detail";
    
    if (image && image.data) {
      userContent = [
        { type: "text", text: message || "Describe this image in detail" },
        { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } }
      ];
    }

    // System prompt for Vortex AI personality
    const systemPrompt = `You are Vortex AI, a helpful, friendly assistant. 
Respond naturally in plain text without markdown symbols like # or **. 
Use triple backticks for code blocks with language identifiers.
Be concise, warm, and helpful.`;

    // Try multiple models with fallback
    let lastError = null;
    
    for (let attempt = 0; attempt < FREE_MODELS.length; attempt++) {
      const model = FREE_MODELS[attempt];
      
      try {
        console.log(`Attempting with model: ${model}`);
        
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
              { role: "user", content: userContent }
            ],
            temperature: 0.7,
            max_tokens: 4096
          })
        });

        const data = await response.json();

        if (!response.ok) {
          console.error(`Model ${model} returned error:`, data.error);
          lastError = data.error;
          continue; // Try next model
        }

        if (data.choices && data.choices[0] && data.choices[0].message) {
          console.log(`Success with model: ${model}`);
          return res.status(200).json({
            choices: [{
              message: { content: data.choices[0].message.content }
            }],
            model_used: model
          });
        }
        
        lastError = data;
        
      } catch (error) {
        console.error(`Model ${model} fetch error:`, error.message);
        lastError = error;
        continue;
      }
    }
    
    // If we get here, all models failed
    console.error('All models failed. Last error:', lastError);
    
    return res.status(503).json({ 
      error: "All AI models are currently busy. Please wait 30 seconds and try again. The free tier has rate limits that refresh every minute."
    });
    
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}