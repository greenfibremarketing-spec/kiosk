"use client";
import { useEffect, useRef, useState, useCallback } from "react";

const DEFAULT_CONFIG = {
  enterCm: 170,
  exitCm: 220,
  enterDwellMs: 250,
  exitGraceMs: 2000,
  focalPx: 580,
  fps: 8,
  cameraLabel: "",
  touchKeepEngagedMs: 10000
};

export function usePresenceDetection({ onEnterEngaged, onExitToIdle } = {}) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [state, setState] = useState("IDLE"); // "IDLE" | "ENGAGED"
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugStats, setDebugStats] = useState({
    facePx: 0,
    rawCm: 0,
    smoothCm: 0,
    fps: 0,
    facesCount: 0,
    isFacing: false,
    cameraActive: false
  });
  const [cameraError, setCameraError] = useState(null);

  const videoRef = useRef(null);
  const detectorRef = useRef(null);
  const streamRef = useRef(null);
  const smoothDistanceRef = useRef(150);
  const dwellStartRef = useRef(null);
  const graceStartRef = useRef(null);
  const touchExpiryRef = useRef(0);
  const lastTimestampRef = useRef(0);
  const cameraFailuresRef = useRef(0);
  const fpsCountRef = useRef({ frames: 0, lastCheck: Date.now(), currentFps: 0 });

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
    if (typeof window !== "undefined" && window.ipcRenderer?.send) {
      window.ipcRenderer.send("presence-state", newState);
    }
  }, []);

  // Screen touch keeps ENGAGED for touchKeepEngagedMs
  const triggerTouchEngaged = useCallback(() => {
    touchExpiryRef.current = Date.now() + (config.touchKeepEngagedMs || 30000);
    graceStartRef.current = null;
    if (state !== "ENGAGED") {
      updateMainState("ENGAGED");
      if (onEnterEngaged) onEnterEngaged();
    }
  }, [config.touchKeepEngagedMs, onEnterEngaged, state, updateMainState]);

  // Calibration helper: when C is pressed in debug mode
  const calibrate100Cm = useCallback(async () => {
    const currentPx = debugStats.facePx;
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
  }, [config, debugStats.facePx]);

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
        // Dynamically import local vision bundle or load via window
        const vision = await import("@mediapipe/tasks-vision");
        const { FaceDetector, FilesetResolver } = vision;

        const wasmFileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        if (!active) return;

        const detector = await FaceDetector.createFromOptions(wasmFileset, {
          baseOptions: {
            modelAssetPath: "/mediapipe/blaze_face_short_range.tflite",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.5
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
              delegate: "CPU"
            },
            runningMode: "VIDEO",
            minDetectionConfidence: 0.5
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
            frameRate: { ideal: 15 }
          },
          audio: false
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!isSubscribed) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
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
          console.error("Camera failed 3 times. Kiosk operating in touch-only mode.");
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

  // Main presence detection loop (~6 FPS)
  useEffect(() => {
    const targetInterval = Math.round(1000 / (config.fps || 6));
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
          if (!box || box.width <= 0) continue;

          // Head orientation check (compare nose keypoint to eye midpoint)
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
                  isFacingScreen = false; // Turned away
                }
              }
            }
          }

          if (isFacingScreen) {
            const facePx = box.width;
            const rawCm = Math.round(((15 * (config.focalPx || 580)) / facePx));
            validFaces.push({ facePx, rawCm, isFacing: true });
          }
        }

        // Pick the closest face (smallest rawCm)
        validFaces.sort((a, b) => a.rawCm - b.rawCm);
        const closest = validFaces[0] || null;

        let currentSmooth = smoothDistanceRef.current;
        let isPresentClose = false;

        if (closest) {
          currentSmooth = Math.round(0.4 * closest.rawCm + 0.6 * currentSmooth);
          smoothDistanceRef.current = currentSmooth;

          setDebugStats({
            facePx: Math.round(closest.facePx),
            rawCm: closest.rawCm,
            smoothCm: currentSmooth,
            fps: fpsCountRef.current.currentFps,
            facesCount: detections.length,
            isFacing: true,
            cameraActive: true
          });

          if (currentSmooth <= (config.enterCm || 170)) {
            isPresentClose = true;
          }
        } else {
          // No face detected -> immediately set smooth distance far
          currentSmooth = 300;
          smoothDistanceRef.current = 300;

          setDebugStats({
            facePx: 0,
            rawCm: 0,
            smoothCm: 300,
            fps: fpsCountRef.current.currentFps,
            facesCount: 0,
            isFacing: false,
            cameraActive: true
          });
        }

        // State Machine Decision Logic
        if (state === "IDLE") {
          if (isPresentClose) {
            if (!dwellStartRef.current) {
              dwellStartRef.current = now;
            } else if (now - dwellStartRef.current >= (config.enterDwellMs || 250)) {
              // Person stood in front of kiosk -> Switch to ENGAGED (Greenie arrives)
              dwellStartRef.current = null;
              updateMainState("ENGAGED");
              if (onEnterEngaged) onEnterEngaged();
            }
          } else {
            dwellStartRef.current = null;
          }
        } else if (state === "ENGAGED") {
          // Check exit condition: no face detected or person moved past exitCm
          const isFarOrGone = !closest || currentSmooth > (config.exitCm || 220);

          if (isFarOrGone) {
            const isTouchActive = now < touchExpiryRef.current;
            const graceRequired = isTouchActive ? 5000 : (config.exitGraceMs || 2000);

            if (!graceStartRef.current) {
              graceStartRef.current = now;
            } else if (now - graceStartRef.current >= graceRequired) {
              // Absence confirmed for 2s -> Switch back to IDLE (Promo attract video)
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
  }, [config, onEnterEngaged, onExitToIdle, state, updateMainState]);

  return {
    state,
    videoRef,
    config,
    debugOpen,
    debugStats,
    cameraError,
    triggerTouchEngaged,
    setDebugOpen,
    calibrate100Cm
  };
}
