// ══════════════════════════════════════════════════════════════════════════════
//  ObsidianCity3D — Frontend v1.0
//  Connects to http://localhost:3333/api/vault and builds city from real data
// ══════════════════════════════════════════════════════════════════════════════

const API = "http://localhost:3333/api/vault";
const WS = "ws://localhost:3333";
const canvas = document.getElementById("c");

// ── WEATHER & TIME SYSTEM ─────────────────────────────────────────────────────
let worldTime = {
  hour: 12, // 0-23 from actual time
  minute: 0,
  second: 0,
  sunPosition: new THREE.Vector3(),
  useRealTime: true, // use actual system time
};

let weatherSystem = {
  type: "sunny", // sunny, cloudy, rainy
  intensity: 0.5,
  transition: 0,
  nextChange: 0,
  rainParticles: [],
  // Real weather data
  realWeather: {
    temperature: 20,
    windSpeed: 5,
    humidity: 60,
    code: 0, // WMO weather code
    description: "Sunny",
  },
  lastUpdate: 0,
  updateInterval: 3600000, // 1 hour in milliseconds
};

// Initialize time from system clock
function initializeTime() {
  updateTimeFromSystemClock();
}

// Update time from actual system clock
function updateTimeFromSystemClock() {
  const now = new Date();
  worldTime.hour = now.getHours();
  worldTime.minute = now.getMinutes();
  worldTime.second = now.getSeconds();
}

// ── REAL WEATHER SYSTEM (Geolocation + Open-Meteo API) ──────────────────────
let userLocation = { lat: 0, lon: 0, loaded: false };

function requestLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      console.warn("Geolocation not available");
      // Default location (Cairo, Egypt)
      userLocation = { lat: 30.0444, lon: 31.2357, loaded: true };
      resolve();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        userLocation = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          loaded: true,
        };
        console.log(`Location: ${userLocation.lat}, ${userLocation.lon}`);
        resolve();
      },
      (error) => {
        console.warn("Location permission denied:", error.message);
        // Default location (Cairo)
        userLocation = { lat: 30.0444, lon: 31.2357, loaded: true };
        resolve();
      },
    );
  });
}

function weatherCodeToType(code) {
  // WMO Weather interpretation codes
  if (code === 0 || code === 1) return "sunny";
  if (code === 2) return "cloudy";
  if (code === 3) return "cloudy";
  if (code >= 45 && code <= 48) return "cloudy"; // foggy
  if (code >= 51 && code <= 67) return "rainy"; // drizzle
  if (code >= 80 && code <= 82) return "rainy"; // rain showers
  if (code >= 85 && code <= 86) return "rainy"; // rain showers
  if (code >= 71 && code <= 77) return "rainy"; // snow
  if (code >= 80 && code <= 90) return "rainy"; // rain
  return "sunny";
}

function weatherCodeToDescription(code) {
  if (code === 0) return "Clear sky";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code >= 45 && code <= 48) return "Foggy";
  if (code >= 51 && code <= 55) return "Light drizzle";
  if (code >= 61 && code <= 65) return "Rain";
  if (code >= 80 && code <= 82) return "Heavy rain";
  if (code >= 71 && code <= 77) return "Snow";
  return "Variable";
}

async function fetchRealWeather() {
  try {
    if (!userLocation.loaded) return;

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${userLocation.lat}&longitude=${userLocation.lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.current) {
      const current = data.current;
      weatherSystem.realWeather = {
        temperature: Math.round(current.temperature_2m),
        humidity: current.relative_humidity_2m,
        windSpeed: Math.round(current.wind_speed_10m),
        code: current.weather_code,
        description: weatherCodeToDescription(current.weather_code),
      };

      // Update game weather based on real weather
      weatherSystem.type = weatherCodeToType(current.weather_code);
      weatherSystem.intensity = current.relative_humidity_2m / 100;

      console.log("Weather updated:", weatherSystem.realWeather);
      updateWeatherDisplay();
    }
  } catch (error) {
    console.error("Error fetching weather:", error);
  }
}

// ── LOCATION PERSISTENCE ──────────────────────────────────────────────────────
function saveLocation() {
  if (!car) return;
  localStorage.setItem(
    "carLocation",
    JSON.stringify({
      x: car.position.x,
      z: car.position.z,
      angle: drv.angle,
      time: { hour: worldTime.hour, minute: worldTime.minute },
    }),
  );
}

function loadLocation() {
  const saved = localStorage.getItem("carLocation");
  if (saved) {
    const loc = JSON.parse(saved);
    if (car) {
      car.position.x = loc.x;
      car.position.z = loc.z;
      drv.angle = loc.angle;
    }
    if (loc.time) {
      worldTime.hour = loc.time.hour;
      worldTime.minute = loc.time.minute;
    }
  }
}

// ── TAG COLORS ────────────────────────────────────────────────────────────────
const TAG_COLORS = {
  frontend: 0x1a73e8,
  react: 0x61dafb,
  vue: 0x41b883,
  javascript: 0xf7df1e,
  backend: 0x1e8449,
  api: 0x27ae60,
  server: 0x2ecc71,
  database: 0xb03a2e,
  sql: 0xc0392b,
  mongodb: 0x4caf50,
  ai: 0x7d3c98,
  ml: 0x6c3483,
  nlp: 0x9b59b6,
  deep: 0x8e44ad,
  devops: 0xca6f1e,
  docker: 0x0db7ed,
  cloud: 0x3498db,
  project: 0xd4ac0d,
  research: 0x1abc9c,
  idea: 0xe67e22,
  default: 0x546e7a,
};
function colorForTags(tags = []) {
  for (const t of tags)
    for (const [k, v] of Object.entries(TAG_COLORS))
      if (t.toLowerCase().includes(k)) return v;
  return TAG_COLORS.default;
}

// ── SCENE SETUP ───────────────────────────────────────────────────────────────
const scene = new THREE.Scene();

// Dynamic sky texture (will update based on time/weather)
function createSkyTexture() {
  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = 256;
  skyCanvas.height = 256;
  const ctx = skyCanvas.getContext("2d");

  // Calculate colors based on time
  const timePercent = (worldTime.hour + worldTime.minute / 60) / 24;
  const sunMiddle = 12 / 24; // Noon

  let topColor, horizonColor;

  if (timePercent < 0.25 || timePercent > 0.75) {
    // Night (0:00-6:00, 18:00-24:00)
    topColor = "#0a1428";
    horizonColor = "#1a2540";
  } else if (timePercent < 0.35) {
    // Dawn (6:00-8:24)
    const dawnProgress = (timePercent - 0.25) / 0.1;
    topColor = `rgb(${Math.floor(10 + dawnProgress * 80)}, ${Math.floor(20 + dawnProgress * 100)}, ${Math.floor(40 + dawnProgress * 160)})`;
    horizonColor = `rgb(${Math.floor(26 + dawnProgress * 150)}, ${Math.floor(37 + dawnProgress * 130)}, ${Math.floor(64 + dawnProgress * 80)})`;
  } else if (timePercent < 0.65) {
    // Day (8:24-15:36)
    topColor = "#87CEEB";
    horizonColor = "#e8f4f8";
  } else {
    // Sunset (15:36-18:00)
    const sunsetProgress = (timePercent - 0.65) / 0.1;
    topColor = `rgb(${Math.floor(135 - sunsetProgress * 70)}, ${Math.floor(206 - sunsetProgress * 100)}, ${Math.floor(235 - sunsetProgress * 150)})`;
    horizonColor = `rgb(${Math.floor(232 - sunsetProgress * 100)}, ${Math.floor(244 - sunsetProgress * 150)}, ${Math.floor(248 - sunsetProgress * 120)})`;
  }

  // Apply weather effects to colors
  if (weatherSystem.type === "rainy" || weatherSystem.type === "cloudy") {
    const factor = weatherSystem.intensity * 0.4;
    // Darken colors
    const rgb = (color) => {
      const match = color.match(/\d+/g);
      if (match) {
        return `rgb(${Math.floor(match[0] * (1 - factor))}, ${Math.floor(match[1] * (1 - factor))}, ${Math.floor(match[2] * (1 - factor))})`;
      }
      return color;
    };
    topColor = rgb(topColor);
    horizonColor = rgb(horizonColor);
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, topColor);
  gradient.addColorStop(0.4, topColor);
  gradient.addColorStop(0.7, horizonColor);
  gradient.addColorStop(1, horizonColor);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);

  return new THREE.CanvasTexture(skyCanvas);
}

let skyTexture = createSkyTexture();
scene.background = skyTexture;
scene.fog = new THREE.FogExp2(0x9fc6e8, 0.002); // closer fog
scene.layers.set(0);

const camera = new THREE.PerspectiveCamera(
  70,
  canvas.clientWidth / canvas.clientHeight,
  0.1,
  1500, // shorter view distance
);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setSize(canvas.clientWidth, canvas.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // reduce quality
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap; // faster
renderer.shadowMap.autoUpdate = false; // manual update only
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
renderer.outputColorSpace = THREE.SRGBColorSpace;

window.addEventListener("resize", () => {
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
});

// ── LIGHTING ──────────────────────────────────────────────────────────────────
const hemiLight = new THREE.HemisphereLight(0x9fc6e8, 0x3a6e2f, 1.0);
scene.add(hemiLight);

const sun = new THREE.DirectionalLight(0xfff4e6, 1.8);
sun.position.set(250, 350, 200);

// Function to update sun position based on time
function updateSunPosition() {
  const timePercent = (worldTime.hour + worldTime.minute / 60) / 24;
  const angle = timePercent * Math.PI * 2;
  const sunHeight = Math.sin(angle) * 400;

  if (timePercent < 0.25 || timePercent > 0.75) {
    // Night - sun below horizon
    sun.intensity = 0.1;
  } else if (timePercent < 0.35 || timePercent > 0.65) {
    // Dawn/Sunset - dimmer
    sun.intensity = 0.8;
  } else {
    // Day - bright
    sun.intensity = 1.8;
  }

  sun.position.set(
    Math.cos(angle) * 300,
    sunHeight + 50,
    Math.sin(angle) * 300,
  );

  // Update ambient and hemisphere light
  const dayIntensity = Math.max(0.2, Math.sin(angle));
  hemiLight.intensity = 0.5 + dayIntensity * 0.8;
  ambientLight.intensity = 0.2 + dayIntensity * 0.4;
}
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); // reduced
sun.shadow.camera.left = sun.shadow.camera.bottom = -800;
sun.shadow.camera.right = sun.shadow.camera.top = 800;
sun.shadow.camera.far = 1500;
sun.shadow.bias = -0.001;
sun.shadow.normalBias = 0.05;
sun.layers.set(0);
scene.add(sun);

// Subtle ambient light for fills
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

// ── WEATHER EFFECTS (Rain particles) ──────────────────────────────────────────
function initRainParticles() {
  const rainGroup = new THREE.Group();
  const rainCount = 200;

  for (let i = 0; i < rainCount; i++) {
    const raindrop = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array([0, 1, 0]), 3),
      ),
      new THREE.LineBasicMaterial({ color: 0x88ccff, linewidth: 0.5 }),
    );
    raindrop.position.set(
      (Math.random() - 0.5) * 500,
      Math.random() * 200,
      (Math.random() - 0.5) * 500,
    );
    rainGroup.add(raindrop);
    weatherSystem.rainParticles.push({
      mesh: raindrop,
      speed: 2 + Math.random() * 2,
      origY: raindrop.position.y,
    });
  }

  scene.add(rainGroup);
  rainGroup.userData = { isRainGroup: true };
  return rainGroup;
}

let rainGroup = null;

function updateRain() {
  if (weatherSystem.type !== "rainy" && rainGroup) {
    // Remove rain
    scene.remove(rainGroup);
    rainGroup = null;
    weatherSystem.rainParticles = [];
  } else if (weatherSystem.type === "rainy" && !rainGroup) {
    // Add rain
    rainGroup = initRainParticles();
  }

  // Update rain particles
  if (rainGroup) {
    weatherSystem.rainParticles.forEach((drop) => {
      drop.mesh.position.y -= drop.speed * weatherSystem.intensity;

      if (drop.mesh.position.y < 0) {
        drop.mesh.position.y = drop.origY;
      }

      // Follow camera
      if (car) {
        drop.mesh.position.x = car.position.x + (Math.random() - 0.5) * 200;
        drop.mesh.position.z = car.position.z + (Math.random() - 0.5) * 200;
      }
    });
  }
}

