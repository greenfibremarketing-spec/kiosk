const { spawn } = require("child_process");
const log = require("electron-log");

class SpeechService {
  constructor() {
    this.process = null;
    this.onHypothesis = null;
    this.onFinal = null;
    this.isMuted = false;
    this.isEngaged = false;
    this.restartTimer = null;
  }

  start({ onHypothesis, onFinal }) {
    this.onHypothesis = onHypothesis;
    this.onFinal = onFinal;
    this.isEngaged = true;

    if (this.process) return;

    const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$src = @"
using System;
using System.Globalization;
using System.Speech.Recognition;

public class SpeechWorker {
    private SpeechRecognitionEngine engine;

    public void Start() {
        try {
            engine = new SpeechRecognitionEngine();
            engine.SetInputToDefaultAudioDevice();

            // 1. Rich Kiosk Conversational Domain Grammar
            var greetings = new Choices(new string[] {
                "hello", "hi", "hey", "hey greenie", "hello greenie", "hi greenie",
                "good morning", "good afternoon", "good evening", "namaste", "how are you",
                "who are you", "what can you do", "help me", "tell me about yourself",
                "what is greenfibre", "about greenfibre"
            });

            var leadIns = new Choices(new string[] {
                "show me", "tell me about", "what is", "what are", "do you have",
                "can i see", "i want to see", "i want", "i need", "can you show",
                "can you tell me about", "how much is", "what is the price of",
                "tell me price of", "show all"
            });

            var items = new Choices(new string[] {
                "products", "all products", "catalog", "collection", "entire collection",
                "viora bottle", "viora", "eco bottle", "bottle", "bottles",
                "statement mug", "ceramic mug", "coffee mug", "mug", "mugs",
                "origin tumbler", "travel tumbler", "tumbler", "tumblers", "travel flask", "flask",
                "flora bowl", "salad bowl", "soup bowl", "bowl", "bowls",
                "zen bento", "bento box", "bento", "lunch box",
                "pantry canister", "canister", "canisters", "jar", "eco harvest canister",
                "terra desk", "desk valet", "desk organizer", "organizer",
                "luxury hamper", "gift hamper", "hamper", "hampers", "gift box",
                "gifts", "drinkware", "kitchen", "office", "dining", "stationery",
                "rice husk", "greenfibre", "bulk discount", "corporate gifts",
                "discounts", "pricing", "corporate orders", "custom branding"
            });

            var qBuilder = new GrammarBuilder();
            qBuilder.Append(leadIns);
            qBuilder.Append(items);

            var directQueries = new Choices(new string[] {
                "yes", "no", "sure", "thank you", "thanks", "bye", "goodbye",
                "bulk inquiry", "corporate pricing", "custom branding", "plastic free",
                "how much", "what is price", "show products", "show gifts", "show mugs",
                "show bottles", "show bowls", "tell me more"
            });

            var rootChoices = new Choices();
            rootChoices.Add(new GrammarBuilder(greetings));
            rootChoices.Add(qBuilder);
            rootChoices.Add(directQueries);

            var kioskGrammar = new Grammar(new GrammarBuilder(rootChoices));
            kioskGrammar.Name = "KioskIntents";
            kioskGrammar.Weight = 1.0f;
            engine.LoadGrammar(kioskGrammar);

            // 2. Freeform Dictation Grammar for general conversational queries
            var dictation = new DictationGrammar();
            dictation.Name = "FreeformDictation";
            dictation.Weight = 0.25f;
            engine.LoadGrammar(dictation);

            engine.SpeechHypothesized += (s, e) => {
                if (e.Result != null && !string.IsNullOrWhiteSpace(e.Result.Text)) {
                    var txt = e.Result.Text.Trim();
                    if (txt.Length > 1) {
                        Console.WriteLine("{\\"type\\":\\"hypothesis\\",\\"text\\":\\"" + Escape(txt) + "\\"}");
                    }
                }
            };

            engine.SpeechRecognized += (s, e) => {
                if (e.Result != null && !string.IsNullOrWhiteSpace(e.Result.Text)) {
                    var txt = e.Result.Text.Trim();
                    // Filter single characters and extreme phonetic noise
                    if (txt.Length > 1 && e.Result.Confidence >= 0.18f) {
                        Console.WriteLine("{\\"type\\":\\"final\\",\\"text\\":\\"" + Escape(txt) + "\\",\\"confidence\\":" + e.Result.Confidence.ToString(CultureInfo.InvariantCulture) + "}");
                    }
                }
            };

            engine.RecognizeAsync(RecognizeMode.Multiple);
            Console.WriteLine("{\\"type\\":\\"ready\\"}");
        } catch (Exception ex) {
            Console.WriteLine("{\\"type\\":\\"error\\",\\"message\\":\\"" + Escape(ex.Message) + "\\"}");
        }
    }

    public void Stop() {
        try {
            if (engine != null) {
                engine.RecognizeAsyncStop();
            }
        } catch {}
    }

    private string Escape(string s) {
        if (s == null) return "";
        return s.Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"").Replace("\\r", "").Replace("\\n", " ");
    }
}
"@

Add-Type -TypeDefinition $src -ReferencedAssemblies "System.Speech"
$worker = New-Object SpeechWorker
$worker.Start()

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($line -eq $null -or $line -eq "quit") {
        break
    }
}

$worker.Stop()
`;

    try {
      this.process = spawn("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy", "Bypass",
        "-Command", psScript
      ], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });

      log.info("[SpeechService] Started dual-grammar speech recognition (PID:", this.process.pid, ")");

      let buffer = "";
      this.process.stdout.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("{")) continue;

          try {
            const data = JSON.parse(trimmed);
            if (data.type === "ready") {
              log.info("[SpeechService] Engine ready with Kiosk + Dictation grammars");
            } else if (data.type === "hypothesis") {
              if (!this.isMuted && this.onHypothesis) {
                this.onHypothesis(data.text);
              }
            } else if (data.type === "final") {
              if (!this.isMuted && this.onFinal) {
                log.info("[SpeechService] Final recognition (confidence:", data.confidence, "):", data.text);
                this.onFinal(data.text);
              }
            } else if (data.type === "error") {
              log.warn("[SpeechService] Recognition notice:", data.message);
            }
          } catch (_) {}
        }
      });

      this.process.stderr.on("data", (err) => {
        log.warn("[SpeechService] stderr:", err.toString("utf8").trim());
      });

      this.process.on("exit", (code) => {
        log.info("[SpeechService] Process exited with code", code);
        this.process = null;

        if (this.isEngaged) {
          clearTimeout(this.restartTimer);
          this.restartTimer = setTimeout(() => {
            if (this.isEngaged && !this.process) {
              this.start({ onHypothesis: this.onHypothesis, onFinal: this.onFinal });
            }
          }, 1000);
        }
      });
    } catch (err) {
      log.error("[SpeechService] Failed to spawn powershell:", err);
    }
  }

  setMuted(muted) {
    this.isMuted = !!muted;
  }

  setEngaged(engaged) {
    this.isEngaged = !!engaged;
    if (!engaged && this.process) {
      this.stop();
    }
  }

  stop() {
    this.isEngaged = false;
    clearTimeout(this.restartTimer);
    if (this.process) {
      try {
        this.process.stdin.write("quit\n");
      } catch (_) {}
      setTimeout(() => {
        if (this.process) {
          try { this.process.kill(); } catch (_) {}
          this.process = null;
        }
      }, 500);
    }
  }
}

module.exports = new SpeechService();
