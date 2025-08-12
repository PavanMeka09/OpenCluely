import dotenv from 'dotenv';
dotenv.config();

export async function processScreenshot(mainWindow, imageDataOrArray) {
  const API_KEY = process.env.GEMINI_API_KEY;
  const language = process.env.language;
  const prompt = `You are a concise coding assistant for stealth interview help.
  first give your thoughts on the problem.
Look at the screenshots and directly give the clean solution in ${language}.
If code is needed, provide only the essential working code in markdown code blocks.
Give solution with comments explaing the code.
after giving the solution give complexity of the code. (both time and space)
`;

  const contents = imageDataOrArray.map(img => ({
    inline_data: { mime_type: "image/png", data: img }
  }));
  contents.push({ text: prompt });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
      {
        method: 'POST',
        body: JSON.stringify({
          contents: [{ parts: contents }],
          generationConfig: { temperature: 0.4 }
        })
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'API request failed');
    }

    const data = await response.json();
    if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
      mainWindow.webContents.send('api-response', data.candidates[0].content.parts[0].text);
    } else {
      throw new Error('Invalid response format from API');
    }
  } catch (error) {
    console.error('API Error:', error);
    mainWindow.webContents.send('api-error', error.message || 'Failed to process image');
  }
}