function updateWeather() {
  // Update real weather every hour
  const now = Date.now();
  if (now - weatherSystem.lastUpdate > weatherSystem.updateInterval) {
    weatherSystem.lastUpdate = now;
    fetchRealWeather();
  }
}

function updateTime() {
  // Update time from system clock every frame
  if (worldTime.useRealTime) {
    updateTimeFromSystemClock();
  }

  // Update weather system
  updateWeather();
}

// Update weather panel display
function updateWeatherDisplay() {
  const timeStr = `${String(worldTime.hour).padStart(2, "0")}:${String(Math.floor(worldTime.minute)).padStart(2, "0")}`;
  document.getElementById("time-display").textContent = timeStr;

  let weatherIcon;
  if (weatherSystem.type === "sunny") {
    weatherIcon = "☀️";
  } else if (weatherSystem.type === "cloudy") {
    weatherIcon = "☁️";
  } else if (weatherSystem.type === "rainy") {
    weatherIcon = "🌧️";
  }

  document.getElementById("weather-icon").textContent = weatherIcon;
  document.getElementById("weather-text").textContent =
    weatherSystem.realWeather.description;

  // Update weather details if they exist
  const weatherDetails = document.getElementById("weather-details");
  if (weatherDetails) {
    weatherDetails.innerHTML = `
      🌡️ ${weatherSystem.realWeather.temperature}°C<br>
      💨 ${weatherSystem.realWeather.windSpeed} km/h<br>
      💧 ${weatherSystem.realWeather.humidity}%
    `;
  }
}

// ── GROUND ────────────────────────────────────────────────────────────────────
// Create textured ground with grass variation
const canvas2D = document.createElement("canvas");
canvas2D.width = 256; // reduced from 512
canvas2D.height = 256;
const ctx2D = canvas2D.getContext("2d");
ctx2D.fillStyle = "#4a8a35";
ctx2D.fillRect(0, 0, 256, 256);
// Add grass variation (less)
for (let i = 0; i < 300; i++) {
  // reduced from 1000
  ctx2D.fillStyle = `rgba(${80 + Math.random() * 40}, ${140 + Math.random() * 40}, ${60 + Math.random() * 30}, ${Math.random() * 0.3})`;
  ctx2D.beginPath();
  ctx2D.arc(
    Math.random() * 256,
    Math.random() * 256,
    Math.random() * 1.5,
    0,
    Math.PI * 2,
  );
  ctx2D.fill();
}
const grassTexture = new THREE.CanvasTexture(canvas2D);
grassTexture.repeat.set(8, 8);
grassTexture.wrapS = grassTexture.wrapT = THREE.RepeatWrapping;

const groundMat = new THREE.MeshPhongMaterial({
  map: grassTexture,
  color: 0x5a9d42,
  emissive: 0x2d4d21,
  emissiveIntensity: 0.08,
  shininess: 5,
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ── GEOMETRY CACHE ────────────────────────────────────────────────────────────
const GEO = {
  road: (l, w) => new THREE.BoxGeometry(w, 0.22, l),
  box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  plane: (w, h) => new THREE.PlaneGeometry(w, h),
  cone: () => new THREE.ConeGeometry(2.4, 5.5, 6),
  cyl: (r, h) => new THREE.CylinderGeometry(r, r * 1.1, h, 6),
  sphere: () => new THREE.SphereGeometry(0.3, 8, 8),
  wheel: () => new THREE.CylinderGeometry(0.68, 0.68, 0.6, 12),
};

// Cache geometries to avoid recreation
const geoCache = new Map();
const winMat = new THREE.MeshBasicMaterial({
  color: 0xffffdd,
  transparent: true,
  opacity: 0.96,
  side: THREE.DoubleSide,
});

// ── ROAD BUILDER ──────────────────────────────────────────────────────────────
function buildRoad(x1, z1, x2, z2, w = 12) {
  const dx = x2 - x1,
    dz = z2 - z1,
    len = Math.hypot(dx, dz);
  const dir = new THREE.Vector3(dx, 0, dz).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    dir,
  );

  // Create road texture with details
  const roadCanvas = document.createElement("canvas");
  roadCanvas.width = 128; // reduced from 256
  roadCanvas.height = 64; // reduced from 128
  const roadCtx = roadCanvas.getContext("2d");
  roadCtx.fillStyle = "#0f0f0f";
  roadCtx.fillRect(0, 0, 128, 64);
  // Add minimal asphalt noise
  for (let i = 0; i < 50; i++) {
    // reduced from 200
    roadCtx.fillStyle = `rgba(40, 40, 40, ${Math.random() * 0.3})`;
    roadCtx.fillRect(
      Math.random() * 128,
      Math.random() * 64,
      Math.random() * 8,
      Math.random() * 8,
    );
  }
  const roadTexture = new THREE.CanvasTexture(roadCanvas);
  roadTexture.repeat.set(len / 12, 1);
  roadTexture.wrapS = THREE.RepeatWrapping;

  const r = new THREE.Mesh(
    GEO.road(len, w),
    new THREE.MeshPhongMaterial({
      map: roadTexture,
      color: 0x1a1a1a,
      shininess: 50,
      emissive: 0x0a0a0a,
      emissiveIntensity: 0.25,
    }),
  );
  r.position.set((x1 + x2) / 2, 0.11, (z1 + z2) / 2);
  r.setRotationFromQuaternion(q);
  r.receiveShadow = true;
  scene.add(r);

  // Dashed center line with better visibility (fewer)
  const dashCount = Math.floor(len / 12); // reduced from every 8
  for (let i = 0; i < dashCount; i++) {
    if (i % 2 === 0) {
      const cl = new THREE.Mesh(
        GEO.road(6, 0.4),
        new THREE.MeshBasicMaterial({ color: 0xffdd00 }),
      );
      const t = (i / dashCount) * 2 - 1;
      cl.position.set(
        (x1 + x2) / 2 + (t * dx) / 2,
        0.125,
        (z1 + z2) / 2 + (t * dz) / 2,
      );
      cl.setRotationFromQuaternion(q);
      scene.add(cl);
    }
  }

  // Road edges (white/light lines)
  [-1, 1].forEach((side) => {
    const edge = new THREE.Mesh(
      GEO.road(len, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xdddddd }),
    );
    edge.position.set(
      (x1 + x2) / 2 + side * (w / 2 - 0.2) * Math.cos(Math.atan2(dz, dx)),
      0.122,
      (z1 + z2) / 2 + side * (w / 2 - 0.2) * Math.sin(Math.atan2(dz, dx)),
    );
    edge.setRotationFromQuaternion(q);
    scene.add(edge);
  });

  // Add street lamps for atmosphere (fewer)
  const lampCount = Math.floor(len / 80); // reduce lamp posts
  for (let i = 0; i < lampCount; i++) {
    const t = (i / lampCount) * 2 - 1;
    const lampPos = new THREE.Vector3(
      (x1 + x2) / 2 + (t * dx) / 2,
      3.5,
      (z1 + z2) / 2 + (t * dz) / 2,
    );

    // Lamp post
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 7, 8),
      new THREE.MeshPhongMaterial({ color: 0x333333, shininess: 20 }),
    );
    post.position.copy(lampPos);
    post.castShadow = true;
    scene.add(post);

    // Lamp light source (non-shadow casting, for effect)
    const lampLight = new THREE.PointLight(0xffff99, 0.15, 40); // weaker lighting
    lampLight.position.y = 7.5;
    lampLight.position.x = lampPos.x;
    lampLight.position.z = lampPos.z;
    lampLight.layers.set(1); // separate layer
    scene.add(lampLight);
  }
}

// ── BUILDING BUILDER ──────────────────────────────────────────────────────────
const buildingObjects = []; // for raycasting
const collisionObjects = []; // for collision detection

function buildBuilding(note, bx, bz) {
  const links = note.linkCount || note.links?.length || 0;
  const h = Math.max(8, links * 2.4 + 6); // slightly taller
  const bw = 6 + (Math.abs(bx * bz * 7) % 4);
  const bd = 6 + (Math.abs(bx + bz * 3) % 4);
  const col = colorForTags(note.tags);
  const darkCol = new THREE.Color(col).multiplyScalar(0.7);

  // Main body
  const body = new THREE.Mesh(
    GEO.box(bw, h, bd),
    new THREE.MeshPhongMaterial({
      color: col,
      emissive: new THREE.Color(col).multiplyScalar(0.25),
      emissiveIntensity: 0.4,
      shininess: 60,
    }),
  );
  body.position.set(bx, h / 2, bz);
  body.castShadow = true;
  body.receiveShadow = true;
  body.userData = { type: "building", note };
  scene.add(body);
  buildingObjects.push(body);

  // Add collision sphere
  collisionObjects.push({
    pos: body.position.clone(),
    radius: Math.max(bw, bd) / 2 + 0.5,
  });

  // Decorative roof
  const capH = Math.max(2, h * 0.15);
  const cap = new THREE.Mesh(
    GEO.box(bw * 0.85, capH, bd * 0.85),
    new THREE.MeshPhongMaterial({
      color: darkCol,
      emissive: new THREE.Color(col).multiplyScalar(0.2),
      emissiveIntensity: 0.3,
      shininess: 40,
    }),
  );
  cap.position.set(bx, h + capH / 2, bz);
  cap.castShadow = true;
  cap.receiveShadow = true;
  scene.add(cap);

  // Corner pillars (only for large buildings)
  if (h > 12) {
    [-1, 1].forEach((sx) => {
      [-1, 1].forEach((sz) => {
        const pillar = new THREE.Mesh(
          GEO.box(0.6, h, 0.6),
          new THREE.MeshPhongMaterial({
            color: darkCol,
            shininess: 30,
          }),
        );
        pillar.position.set(bx + sx * bw * 0.35, h / 2, bz + sz * bd * 0.35);
        pillar.castShadow = true;
        pillar.receiveShadow = true;
        scene.add(pillar);
      });
    });
  }

  // Windows with lighting
  const floors = Math.min(links, 12);
  for (let fl = 0; fl < floors; fl++) {
    for (const s of [-1, 1]) {
      // Window frame
      const wFrame = new THREE.Mesh(
        GEO.plane(1.1, 1.4),
        new THREE.MeshPhongMaterial({
          color: 0x333333,
          shininess: 20,
        }),
      );
      const yPos = fl * 2.8 + 4;
      wFrame.position.set(bx + s * bw * 0.25, yPos, bz + bd / 2 + 0.1);
      scene.add(wFrame);

      // Lit window
      const w = new THREE.Mesh(
        GEO.plane(0.95, 1.25),
        new THREE.MeshBasicMaterial({
          color: Math.random() > 0.3 ? 0xffffdd : 0xffff99, // variable
          transparent: true,
          opacity: Math.random() > 0.5 ? 0.95 : 0.7, // some windows dark
        }),
      );
      w.position.copy(wFrame.position);
      w.position.z += 0.05;
      scene.add(w);
    }
  }

  // Balconies on some floors (less frequent)
  if (floors > 4) {
    for (let fl = 2; fl < floors; fl += 4) {
      const balcony = new THREE.Mesh(
        GEO.box(bw * 0.5, 0.4, 1.2),
        new THREE.MeshPhongMaterial({
          color: 0x555555,
          shininess: 40,
        }),
      );
      balcony.position.set(bx, fl * 2.8 + 4.5, bz + bd / 2 + 0.8);
      balcony.castShadow = true;
      balcony.receiveShadow = true;
      scene.add(balcony);
    }
  }

  return body;
}

