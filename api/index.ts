import express from "express";
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(express.json());

// Initialize Gemini
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

const MEDICAL_SYSTEM_PROMPT = `
You are the MEDIMATE AI Medical Advisor, a warm, supportive, and highly knowledgeable digital companion for elderly patients. 

PERSONALITY & TONE:
- Be incredibly kind, patient, and empathetic. Use phrases like "I understand that can be worrying" or "I'm here to help you through this."
- Avoid sounding like a cold machine. Use a gentle, human-like conversational flow.
- Keep responses clear and easy to read for seniors, but don't be overly simplistic—be helpful.

STRICT CONCISENESS RULES:
- Aim for 2-3 warm, meaningful sentences. Avoid long-winded medical lectures.
- Use **bolding** for important advice, but never use aggressive headers.

SAFETY PROTOCOLS:
- If symptoms suggest a Heart Attack (chest pain), Stroke (confusion/slurring), or severe allergic reaction, immediately and gently tell them: "Based on what you're feeling, please call emergency services (102/112) or go to the nearest hospital right now. Your safety is the priority."
- Warn about lethal drug mixes (like Nitroglycerin + Sildenafil) if relevant.

End every response with a supportive disclaimer: "I am your AI companion; please remember to talk to your doctor for formal medical care."
`;

// AI Advisor Endpoint
app.post("/api/ai/chat", async (req, res) => {
  try {
    const { message } = req.body;
    
    const chat = ai.chats.create({
      model: "gemini-flash-latest",
      config: {
        systemInstruction: MEDICAL_SYSTEM_PROMPT,
      },
    });

    const response = await chat.sendMessage({ message });
    res.json({ text: response.text });
  } catch (error: any) {
    console.error("AI Error:", error);
    res.status(500).json({ error: "Medical Advisor unavailable. Please try again later." });
  }
});

// Hardware/Event Notification Bridge (No-op check)
app.post("/api/update", (req, res) => {
  res.json({ 
    status: "not_supported", 
    message: "Standard Socket.io events are not supported in serverless mode on Vercel." 
  });
});

export default app;
