const { spawn } = require("child_process");
const path = require("path");
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
using System.Speech.Recognition;

public class SpeechWorker {
    private SpeechRecognitionEngine engine;

    public void Start() {
        try {
            engine = new SpeechRecognitionEngine();
            engine.SetInputToDefaultAudioDevice();
            engine.LoadGrammar(new DictationGrammar());
            engine.SpeechHypothesized += (s, e) => {
                if (e.Result != null && !string.IsNullOrWhiteSpace(e.Result.Text)) {
                    Console.WriteLine("{\\"type\\":\\"hypothesis\\",\\"text\\":\\"" + Escape(e.Result.Text) + "\\"}");
                }
            };
            engine.SpeechRecognized += (s, e) => {
                if (e.Result != null && !string.IsNullOrWhiteSpace(e.Result.Text)) {
                    Console.WriteLine("{\\"type\\":\\"final\\",\\"text\\":\\"" + Escape(e.Result.Text) + "\\"}");
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

      log.info("[SpeechService] Started native Windows speech recognition process (PID:", this.process.pid, ")");

      let buffer = "";
      this.process.stdout.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop(); // keep remainder

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("{")) continue;

          try {
            const data = JSON.parse(trimmed);
            if (data.type === "ready") {
              log.info("[SpeechService] Engine ready and listening");
            } else if (data.type === "hypothesis") {
              if (!this.isMuted && this.onHypothesis) {
                this.onHypothesis(data.text);
              }
            } else if (data.type === "final") {
              if (!this.isMuted && this.onFinal) {
                log.info("[SpeechService] Final recognition:", data.text);
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

        // Auto restart if still engaged
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