// ── TREE BUILDER ─────────────────────────────────────────────────────────────
function addTrees(count = 200) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2,
      r = 120 + Math.random() * 700;
    const tx = Math.cos(a) * r,
      tz = Math.sin(a) * r;

    // Tree trunk variations
    const trunkH = 2.5 + Math.random() * 1.5;
    const trunkR = 0.28 + Math.random() * 0.15;
    const trk = new THREE.Mesh(
      GEO.cyl(trunkR, trunkH),
      new THREE.MeshPhongMaterial({
        color: 0x6b3e2e,
        emissive: 0x3d2415,
        emissiveIntensity: 0.1,
        shininess: 15,
      }),
    );
    trk.position.set(tx, trunkH / 2, tz);
    trk.castShadow = r < 300; // shadows only for nearby trees
    trk.receiveShadow = true;
    scene.add(trk);

    // Foliage variations
    const foliageH = 5 + Math.random() * 3;
    const foliageScale = 2.2 + Math.random() * 0.8;
    const lv = new THREE.Mesh(
      new THREE.ConeGeometry(foliageScale, foliageH, 8),
      new THREE.MeshPhongMaterial({
        color: 0x2d6e2d + Math.floor(Math.random() * 0x2a2a2a),
        emissive: 0x1a4d1a,
        emissiveIntensity: 0.2,
        shininess: 20,
      }),
    );
    lv.position.set(tx, trunkH + foliageH / 2 + 0.5, tz);
    lv.castShadow = true;
    lv.receiveShadow = true;
    scene.add(lv);

    // Add secondary foliage for fullness (less frequent)
    if (Math.random() > 0.7) {
      const lv2 = new THREE.Mesh(
        new THREE.ConeGeometry(foliageScale * 0.7, foliageH * 0.6, 6),
        new THREE.MeshPhongMaterial({
          color: 0x2d6e2d + Math.floor(Math.random() * 0x2a2a2a),
          emissive: 0x1a4d1a,
          emissiveIntensity: 0.15,
          shininess: 20,
        }),
      );
      lv2.position.set(
        tx + (Math.random() - 0.5) * 1.5,
        trunkH + foliageH * 0.3,
        tz + (Math.random() - 0.5) * 1.5,
      );
      lv2.castShadow = true;
      lv2.receiveShadow = true;
      scene.add(lv2);
    }

    // Add collision sphere for tree
    collisionObjects.push({
      pos: new THREE.Vector3(tx, 0, tz),
      radius: foliageScale * 0.8, // Smaller radius for easier navigation
    });
  }
}

// ── LABEL SPRITE ─────────────────────────────────────────────────────────────
const labelSprites = [];
function makeLabel(text, x, y, z) {
  const cv = document.createElement("canvas");
  cv.width = 512;
  cv.height = 96;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "rgba(3,7,30,.92)";
  ctx.fillRect(0, 0, 512, 96);
  ctx.strokeStyle = "rgba(100,180,255,.4)";
  ctx.lineWidth = 2.5;
  ctx.strokeRect(1.5, 1.5, 509, 93);
  ctx.fillStyle = "#aee4ff";
  ctx.font = 'bold 38px "Segoe UI",Arial';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 48);
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(cv),
      transparent: true,
    }),
  );
  spr.scale.set(28, 6, 1);
  spr.position.set(x, y, z);
  scene.add(spr);
  labelSprites.push(spr);
  return spr;
}

// ── BUILD CITY FROM DATA ──────────────────────────────────────────────────────
function buildCity(city) {
  const cx = city.position?.x ?? 0;
  const cz = city.position?.z ?? 0;
  const allNotes = collectNotes(city);

  // use _radius calculated in backend if available
  const size = city._radius
    ? city._radius * 2
    : Math.max(100, Math.ceil(Math.sqrt(allNotes.length + 1)) * 28 + 50);

  // City platform with gradient
  const padCanvas = document.createElement("canvas");
  padCanvas.width = 512;
  padCanvas.height = 512;
  const padCtx = padCanvas.getContext("2d");
  const grad = padCtx.createRadialGradient(256, 256, 0, 256, 256, 512);
  grad.addColorStop(0, "#333333");
  grad.addColorStop(0.5, "#2a2a2a");
  grad.addColorStop(1, "#1a1a1a");
  padCtx.fillStyle = grad;
  padCtx.fillRect(0, 0, 512, 512);
  const padTexture = new THREE.CanvasTexture(padCanvas);
  padTexture.repeat.set(4, 4);
  padTexture.wrapS = padTexture.wrapT = THREE.RepeatWrapping;

  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshPhongMaterial({
      map: padTexture,
      color: 0x2a2a2a,
      emissive: 0x1a1a1a,
      emissiveIntensity: 0.15,
      shininess: 20,
    }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(cx, 0.09, cz);
  pad.receiveShadow = true;
  scene.add(pad);

  // Internal streets grid
  const half = size / 2 - 15;
  const step = Math.max(22, size / 6);
  for (let off = -half + step; off < half; off += step) {
    buildRoad(cx - half, cz + off, cx + half, cz + off, 5);
    buildRoad(cx + off, cz - half, cx + off, cz + half, 5);
  }

  // Place buildings
  const cols = Math.max(2, Math.ceil(Math.sqrt(allNotes.length)));
  const spacing = step * 0.95;
  allNotes.forEach((note, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const offsetX = ((cols - 1) * spacing) / 2;
    const offsetZ = ((Math.ceil(allNotes.length / cols) - 1) * spacing) / 2;
    const bx = cx - offsetX + col * spacing;
    const bz = cz - offsetZ + row * spacing;
    buildBuilding(note, bx, bz);
  });

  // City label — height based on building density
  const labelH = 55 + Math.min(allNotes.length * 0.5, 30);
  makeLabel(city.name, cx, labelH, cz);

  // Subfolders as districts around the city
  if (city.subfolders?.length) {
    city.subfolders.forEach((sub, si) => {
      const angle = (si / city.subfolders.length) * Math.PI * 2;
      const dist = size * 0.68;
      sub.position = {
        x: cx + Math.cos(angle) * dist,
        z: cz + Math.sin(angle) * dist,
        y: 0,
      };
      buildCity(sub);
      buildRoad(cx, cz, sub.position.x, sub.position.z, 8);
    });
  }
}

// collect all notes from city + subfolders
function collectNotes(node) {
  return [
    ...(node.notes || []),
    ...(node.subfolders || []).flatMap(collectNotes),
  ];
}

// ── HIGHWAYS BETWEEN TOP-LEVEL CITIES ────────────────────────────────────────
function buildHighways(cities, highwayConnections) {
  const conns = highwayConnections || [];

  if (conns.length > 0) {
    // Using smart connections from backend (MST + proximity)
    for (const { from, to } of conns) {
      const a = cities[from]?.position,
        b = cities[to]?.position;
      if (a && b) buildRoad(a.x, a.z, b.x, b.z, 18);
    }
  } else {
    // fallback: each city on adjacent only
    for (let i = 0; i < cities.length; i++) {
      for (let j = i + 1; j < cities.length; j++) {
        const a = cities[i].position,
          b = cities[j].position;
        if (!a || !b) continue;
        const dist = Math.hypot(a.x - b.x, a.z - b.z);
        // Only cities where distance is less than 600
        if (dist < 600) buildRoad(a.x, a.z, b.x, b.z, 16);
      }
    }
  }
}

// ── CAR ───────────────────────────────────────────────────────────────────────
let car,
  drv = {
    speed: 0,
    angle: 0,
    maxV: 1.2,
    acc: 0.025,
    dec: 0.012,
    brk: 0.08,
    turn: 0.035,
    radius: 2.2, // ← increased slightly for realism
    friction: 0.94,
    verticalV: 0,
    isAirborne: false,
    collisionCooldown: 0, // ← new: cooldown period after collision
  };

function buildCar() {
  car = new THREE.Group();
  const bdy = new THREE.Mesh(
    GEO.box(3.8, 1.45, 7.6),
    new THREE.MeshPhongMaterial({
      color: 0xc62828,
      emissive: 0x6b1619,
      emissiveIntensity: 0.4,
      shininess: 100,
    }),
  );
  bdy.position.y = 1.45;
  bdy.castShadow = true;
  bdy.receiveShadow = true;
  car.add(bdy);
  carBodyMesh = bdy; // ← #10 color picker reference
  const cab = new THREE.Mesh(
    GEO.box(3, 1.15, 3.9),
    new THREE.MeshPhongMaterial({
      color: 0x8b1a1a,
      emissive: 0x5b0f12,
      emissiveIntensity: 0.3,
      shininess: 80,
    }),
  );
  cab.position.set(0, 2.7, -0.35);
  cab.castShadow = true;
  cab.receiveShadow = true;
  car.add(cab);
  const ws = new THREE.Mesh(
    GEO.box(2.75, 0.9, 0.12),
    new THREE.MeshPhongMaterial({
      color: 0xa0d5ff,
      emissive: 0x4a7fa0,
      emissiveIntensity: 0.2,
      transparent: true,
      opacity: 0.7,
      shininess: 120,
    }),
  );
  ws.position.set(0, 2.7, 1.6);
  car.add(ws);
  [
    [-2.2, 0.68, 2.5],
    [2.2, 0.68, 2.5],
    [-2.2, 0.68, -2.5],
    [2.2, 0.68, -2.5],
  ].forEach(([x, y, z]) => {
    const w = new THREE.Mesh(
      GEO.wheel(),
      new THREE.MeshPhongMaterial({
        color: 0x0a0a0a,
        shininess: 30,
      }),
    );
    w.rotation.z = Math.PI / 2;
    w.position.set(x, y, z);
    w.castShadow = true;
    w.receiveShadow = true;
    car.add(w);
  });
  [
    [-1.1, 1.45, 3.82],
    [1.1, 1.45, 3.82],
  ].forEach(([x, y, z]) => {
    const h = new THREE.Mesh(
      GEO.sphere(),
      new THREE.MeshBasicMaterial({ color: 0xffff88 }),
    );
    h.position.set(x, y, z);
    car.add(h);
  });
  car.position.set(0, 0, 0);
  scene.add(car);
}

// ── COLLISION DETECTION ──────────────────────────────────────────────────────
function checkCollision(pos) {
  for (const obj of collisionObjects) {
    // skip far away objects (performance optimization)
    if (Math.abs(pos.x - obj.pos.x) > 80 || Math.abs(pos.z - obj.pos.z) > 80)
      continue;

    const dist = pos.distanceTo(obj.pos);
    if (dist < drv.radius + obj.radius) {
      return true;
    }
  }
  return false;
}

function unstuckCar() {
  if (!car) return;

  // make car jump forward out of collision
  drv.collisionCooldown = 60; // full second of ignoring collisions
  drv.speed = 0;

  // move 15 units forward in opposite direction
  car.position.x -= Math.sin(drv.angle) * 15;
  car.position.z -= Math.cos(drv.angle) * 15;
  car.position.y = 0;

  // flash notification
  const n = document.createElement("div");
  n.textContent = "🚗 Car freed!";
  n.style.cssText =
    "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(4,10,32,.9);color:#ff9800;padding:14px 22px;border-radius:10px;border:1px solid rgba(255,152,0,.4);font-size:14px;z-index:200;pointer-events:none;transition:opacity .5s";
  document.body.appendChild(n);
  setTimeout(() => {
    n.style.opacity = "0";
    setTimeout(() => n.remove(), 500);
  }, 2000);
}

// ── PARTICLE SYSTEM (for movement effects) ────────────────────────────────────
const particles = [];
const particlePool = [];

// Camera shake effect
let cameraShake = {
  intensity: 0,
  duration: 0,
};

function triggerCameraShake(intensity = 0.3, duration = 200) {
  cameraShake.intensity = intensity;
  cameraShake.duration = duration;
}

// ── AUDIO SYSTEM (Web Audio API) ──────────────────────────────────────────────
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

function playCollisionSound(intensity = 1) {
  const now = audioContext.currentTime;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();

  osc.connect(gain);
  gain.connect(audioContext.destination);

  osc.frequency.value = 400 * intensity;
  gain.gain.setValueAtTime(0.1 * intensity, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

  osc.start(now);
  osc.stop(now + 0.15);
}

function playJumpSound() {
  const now = audioContext.currentTime;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();

  osc.connect(gain);
  gain.connect(audioContext.destination);

  osc.frequency.setValueAtTime(800, now);
  osc.frequency.exponentialRampToValueAtTime(400, now + 0.1);
  gain.gain.setValueAtTime(0.05, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);

  osc.start(now);
  osc.stop(now + 0.1);
}

function createParticle(pos, vel) {
  let p;
  if (particlePool.length > 0) {
    p = particlePool.pop();
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.life = 1.0;
  } else {
    p = {
      pos: pos.clone(),
      vel: vel.clone(),
      life: 1.0,
      mesh: new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 4, 4),
        new THREE.MeshBasicMaterial({
          color: 0xc0a080,
          toneMapped: false,
          transparent: true,
        }),
      ),
    };
    scene.add(p.mesh);
  }
  p.mesh.visible = true;
  particles.push(p);
}

