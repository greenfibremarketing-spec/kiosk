"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { trace } from "@/lib/debugTrace";
import {
  PRESENCE_CONFIG,
  ENTER_DISTANCE_CM,
  EXIT_DISTANCE_CM,
  ENTER_STABLE_MS,
  FOCAL_PX,
  FACE_REAL_WIDTH_CM,
  MIN_FACE_WIDTH_PX,
} from "@/lib/presenceConfig";

const DEFAULT_CONFIG = {
  enterCm: ENTER_DISTANCE_CM,
  exitCm: EXIT_DISTANCE_CM,
  enterDwellMs: ENTER_STABLE_MS,
  exitGraceMs: 8000,
  focalPx: FOCAL_PX,
  faceRealWidthCm: FACE_REAL_WIDTH_CM,
  minFaceWidthPx: MIN_FACE_WIDTH_PX,
  fps: 8,
  cameraLabel: "",
  touchKeepEngagedMs: 60000,
};

export function usePresenceDetection({ onEnterEngaged, onExitToIdle } = {}) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [state, setState] = useState("IDLE"); // "IDLE" | "ENGAGED"
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugStats, setDebugStats] = useState({
    facePx: 0,
    rawCm: 0,
    smoothCm: 150,
    fps: 0,
    facesCount: 0,
    isFacing: false,
    cameraActive: false,
  });
  const [cameraError, setCameraError] = useState(null);

  const videoRef = useRef(null);
  const detectorRef = useRef(null);
  const streamRef = useRef(null);
  const smoothDistanceRef = useRef(150);
  const dwellStartRef = useRef(null);
  const graceStartRef = useRef(null);
  const touchExpiryRef = useRef(0);
  const lastCalibrationLogRef = useRef(0);
  const lastTimestampRef = useRef(0);
  const cameraFailuresRef = useRef(0);
  const fpsCountRef = useRef({ frames: 0, lastCheck: Date.now(), currentFps: 0 });

  // Single ref for fused human presence tracking
  const lastFaceAtRef = useRef(0);
  const consecutiveMissesRef = useRef(0);
  const lastDetectionTimeRef = useRef(0);
  const debugStatsRef = useRef({
    facePx: 0,
    rawCm: 0,
    smoothCm: 150,
    fps: 0,
    facesCount: 0,
    isFacing: false,
    cameraActive: false,
  });
  const lastDebugUpdateRef = useRef(0);

  // Load config on mount
  useEffect(() => {
    async function loadInitialConfig() {
      if (typeof window !== "undefined" && window.kiosk?.getConfig) {
        try {
          const loaded = await window.kiosk.getConfig();
          if (loaded) setConfig({ ...DEFAULT_CONFIG, ...loaded });
        } catch (e) {
          console.warn("Could not load config via IPC:", e);
        }
      }
    }
    loadInitialConfig();
  }, []);

  // Update Main process presence state via IPC
  const updateMainState = useCallback((newState) => {
    setState(newState);
    if (typeof window !== "undefined") {
      if (window.kiosk?.sendPresenceState) {
        window.kiosk.sendPresenceState(newState);
      } else if (window.ipcRenderer?.send) {
        window.ipcRenderer.send("presence-state", newState);
      }
    }
  }, []);

  // Screen touch keeps ENGAGED for touchKeepEngagedMs
  const triggerTouchEngaged = useCallback(() => {
    touchExpiryRef.current = Date.now() + (config.touchKeepEngagedMs || 60000);
    graceStartRef.current = null;
    if (state !== "ENGAGED") {
      updateMainState("ENGAGED");
      if (onEnterEngaged) onEnterEngaged();
    }
  }, [config.touchKeepEngagedMs, onEnterEngaged, state, updateMainState]);

  // Force reset state to IDLE on session reset
  const forceResetToIdle = useCallback(() => {
    touchExpiryRef.current = 0;
    dwellStartRef.current = null;
    graceStartRef.current = null;
    smoothDistanceRef.current = 150;
    consecutiveMissesRef.current = 0;
    updateMainState("IDLE");
  }, [updateMainState]);

  // Calibration helper: when C is pressed in debug mode
  const calibrate100Cm = useCallback(async () => {
    const currentPx = debugStatsRef.current.facePx;
    if (currentPx > 20) {
      const newFocalPx = Math.round((100 * currentPx) / 15);
      const updated = { ...config, focalPx: newFocalPx };
      setConfig(updated);
      if (typeof window !== "undefined" && window.kiosk?.saveConfig) {
        await window.kiosk.saveConfig(updated);
      }
      return newFocalPx;
    }
    return null;
  }, [config]);

  // Keyboard shortcuts: Ctrl+Shift+D (toggle debug) and C (calibrate)
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setDebugOpen((prev) => !prev);
      } else if (e.key.toLowerCase() === "c" && debugOpen) {
        calibrate100Cm();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [calibrate100Cm, debugOpen]);



  // Initialize MediaPipe FaceDetector using local files
  useEffect(() => {
    let active = true;

    async function initMediaPipe() {
      try {
        const vision = await import("@mediapipe/tasks-vision");
        const { FaceDetector, FilesetResolver } = vision;

        const wasmFileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        if (!active) return;

        const detector = await FaceDetector.createFromOptions(wasmFileset, {
          baseOptions: {
            modelAssetPath: "/mediapipe/blaze_face_short_range.tflite",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.5,
        });

        if (active) {
          detectorRef.current = detector;
        }
      } catch (err) {
        console.warn("MediaPipe GPU delegate init failed, falling back to CPU:", err);
        try {
          const vision = await import("@mediapipe/tasks-vision");
          const { FaceDetector, FilesetResolver } = vision;
          const wasmFileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
          if (!active) return;
          const detector = await FaceDetector.createFromOptions(wasmFileset, {
            baseOptions: {
              modelAssetPath: "/mediapipe/blaze_face_short_range.tflite",
              delegate: "CPU",
            },
            runningMode: "VIDEO",
            minDetectionConfidence: 0.5,
          });
          if (active) detectorRef.current = detector;
        } catch (cpuErr) {
          console.error("Critical: MediaPipe could not be initialized:", cpuErr);
          setCameraError("Vision engine unavailable");
        }
      }
    }

    initMediaPipe();

    return () => {
      active = false;
      if (detectorRef.current) {
        try {
          detectorRef.current.close();
        } catch (_) {}
      }
    };
  }, []);

  // Camera stream lifecycle
  useEffect(() => {
    let isSubscribed = true;

    async function startCamera() {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }

        const constraints = {
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 15 },
          },
          audio: false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!isSubscribed) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        stream.getVideoTracks().forEach((track) => {
          track.addEventListener("ended", () => {
            trace("camera_track_ended", { id: track.id, label: track.label, readyState: track.readyState });
          });
          track.addEventListener("mute", () => {
            trace("camera_track_mute", { id: track.id, label: track.label, muted: track.muted });
          });
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraError(null);
        cameraFailuresRef.current = 0;
      } catch (err) {
        console.warn("Camera getUserMedia error:", err);
        setCameraError("Camera unavailable");
        cameraFailuresRef.current += 1;
        if (cameraFailuresRef.current >= 3) {
          console.error("Camera failed 3 times. Kiosk operating in touch/voice-only mode.");
        }
      }
    }

    startCamera();

    return () => {
      isSubscribed = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [config.cameraLabel]);

  // Listen for video stalled and waiting events (Requirement 3)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onStalled = () => trace("video_stalled", { readyState: video.readyState, currentTime: video.currentTime });
    const onWaiting = () => trace("video_waiting", { readyState: video.readyState, currentTime: video.currentTime });
    video.addEventListener("stalled", onStalled);
    video.addEventListener("waiting", onWaiting);
    return () => {
      video.removeEventListener("stalled", onStalled);
      video.removeEventListener("waiting", onWaiting);
    };
  }, [videoRef.current]);

  // Periodic Camera & Presence Health Monitoring (Requirement 3: every 5s)
  const prevVideoCurrentTimeRef = useRef(0);
  useEffect(() => {
    const timer = setInterval(() => {
      const video = videoRef.current;
      const track = streamRef.current?.getVideoTracks()?.[0];
      const curTime = video ? video.currentTime : 0;
      const currentTimeAdvanced = curTime > prevVideoCurrentTimeRef.current;
      prevVideoCurrentTimeRef.current = curTime;
      const now = Date.now();
      const lastFaceResultAgoMs = lastFaceAtRef.current > 0 ? now - lastFaceAtRef.current : null;
      const detectionFps = fpsCountRef.current?.currentFps || debugStatsRef.current?.fps || 0;

      trace("camera", {
        trackReadyState: track?.readyState ?? null,
        trackMuted: track?.muted ?? null,
        trackEnabled: track?.enabled ?? null,
        videoPaused: video ? Boolean(video.paused) : null,
        videoReadyState: video ? video.readyState : null,
        videoCurrentTime: curTime,
        currentTimeAdvanced,
        lastFaceResultAgoMs,
        detectionFps,
      });
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Main presence detection loop (~8 FPS)
  useEffect(() => {
    const targetInterval = Math.round(1000 / (config.fps || 8));
    let timerId = null;

    function processFrame() {
      const now = Date.now();
      const perfNow = performance.now();
      const video = videoRef.current;
      const detector = detectorRef.current;

      // Update FPS stats
      fpsCountRef.current.frames += 1;
      if (now - fpsCountRef.current.lastCheck >= 1000) {
        fpsCountRef.current.currentFps = fpsCountRef.current.frames;
        fpsCountRef.current.frames = 0;
        fpsCountRef.current.lastCheck = now;
      }

      if (!video || video.readyState < 2 || !detector || video.paused) {
        timerId = setTimeout(processFrame, targetInterval);
        return;
      }

      if (perfNow <= lastTimestampRef.current) {
        timerId = setTimeout(processFrame, targetInterval);
        return;
      }
      lastTimestampRef.current = perfNow;

      try {
        const detections = detector.detectForVideo(video, perfNow).detections || [];
        let validFaces = [];

        for (const face of detections) {
          const box = face.boundingBox;
          const minPx = config.minFaceWidthPx || MIN_FACE_WIDTH_PX;
          if (!box || box.width < minPx) continue; // Ignore tiny false positives / faces too small

          const facePx = box.width;
          const focal = config.focalPx || FOCAL_PX;
          const realWidth = config.faceRealWidthCm || FACE_REAL_WIDTH_CM;
          const rawCm = Math.round((realWidth * focal) / facePx);
          const exitLimit = config.exitCm || EXIT_DISTANCE_CM;
          if (rawCm > exitLimit) continue; // Ignore bystanders beyond exitCm

          // Head orientation check (used for ATTENTION, NOT presence)
          let isFacingScreen = true;
          if (face.keypoints && face.keypoints.length >= 3) {
            const rightEye = face.keypoints[0];
            const leftEye = face.keypoints[1];
            const nose = face.keypoints[2];
            if (rightEye && leftEye && nose) {
              const eyeMidX = (rightEye.x + leftEye.x) / 2;
              const eyeDist = Math.abs(leftEye.x - rightEye.x);
              if (eyeDist > 0.05) {
                const noseOffset = Math.abs(nose.x - eyeMidX) / eyeDist;
                if (noseOffset > 0.55) {
                  isFacingScreen = false; // Turned away, but still physically present!
                }
              }
            }
          }

          // Presence != facing: looking sideways or down at screen counts as present
          validFaces.push({ facePx, rawCm, isFacing: isFacingScreen });
        }

        // Pick closest face
        validFaces.sort((a, b) => a.rawCm - b.rawCm);
        const closest = validFaces[0] || null;

        let currentSmooth = smoothDistanceRef.current;
        let isPresentClose = false;

        const enterLimit = config.enterCm || ENTER_DISTANCE_CM;

        if (closest) {
          consecutiveMissesRef.current = 0;
          lastDetectionTimeRef.current = now;
          lastFaceAtRef.current = now;

          currentSmooth = Math.round(0.4 * closest.rawCm + 0.6 * currentSmooth);
          smoothDistanceRef.current = currentSmooth;

          // Calibration log: throttled to 1s so staff can stand at 150cm and tune focalPx
          if (now - lastCalibrationLogRef.current >= 1000) {
            lastCalibrationLogRef.current = now;
            console.log(
              `[Presence Calibration] Distance: ${closest.rawCm}cm (smooth: ${currentSmooth}cm) | ` +
              `faceWidth: ${Math.round(closest.facePx)}px | focalPx: ${config.focalPx || FOCAL_PX} | ` +
              `enterLimit: <=${enterLimit}cm | isClose: ${currentSmooth <= enterLimit}`
            );
          }

          if (currentSmooth <= enterLimit) {
            isPresentClose = true;
          }

          debugStatsRef.current = {
            facePx: Math.round(closest.facePx),
            rawCm: closest.rawCm,
            smoothCm: currentSmooth,
            focalPx: config.focalPx || FOCAL_PX,
            enterCm: enterLimit,
            exitCm: config.exitCm || EXIT_DISTANCE_CM,
            fps: fpsCountRef.current.currentFps,
            facesCount: detections.length,
            isFacing: closest.isFacing,
            cameraActive: true,
          };
        } else {
          consecutiveMissesRef.current += 1;
          const timeSinceDetection = now - lastDetectionTimeRef.current;

          // Flicker tolerance: only declare face gone after 1500 ms OR 5 consecutive misses
          if (timeSinceDetection >= 1500 || consecutiveMissesRef.current >= 5) {
            currentSmooth = 300;
            smoothDistanceRef.current = 300;

            debugStatsRef.current = {
              facePx: 0,
              rawCm: 0,
              smoothCm: 300,
              focalPx: config.focalPx || FOCAL_PX,
              enterCm: enterLimit,
              exitCm: config.exitCm || EXIT_DISTANCE_CM,
              fps: fpsCountRef.current.currentFps,
              facesCount: 0,
              isFacing: false,
              cameraActive: true,
            };
          } else {
            // Keep previous smooth distance during brief detection blip
            debugStatsRef.current.fps = fpsCountRef.current.currentFps;
            debugStatsRef.current.facesCount = 0;
            if (currentSmooth <= enterLimit) {
              isPresentClose = true;
            }
          }
        }

        // Throttle React state updates: only when debug panel is open or max 2x/second
        if (debugOpen || now - lastDebugUpdateRef.current >= 500) {
          lastDebugUpdateRef.current = now;
          setDebugStats({ ...debugStatsRef.current });
        }

        // State Machine Decision Logic
        if (state === "IDLE") {
          if (isPresentClose) {
            if (!dwellStartRef.current) {
              dwellStartRef.current = now;
            } else if (now - dwellStartRef.current >= (config.enterDwellMs || ENTER_STABLE_MS)) {
              // Person stood in front of kiosk within enterCm for ENTER_STABLE_MS (500ms) -> Switch to ENGAGED
              dwellStartRef.current = null;
              updateMainState("ENGAGED");
              if (onEnterEngaged) onEnterEngaged();
            }
          } else {
            dwellStartRef.current = null;
          }
        } else if (state === "ENGAGED") {
          const isFarOrGone = currentSmooth > (config.exitCm || EXIT_DISTANCE_CM);

          if (isFarOrGone) {
            const isTouchActive = now < touchExpiryRef.current;
            const graceRequired = isTouchActive
              ? (config.touchKeepEngagedMs || 60000)
              : (config.exitGraceMs || 8000);

            if (!graceStartRef.current) {
              graceStartRef.current = now;
            } else if (now - graceStartRef.current >= graceRequired) {
              // Absence confirmed -> Switch back to IDLE
              graceStartRef.current = null;
              touchExpiryRef.current = 0;
              updateMainState("IDLE");
              if (onExitToIdle) onExitToIdle();
            }
          } else {
            graceStartRef.current = null;
          }
        }
      } catch (err) {
        console.warn("Error running face detection frame:", err);
      }

      timerId = setTimeout(processFrame, targetInterval);
    }

    timerId = setTimeout(processFrame, targetInterval);

    return () => clearTimeout(timerId);
  }, [config, debugOpen, onEnterEngaged, onExitToIdle, state, updateMainState]);

  return {
    state,
    videoRef,
    config,
    debugOpen,
    debugStats,
    cameraError,
    triggerTouchEngaged,
    forceResetToIdle,
    setDebugOpen,
    calibrate100Cm,
    lastFaceAtRef,
    debugStatsRef,
  };
}
