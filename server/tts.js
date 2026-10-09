import { EdgeTTS } from "node-edge-tts";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const VOICE = "en-US-AnaNeural";
const CACHE = path.join(os.tmpdir(), "greenie-tts");
fs.mkdirSync(CACHE, { recursive: true });

export async function synth(text) {
  const clean = String(text).slice(0, 500);
  const file = path.join(CACHE, crypto.createHash("md5").update(VOICE + clean).digest("hex") + ".mp3");
  if (fs.existsSync(file)) return file;

  const tts = new EdgeTTS({
    voice: VOICE,
    lang: "en-US",
    outputFormat: "audio-24khz-48kbitrate-mono-mp3",
  });
  await tts.ttsPromise(clean, file);
  return file;
}