function updateParticles() {
  let alive = 0;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= 0.015;
    p.pos.add(p.vel);
    p.vel.y -= 0.002; // gravity
    p.mesh.position.copy(p.pos);
    p.mesh.material.opacity = p.life * 0.3;

    if (p.life <= 0) {
      p.mesh.visible = false;
      particles.splice(i, 1);
      particlePool.push(p);
    } else {
      alive++;
    }
  }

  // Clear pool if too large (memory cleanup)
  if (particlePool.length > 200) {
    particlePool.splice(0, 100);
  }
}

// ── INPUT ─────────────────────────────────────────────────────────────────────
const K = {};
document.addEventListener("keydown", (e) => {
  K[e.code] = true;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key))
    e.preventDefault();
  if (e.code === "KeyR") unstuckCar();
});
document.addEventListener("keyup", (e) => {
  K[e.code] = false;
});

// ── RAYCASTING (click on building) ───────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selectedBuilding = null;
let buildingGlowTime = 0;

canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = ((e.clientY - rect.top) / rect.height) * -2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(buildingObjects);
  if (hits.length) {
    selectedBuilding = hits[0].object;
    buildingGlowTime = 600; // milliseconds
    openNotePanel(hits[0].object.userData.note);
  }
});

// ── NOTE PANEL ───────────────────────────────────────────────────────────────
function openNotePanel(note) {
  document.getElementById("np-title").textContent = note.name;
  document.getElementById("np-meta").textContent =
    `Links: ${note.linkCount || 0}  |  Words: ${note.wordCount || "—"}`;
  document.getElementById("np-tags").innerHTML = (note.tags || [])
    .map((t) => `<span>#${t}</span>`)
    .join("");
  document.getElementById("np-links").innerHTML =
    '<b style="font-size:11px;opacity:.4">Outgoing Links:</b><br>' +
    (note.links || [])
      .map((l) => `<a href="#" onclick="return false">${l}</a>`)
      .join("");

  // fetch note content
  const noteId = note.id || note.name?.toLowerCase().replace(/\s+/g, "-");
  fetch(`${API}/note/${noteId}`)
    .then((r) => r.json())
    .then((d) => {
      document.getElementById("np-content").textContent =
        d.content?.slice(0, 1200) +
          (d.content?.length > 1200 ? "\n\n..." : "") || "";
    })
    .catch(() => {
      document.getElementById("np-content").textContent =
        "(Failed to load content)";
    });

  document.getElementById("note-panel").classList.add("open");
}
function closePanel() {
  document.getElementById("note-panel").classList.remove("open");
}

// ── MINIMAP ──────────────────────────────────────────────────────────────────
const mm = document.getElementById("minimap").getContext("2d");
let minimapData = {
  cities: [],
  bounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
};
let allCities = []; // access cities from anywhere

function updateMinimap(vaultData) {
  const cities = vaultData.cities || [];
  allCities = cities;

  // collect all locations (cities + subdirectories)
  const allPositioned = [];
  function collectPositions(nodeList) {
    for (const c of nodeList) {
      if (c.position) allPositioned.push(c);
      if (c.subfolders?.length) collectPositions(c.subfolders);
    }
  }
  collectPositions(cities);

  const xs = allPositioned.map((c) => c.position.x);
  const zs = allPositioned.map((c) => c.position.z);
  const PADDING = 120;

  minimapData = {
    cities,
    highwayConnections: vaultData.highwayConnections || [],
    bounds: {
      minX: Math.min(...xs, 0) - PADDING,
      maxX: Math.max(...xs, 0) + PADDING,
      minZ: Math.min(...zs, 0) - PADDING,
      maxZ: Math.max(...zs, 0) + PADDING,
    },
  };
}

// Get closest city for HUD location display
function getClosestCity() {
  if (!car || allCities.length === 0) return "—";

  let closest = null;
  let minDist = Infinity;

  for (const city of allCities) {
    if (!city.position) continue;
    const dist = car.position.distanceTo(
      new THREE.Vector3(city.position.x, 0, city.position.z),
    );
    if (dist < minDist) {
      minDist = dist;
      closest = city;
    }
  }

  return closest?.name || "—";
}
// tag colors for minimap
const MM_TAG_COLORS = {
  frontend: "#1a73e8",
  react: "#61dafb",
  backend: "#1e8449",
  api: "#27ae60",
  database: "#b03a2e",
  sql: "#c0392b",
  ai: "#7d3c98",
  ml: "#6c3483",
  devops: "#ca6f1e",
  docker: "#0db7ed",
  project: "#d4ac0d",
  research: "#1abc9c",
  default: "#546e7a",
};
function mmTagColor(tags = []) {
  for (const t of tags)
    for (const [k, v] of Object.entries(MM_TAG_COLORS))
      if (t.toLowerCase().includes(k)) return v;
  return MM_TAG_COLORS.default;
}

// Cache: buildings on minimap
let mmBuildingCache = null;
function buildMMCache(cities) {
  mmBuildingCache = [];
  function walk(node) {
    for (const note of node.notes || []) {
      mmBuildingCache.push({
        x: node.position?.x ?? 0,
        z: node.position?.z ?? 0,
        color: mmTagColor(note.tags || []),
      });
    }
    for (const sub of node.subfolders || []) walk(sub);
  }
  for (const c of cities) walk(c);
}

function drawMinimap() {
  if (!car) return;
  const W = 160,
    H = 160;
  const { minX, maxX, minZ, maxZ } = minimapData.bounds;
  const sx = W / (maxX - minX || 1);
  const sz = H / (maxZ - minZ || 1);

  const toMM = (wx, wz) => ({
    x: (wx - minX) * sx,
    z: (wz - minZ) * sz,
  });

  mm.clearRect(0, 0, W, H);

  // ── Background ────────────────────────────────────────────────────────────
  const bgGrad = mm.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
  bgGrad.addColorStop(0, "rgba(8,16,45,.97)");
  bgGrad.addColorStop(0.7, "rgba(4,10,28,.98)");
  bgGrad.addColorStop(1, "rgba(2,5,18,.99)");
  mm.fillStyle = bgGrad;
  mm.fillRect(0, 0, W, H);

  // ── Grid ─────────────────────────────────────────────────────────────────
  mm.strokeStyle = "rgba(50,100,180,.1)";
  mm.lineWidth = 0.5;
  const gridStep = W / 6;
  for (let i = 0; i <= W; i += gridStep) {
    mm.beginPath();
    mm.moveTo(i, 0);
    mm.lineTo(i, H);
    mm.stroke();
    mm.beginPath();
    mm.moveTo(0, i);
    mm.lineTo(W, i);
    mm.stroke();
  }

  // ── City zones (halos) ────────────────────────────────────────────────────
  for (const c of minimapData.cities) {
    if (!c.position) continue;
    const p = toMM(c.position.x, c.position.z);
    const notes = collectNotes(c);
    const cityR = Math.max(8, Math.sqrt(notes.length + 1) * 3.5);

    const zoneGrad = mm.createRadialGradient(p.x, p.z, 0, p.x, p.z, cityR);
    zoneGrad.addColorStop(0, "rgba(26,80,180,.25)");
    zoneGrad.addColorStop(0.7, "rgba(26,80,180,.08)");
    zoneGrad.addColorStop(1, "rgba(26,80,180,0)");
    mm.fillStyle = zoneGrad;
    mm.beginPath();
    mm.arc(p.x, p.z, cityR, 0, Math.PI * 2);
    mm.fill();

    // Zone border
    mm.strokeStyle = "rgba(80,150,255,.2)";
    mm.lineWidth = 0.6;
    mm.beginPath();
    mm.arc(p.x, p.z, cityR, 0, Math.PI * 2);
    mm.stroke();
  }

  // ── Highways ──────────────────────────────────────────────────────────────
  const cities = minimapData.cities;
  const hwConns = minimapData.highwayConnections || [];

  // MST highways: glowing blue
  if (hwConns.length > 0) {
    hwConns.forEach(({ from, to }) => {
      const a = cities[from]?.position,
        b = cities[to]?.position;
      if (!a || !b) return;
      const pa = toMM(a.x, a.z),
        pb = toMM(b.x, b.z);

      // Glow effect — draw multiple times with gradient transparency
      [
        ["rgba(80,160,255,.04)", 5],
        ["rgba(80,160,255,.12)", 2.5],
        ["rgba(120,200,255,.35)", 1],
      ].forEach(([color, lw]) => {
        mm.strokeStyle = color;
        mm.lineWidth = lw;
        mm.beginPath();
        mm.moveTo(pa.x, pa.z);
        mm.lineTo(pb.x, pb.z);
        mm.stroke();
      });
    });
  } else {
    // fallback all-to-all
    mm.strokeStyle = "rgba(80,160,255,.25)";
    mm.lineWidth = 1;
    for (let i = 0; i < cities.length; i++)
      for (let j = i + 1; j < cities.length; j++) {
        const a = cities[i].position,
          b = cities[j].position;
        if (!a || !b) continue;
        const pa = toMM(a.x, a.z),
          pb = toMM(b.x, b.z);
        mm.beginPath();
        mm.moveTo(pa.x, pa.z);
        mm.lineTo(pb.x, pb.z);
        mm.stroke();
      }
  }

  // ── Buildings (dots) ──────────────────────────────────────────────────────
  if (mmBuildingCache) {
    for (const b of mmBuildingCache) {
      const p = toMM(b.x, b.z);
      mm.fillStyle = b.color + "88"; // semi-transparent
      mm.beginPath();
      mm.arc(p.x, p.z, 1.5, 0, Math.PI * 2);
      mm.fill();
    }
  }

  // ── City nodes ────────────────────────────────────────────────────────────
  for (const c of minimapData.cities) {
    if (!c.position) continue;
    const p = toMM(c.position.x, c.position.z);
    const notes = collectNotes(c);
    const nodeR = Math.max(4, Math.min(9, Math.sqrt(notes.length) * 1.4));

    // Outer glow
    const nodeGrad = mm.createRadialGradient(p.x, p.z, 0, p.x, p.z, nodeR + 4);
    nodeGrad.addColorStop(0, "rgba(80,180,255,.6)");
    nodeGrad.addColorStop(0.5, "rgba(40,120,220,.3)");
    nodeGrad.addColorStop(1, "rgba(20,60,180,0)");
    mm.fillStyle = nodeGrad;
    mm.beginPath();
    mm.arc(p.x, p.z, nodeR + 4, 0, Math.PI * 2);
    mm.fill();

    // Core dot
    mm.fillStyle = "#aee4ff";
    mm.beginPath();
    mm.arc(p.x, p.z, nodeR, 0, Math.PI * 2);
    mm.fill();

    // City name
    mm.fillStyle = "#88ccff";
    mm.font = 'bold 7px "Segoe UI",Arial';
    mm.textAlign = "center";
    mm.shadowColor = "rgba(0,0,0,.9)";
    mm.shadowBlur = 3;
    const label = (c.name || "")
      .replace(/^[\u{1F300}-\u{1F9FF}]/u, "")
      .trim()
      .slice(0, 9);
    mm.fillText(label, p.x, p.z + nodeR + 8);
    mm.shadowBlur = 0;
  }

  // ── Car ───────────────────────────────────────────────────────────────────
  const cp = toMM(car.position.x, car.position.z);

  // Car glow
  const carGlow = mm.createRadialGradient(cp.x, cp.z, 0, cp.x, cp.z, 10);
  carGlow.addColorStop(0, "rgba(255,80,80,.5)");
  carGlow.addColorStop(1, "rgba(255,80,80,0)");
  mm.fillStyle = carGlow;
  mm.beginPath();
  mm.arc(cp.x, cp.z, 10, 0, Math.PI * 2);
  mm.fill();

  // Car triangle (points direction)
  const carAngle = drv.angle;
  const carSize = 5;
  mm.fillStyle = "#ff4444";
  mm.beginPath();
  mm.moveTo(
    cp.x + Math.sin(carAngle) * carSize * 1.5,
    cp.z + Math.cos(carAngle) * carSize * 1.5,
  );
  mm.lineTo(
    cp.x + Math.sin(carAngle + 2.4) * carSize,
    cp.z + Math.cos(carAngle + 2.4) * carSize,
  );
  mm.lineTo(
    cp.x + Math.sin(carAngle - 2.4) * carSize,
    cp.z + Math.cos(carAngle - 2.4) * carSize,
  );
  mm.closePath();
  mm.fill();

  // ── North arrow (top right corner) ──────────────────────────────
  const nx = W - 12,
    nz = 12;
  mm.fillStyle = "rgba(2,5,20,.7)";
  mm.beginPath();
  mm.arc(nx, nz, 9, 0, Math.PI * 2);
  mm.fill();
  mm.strokeStyle = "rgba(100,180,255,.4)";
  mm.lineWidth = 0.5;
  mm.beginPath();
  mm.arc(nx, nz, 9, 0, Math.PI * 2);
  mm.stroke();

  // N arrow
  mm.fillStyle = "#aee4ff";
  mm.beginPath();
  mm.moveTo(nx, nz - 7);
  mm.lineTo(nx + 3, nz + 3);
  mm.lineTo(nx - 3, nz + 3);
  mm.closePath();
  mm.fill();
  mm.font = "bold 6px Arial";
  mm.textAlign = "center";
  mm.fillStyle = "#aee4ff";
  mm.fillText("N", nx, nz + 2);

  // ── Scale bar (bottom corner) ───────────────────────────────────────
  const worldSpan = maxX - minX;
  const scaleWorld = worldSpan / 4; // quarter of map
  const scalePixels = W / 4;
  const scaleLabel =
    scaleWorld > 1000
      ? `${(scaleWorld / 1000).toFixed(1)}k`
      : `${Math.round(scaleWorld)}`;

  mm.strokeStyle = "rgba(150,200,255,.5)";
  mm.lineWidth = 1;
  mm.beginPath();
  mm.moveTo(8, H - 7);
  mm.lineTo(8 + scalePixels, H - 7);
  mm.stroke();
  mm.beginPath();
  mm.moveTo(8, H - 10);
  mm.lineTo(8, H - 4);
  mm.stroke();
  mm.beginPath();
  mm.moveTo(8 + scalePixels, H - 10);
  mm.lineTo(8 + scalePixels, H - 4);
  mm.stroke();

  mm.fillStyle = "rgba(150,200,255,.7)";
  mm.font = "6px Arial";
  mm.textAlign = "left";
  mm.fillText(scaleLabel, 12 + scalePixels / 2, H - 2);
}

