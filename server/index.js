import express from "express";
import cors from "cors";
import { synth } from "./tts.js";

const app = express();
app.use(cors());

app.get("/api/tts", async (req, res) => {
  try {
    const text = (req.query.text || "").trim();
    if (!text) {
      return res.status(400).send("Text is required");
    }
    const file = await synth(text);
    res.set("Content-Type", "audio/mpeg");
    res.sendFile(file);
  } catch (e) {
    console.warn("[tts]", e.message);
    res.status(500).end();
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", voice: "en-US-AnaNeural" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Voice server on http://localhost:${PORT}`));
