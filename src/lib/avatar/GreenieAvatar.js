import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { preferredVoice } from "./voice";
import { attachLipSync, getMouth, resetLipSync } from "../lipSync";

/**
 * Helper to build a cute fairy wing geometry
 */
function createWingShape(scale = 1.0) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.15 * scale, 0.35 * scale, 0.55 * scale, 0.75 * scale, 0.75 * scale, 0.55 * scale);
  shape.bezierCurveTo(0.9 * scale, 0.35 * scale, 0.7 * scale, -0.15 * scale, 0.35 * scale, -0.28 * scale);
  shape.bezierCurveTo(0.15 * scale, -0.22 * scale, 0.05 * scale, -0.08 * scale, 0, 0);
  return shape;
}

/**
 * Helper to build a 3D eco leaf geometry for grand opening burst
 */
function createLeafShape() {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.12);
  shape.quadraticCurveTo(0.1, 0, 0, 0.18);
  shape.quadraticCurveTo(-0.1, 0, 0, -0.12);
  return shape;
}

export class GreenieAvatar {
  constructor(
    container,
    {
      modelUrl = "/avatar/greenie.glb",
      onStatus = () => {},
      onSpeakingChange = () => {},
      onBoundary = () => {},
    } = {}
  ) {
    this.container = container;
    this.onStatus = onStatus;
    this.onSpeakingChange = onSpeakingChange;
    this.onBoundary = onBoundary;
    this.generation = 0;
    this.mode = "idle";
    this.started = 0;
    this.cues = [];
    this.detachLipSync = null;
    this.lastTickTime = 0;
    this.blinkStart = 0;
    this.nextBlink = 0;
    this.reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this._listening = false;
    this._engaged = false;
    this._arrived = false;
    this.waveStart = -10000;
    this.waveDuration = 2.0;
    this.reaction = null;
    this.flyingEntrance = null;
    this._hoverY = 0; // Flight hover height when explaining

    // Expression state (set via setExpression())
    this._expression = "attentive";
    this._expressionStart = 0;

    // Smooth continuous head rotations (Tilt strictly only when user speaks)
    this._headRotX = 0;
    this._headRotZ = 0;
    this._targetHeadX = 0;
    this._targetHeadZ = 0;

    // Smooth lerp targets for arm positions
    this._armRTarget = 0.24;
    this._armLTarget = -0.24;
    this._armRCurrent = 0.24;
    this._armLCurrent = -0.24;

    // 1. Scene & Camera Setup
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    this.camera.position.set(0, 1.8, 7.4);

    // 2. WebGL Renderer (Optimized for butter-smooth 60 FPS)
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(
      typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 1.25) : 1
    );
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    container.appendChild(this.renderer.domElement);