// ── LEGEND ───────────────────────────────────────────────────────────────────
function buildLegend() {
  const el = document.getElementById("legend");
  el.style.display = "block";
  const entries = [
    ["Frontend", "#1a73e8"],
    ["Backend", "#1e8449"],
    ["AI / ML", "#7d3c98"],
    ["DevOps", "#ca6f1e"],
    ["Database", "#b03a2e"],
    ["Project", "#d4ac0d"],
    ["Research", "#1abc9c"],
    ["Other", "#546e7a"],
  ];
  el.innerHTML = entries
    .map(
      ([n, c]) =>
        `<div class="leg-row"><span class="leg-dot" style="background:${c}"></span>${n}</div>`,
    )
    .join("");
}

// ── WEBSOCKET ─────────────────────────────────────────────────────────────────
let ws;
function connectWS() {
  ws = new WebSocket(WS);
  const dot = document.getElementById("ws-indicator");
  ws.onopen = () => {
    dot.className = "dot green";
  };
  ws.onclose = () => {
    dot.className = "dot red";
    setTimeout(connectWS, 3000);
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "vault:change") {
      // flash notification
      const n = document.createElement("div");
      n.textContent = `📝 Changed: ${msg.noteId}`;
      n.style.cssText =
        "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(4,10,32,.9);color:#aee4ff;padding:14px 22px;border-radius:10px;border:1px solid rgba(100,180,255,.3);font-size:14px;z-index:200;pointer-events:none;transition:opacity .5s";
      document.body.appendChild(n);
      setTimeout(() => {
        n.style.opacity = "0";
        setTimeout(() => n.remove(), 500);
      }, 2500);
    }
  };
}

// ── MAIN: FETCH VAULT & BUILD ─────────────────────────────────────────────────
async function init() {
  const loadMsg = document.getElementById("loading-msg");

  try {
    loadMsg.textContent = "Connecting to vault...";
    const res = await fetch(API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    loadMsg.textContent = "Building city...";
    await new Promise((r) => setTimeout(r, 200)); // let browser paint

    // Stats
    document.getElementById("s-cities").textContent =
      data.meta?.totalCities ?? "—";
    document.getElementById("s-notes").textContent =
      data.meta?.totalNotes ?? "—";
    document.getElementById("s-links").textContent =
      data.meta?.totalLinks ?? "—";

    // Store globally for new features
    vaultData = data;

    // Build world
    addTrees(100); // major reduction
    buildHighways(data.cities || [], data.highwayConnections || []);
    (data.cities || []).forEach(buildCity);
    buildMMCache(data.cities || []); // ← new
    buildCar();
    const firstCity = data.cities?.[0];
    if (firstCity?.position) {
      const cityR = firstCity._radius || 80;
      car.position.set(
        firstCity.position.x + cityR + 30,
        0,
        firstCity.position.z,
      );
      drv.angle = Math.PI;
    }
    buildLegend();
    updateMinimap(data);
    initializeTime();
    loadLocation();
    updateSunPosition();

    // Request location and fetch real weather
    await requestLocation();
    await fetchRealWeather();

    // Auto-update weather every hour
    setInterval(fetchRealWeather, weatherSystem.updateInterval);

    connectWS();

    // Hide loader
    const loader = document.getElementById("loading");
    loader.style.opacity = "0";
    setTimeout(() => (loader.style.display = "none"), 650);
  } catch (err) {
    loadMsg.innerHTML = `
      <span style="color:#f44">❌ Failed to connect to backend</span><br><br>
      <small style="opacity:.6">Make sure server is running on:<br>
      <code style="color:#aee4ff">http://localhost:3333</code></small><br><br>
      <small style="opacity:.4">${err.message}</small>
    `;
  }
}

// ── ANIMATE LOOP ──────────────────────────────────────────────────────────────
let frameCount = 0;
function animate() {
  requestAnimationFrame(animate);
  frameCount++;

  if (car) {
    const fwd = K["ArrowUp"] || K["KeyW"],
      bwd = K["ArrowDown"] || K["KeyS"];
    const lft = K["ArrowLeft"] || K["KeyA"],
      rgt = K["ArrowRight"] || K["KeyD"];
    const space = K["Space"]; // for strong braking
    const jump = K["KeyZ"]; // for jumping

    // Enhanced physics with friction
    if (fwd) drv.speed = Math.min(drv.speed + drv.acc, drv.maxV);
    else if (bwd) drv.speed = Math.max(drv.speed - drv.brk, -drv.maxV * 0.5);
    else if (space)
      drv.speed *= 0.88; // very strong braking
    else {
      // Natural friction
      if (drv.speed > 0)
        drv.speed = Math.max(0, drv.speed * drv.friction - drv.dec);
      else if (drv.speed < 0)
        drv.speed = Math.min(0, drv.speed * drv.friction + drv.dec);
    }

    // Jump mechanic
    if (jump && !drv.isAirborne) {
      drv.verticalV = 0.45;
      drv.isAirborne = true;
      playJumpSound();
    }

    // Gravity
    drv.verticalV -= 0.025;
    car.position.y += drv.verticalV;

    // Ground collision
    if (car.position.y <= 0) {
      car.position.y = 0;
      drv.verticalV = 0;
      drv.isAirborne = false;
    }

    // Wheel turning (only when moving)
    if (Math.abs(drv.speed) > 0.008) {
      if (lft) drv.angle += drv.turn * Math.sign(drv.speed);
      if (rgt) drv.angle -= drv.turn * Math.sign(drv.speed);
    }
    car.rotation.y = drv.angle;

    // Calculate new position
    const nextX = car.position.x + Math.sin(drv.angle) * drv.speed;
    const nextZ = car.position.z + Math.cos(drv.angle) * drv.speed;
    const nextPos = new THREE.Vector3(nextX, car.position.y, nextZ);

    // Check collision before moving
    // reduce cooldown every frame
    if (drv.collisionCooldown > 0) drv.collisionCooldown--;

    if (drv.collisionCooldown > 0) {
      // during cooldown: ignore collision completely (allows escape)
      car.position.x = nextX;
      car.position.z = nextZ;
    } else if (!checkCollision(nextPos)) {
      // no collision: move freely
      car.position.x = nextX;
      car.position.z = nextZ;

      // dust particles while moving
      if (Math.abs(drv.speed) > 0.1) {
        for (let i = 0; i < 2; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 2 + Math.random() * 1.5;
          createParticle(
            new THREE.Vector3(
              nextX + Math.cos(angle) * dist,
              0.5,
              nextZ + Math.sin(angle) * dist,
            ),
            new THREE.Vector3(
              Math.cos(angle) * 0.015,
              Math.random() * 0.008,
              Math.sin(angle) * 0.015,
            ),
          );
        }
      }
    } else {
      // collision: stop speed + start cooldown (no bounce)
      drv.speed = 0;
      drv.collisionCooldown = 25; // ~0.4 seconds at 60fps
      triggerCameraShake(0.2, 120);
      playCollisionSound(0.4);
    }

    // Update particles
    updateParticles();

    // 3rd-person camera with enhanced smoothing
    const cp = car.position;
    const camDistance = 26 + Math.abs(drv.speed) * 8; // Camera distance increases with speed
    const camHeight = 12 + Math.abs(drv.speed) * 2;

    const camT = new THREE.Vector3(
      cp.x - Math.sin(drv.angle) * camDistance,
      cp.y + camHeight,
      cp.z - Math.cos(drv.angle) * camDistance,
    );

    // Smooth lerp with frame-rate independent damping
    camera.position.lerp(camT, 0.08);

    // Look ahead of car
    const lookAheadDist = 15 + Math.abs(drv.speed) * 5;
    camera.lookAt(
      cp.x + Math.sin(drv.angle) * lookAheadDist,
      cp.y + 3,
      cp.z + Math.cos(drv.angle) * lookAheadDist,
    );

    // Apply camera shake
    if (cameraShake.duration > 0) {
      const shakeAmount = (cameraShake.intensity * cameraShake.duration) / 200;
      camera.position.x += (Math.random() - 0.5) * shakeAmount;
      camera.position.y += (Math.random() - 0.5) * shakeAmount;
      camera.position.z += (Math.random() - 0.5) * shakeAmount;
      cameraShake.duration -= 16;
    }

    // Apply glow to selected building
    if (selectedBuilding) {
      buildingGlowTime -= 16;
      const progress = buildingGlowTime / 600;
      selectedBuilding.material.emissiveIntensity = 0.3 + progress * 0.4;
      if (buildingGlowTime <= 0) {
        selectedBuilding.material.emissiveIntensity = 0.3;
        selectedBuilding = null;
      }
    }

    // HUD
    document.getElementById("hud-loc").textContent = getClosestCity();
    document.getElementById("hud-spd").textContent =
      `Speed: ${Math.abs(drv.speed * 100).toFixed(0)} km/h`;

    // update minimap every other frame
    if (frameCount % 2 === 0) {
      drawMinimap();
    }

    // Update weather effects
    updateRain();
  }

  // Update time and sunlight every frame
  updateTime();
  updateWeatherDisplay();
  updateSunPosition();

  // Update sky texture based on time/weather
  if (frameCount % 60 === 0) {
    skyTexture = createSkyTexture();
    scene.background = skyTexture;
  }

  // Save location every 5 seconds (300 frames at 60fps)
  if (frameCount % 300 === 0) {
    saveLocation();
  }

  labelSprites.forEach((s) => s.quaternion.copy(camera.quaternion));

  // Manually update shadows every few frames
  if (frameCount % 3 === 0) {
    renderer.shadowMap.needsUpdate = true;
  }

  renderer.render(scene, camera);
}

// ── KICK OFF ──────────────────────────────────────────────────────────────────
init();
animate();

// ════════════════════════════════════════════════════════════════════════════
//  ObsidianCity3D — NEW FEATURES v3  (18 features)
// ════════════════════════════════════════════════════════════════════════════

// ── shared state ─────────────────────────────────────────────────────────────
let vaultData = null; // all vault data (set in init)
let graphLines = []; // Graph View lines
let graphVisible = false; // Graph View state
let autoCycleActive = false; // Auto Day/Night Cycle
let streetLamps = []; // street lamps
let carBodyMesh = null; // reference to car body for color picker
let searchIndex = []; // search index [{note, city, mesh}]
let notePreviewCache = {}; // cache for note previews
let speedLinesMeshes = []; // speed lines for turbo
let autoCycleSpeed = 60; // 1 real minute = 1 hour in game

// ══════════════════════════════════════════════════════════════════════════════
//  #1  SEARCH & TELEPORT PANEL
// ══════════════════════════════════════════════════════════════════════════════
function buildSearchIndex(cities) {
  searchIndex = [];
  function walk(city, cityName) {
    for (const note of city.notes || []) {
      const mesh = buildingObjects.find(
        (b) => b.userData?.note?.id === note.id,
      );
      searchIndex.push({ note, cityName, mesh });
    }
    for (const sub of city.subfolders || []) walk(sub, sub.name);
  }
  for (const city of cities || []) walk(city, city.name);
}

let searchActiveIdx = 0;

function openSearch() {
  const overlay = document.getElementById("search-overlay");
  overlay.classList.add("open");
  document.getElementById("search-input").value = "";
  document.getElementById("search-input").focus();
  renderSearchResults("");
}

function closeSearch() {
  document.getElementById("search-overlay").classList.remove("open");
}

function renderSearchResults(query) {
  const container = document.getElementById("search-results");
  const q = query.trim().toLowerCase();
  const results = q
    ? searchIndex
        .filter(
          (e) =>
            e.note.name.toLowerCase().includes(q) ||
            e.cityName.toLowerCase().includes(q) ||
            (e.note.tags || []).some((t) => t.includes(q)),
        )
        .slice(0, 12)
    : searchIndex.slice(0, 8);

  searchActiveIdx = 0;
  container.innerHTML = results
    .map(
      (e, i) => `
    <div class="search-item ${i === 0 ? "active" : ""}" data-idx="${i}" onclick="searchTeleport(${i})">
      <span class="si-dot" style="background:${e.note.color || "#546e7a"}"></span>
      <span class="si-name">${e.note.name}</span>
      <span class="si-city">${e.cityName}</span>
      <span class="si-links">🔗${e.note.linkCount || 0}</span>
    </div>`,
    )
    .join("");
  container._results = results;
}

function searchTeleport(idx) {
  const res = document.getElementById("search-results")._results;
  if (!res || !res[idx]) return;
  const { mesh, note } = res[idx];
  if (mesh && car) {
    const target = mesh.position;
    const dist = (mesh.userData?.note?.linkCount * 2.8) / 2 + 20;
    drv.collisionCooldown = 50;
    drv.speed = 0;
    car.position.set(target.x + dist, 0, target.z + dist);
    drv.angle = Math.atan2(
      target.x - car.position.x,
      target.z - car.position.z,
    );
    showToastMsg(`✈️ Teleported to: ${note.name}`);
  }
  closeSearch();
}

function showToastMsg(msg) {
  const n = document.createElement("div");
  n.textContent = msg;
  n.style.cssText =
    "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(4,10,32,.9);color:#aee4ff;padding:12px 22px;border-radius:10px;border:1px solid rgba(100,180,255,.3);font-size:14px;z-index:500;pointer-events:none;transition:opacity .5s";
  document.body.appendChild(n);
  setTimeout(() => {
    n.style.opacity = "0";
    setTimeout(() => n.remove(), 500);
  }, 2000);
}

// Keyboard wiring for search
document
  .getElementById("search-input")
  .addEventListener("input", (e) => renderSearchResults(e.target.value));
document.getElementById("search-input").addEventListener("keydown", (e) => {
  const res = document.getElementById("search-results")._results || [];
  const items = document.querySelectorAll(".search-item");
  if (e.key === "ArrowDown") {
    searchActiveIdx = Math.min(searchActiveIdx + 1, res.length - 1);
    items.forEach((el, i) =>
      el.classList.toggle("active", i === searchActiveIdx),
    );
    e.preventDefault();
  } else if (e.key === "ArrowUp") {
    searchActiveIdx = Math.max(searchActiveIdx - 1, 0);
    items.forEach((el, i) =>
      el.classList.toggle("active", i === searchActiveIdx),
    );
    e.preventDefault();
  } else if (e.key === "Enter") {
    searchTeleport(searchActiveIdx);
  } else if (e.key === "Escape") {
    closeSearch();
  }
});
document.getElementById("search-overlay").addEventListener("click", (e) => {
  if (e.target === document.getElementById("search-overlay")) closeSearch();
});

// ── add Ctrl+K to existing keydown listener ──────────────────────────────────
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "k") {
    e.preventDefault();
    openSearch();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  #2  BUILDING HOVER TOOLTIP
// ══════════════════════════════════════════════════════════════════════════════
const hoverRaycaster = new THREE.Raycaster();
const hoverMouse = new THREE.Vector2();
const tooltip = document.getElementById("hover-tooltip");
let lastHovered = null;

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  hoverMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  hoverMouse.y = ((e.clientY - rect.top) / rect.height) * -2 + 1;
  hoverRaycaster.setFromCamera(hoverMouse, camera);

  const hits = hoverRaycaster.intersectObjects(buildingObjects);
  if (hits.length) {
    const note = hits[0].object.userData?.note;
    if (!note) return;
    if (lastHovered !== note.id) {
      lastHovered = note.id;
      document.getElementById("ht-name").textContent = note.name;
      document.getElementById("ht-tags").innerHTML = (note.tags || [])
        .slice(0, 4)
        .map((t) => `<span class="ht-tag">#${t}</span>`)
        .join("");
      document.getElementById("ht-stat").textContent =
        `🔗 ${note.linkCount || 0} links  ·  📝 ${note.wordCount || 0} words`;
    }
    tooltip.style.display = "block";
    tooltip.style.left = e.clientX + 16 + "px";
    tooltip.style.top = e.clientY - 10 + "px";
  } else {
    tooltip.style.display = "none";
    lastHovered = null;
  }
});
canvas.addEventListener("mouseleave", () => {
  tooltip.style.display = "none";
});

