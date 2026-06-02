import express from "express";
import path from "path";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

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

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  const PORT = 3000;

  app.use(express.json());

  // AI Advisor Endpoint
  app.post("/api/ai/chat", async (req, res) => {
    try {
      const { message, history } = req.body;
      
      const chat = ai.chats.create({
        model: "gemini-flash-latest",
        config: {
          systemInstruction: MEDICAL_SYSTEM_PROMPT,
        },
        // If history format matches, it can be passed here, otherwise handled separately
      });

      const response = await chat.sendMessage({ message });
      res.json({ text: response.text });
    } catch (error: any) {
      console.error("AI Error:", error);
      res.status(500).json({ error: "Medical Advisor unavailable. Please try again later." });
    }
  });

  // Hardware/Event Notification Bridge
  app.post("/api/update", (req, res) => {
    const { patientId, event, detail, type } = req.body;
    
    const notification = {
      patientId,
      timestamp: new Date().toISOString(),
      event: `${event}: ${detail || ""}`,
      type: type || "info",
    };
    
    io.emit("notification", notification);
    res.json({ status: "broadcasted" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  io.on("connection", (socket) => {
    console.log("Client connected");
  });
}

startServer().catch(err => {
    console.error("Failed to start server:", err);
    process.exit(1);
});