    // 3. Lighting
    this.scene.add(new THREE.HemisphereLight(0xf9f4e7, 0x415b51, 3));
    const key = new THREE.DirectionalLight(0xfff5e5, 5);
    key.position.set(-3, 5, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0xc7e9da, 3.5);
    rim.position.set(3, 3, -3);
    this.scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.1, 80),
      new THREE.ShadowMaterial({ opacity: 0.15 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.007;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // 4. Orbit Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.6, 0);
    this.controls.enablePan = false;
    this.controls.enableZoom = false;
    this.controls.minPolarAngle = 1.05;
    this.controls.maxPolarAngle = 1.7;
    this.controls.minAzimuthAngle = -0.7;
    this.controls.maxAzimuthAngle = 0.7;
    this.controls.enableDamping = true;

    // 5. Dynamic Resize Observer
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.container) return;
      const { width, height } = this.container.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      this.renderer.setSize(width, height);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    });
    this.resizeObserver.observe(container);

    // 6. 3D Leaves Particle System (Grand Opening Burst)
    this.leavesGroup = new THREE.Group();
    this.scene.add(this.leavesGroup);
    this.leafParticles = [];
    this.initLeafParticles();

    // 7. Model Loading & Cute Wings Attachment
    this.ready = new GLTFLoader()
      .loadAsync(modelUrl)
      .then(({ scene }) => {
        this.model = scene;
        this.scene.add(scene);
        this.head = scene.getObjectByName("Head");
        this.mouth = scene.getObjectByName("Mouth");
        this.smile = scene.getObjectByName("Smile");
        this.eyes = ["Eye_L", "Eye_R"]
          .map((n) => scene.getObjectByName(n))
          .filter(Boolean);
        this.eyes.forEach((eye) => {
          eye.userData.restPos = eye.position.clone();
          eye.userData.restScale = eye.scale.clone();
        });
        this.arm = scene.getObjectByName("Arm_R");
        this.leftArm = scene.getObjectByName("Arm_L");
        this.cheeks = [];
        scene.traverse((o) => {
          if (o.name && o.name.startsWith("Cheek")) {
            o.userData.restScale = o.scale.clone();
            this.cheeks.push(o);
          }
        });
        this.pigtails = ["Pigtail_L", "Pigtail_R"].map((n) =>
          scene.getObjectByName(n)
        );

        // Initialize cute kawaii smile & glowing cheeks
        if (this.smile) {
          this.smile.visible = true;
          this.smile.userData.restScale = this.smile.scale.clone();
          this.smile.userData.restPos = this.smile.position.clone();
          if (this.smile.material) {
            this.smile.material.color.set("#2a1810"); // warm natural smile line
          }
        }
        if (this.mouth) {
          this.mouth.visible = false;
          this.mouth.userData.restScale = this.mouth.scale.clone();
          this.mouth.userData.restPos = this.mouth.position.clone();
        }

        // Attach cute glowing fairy wings to Greenie's back
        this.attachCuteWings(scene);

        // If engaged or already arrived, position in center, otherwise off-screen
        if (this._arrived || this._engaged) {
          if (!this.flyingEntrance) {
            scene.position.x = 0.0;
            this._arrived = true;
          }
        } else {
          scene.position.x = -10.0;
        }

        this.setStatus("Ready");
        return this;
      })
      .catch((e) => {
        this.setStatus("Could not load Greenie avatar model.");
        console.error("GLTF load error:", e);
        throw e;
      });

    // 8. Tap-to-blush raycasting
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.pointerDown = (e) => {
      this.downPoint = { x: e.clientX, y: e.clientY };
    };
    this.pointerUp = (e) => {
      if (
        !this.model ||
        !this.downPoint ||
        Math.hypot(e.clientX - this.downPoint.x, e.clientY - this.downPoint.y) > 8
      )
        return;
      const r = this.renderer.domElement.getBoundingClientRect();
      this.pointer.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1
      );
      this.raycaster.setFromCamera(this.pointer, this.camera);
      if (this.raycaster.intersectObject(this.model, true).length) {
        this.react("blush");
      }
    };
    this.renderer.domElement.addEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.addEventListener("pointerup", this.pointerUp);

    // 9. Animation Render Loop
    this.tick = this.tick.bind(this);
    this.frame = requestAnimationFrame(this.tick);
  }

  /**
   * Builds and attaches cute translucent fairy wings to Greenie's back
   */
  attachCuteWings(root) {
    const wingMat = new THREE.MeshPhysicalMaterial({
      color: 0xa7f3d0,
      emissive: 0x34d399,
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.84,
      roughness: 0.12,
      metalness: 0.05,
      transmission: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const upperGeom = new THREE.ShapeGeometry(createWingShape(0.75));
    const lowerGeom = new THREE.ShapeGeometry(createWingShape(0.48));

    // Right Wing Group (Pivot at wing root)
    this.wingRGroup = new THREE.Group();
    const upperR = new THREE.Mesh(upperGeom, wingMat);
    upperR.rotation.z = -0.15;
    const lowerR = new THREE.Mesh(lowerGeom, wingMat);
    lowerR.position.set(0.05, -0.22, 0);
    lowerR.rotation.z = -0.55;
    this.wingRGroup.add(upperR);
    this.wingRGroup.add(lowerR);
    this.wingRGroup.position.set(0.2, 1.48, -0.26);

    // Left Wing Group (Mirrored on X)
    this.wingLGroup = new THREE.Group();
    const upperL = new THREE.Mesh(upperGeom, wingMat);
    upperL.scale.x = -1;
    upperL.rotation.z = 0.15;
    const lowerL = new THREE.Mesh(lowerGeom, wingMat);
    lowerL.scale.x = -1;
    lowerL.position.set(-0.05, -0.22, 0);
    lowerL.rotation.z = 0.55;
    this.wingLGroup.add(upperL);
    this.wingLGroup.add(lowerL);
    this.wingLGroup.position.set(-0.2, 1.48, -0.26);

    // Add wings to Greenie's model root
    root.add(this.wingRGroup);
    root.add(this.wingLGroup);
  }

  /**
   * Initializes 45 3D leaf confetti meshes for the grand opening entrance
   */
  initLeafParticles() {
    const leafGeom = new THREE.ShapeGeometry(createLeafShape());
    const colors = [0x22c55e, 0x4ade80, 0x16a34a, 0x86efac, 0xfacc15];

    for (let i = 0; i < 45; i++) {
      const col = colors[i % colors.length];
      const mat = new THREE.MeshStandardMaterial({
        color: col,
        roughness: 0.3,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(leafGeom, mat);
      mesh.visible = false;
      mesh.scale.setScalar(0.7 + Math.random() * 0.7);
      this.leavesGroup.add(mesh);
      this.leafParticles.push({
        mesh,
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        rotX: 0,
        rotY: 0,
        rotZ: 0,
        rotVx: 0,
        rotVy: 0,
        rotVz: 0,
        opacity: 0,
        life: 0,
        maxLife: 0,
      });
    }
  }

  /**
   * Triggers a magnificent burst of swirling green leaves across the scene
   */
  burstGrandOpeningLeaves() {
    this.leafParticles.forEach((p, i) => {
      p.active = true;
      p.mesh.visible = true;
      // Start near left entry zone along Greenie's flight path
      p.x = -4.0 + Math.random() * 2.5;
      p.y = 1.0 + Math.random() * 1.8;
      p.z = -1.0 + Math.random() * 2.0;

      // Swirling outward velocities
      const angle = (i / 45) * Math.PI * 2 + Math.random() * 0.5;
      const speed = 1.2 + Math.random() * 2.4;
      p.vx = Math.cos(angle) * speed + 1.2; // drift towards center
      p.vy = Math.sin(angle) * speed * 0.8 + 0.6;
      p.vz = (Math.random() - 0.5) * 2.2;

      p.rotX = Math.random() * Math.PI;
      p.rotY = Math.random() * Math.PI;
      p.rotZ = Math.random() * Math.PI;
      p.rotVx = (Math.random() - 0.5) * 8;
      p.rotVy = (Math.random() - 0.5) * 8;
      p.rotVz = (Math.random() - 0.5) * 8;

      p.opacity = 1;
      p.life = 0;
      p.maxLife = 2.6 + Math.random() * 1.4;
    });
  }

  setStatus(s) {
    this.onStatus(s);
  }

  setListening(active) {
    const wasListening = this._listening;
    this._listening = active;
    if (active && !wasListening) {
      this._listenStart = performance.now();
    }
  }

  /**
   * setExpression(name)
   * Drives avatar posture for each conversation state.
   * Expressions: "listening" | "thinking" | "speaking" | "attentive"
   * Smooth transitions ~200 ms via the continuous lerp in tick().
   */
  setExpression(name) {
    if (this._expression === name) return;
    this._expression = name;
    this._expressionStart = performance.now();
    if (name === "listening") {
      this._listenStart = performance.now();
    }
  }

  /**
   * setMorph(name, v)
   * Helper to set morph target weights across any meshes in the avatar model
   */
  setMorph(name, v) {
    if (!this.model) return;
    this.model.traverse((o) => {
      if (o.morphTargetDictionary && o.morphTargetInfluences) {
        const idx = o.morphTargetDictionary[name];
        if (idx !== undefined) {
          o.morphTargetInfluences[idx] = THREE.MathUtils.clamp(v, 0, 1);
        }
      }
    });
  }

  setMouth(shape = "rest", weight = 1) {
    const isRest = shape === "rest" || weight < 0.05;

    if (isRest) {
      // Idle / Resting: show sweet curved smile, hide the speaking mouth slit
      if (this.smile) this.smile.visible = true;
      if (this.mouth) {
        this.mouth.visible = false;
        if (this.mouth.morphTargetInfluences) {
          this.mouth.morphTargetInfluences.fill(0);
        }
      }
      this.setMorph("jawOpen", 0);
      this.setMorph("mouthFunnel", 0);
      this.setMorph("mouthPucker", 0);
      this.setMorph("mouthStretch", 0);
      this.setMorph("mouthSmile", 0);
      this.setMorph("mouthClose", 0);
      this.setMorph("browInnerUp", 0);
      this.setMorph("AA", 0);
      this.setMorph("EE", 0);
      this.setMorph("OH", 0);
      this.setMorph("FV", 0);
      this.setMorph("MBP", 0);
    } else {
      // Speaking / Phonemes: show animated mouth, hide smile to prevent double mouth
      if (this.smile) this.smile.visible = false;
      if (this.mouth) {
        this.mouth.visible = true;
        const restY = this.mouth.userData?.restScale?.y || 1.0;
        this.mouth.scale.y = (0.2 + weight * 0.8) * restY;
      }
      this.setMorph("jawOpen", weight * 0.75);
      this.setMorph(shape, weight);
    }
  }

  setEngaged(engaged) {
    this._engaged = !!engaged;
    if (!engaged) {
      this.flyingEntrance = null;
      this._arrived = false;
      this.stop();
      if (this.model) {
        this.model.position.x = -10.0;
      }
    } else {
      if (!this._arrived && !this.flyingEntrance) {
        this.flyIn(1.8);
      }
    }
  }

  // Flying entrance from the left like a fairy girl + leaf burst
  flyIn(duration = 1.8) {
    this._arrived = false;
    this.flyingEntrance = {
      start: performance.now(),
      duration: duration,
    };
    if (this.model) {
      this.model.position.x = -6.0;
    }
    this.burstGrandOpeningLeaves();
    this.setStatus("✨ Welcome to GreenFibre!");
  }

  // One-time hello wave
  wave(duration = 2.0) {
    this.waveStart = performance.now();
    this.waveDuration = duration;
  }

  react(kind = "blush") {
    if (!["blush", "wink", "dance", "nod", "bow"].includes(kind)) return;
    this.reaction = { kind, start: performance.now() };
    if (this.mode === "idle" || this._listening) {
      this.setStatus(
        kind === "blush"
          ? "Aww, you made me blush! 🌸"
          : kind === "wink"
          ? "A little wink for you! 😉"
          : kind === "bow"
          ? "Listening attentively... 🌿"
          : kind === "nod"
          ? "Uh-huh, I hear you! ✨"
          : "Happy eco dance! 💃"
      );
    }
  }

  stop() {
    this.generation++;
    this.started = 0;
    if (this.detachLipSync) {
      try {
        this.detachLipSync();
      } catch (_) {}
      this.detachLipSync = null;
    }
    resetLipSync();

    if (typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
    }
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio = null;
    }
    this.mode = "idle";
    this.reaction = null;
    this.waveStart = -10000;
    this._hoverY = 0; // instantly cancel flight hover
    this.setMouth();
    this.onSpeakingChange(false);
    this.setStatus("Listening...");
  }

  async speak(
    text,
    { voice = null, lang = "en-US", rate = 0.95, pitch = 1.15 } = {}
  ) {
    await this.ready;
    text = String(text || "").trim();
    if (!text) return;

    this.stop();
    this._arrived = true;
    if (this.model && this.model.position.x < -2.0 && !this.flyingEntrance) {
      this.model.position.x = 0;
    }
    const token = this.generation;
    this.text = text;

    // 1. Primary: EdgeTTS Ana Neural Voice from voice server (http://localhost:4000/api/tts)
    try {
      const res = await fetch(`http://localhost:4000/api/tts?text=${encodeURIComponent(text)}`);
      if (token !== this.generation) return;
      if (res.ok) {
        const blob = await res.blob();
        if (token !== this.generation) return;
        const url = URL.createObjectURL(blob);
        if (token !== this.generation) {
          URL.revokeObjectURL(url);
          return;
        }

        const audio = new Audio(url);
        this.audio = audio;
        this.mode = "audio";
        this.onSpeakingChange(true);
        this.setStatus("Explaining...");

        this.detachLipSync = attachLipSync(audio);

        const cleanupAudio = () => {
          if (this.detachLipSync) {
            try {
              this.detachLipSync();
            } catch (_) {}
            this.detachLipSync = null;
          }
          resetLipSync();
          URL.revokeObjectURL(url);
          if (token === this.generation) {
            this.mode = "idle";
            this.setMouth();
            this.onSpeakingChange(false);
            this.setStatus("Listening...");
          }
        };

        audio.onended = cleanupAudio;
        audio.onerror = cleanupAudio;

        await audio.play();
        return;
      }
    } catch (e) {
      console.warn("[Avatar] EdgeTTS Ana unavailable, falling back to Web Speech:", e?.message);
    }

    // 2. Fallback: Browser Web Speech API
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      this.setStatus("Speech synthesis not supported.");
      return;
    }

    this.charIndex = 0;
    this.boundaryAt = 0;
    this.rate = rate;

    const u = new SpeechSynthesisUtterance(text);
    this.utterance = u;
    u.lang = lang;
    u.rate = rate;
    u.pitch = pitch;

    // Load preferred voice
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      const selected = voice || preferredVoice(voices, lang);
      if (selected) {
        u.voice = selected;
        u.lang = selected.lang || lang || "en-IN";
      }
    };
    loadVoices();
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => {
        loadVoices();
        window.speechSynthesis.onvoiceschanged = null;
      };
    }

    u.onstart = () => {
      if (token !== this.generation) return;
      this.mode = "tts";
      this.started = performance.now();
      this.boundaryAt = this.started;
      this.onSpeakingChange(true);
      this.setStatus("Explaining...");
    };
    u.onboundary = (e) => {
      if (token !== this.generation) return;
      this.charIndex = e.charIndex;
      this.boundaryAt = performance.now();
      this.onBoundary(e.charIndex);
    };
    u.onend = () => {
      if (token !== this.generation) return;
      this.mode = "idle";
      this.setMouth();
      this.onSpeakingChange(false);
      this.setStatus("Listening...");
    };
    u.onerror = (e) => {
      if (token !== this.generation) return;
      this.mode = "idle";
      this.setMouth();
      this.onSpeakingChange(false);
      this.setStatus("Listening...");
    };

    this.mode = "tts";
    this.setStatus("Explaining...");
    
    // Resume audio stream and speak utterance
    setTimeout(() => {
      if (token === this.generation && typeof window !== "undefined") {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.speak(u);
      }
    }, 25);
  }

  async playSpeech(audioUrl, cues = []) {
    await this.ready;
    this.stop();
    const token = this.generation;
    const valid = new Set(["AA", "EE", "OH", "FV", "MBP", "rest"]);
    this.cues = cues
      .filter(
        (c) =>
          Number.isFinite(c.start) &&
          Number.isFinite(c.end) &&
          c.start >= 0 &&
          c.end > c.start &&
          valid.has(c.value)
      )
      .sort((a, b) => a.start - b.start);

    const audio = new Audio(audioUrl);
    this.audio = audio;
    this.mode = "audio";
    this.onSpeakingChange(true);

    audio.onended = () => {
      if (token === this.generation) {
        this.mode = "idle";
        this.setMouth();
        this.onSpeakingChange(false);
        this.setStatus("Listening...");
      }
    };
    audio.onerror = () => {
      if (token === this.generation) {
        this.mode = "idle";
        this.setMouth();
        this.onSpeakingChange(false);
        this.setStatus("Audio could not be loaded");
      }
    };

    try {
      await audio.play();
      if (token === this.generation) this.setStatus("Speaking...");
    } catch (e) {
      if (token === this.generation) {
        this.mode = "idle";
        this.setMouth();
        this.onSpeakingChange(false);
        this.setStatus("Audio playback blocked.");
      }
      throw e;
    }
  }

  tick(now) {
    this.frame = requestAnimationFrame(this.tick);
    if (!this.model) {
      if (this.controls) this.controls.update();
      if (this.renderer && this.scene && this.camera)
        this.renderer.render(this.scene, this.camera);
      return;
    }

    const currentTime = typeof now === "number" ? now : performance.now();
    const dt = this.lastTickTime
      ? Math.min(0.05, Math.max(0.001, (currentTime - this.lastTickTime) / 1000))
      : 0.016;
    this.lastTickTime = currentTime;

    const LERP = 0.08;

    // --- Reset base pose every frame ---
    if (!this._arrived && !this.flyingEntrance) {
      if (this._engaged) {
        this._arrived = true;
        this.model.position.x = 0;
      } else {
        this.model.position.x = -10.0;
      }
      this.model.position.y = 0;
      this.model.position.z = 0;
    } else {
      this.model.position.x = 0;
      this.model.position.y = 0;
      this.model.position.z = 0;
    }
    this.model.rotation.x = 0;
    this.model.rotation.y = 0;
    this.model.rotation.z = 0;

    // Base target head orientation: upright, strictly no tilt unless user is speaking
    this._targetHeadX = 0;
    this._targetHeadZ = 0;

    this._armRTarget = 0.24;
    this._armLTarget = -0.24;

    // Cute sweet strawberry-coral blush cheeks with gentle breathing pulse
    if (this.cheeks) {
      const blushPulse = Math.sin(currentTime / 900) * 0.04;
      this.cheeks.forEach((c) => {
        if (c?.material) {
          c.material.color.set("#ff5a84");
        }
        if (c?.userData?.restScale) {
          c.scale.set(
            c.userData.restScale.x * (1 + blushPulse),
            c.userData.restScale.y * (1 + blushPulse),
            c.userData.restScale.z
          );
        }
      });
    }

    if (this.pigtails && !this.reduced) {
      const t = currentTime / 1000;
      this.pigtails.forEach((p, i) => {
        if (p) p.rotation.z = Math.sin(t * 0.9 + i * Math.PI) * 0.012;
      });
    }

    // Natural cute blink animation
    if (this.eyes) {
      const t = currentTime / 1000;
      const b = t % 4.5;
      const blink = b > 4.3 ? Math.max(0.08, Math.abs(b - 4.4) / 0.1) : 1;
      this.eyes.forEach((x) => {
        if (x && x.userData?.restScale) {
          x.scale.set(
            x.userData.restScale.x,
            x.userData.restScale.y * blink,
            x.userData.restScale.z
          );
        }
      });
    }

    // Cheerful cute mascot smile curve
    if (this.smile && this.smile.visible) {
      this.smile.scale.set(1.0, 1.0, 1.0);
    }

    // =========================================================
    // HOVER FLIGHT & SPEAKING STATE EVALUATION
    // =========================================================
    const isSpeakingTTS =
      typeof window !== "undefined" &&
      window.speechSynthesis?.speaking &&
      !window.speechSynthesis?.paused &&
      this.started;
    const isSpeakingAudio = this.mode === "audio" && this.audio && !this.audio.paused;
    const isSpeaking = isSpeakingTTS || isSpeakingAudio;

    // Real-time formant-based viseme analysis (reads delayed audio live)
    const m = getMouth(isSpeaking, dt);
    const STYLE = 0.75;

    // Lifts up 0.52m into the air when explaining, glides softly back down when done
    const targetHover = isSpeaking && !this.flyingEntrance ? 0.52 : 0;
    this._hoverY += (targetHover - this._hoverY) * 0.055;
    const hoverBob =
      this._hoverY > 0.03
        ? Math.sin(currentTime / 380) * 0.08 * (this._hoverY / 0.52)
        : 0;

    if (!this.flyingEntrance) {
      this.model.position.y += this._hoverY + hoverBob;
    }

    // =========================================================
    // CUTE FAIRY WINGS FLUTTER
    // =========================================================
    const isAirborne = !!this.flyingEntrance || this._hoverY > 0.06;
    const wingSpeed = this.flyingEntrance ? 32 : isAirborne ? 42 : 160;
    const wingAmp = this.flyingEntrance ? 0.85 : isAirborne ? 0.72 : 0.22;
    const wingFlutter = Math.sin(currentTime / wingSpeed) * wingAmp;

    if (this.wingRGroup) {
      this.wingRGroup.rotation.y = 0.2 + wingFlutter;
      this.wingRGroup.rotation.x = isAirborne ? 0.22 : 0.05;
    }
    if (this.wingLGroup) {
      this.wingLGroup.rotation.y = -0.2 - wingFlutter;
      this.wingLGroup.rotation.x = isAirborne ? 0.22 : 0.05;
    }

    // Animated hand gestures & speaking cadence while explaining in mid-air (NO head tilt)
    if (isSpeaking && !this.flyingEntrance && !this.reaction && !this._waveActive) {
      this._armRTarget = 0.62 + Math.sin(currentTime / 320) * 0.35;
      this._armLTarget = -0.62 - Math.cos(currentTime / 360) * 0.28;
      // Stressed syllable emphasis head nod + subtle lifelike motion
      this._targetHeadX = -m.emph * 0.06 + Math.sin((currentTime / 1000) * 1.3) * 0.01;
      this._targetHeadZ = 0; // STRICTLY NO head tilt when avatar is speaking
    }

    // =========================================================
    // GRAND OPENING SWIRLING LEAVES PARTICLES
    // =========================================================
    this.leafParticles.forEach((p) => {
      if (!p.active) return;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        p.mesh.visible = false;
        return;
      }

      // Physics: drag + gravity
      p.vx *= 0.985;
      p.vy -= 0.025; // gentle gravity
      p.vz *= 0.985;

      p.x += p.vx * dt * 2.5;
      p.y += p.vy * dt * 2.5;
      p.z += p.vz * dt * 2.5;

      p.rotX += p.rotVx * dt;
      p.rotY += p.rotVy * dt;
      p.rotZ += p.rotVz * dt;

      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.rotation.set(p.rotX, p.rotY, p.rotZ);

      // Fade out smoothly
      const progress = p.life / p.maxLife;
      const alpha = progress < 0.2 ? progress / 0.2 : 1 - (progress - 0.2) / 0.8;
      p.mesh.material.opacity = THREE.MathUtils.clamp(alpha * 0.95, 0, 1);
    });

    // =========================================================
    // FLYING FAIRY GIRL ENTRANCE (from left to center)
    // =========================================================
    if (this.flyingEntrance) {
      const age = (now - this.flyingEntrance.start) / 1000;
      const dur = this.flyingEntrance.duration || 1.8;
      const progress = THREE.MathUtils.clamp(age / dur, 0, 1);

      if (progress >= 1) {
        this.flyingEntrance = null;
        this._arrived = true;
        this.model.position.x = 0;
        this.setStatus(
          isSpeaking
            ? "Explaining..."
            : this._listening
            ? "Listening..."
            : "Ready to chat"
        );
      } else {
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const invP = 1 - progress;

        this.model.position.x = -5.6 * (1 - easeOut);
        const flightLift = Math.sin(invP * Math.PI * 0.9) * 1.4;
        const landingBounce =
          progress > 0.82
            ? Math.sin(((progress - 0.82) / 0.18) * Math.PI) * 0.08
            : 0;
        this.model.position.y = flightLift + landingBounce;

        if (!this.reduced) {
          this.model.rotation.z = -0.32 * invP;
          this.model.rotation.y = 0.38 * invP;
          this.model.rotation.x = 0.16 * invP;
        }

        if (isSpeaking) {
          const gesture = Math.sin(now / 160) * 0.2;
          this._armLTarget = -1.25 * invP + (-0.5 + gesture) * progress;
          this._armRTarget = 1.25 * invP + (0.5 + gesture) * progress;
        } else {
          this._armLTarget = -1.45 * invP + -0.24 * progress;
          this._armRTarget = 1.45 * invP + 0.24 * progress;
        }

        if (this.pigtails && !this.reduced) {
          this.pigtails.forEach((p, i) => {
            if (p) p.rotation.z = Math.sin(now / 55 + i * Math.PI) * 0.45 * invP;
          });
        }

        if (this.cheeks) {
          this.cheeks.forEach((c) => c?.material?.color.set("#ff7096"));
        }
      }
    }

    // =========================================================
    // ACTIVE HUMAN-LIKE LISTENING GESTURES (Head tilts ONLY here)
    // =========================================================
    const isActivelyListening =
      (this._listening || this._expression === "listening") &&
      this.mode !== "tts" &&
      this.mode !== "audio" &&
      !this.flyingEntrance;

    if (isActivelyListening && !this._waveActive && !this.reaction) {
      const listenTime = (now - (this._listenStart || now)) / 1000;

      // Natural, graceful receptive arm pose held gently in front of torso with breathing
      const breathArm = Math.sin(listenTime * 2.2) * 0.03;
      this._armRTarget = 0.35 + breathArm;
      this._armLTarget = -0.35 - breathArm;

      // Natural human active-listening micro-nod cycles ("hmmhuu" nods) every ~2.0s
      const nodPhase = (listenTime % 2.0) / 2.0;
      const microNod =
        nodPhase < 0.35
          ? Math.sin(nodPhase * Math.PI * 2) * 0.05
          : 0;

      // ATTENTIVE HEAD TILT: Greenie tilts head ONLY when user speaks
      this._targetHeadX = 0.04 + microNod;
      this._targetHeadZ = 0.085 + Math.sin(listenTime * 1.5) * 0.015;

      if (this.model && !this.reduced) {
        // Slight respectful, attentive lean toward the customer
        this.model.rotation.x = THREE.MathUtils.lerp(this.model.rotation.x, 0.035, 0.08);
      }

      // Warm receptive strawberry blush while customer is speaking
      if (this.cheeks) {
        this.cheeks.forEach((c) => c?.material?.color.set("#ff5a84"));
      }
    }

    // =========================================================
    // WAVE: one-time hello after landing
    // =========================================================
    const waveElapsed = (now - this.waveStart) / 1000;
    this._waveActive = waveElapsed < this.waveDuration;
    if (this._waveActive) {
      this._armRTarget = 2.2 + Math.sin(waveElapsed * 8.5) * 0.3;
      this._armLTarget = -0.24;
    }

    // =========================================================
    // REACTIONS: dance / wink / blush / bow / nod
    // =========================================================
    if (this.reaction) {
      const age = (now - this.reaction.start) / 1000;
      let duration = 1.8;
      if (this.reaction.kind === "dance") duration = 2.8;
      else if (this.reaction.kind === "bow") duration = 0.9;
      else if (this.reaction.kind === "nod") duration = 1.1;

      const envelope = Math.sin(Math.PI * Math.min(age / duration, 1));

      if (age >= duration) {
        this.reaction = null;
        this.setStatus(this._listening ? "Listening..." : "Ready to chat");
      } else if (this.reaction.kind === "bow") {
        // Polite, respectful acknowledgement nod / bow ("sir bowing" gesture)
        this._targetHeadX = 0.22 * envelope;
        this._targetHeadZ = 0;
        if (this.model && !this.reduced) {
          this.model.rotation.x = 0.06 * envelope;
        }
        this._armRTarget = 0.34 + 0.12 * envelope;
        this._armLTarget = -0.34 - 0.12 * envelope;
      } else if (this.reaction.kind === "nod") {
        // Affirmative active listening double-nod ("hmmhuu / uh-huh" gesture)
        const doubleNod = Math.sin(age * 12.0) * envelope * 0.14;
        this._targetHeadX = 0.06 + doubleNod;
        this._targetHeadZ = 0;
      } else if (this.reaction.kind === "wink") {
        if (this.eyes && this.eyes[1] && this.eyes[1].userData?.restScale) {
          this.eyes[1].scale.y =
            (age > 0.25 && age < 1.2 ? 0.08 : 1) * this.eyes[1].userData.restScale.y;
        }
        this._targetHeadZ = 0;
      } else if (this.reaction.kind === "blush") {
        if (this.cheeks) {
          this.cheeks.forEach((c) => {
            if (c?.material)
              c.material.color.lerp(new THREE.Color("#f14982"), envelope);
          });
        }
        this._targetHeadX = 0.06 * envelope;
        this._targetHeadZ = 0;
      } else if (this.reaction.kind === "dance") {
        if (this.cheeks) {
          this.cheeks.forEach((c) => c?.material?.color.set("#ef7398"));
        }
        this._targetHeadZ = 0;
        if (!this.reduced) {
          this.model.position.y = Math.abs(Math.sin(age * 7)) * 0.15 * envelope;
          this.model.rotation.z = Math.sin(age * 8) * 0.1 * envelope;
          this._armLTarget = -0.24 - 0.9 * envelope;
          this._armRTarget = 0.24 + 0.9 * envelope;
          if (this.pigtails) {
            this.pigtails.forEach((p, i) => {
              if (p) p.rotation.z = Math.sin(age * 10 + i) * 0.2 * envelope;
            });
          }
        }
      }
    }

    // =========================================================
    // SMOOTH ARM LERP
    // =========================================================
    this._armRCurrent += (this._armRTarget - this._armRCurrent) * LERP;
    this._armLCurrent += (this._armLTarget - this._armLCurrent) * LERP;
    if (this.arm) this.arm.rotation.z = this._armRCurrent;
    if (this.leftArm) this.leftArm.rotation.z = this._armLCurrent;

    // =========================================================
    // EXPRESSION OVERLAY (convState-driven, 200 ms transition)
    // Applied on top of the listening/speaking poses above.
    // =========================================================
    if (!this.reduced && !this.reaction && !this.flyingEntrance) {
      const exAge = (now - this._expressionStart) / 1000;
      const exBlend = Math.min(1, exAge / 0.2); // 200 ms fade-in

      if (this._expression === "listening") {
        // Eyes forward, eyebrows raised (head tilt handled by isActivelyListening)
        if (this.eyes) {
          this.eyes.forEach((e) => {
            if (e && e.userData?.restPos) {
              e.position.x = THREE.MathUtils.lerp(e.position.x, e.userData.restPos.x, 0.08);
              e.position.y = THREE.MathUtils.lerp(e.position.y, e.userData.restPos.y, 0.08);
            }
          });
        }
      } else if (this._expression === "thinking") {
        // Eyes glance up-left, head upright (NO head tilt)
        this._targetHeadX = -0.05 * exBlend;
        this._targetHeadZ = 0;
        if (this.eyes) {
          this.eyes.forEach((e) => {
            if (e && e.userData?.restPos) {
              const glanceX = e.userData.restPos.x - 0.02 * exBlend;
              const glanceY = e.userData.restPos.y + 0.02 * exBlend;
              e.position.x = THREE.MathUtils.lerp(e.position.x, glanceX, 0.08);
              e.position.y = THREE.MathUtils.lerp(e.position.y, glanceY, 0.08);
            }
          });
        }
      } else {
        // speaking / attentive / idle: keep eyes at restPos and head upright
        this._targetHeadZ = 0;
        if (this.eyes) {
          this.eyes.forEach((e) => {
            if (e && e.userData?.restPos) {
              e.position.x = THREE.MathUtils.lerp(e.position.x, e.userData.restPos.x, 0.08);
              e.position.y = THREE.MathUtils.lerp(e.position.y, e.userData.restPos.y, 0.08);
            }
          });
        }
      }
    }

    // =========================================================
    // SMOOTH CONTINUOUS HEAD ROTATION LERP
    // =========================================================
    if (this.head && !this.reduced) {
      this._headRotX += (this._targetHeadX - this._headRotX) * 0.12;
      this._headRotZ += (this._targetHeadZ - this._headRotZ) * 0.12;
      this.head.rotation.x = this._headRotX;
      this.head.rotation.z = this._headRotZ;
    }

    // =========================================================
    // MOUTH & FACIAL LIP SYNC (Formant-based Real-time Engine)
    // =========================================================
    // 1. ARKit morph targets (jawOpen, mouthFunnel, mouthPucker, mouthStretch, mouthSmile, mouthClose, browInnerUp)
    this.setMorph("jawOpen", m.open * STYLE);
    this.setMorph("mouthFunnel", m.round * m.open);
    this.setMorph("mouthPucker", m.round * 0.5 * m.open);
    this.setMorph("mouthStretch", m.wide * 0.6 * m.open);
    this.setMorph("mouthSmile", m.wide * 0.35 * m.open);
    this.setMorph("mouthClose", (1 - m.open) * 0.3);
    this.setMorph("browInnerUp", m.emph * 0.5);

    // 2. Viseme morph targets (AA, EE, OH, FV, MBP)
    if (m.hiss > 0.35) {
      this.setMorph("FV", m.hiss * m.open);
      this.setMorph("MBP", 0);
      this.setMorph("OH", 0);
      this.setMorph("EE", 0);
      this.setMorph("AA", m.open * 0.4);
    } else if (m.round > 0.25) {
      this.setMorph("OH", m.round * m.open);
      this.setMorph("AA", m.open * 0.6);
      this.setMorph("EE", 0);
      this.setMorph("FV", 0);
      this.setMorph("MBP", 0);
    } else if (m.wide > 0.25) {
      this.setMorph("EE", m.wide * m.open);
      this.setMorph("AA", m.open * 0.5);
      this.setMorph("OH", 0);
      this.setMorph("FV", 0);
      this.setMorph("MBP", 0);
    } else if (m.open > 0.1) {
      this.setMorph("AA", m.open);
      this.setMorph("EE", 0);
      this.setMorph("OH", 0);
      this.setMorph("FV", 0);
      this.setMorph("MBP", 0);
    } else if (isSpeaking && m.open <= 0.1) {
      this.setMorph("MBP", (1 - m.open / 0.1) * 0.4);
      this.setMorph("AA", 0);
      this.setMorph("EE", 0);
      this.setMorph("OH", 0);
      this.setMorph("FV", 0);
    } else {
      this.setMorph("AA", 0);
      this.setMorph("EE", 0);
      this.setMorph("OH", 0);
      this.setMorph("FV", 0);
      this.setMorph("MBP", 0);
    }

    // 3. Dynamic mesh scaling for models with dedicated Mouth and Smile meshes
    if (this.mouth || this.smile) {
      if (isSpeaking && m.open > 0.06) {
        if (this.smile) this.smile.visible = false;
        if (this.mouth) {
          this.mouth.visible = true;
          const restY = this.mouth.userData?.restScale?.y || 1.0;
          const restX = this.mouth.userData?.restScale?.x || 1.0;
          const restZ = this.mouth.userData?.restScale?.z || 1.0;

          const scaleY = (0.12 + m.open * 0.95) * restY;
          const scaleX = (1.0 + m.wide * 0.35 - m.round * 0.25) * restX;
          this.mouth.scale.set(scaleX, scaleY, restZ);
        }
      } else {
        // Pauses or silence: display sweet smile curve, hide open mouth
        if (this.smile) {
          this.smile.visible = true;
          const restY = this.smile.userData?.restScale?.y || 1.0;
          const restX = this.smile.userData?.restScale?.x || 1.0;
          const restZ = this.smile.userData?.restScale?.z || 1.0;
          this.smile.scale.set(restX, restY, restZ);
        }
        if (this.mouth) {
          this.mouth.visible = false;
          if (this.mouth.userData?.restScale) {
            this.mouth.scale.copy(this.mouth.userData.restScale);
          }
        }
      }
    }

    if (this.controls) this.controls.update();
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose() {
    this.stop();
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.controls) this.controls.dispose();
    if (this.renderer?.domElement) {
      this.renderer.domElement.removeEventListener(
        "pointerdown",
        this.pointerDown
      );
      this.renderer.domElement.removeEventListener(
        "pointerup",
        this.pointerUp
      );
      this.renderer.domElement.remove();
    }
    if (this.scene) {
      this.scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m?.dispose?.());
        }
      });
    }
    if (this.renderer) this.renderer.dispose();
  }
}