// ══════════════════════════════════════════════════════════════════════════════
//  #3  GRAPH VIEW MODE
// ══════════════════════════════════════════════════════════════════════════════
function buildGraphLines(connections) {
  // delete old lines
  graphLines.forEach((l) => scene.remove(l));
  graphLines = [];

  const posMap = {};
  buildingObjects.forEach((b) => {
    if (b.userData?.note) posMap[b.userData.note.id] = b.position;
  });

  for (const { from, to } of connections || []) {
    const a = posMap[from],
      b2 = posMap[to];
    if (!a || !b2) continue;
    const mid = new THREE.Vector3().addVectors(a, b2).multiplyScalar(0.5);
    mid.y += 8; // arc
    const pts = [];
    for (let t = 0; t <= 1; t += 0.1) {
      const p = new THREE.Vector3();
      p.lerpVectors(a, b2, t);
      p.y += Math.sin(t * Math.PI) * 8;
      pts.push(p);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: 0x00ffaa,
      transparent: true,
      opacity: 0.35,
    });
    const line = new THREE.Line(geo, mat);
    line.userData.isGraphLine = true;
    scene.add(line);
    graphLines.push(line);
  }
}

function toggleGraphView() {
  graphVisible = !graphVisible;
  graphLines.forEach((l) => {
    l.visible = graphVisible;
  });
  const btn = document.getElementById("graph-btn");
  btn.classList.toggle("active", graphVisible);
  btn.textContent = graphVisible ? "🕸️ Graph ON" : "🕸️ Graph View";
}

// ══════════════════════════════════════════════════════════════════════════════
//  #4  STREET LAMPS AUTO ON/OFF
// ══════════════════════════════════════════════════════════════════════════════
function registerStreetLamp(light) {
  streetLamps.push(light);
}

function updateStreetLamps() {
  const hour = worldTime.hour + worldTime.minute / 60;
  const isNight = hour < 6.5 || hour > 18.5;
  streetLamps.forEach((l) => {
    l.intensity = isNight ? 0.55 : 0.0;
    if (l._head) l._head.material.emissiveIntensity = isNight ? 1.2 : 0;
  });
}

// ── patch buildRoad to register its lamps ──
// (called after original buildRoad to register lights)
const _origBuildRoad = buildRoad;
// add interceptor via monkey-patch
window._streetLampNodes = window._streetLampNodes || [];

// ══════════════════════════════════════════════════════════════════════════════
//  #5  CITY SELECTOR MENU
// ══════════════════════════════════════════════════════════════════════════════
function populateCitySelector(cities) {
  const sel = document.getElementById("city-select");
  sel.innerHTML = '<option value="">🏙️ Choose city...</option>';
  function addCity(city, depth) {
    const prefix = "  ".repeat(depth);
    const opt = document.createElement("option");
    opt.value = JSON.stringify({
      x: city.position?.x || 0,
      z: city.position?.z || 0,
    });
    opt.textContent = prefix + (city.name || "?");
    sel.appendChild(opt);
    (city.subfolders || []).forEach((s) => addCity(s, depth + 1));
  }
  (cities || []).forEach((c) => addCity(c, 0));
}

function teleportToCity(valStr) {
  if (!valStr || !car) return;
  try {
    const { x, z } = JSON.parse(valStr);
    drv.collisionCooldown = 50;
    drv.speed = 0;
    const cityR = 80;
    car.position.set(x + cityR + 30, 0, z);
    drv.angle = Math.PI;
    showToastMsg("🏙️ Moved to city");
  } catch (e) {}
  document.getElementById("city-select").value = "";
}

// ══════════════════════════════════════════════════════════════════════════════
//  #6  BUILDING HEIGHT LEGEND  (toggle with H key)
// ══════════════════════════════════════════════════════════════════════════════
let heightLegendVisible = false;
function toggleHeightLegend() {
  heightLegendVisible = !heightLegendVisible;
  document.getElementById("height-legend").style.display = heightLegendVisible
    ? "block"
    : "none";
}
document.addEventListener("keydown", (e) => {
  if (e.code === "KeyH") toggleHeightLegend();
});

// ══════════════════════════════════════════════════════════════════════════════
//  #7  NOTE PREVIEW ON PROXIMITY
// ══════════════════════════════════════════════════════════════════════════════
const notePreviewEl = document.getElementById("note-preview");
let lastPreviewId = null;

async function showNotePreview(note) {
  const id = note.id || note.name?.toLowerCase().replace(/\s+/g, "-");
  if (id === lastPreviewId) return;
  lastPreviewId = id;
  document.getElementById("np2-title").textContent = note.name;
  document.getElementById("np2-text").textContent = "Loading...";
  notePreviewEl.style.display = "block";

  if (notePreviewCache[id]) {
    document.getElementById("np2-text").textContent = notePreviewCache[id];
    return;
  }
  try {
    const d = await fetch(`${API}/note/${id}`).then((r) => r.json());
    const preview = (d.content || "")
      .replace(/^---[\s\S]*?---\n?/, "")
      .trim()
      .slice(0, 200);
    notePreviewCache[id] = preview || "(No content)";
    if (lastPreviewId === id)
      document.getElementById("np2-text").textContent = notePreviewCache[id];
  } catch (_) {
    document.getElementById("np2-text").textContent = "(Failed to load)";
  }
}

function hideNotePreview() {
  lastPreviewId = null;
  notePreviewEl.style.display = "none";
}

// ── patch checkProximity to show preview at closer range ──
const _origCheckProximity =
  typeof checkProximity === "function" ? checkProximity : null;
// Override proximity in animate via flag — see patch below animate

