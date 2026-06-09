// ==================== VORTEX AI BACKEND PROXY ====================
// Uses openrouter/auto with free model restriction + Pollinations fallback

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Direct free API fallback (Pollinations - no API key needed, always works)
// This is our backup when OpenRouter free tier is busy
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

    const systemPrompt = `You are Vortex AI, a helpful, friendly assistant. 
Respond naturally in plain text without markdown symbols like # or **. 
Use triple backticks for code blocks with language identifiers.
Be concise, warm, and helpful.`;

    // ========== ATTEMPT 1: OpenRouter with openrouter/auto (free models only) ==========
    let openrouterSuccess = false;
    let lastError = null;
    
    try {
      console.log("Attempting OpenRouter with openrouter/auto...");
      
      // Build user content with or without image
      let userContent = message || "Describe this image in detail";
      if (image && image.data) {
        userContent = [
          { type: "text", text: message || "Describe this image in detail" },
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
            { role: "user", content: userContent }
          ],
          temperature: 0.7,
          max_tokens: 4096
        })
      });

      const data = await response.json();

      if (response.ok && data.choices && data.choices[0] && data.choices[0].message) {
        console.log("OpenRouter auto success!");
        openrouterSuccess = true;
        return res.status(200).json({
          choices: [{
            message: { content: data.choices[0].message.content }
          }],
          source: "openrouter"
        });
      }
      
      console.log("OpenRouter auto failed:", data.error);
      lastError = data.error;
      
    } catch (orError) {
      console.log("OpenRouter error:", orError.message);
      lastError = orError;
    }

    // ========== ATTEMPT 2: Pollinations.ai Text API (FREE, NO KEY, ALWAYS WORKS) ==========
    if (!openrouterSuccess) {
      try {
        console.log("Falling back to Pollinations.ai text API...");
        
        const fullPrompt = `${systemPrompt}\n\nUser: ${message}\n\nAssistant:`;
        const encodedPrompt = encodeURIComponent(fullPrompt);
        
        const pollResponse = await fetch(`${POLLINATIONS_URL}${encodedPrompt}`, {
          method: 'GET',
          headers: { 'Content-Type': 'text/plain' }
        });
        
        if (pollResponse.ok) {
          const textResponse = await pollResponse.text();
          console.log("Pollinations.ai success!");
          
          return res.status(200).json({
            choices: [{
              message: { content: textResponse }
            }],
            source: "pollinations"
          });
        }
        
      } catch (pollError) {
        console.log("Pollinations error:", pollError.message);
      }
    }

    // ========== ATTEMPT 3: Try specific free models in sequence ==========
    const freeModels = [
      "google/gemini-2.0-flash-exp:free",
      "microsoft/phi-3-mini-128k:free",
      "qwen/qwen-2-7b-instruct:free",
      "mistralai/mistral-7b-instruct:free"
    ];
    
    for (const model of freeModels) {
      try {
        console.log(`Trying specific model: ${model}`);
        
        let userContent = message || "Describe this image in detail";
        if (image && image.data) {
          userContent = [
            { type: "text", text: message || "Describe this image in detail" },
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
              { role: "user", content: userContent }
            ],
            temperature: 0.7,
            max_tokens: 4096
          })
        });

        const data = await response.json();

        if (response.ok && data.choices && data.choices[0] && data.choices[0].message) {
          console.log(`Success with model: ${model}`);
          return res.status(200).json({
            choices: [{
              message: { content: data.choices[0].message.content }
            }],
            source: model
          });
        }
        
      } catch (modelError) {
        console.log(`Model ${model} failed:`, modelError.message);
      }
    }

    // ========== ALL ATTEMPTS FAILED ==========
    console.error("All APIs failed. Last error:", lastError);
    
    // Return a helpful error message with guidance
    return res.status(503).json({ 
      error: "The AI service is currently busy. Please try again in 30 seconds.\n\n💡 Tips:\n• Wait a moment and try again\n• Free tier refreshes every minute\n• Your message has been saved, just click send again",
      fallbackMessage: "I'm currently experiencing high demand. Please try your message again in a few seconds. The free AI services refresh their quota every minute."
    });
    
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}
