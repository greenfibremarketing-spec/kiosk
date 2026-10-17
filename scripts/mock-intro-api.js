/**
 * Standalone Mock API Server for Kiosk Intro Videos & Player
 *
 * Runs on port 5000 (plain Node.js, zero dependencies)
 * Usage: npm run mock:intro
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 5000;
const TEST_VIDEOS_DIR = path.join(__dirname, "..", "public", "test-videos");
const PROMO_FALLBACK = path.join(__dirname, "..", "public", "videos", "promo.mp4");

// Exact remote intro-player.js implementation
const INTRO_PLAYER_JS = `// Use a dedicated container; hide Greeny until this promise completes.
export async function playKioskIntro(container, { apiBase = "", signal } = {}) {
    try {
        const response = await fetch(\`\${apiBase.replace(/\\/$/, "")}/media/intro-videos\`, { signal });
        if (!response.ok) return "intro_failed";
        return await playIntroPlaylist(container, await response.json(), { signal });
    } catch {
        return signal?.aborted ? "intro_skipped" : "intro_failed";
    }
}

export function playIntroPlaylist(container, playlist, { signal } = {}) {
    return new Promise(resolve => {
        if (!container || !playlist?.videos?.length) return resolve("intro_failed");
        if (signal?.aborted) return resolve("intro_skipped");
        const host = document.createElement("div");
        host.style.cssText = "position:relative;width:100%;height:100%;background:#000;";
        const video = document.createElement("video");
        video.muted = true; // Muted autoplay works without a prior user gesture.
        video.playsInline = true;
        video.autoplay = true;
        video.preload = "metadata";
        video.style.cssText = "display:block;width:100%;height:100%;object-fit:contain;";
        video.setAttribute("aria-label", "GreenFibre welcome videos");
        const skip = document.createElement("button");
        skip.type = "button";
        skip.textContent = "Meet Greeny";
        skip.style.cssText = "position:absolute;bottom:24px;right:24px;padding:12px 20px;border:0;border-radius:8px;background:#fff;color:#14532d;font:inherit;cursor:pointer;";
        host.append(video, skip);
        container.append(host);
        let index = -1, failed = 0, finished = false, generation = 0;
        let stallTimer, limitTimer;
        const clearTimers = () => { clearTimeout(stallTimer); clearTimeout(limitTimer); };
        const finish = event => {
            if (finished) return;
            finished = true;
            clearTimers();
            signal?.removeEventListener("abort", abort);
            video.onended = video.onerror = video.onwaiting = video.onstalled = video.onplaying = null;
            video.pause();
            video.removeAttribute("src");
            video.load();
            host.remove();
            resolve(event);
        };
        const abort = () => finish("intro_skipped");
        const next = (didFail = false, expected = generation) => {
            if (finished || expected !== generation) return;
            clearTimers();
            if (didFail) failed++;
            index++;
            generation++;
            if (index >= playlist.videos.length) {
                finish(failed === playlist.videos.length ? "intro_failed" : "intro_done");
                return;
            }
            const current = generation;
            video.onended = () => next(false, current);
            video.onerror = () => next(true, current);
            const wait = () => {
                clearTimeout(stallTimer);
                stallTimer = setTimeout(() => next(true, current), 15000);
            };
            video.onwaiting = video.onstalled = wait;
            video.onplaying = () => clearTimeout(stallTimer);
            // A failed/stalled media source must not indefinitely block Greeny.
            wait();
            limitTimer = setTimeout(() => next(true, current), 180000);
            video.src = playlist.videos[index].url;
            video.load();
            video.play().catch(() => next(true, current));
        };
        skip.onclick = abort;
        signal?.addEventListener("abort", abort, { once: true });
        next();
    });
}
`;

function serveVideoFile(filePath, req, res) {
  if (!fs.existsSync(filePath)) {
    if (fs.existsSync(PROMO_FALLBACK)) {
      filePath = PROMO_FALLBACK;
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Video Not Found");
      return;
    }
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    // Parse range e.g. "bytes=0-1024"
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
      res.writeHead(416, {
        "Content-Range": `bytes */${fileSize}`,
      });
      res.end();
      return;
    }

    const chunksize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunksize,
      "Content-Type": "video/mp4",
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Accept-Ranges": "bytes",
      "Content-Type": "video/mp4",
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

const server = http.createServer((req, res) => {
  // CORS Headers on every response
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = reqUrl.pathname;

  console.log(`[MockIntroAPI] ${req.method} ${pathname}`);

  // Endpoint 1: Remote Module intro-player.js
  if (pathname === "/media/intro-player.js") {
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
    res.end(INTRO_PLAYER_JS);
    return;
  }

  // Endpoint 2: Playlist JSON /media/intro-videos
  if (pathname === "/media/intro-videos") {
    let videoFiles = [];
    if (fs.existsSync(TEST_VIDEOS_DIR)) {
      videoFiles = fs
        .readdirSync(TEST_VIDEOS_DIR)
        .filter((f) => f.endsWith(".mp4"))
        .sort();
    }

    // Default to at least 4 videos if test-videos is empty
    if (videoFiles.length === 0) {
      videoFiles = ["video1.mp4", "video2.mp4", "video3.mp4", "video4.mp4"];
    }

    const videos = videoFiles.map((file, idx) => ({
      id: `mock-v${idx + 1}`,
      title: `Mock Intro Video ${idx + 1} (${file})`,
      url: `http://localhost:${PORT}/media/test-videos/${file}`,
      type: "video/mp4",
    }));

    const responseBody = JSON.stringify(
      {
        version: 1,
        playback: {
          autoplay: true,
          muted: true,
          plays_inline: true,
          loop: false,
          allow_skip: true,
        },
        videos,
        completion_events: ["intro_done", "intro_skipped", "intro_failed"],
      },
      null,
      2
    );

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(responseBody);
    return;
  }

  // Endpoint 3: Stream video files
  if (pathname.startsWith("/media/test-videos/") || pathname.startsWith("/test-videos/")) {
    const filename = path.basename(pathname);
    const filePath = path.join(TEST_VIDEOS_DIR, filename);
    serveVideoFile(filePath, req, res);
    return;
  }

  // Default Info / Health
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      status: "ok",
      endpoints: {
        intro_player: `http://localhost:${PORT}/media/intro-player.js`,
        intro_videos: `http://localhost:${PORT}/media/intro-videos`,
        video_stream: `http://localhost:${PORT}/media/test-videos/video1.mp4`,
      },
    })
  );
});

server.listen(PORT, () => {
  console.log(`\n============================================================`);
  console.log(`  Kiosk Mock Intro API Server running at http://localhost:${PORT}`);
  console.log(`  - Playlist API:   http://localhost:${PORT}/media/intro-videos`);
  console.log(`  - Player Module:  http://localhost:${PORT}/media/intro-player.js`);
  console.log(`  - Serving videos: ${TEST_VIDEOS_DIR}`);
  console.log(`============================================================\n`);
});