// ══════════════════════════════════════════════════════════════════════════════
//  #8  DAY/NIGHT AUTO CYCLE
// ══════════════════════════════════════════════════════════════════════════════
function toggleAutoCycle() {
  autoCycleActive = !autoCycleActive;
  const btn = document.getElementById("autocycle-btn");
  btn.classList.toggle("active", autoCycleActive);
  btn.textContent = autoCycleActive ? "⏱️ Auto ON" : "⏱️ Auto Cycle";
  if (autoCycleActive) worldTime.useRealTime = false;
  else worldTime.useRealTime = true;
}

function advanceAutoTime(dt) {
  if (!autoCycleActive) return;
  const minutesPerSecond = autoCycleSpeed / 60; // game minutes per real second
  worldTime.minute += minutesPerSecond * dt * 60; // dt in seconds (~0.016)
  if (worldTime.minute >= 60) {
    worldTime.minute -= 60;
    worldTime.hour = (worldTime.hour + 1) % 24;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  #9  FOG OF WAR
// ══════════════════════════════════════════════════════════════════════════════
function updateFogOfWar() {
  if (!car || !vaultData) return;
  const carPos = car.position;
  for (const cityGroup of scene.children.filter(
    (o) => o.userData?.isCityGroup,
  )) {
    const dist = carPos.distanceTo(cityGroup.userData.center);
    const visible = dist < 800;
    cityGroup.visible = visible;
  }
}
// Note: cities are NOT grouped yet (future: group them) — fog handled via scene.fog density

// Dynamic fog based on time of day
function updateDynamicFog() {
  const hour = worldTime.hour;
  const isNight = hour < 6 || hour > 20;
  const isSunrise = hour >= 6 && hour < 8;
  const isSunset = hour >= 18 && hour < 20;

  let density = 0.002;
  if (isNight) density = 0.0015;
  if (isSunrise || isSunset) density = 0.0035; // sunrise/sunset fog

  // Weather effect
  if (weatherSystem.type === "rainy") density += 0.001;
  if (weatherSystem.type === "cloudy") density += 0.0005;

  if (scene.fog) scene.fog.density = density;
}

// ══════════════════════════════════════════════════════════════════════════════
//  #10  CAR COLOR PICKER
// ══════════════════════════════════════════════════════════════════════════════
function changeCarColor(hex) {
  if (carBodyMesh) {
    carBodyMesh.material.color.set(hex);
    carBodyMesh.material.emissive.set(hex);
    carBodyMesh.material.emissiveIntensity = 0.25;
    // save to localStorage
    localStorage.setItem("carColor", hex);
  }
}

function loadCarColor() {
  const saved = localStorage.getItem("carColor");
  if (saved && carBodyMesh) {
    changeCarColor(saved);
    document.getElementById("car-color").value = saved;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  #11  SPEED LINES EFFECT
// ══════════════════════════════════════════════════════════════════════════════
function initSpeedLines() {
  speedLinesMeshes.forEach((l) => scene.remove(l));
  speedLinesMeshes = [];
  for (let i = 0; i < 20; i++) {
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -30)];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: 0xaaddff,
      transparent: true,
      opacity: 0,
    });
    const line = new THREE.Line(geo, mat);
    line.userData.isSpeedLine = true;
    line.userData.offset = i;
    scene.add(line);
    speedLinesMeshes.push(line);
  }
}

function updateSpeedLines(turbo, speed) {
  const active = turbo && Math.abs(speed) > 0.6;
  speedLinesMeshes.forEach((line, i) => {
    if (!car) return;
    const angle = (i / speedLinesMeshes.length) * Math.PI * 2;
    const r = 3 + Math.random() * 2;
    const baseX = car.position.x + Math.cos(angle) * r;
    const baseZ = car.position.z + Math.sin(angle) * r;
    const ahead = 25 + Math.random() * 15;
    const pts = [
      new THREE.Vector3(baseX, car.position.y + 1.5, baseZ),
      new THREE.Vector3(
        baseX - Math.sin(drv.angle) * ahead,
        car.position.y + 1.5,
        baseZ - Math.cos(drv.angle) * ahead,
      ),
    ];
    line.geometry.setFromPoints(pts);
    line.material.opacity = active ? 0.2 + Math.random() * 0.3 : 0;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  #12  BUILDING CLICK ANIMATION
// ══════════════════════════════════════════════════════════════════════════════
let clickAnimBuilding = null;
let clickAnimTime = 0;
const CLICK_ANIM_DUR = 400; // ms

function startBuildingClickAnim(mesh) {
  clickAnimBuilding = mesh;
  clickAnimTime = CLICK_ANIM_DUR;
  mesh.userData._origScaleY = mesh.userData._origScaleY || 1;
}

function updateBuildingClickAnim(dtMs) {
  if (!clickAnimBuilding || clickAnimTime <= 0) return;
  clickAnimTime -= dtMs;
  const t = clickAnimTime / CLICK_ANIM_DUR;
  const pulse = 1 + Math.sin(t * Math.PI) * 0.06;
  clickAnimBuilding.scale.set(pulse, pulse, pulse);
  if (clickAnimTime <= 0) {
    clickAnimBuilding.scale.set(1, 1, 1);
    clickAnimBuilding = null;
  }
}

// ── patch openNotePanel to trigger animation ──
const _origOpenNotePanel = openNotePanel;
window.openNotePanel = function (note) {
  _origOpenNotePanel(note);
  const mesh = buildingObjects.find((b) => b.userData?.note?.id === note.id);
  if (mesh) startBuildingClickAnim(mesh);
};

// ══════════════════════════════════════════════════════════════════════════════
//  #13  SCREENSHOT
// ══════════════════════════════════════════════════════════════════════════════
function takeScreenshot() {
  // render one frame at full res
  renderer.render(scene, camera);
  const dataURL = renderer.domElement.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = dataURL;
  a.download = `ObsidianCity3D_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.png`;
  a.click();
  showToastMsg("📸 Screenshot saved!");
}

// ══════════════════════════════════════════════════════════════════════════════
//  #14  STATS DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════
function openStats() {
  const body = document.getElementById("stats-body");

  // Calculate statistics
  const notes = buildingObjects.map((b) => b.userData?.note).filter(Boolean);
  const totalNotes = notes.length;
  const totalLinks = notes.reduce((s, n) => s + (n.linkCount || 0), 0);
  const avgLinks = totalNotes ? (totalLinks / totalNotes).toFixed(1) : 0;

  // Top 5 linked notes
  const topNotes = [...notes]
    .sort((a, b) => (b.linkCount || 0) - (a.linkCount || 0))
    .slice(0, 5);

  // Tag distribution
  const tagCount = {};
  notes.forEach((n) =>
    (n.tags || []).forEach((t) => (tagCount[t] = (tagCount[t] || 0) + 1)),
  );
  const topTags = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const maxTag = topTags[0]?.[1] || 1;

  const TAG_COLORS_DASH = {
    frontend: "#1a73e8",
    react: "#61dafb",
    backend: "#1e8449",
    ai: "#7d3c98",
    devops: "#ca6f1e",
    database: "#b03a2e",
    project: "#d4ac0d",
    default: "#546e7a",
  };
  function tagColor(t) {
    for (const [k, v] of Object.entries(TAG_COLORS_DASH))
      if (t.includes(k)) return v;
    return TAG_COLORS_DASH.default;
  }

  body.innerHTML = `
    <div class="sd-section">
      <h3>Overall Statistics</h3>
      <div class="sd-row"><span>Total Notes</span><span>${totalNotes}</span></div>
      <div class="sd-row"><span>Total Links</span><span>${totalLinks}</span></div>
      <div class="sd-row"><span>Average Links per Note</span><span>${avgLinks}</span></div>
      <div class="sd-row"><span>Cities</span><span>${(vaultData?.cities || []).length}</span></div>
    </div>
    <div class="sd-section">
      <h3>Most Linked Notes 🏆</h3>
      ${topNotes
        .map(
          (n, i) => `
        <div class="sd-row" style="cursor:pointer" onclick="openNotePanel(${JSON.stringify(n).replace(/"/g, "'")})">
          <span>${["🥇", "🥈", "🥉", "4️⃣", "5️⃣"][i]} ${n.name}</span>
          <span>🔗 ${n.linkCount || 0}</span>
        </div>`,
        )
        .join("")}
    </div>
    <div class="sd-section">
      <h3>Tag Distribution</h3>
      ${topTags
        .map(
          ([t, c]) => `
        <div class="sd-bar-label"><span>#${t}</span><span>${c}</span></div>
        <div class="sd-bar-wrap">
          <div class="sd-bar" style="width:${((c / maxTag) * 100).toFixed(0)}%;background:${tagColor(t)}"></div>
        </div>`,
        )
        .join("")}
    </div>`;

  document.getElementById("stats-modal").classList.add("open");
}

function closeStats() {
  document.getElementById("stats-modal").classList.remove("open");
}

// ══════════════════════════════════════════════════════════════════════════════
//  #15  HOT RELOAD (WebSocket note rebuild)
// ══════════════════════════════════════════════════════════════════════════════
function hotReloadNote(noteId) {
  // Find current building and update it
  const mesh = buildingObjects.find((b) => b.userData?.note?.id === noteId);
  if (!mesh) return;

  fetch(`${API}/note/${noteId}`)
    .then((r) => r.json())
    .then((d) => {
      // update note data
      const note = mesh.userData.note;
      const newLinks = (d.content?.match(/\[\[/g) || []).length;
      note.wordCount = (d.content || "").split(/\s+/).filter(Boolean).length;

      // update building color if tags changed
      if (d.tags?.length) {
        note.tags = d.tags;
        note.color = colorForTags(d.tags);
        mesh.material.color.set(note.color);
      }

      // update cache
      notePreviewCache[noteId] = null;
      showToastMsg(`🔄 Updated: ${d.name}`);
    })
    .catch(() => {});
}

// ── patch connectWS to handle vault:change with hot reload ──
const _origConnectWS = connectWS;
window.connectWS = function () {
  const wsObj = new WebSocket(WS);
  const dot = document.getElementById("ws-indicator");
  wsObj.onopen = () => {
    dot.className = "dot green";
  };
  wsObj.onclose = () => {
    dot.className = "dot red";
    setTimeout(window.connectWS, 3000);
  };
  wsObj.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "vault:change") {
      hotReloadNote(msg.noteId);
      showToastMsg(`📝 Changed: ${msg.noteId}`);
    }
  };
};

// ══════════════════════════════════════════════════════════════════════════════
//  #16  CREATE NOTE FROM CITY
// ══════════════════════════════════════════════════════════════════════════════
function openCreateNote() {
  // Populate folder list
  const folderSel = document.getElementById("cn-folder");
  folderSel.innerHTML = "";
  function addFolder(city, depth) {
    const opt = document.createElement("option");
    opt.value = city.name;
    opt.textContent = "  ".repeat(depth) + city.name;
    folderSel.appendChild(opt);
    (city.subfolders || []).forEach((s) => addFolder(s, depth + 1));
  }
  (vaultData?.cities || []).forEach((c) => addFolder(c, 0));
  document.getElementById("create-note-modal").classList.add("open");
  document.getElementById("cn-name").focus();
}

function closeCreateNote() {
  document.getElementById("create-note-modal").classList.remove("open");
}

async function submitCreateNote() {
  const name = document.getElementById("cn-name").value.trim();
  const folder = document.getElementById("cn-folder").value;
  const content = document.getElementById("cn-content").value.trim();
  const tagsRaw = document.getElementById("cn-tags").value.trim();

  if (!name) {
    alert("Note name is required");
    return;
  }

  const tags = tagsRaw ? tagsRaw.split(/\s+/).filter(Boolean) : [];
  const frontmatter = tags.length
    ? `---\ntags: [${tags.join(", ")}]\n---\n\n`
    : "";
  const fullContent = frontmatter + `# ${name}\n\n${content}`;

  try {
    const res = await fetch(`${API}/note`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, folder, content: fullContent }),
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    showToastMsg(`✅ Created: ${name}`);
    closeCreateNote();
    document.getElementById("cn-name").value = "";
    document.getElementById("cn-content").value = "";
    document.getElementById("cn-tags").value = "";
  } catch (err) {
    alert("Error: " + err.message);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  #17  MULTI-FLOOR INTERIOR
// ══════════════════════════════════════════════════════════════════════════════
let insideBuilding = false;
let buildingInteriorNote = null;

function enterBuilding(note) {
  if (!note || insideBuilding) return;
  const mesh = buildingObjects.find((b) => b.userData?.note?.id === note.id);
  if (!mesh) return;
  insideBuilding = true;
  buildingInteriorNote = note;

  // Move camera inside
  const target = mesh.position.clone();
  target.y = 4;
  camera.position.set(target.x - 2, target.y, target.z);
  camera.lookAt(target.x, target.y + 2, target.z + 2);

  showToastMsg(`🏢 Entered: ${note.name} — Press Escape to exit`);
  openNotePanel(note);
}

function exitBuilding() {
  insideBuilding = false;
  buildingInteriorNote = null;
}

// ── Escape exits building ──
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (insideBuilding) exitBuilding();
    if (document.getElementById("search-overlay").classList.contains("open"))
      closeSearch();
    if (document.getElementById("stats-modal").classList.contains("open"))
      closeStats();
    if (document.getElementById("create-note-modal").classList.contains("open"))
      closeCreateNote();
  }
  // Enter enters building when close
  if (e.code === "KeyE" && nearestBuilding && !insideBuilding) {
    enterBuilding(nearestBuilding.userData.note);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  #18  EXPORT CITY AS IMAGE (top-down)
// ══════════════════════════════════════════════════════════════════════════════
function exportCityImage() {
  const origPos = camera.position.clone();
  const origRot = camera.rotation.clone();

  // Move camera up
  camera.position.set(0, 600, 0);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  const dataURL = renderer.domElement.toDataURL("image/png");

  // Restore camera
  camera.position.copy(origPos);
  camera.rotation.copy(origRot);

  const a = document.createElement("a");
  a.href = dataURL;
  a.download = `ObsidianCity3D_Map_${Date.now()}.png`;
  a.click();
  showToastMsg("🗺️ City map exported!");
}

// ══════════════════════════════════════════════════════════════════════════════
//  INIT PATCH — Call all new features on load
// ══════════════════════════════════════════════════════════════════════════════
const _origInit = init;
window.init = async function () {
  await _origInit();

  // After building the world, run new features
  if (typeof vaultData === "undefined" || !vaultData) return;

  buildSearchIndex(vaultData.cities || []);
  buildGraphLines(vaultData.connections || []);
  populateCitySelector(vaultData.cities || []);
  initSpeedLines();
  document.getElementById("height-legend").style.display = "none";

  // Load saved car color
  setTimeout(() => {
    if (carBodyMesh) loadCarColor();
  }, 500);
};

// ══════════════════════════════════════════════════════════════════════════════
//  ANIMATE PATCH — Each frame
// ══════════════════════════════════════════════════════════════════════════════
const _origAnimate = animate;
// Add new features logic inside current loop
const _origAnimateFrame = renderer.render.bind(renderer);

// Redefine animate to add new features
// (Since animate calls requestAnimationFrame, we intercept elsewhere)
// Instead, we use a separate light RAF loop:
let _lastTime = performance.now();
function featureLoop() {
  requestAnimationFrame(featureLoop);
  const now = performance.now();
  const dtMs = now - _lastTime;
  _lastTime = now;

  // #8 Auto Cycle
  advanceAutoTime(dtMs / 1000);

  // #9 Dynamic Fog
  if (frameCount % 30 === 0) {
    updateDynamicFog();
    updateStreetLamps();
  }

  // #11 Speed Lines
  if (car) {
    const turbo = K["KeyF"];
    updateSpeedLines(turbo, drv.speed);
  }

  // #12 Building Click Animation
  updateBuildingClickAnim(dtMs);

  // #7 Note Preview Proximity (every 20 frames i.e. ~3 times/second)
  if (car && frameCount % 20 === 0) {
    let closestNote = null,
      minD = 12; // preview distance less than checkProximity
    for (const b of buildingObjects) {
      const d = car.position.distanceTo(b.position);
      if (d < minD) {
        minD = d;
        closestNote = b.userData?.note;
      }
    }
    if (closestNote) showNotePreview(closestNote);
    else hideNotePreview();
  }
}
featureLoop();

// ════════════════════════════════════════════════════════════════
//  UI REDESIGN BRIDGE — Connect script.js with new HTML
// ════════════════════════════════════════════════════════════════

// Override HUD speed update to drive new speedometer
const __origAnimRef = animate;
(function patchSpeedHUD() {
  const _origUpdate = Object.getOwnPropertyDescriptor(window, "drv");
  // Hook into the animate loop via requestAnimationFrame intercept
  // We just patch the DOM update part that writes to hud-spd
  const _oldHudSpd = document.getElementById("hud-spd");
  const _speedBar = document.getElementById("speed-bar-fill");

  // MutationObserver to intercept text changes on hidden #hud-spd placeholder
  // Instead: override via direct assignment each frame
  // The animate loop writes: document.getElementById("hud-spd").textContent = `السرعة: ...`
  // We intercept by overriding getElementById temporarily in animate context

  // Simpler: add a second RAF that reads drv.speed and updates new elements
  function syncSpeedometer() {
    requestAnimationFrame(syncSpeedometer);
    if (!window.drv) return;
    const kmh = Math.abs(drv.speed * 100);
    const turbo = window.K && window.K["KeyF"];
    const el = document.getElementById("hud-spd");
    const bar = document.getElementById("speed-bar-fill");
    if (el) el.textContent = kmh.toFixed(0) + (turbo ? " 🔥" : "");
    if (bar) bar.style.width = Math.min(100, (kmh / 120) * 100) + "%";
  }
  syncSpeedometer();
})();

// Override loading function to use new bar ID
const __origInit2 = window.init;
window.init = async function () {
  // patch loadMsg setter
  const origLoadMsg = document.getElementById("loading-msg");
  const origBar = document.getElementById("bar");
  const origLoadEl = document.getElementById("loading");

  // intercept the loadMsg writes inside init
  // We re-wire by patching document.getElementById for loading-msg
  const __origGetById = document.getElementById.bind(document);
  document.getElementById = function (id) {
    if (id === "loading-msg" && origLoadMsg) return origLoadMsg;
    if (id === "bar" && origBar) return origBar;
    return __origGetById(id);
  };

  await __origInit2();

  // restore
  document.getElementById = __origGetById;

  // Show legend after build
  setTimeout(() => {
    const leg = document.getElementById("legend");
    if (leg && !leg.classList.contains("visible")) leg.classList.add("visible");
  }, 800);
};

// Patch buildLegend to use new structure
const __origBuildLegend = buildLegend;
window.buildLegend = function () {
  const el = document.getElementById("legend");
  if (!el) return __origBuildLegend();
  el.innerHTML =
    '<div class="legend-title">Building Types</div>' +
    [
      ["Frontend", "#1a73e8"],
      ["Backend", "#1e8449"],
      ["AI / ML", "#7d3c98"],
      ["DevOps", "#ca6f1e"],
      ["Database", "#b03a2e"],
      ["Project", "#d4ac0d"],
      ["Research", "#1abc9c"],
      ["Other", "#546e7a"],
    ]
      .map(
        ([n, c]) =>
          `<div class="leg-row"><span class="leg-dot" style="background:${c}"></span><span class="leg-label">${n}</span></div>`,
      )
      .join("");
  el.classList.add("visible");
};

// Patch HUD loc (hud-loc is now in top-bar, should still work)
// Patch note panel close button class
(function fixNotePanel() {
  const oldClose = document.querySelector("#note-panel .close");
  if (oldClose) {
    oldClose.className = "np-close-btn";
  }
})();

// ════════════════════════════════════════════════════════════════
//  v4 FIX PATCH
// ════════════════════════════════════════════════════════════════

// ── FIX-2: Search — safe open/render with null guard ────────────
window.openSearch = function () {
  const overlay = document.getElementById("search-overlay");
  if (!overlay) return;
  overlay.classList.add("open");
  const inp = document.getElementById("search-input");
  if (inp) {
    inp.value = "";
    inp.focus();
  }
  renderSearchResults("");
};

window.renderSearchResults = function (query) {
  const container = document.getElementById("search-results");
  if (!container) return;
  const q = (query || "").trim().toLowerCase();
  const results = q
    ? (searchIndex || [])
        .filter(
          (e) =>
            e.note.name.toLowerCase().includes(q) ||
            e.cityName.toLowerCase().includes(q) ||
            (e.note.tags || []).some((t) => t.includes(q)),
        )
        .slice(0, 12)
    : (searchIndex || []).slice(0, 8);

  searchActiveIdx = 0;
  container.innerHTML = results.length
    ? results
        .map(
          (e, i) => `
        <div class="search-item ${i === 0 ? "active" : ""}"
             onclick="searchTeleport(${i})" data-idx="${i}">
          <span class="si-dot" style="background:${e.note.color || "#546e7a"}"></span>
          <span class="si-name">${e.note.name}</span>
          <span class="si-city">${e.cityName}</span>
          <span class="si-links">🔗${e.note.linkCount || 0}</span>
        </div>`,
        )
        .join("")
    : '<div style="padding:14px 20px;font-family:var(--fmono,monospace);font-size:.72rem;color:rgba(160,210,255,.3)">No results found</div>';
  container._results = results;
};

// Re-bind search input events (safe re-attach)
(function bindSearchInput() {
  const inp = document.getElementById("search-input");
  if (!inp) return;
  // Remove old listeners by cloning
  const fresh = inp.cloneNode(true);
  inp.parentNode.replaceChild(fresh, inp);
  fresh.addEventListener("input", (e) => renderSearchResults(e.target.value));
  fresh.addEventListener("keydown", (e) => {
    const res = document.getElementById("search-results")?._results || [];
    const items = document.querySelectorAll(".search-item");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      searchActiveIdx = Math.min(searchActiveIdx + 1, res.length - 1);
      items.forEach((el, i) =>
        el.classList.toggle("active", i === searchActiveIdx),
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      searchActiveIdx = Math.max(searchActiveIdx - 1, 0);
      items.forEach((el, i) =>
        el.classList.toggle("active", i === searchActiveIdx),
      );
    } else if (e.key === "Enter") {
      searchTeleport(searchActiveIdx);
    } else if (e.key === "Escape") {
      closeSearch();
    }
  });
})();

window.closeSearch = function () {
  document.getElementById("search-overlay")?.classList.remove("open");
};

// Ctrl+K
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "k") {
    e.preventDefault();
    openSearch();
  }
});

// Click outside closes search
document.getElementById("search-overlay")?.addEventListener("click", (e) => {
  if (e.target.id === "search-overlay") closeSearch();
});

// ── FIX-3: Car Color — patch ALL car meshes ───────────────────
// Store refs to cabin too
let carCabinMesh = null;

// Override buildCar to capture cabin ref
const __v4_origBuildCar = buildCar;
window.buildCar = function () {
  __v4_origBuildCar();
  // Find cabin (second MeshPhongMaterial child of car group)
  if (car) {
    car.traverse((child) => {
      if (child.isMesh && child !== carBodyMesh && child.material?.color) {
        const c = child.material.color.getHexString();
        if (c === "8b1a1a" || c.startsWith("8b") || c.startsWith("7b")) {
          carCabinMesh = child;
        }
      }
    });
  }
  // Apply saved color
  const saved = localStorage.getItem("carColor");
  if (saved) {
    changeCarColor(saved);
    const picker = document.getElementById("car-color");
    if (picker) picker.value = saved;
  }
};

window.changeCarColor = function (hex) {
  const c = new THREE.Color(hex);
  const dark = new THREE.Color(hex).multiplyScalar(0.55);
  if (carBodyMesh) {
    carBodyMesh.material.color.set(c);
    carBodyMesh.material.emissive.set(c);
    carBodyMesh.material.emissiveIntensity = 0.28;
  }
  if (carCabinMesh) {
    carCabinMesh.material.color.set(dark);
    carCabinMesh.material.emissive.set(dark);
    carCabinMesh.material.emissiveIntensity = 0.2;
  }
  localStorage.setItem("carColor", hex);
};
