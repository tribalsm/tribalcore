// 3D map for the TRIBALCORE home page. Three.js is loaded only when the device can afford it;
// otherwise the 2D canvas map from scene.js keeps running.

const scene = document.getElementById("scene");
const pinEls = scene ? [...scene.querySelectorAll(".pin")] : [];
const liteQuery = window.matchMedia("(max-width: 735px), (hover: none)");

function canUse3D() {
  if (!scene || !pinEls.length) return false;
  // tribalcore.bond/?2d opens the 2D map on any device.
  if (new URLSearchParams(window.location.search).has("2d")) return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  if (navigator.connection && navigator.connection.saveData) return false;
  if (liteQuery.matches) {
    if ((navigator.deviceMemory || 4) < 4) return false;
    if ((navigator.hardwareConcurrency || 4) < 4) return false;
  }
  const probe = document.createElement("canvas");
  return Boolean(probe.getContext("webgl2") || probe.getContext("webgl"));
}

if (canUse3D()) {
  const begin = () => window.setTimeout(() => {
    main().catch((error) => console.warn("3D scene disabled:", error));
  }, 300);
  if (document.readyState === "complete") begin();
  else window.addEventListener("load", begin, { once: true });
}

// Minimal GLB reader for the site's own Blender exports: node tree with transforms and
// indexed triangle meshes (positions and optional vertex colours). Textures, skins and animations are not used.
// Each mesh keeps its Blender material name in userData.material; the scene picks real materials.
async function loadGLB(THREE, url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const data = await response.arrayBuffer();
  const view = new DataView(data);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error(`${url}: not a GLB file`);
  let offset = 12, json = null, bin = null;
  while (offset < data.byteLength) {
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(data, offset + 8, length)));
    else if (type === 0x004e4942) bin = offset + 8;
    offset += 8 + length;
  }
  const ARRAYS = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const accessor = (index) => {
    const a = json.accessors[index], v = json.bufferViews[a.bufferView];
    if (v.byteStride && v.byteStride !== SIZES[a.type] * ARRAYS[a.componentType].BYTES_PER_ELEMENT) throw new Error("interleaved data");
    return new ARRAYS[a.componentType](data, bin + (v.byteOffset || 0) + (a.byteOffset || 0), a.count * SIZES[a.type]);
  };
  const build = (index) => {
    const def = json.nodes[index];
    const node = new THREE.Group();
    node.name = def.name || "";
    if (def.translation) node.position.fromArray(def.translation);
    if (def.rotation) node.quaternion.fromArray(def.rotation);
    if (def.scale) node.scale.fromArray(def.scale);
    for (const primitive of def.mesh === undefined ? [] : json.meshes[def.mesh].primitives) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(accessor(primitive.attributes.POSITION).slice(), 3));
      if (primitive.attributes.COLOR_0 !== undefined) {
        const def = json.accessors[primitive.attributes.COLOR_0];
        geometry.setAttribute("color", new THREE.BufferAttribute(accessor(primitive.attributes.COLOR_0).slice(), SIZES[def.type], Boolean(def.normalized)));
      }
      if (primitive.indices !== undefined) geometry.setIndex(new THREE.BufferAttribute(accessor(primitive.indices).slice(), 1));
      const materialName = primitive.material === undefined ? "" : json.materials[primitive.material].name;
      const mesh = new THREE.Mesh(geometry);
      mesh.userData.material = materialName;
      node.add(mesh);
    }
    for (const child of def.children || []) node.add(build(child));
    return node;
  };
  const root = new THREE.Group();
  for (const index of json.scenes[json.scene || 0].nodes) root.add(build(index));
  return root;
}

async function main() {
  const THREE = await import("/assets/vendor/three.module.min.js");
  const lite = liteQuery.matches;
  const portraitQuery = window.matchMedia("(max-width: 735px)");
  const touchQuery = window.matchMedia("(hover: none)");
  const card = document.getElementById("scene-card");
  const cardTitle = card.querySelector("strong");
  const cardDesc = card.querySelector(".card-desc");
  const cardLink = card.querySelector(".card-link");
  const live = document.getElementById("scene-live");
  const driveButton = document.getElementById("drive");
  const hint = document.getElementById("hint-text");

  const NIGHT = 0x070c1c, PAPER = 0xe9eefb, BODY = 0x2a3c6e, AMBER = 0xffb547;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  const pins = pinEls.map((el) => {
    const style = getComputedStyle(el);
    const read = (name) => style.getPropertyValue(name).trim();
    return {
      el, id: el.dataset.id, title: el.dataset.title, desc: el.dataset.desc, cta: el.dataset.cta,
      href: el.getAttribute("href"), color: read("--c"),
      fx: parseFloat(read("--x")), fy: parseFloat(read("--y")),
      mx: parseFloat(read("--mx")), my: parseFloat(read("--my")),
      pos: new THREE.Vector3(), found: false, glow: 0, light: null, ring: null, blip: null, accents: [],
    };
  });

  // Renderer and world.
  const renderer = new THREE.WebGLRenderer({ antialias: !lite, powerPreference: lite ? "low-power" : "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1 : 1.75));
  renderer.shadowMap.enabled = !lite;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.className = "scene-webgl";
  canvas.setAttribute("aria-hidden", "true");
  scene.insertBefore(canvas, scene.querySelector(".pins"));

  const world = new THREE.Scene();
  world.background = new THREE.Color(NIGHT);
  world.fog = new THREE.Fog(NIGHT, 34, 80);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 200);
  world.add(new THREE.HemisphereLight(0x7f96cc, 0x0c1328, 1.1));
  const moon = new THREE.DirectionalLight(0x9db4e6, 0.35);
  moon.position.set(-10, 20, -8);
  world.add(moon);

  const edgeMaterial = new THREE.LineBasicMaterial({ color: PAPER, transparent: true, opacity: 0.55 });
  function solid(geometry, material, edges = true) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = !lite;
    mesh.receiveShadow = !lite;
    if (edges) mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 30), edgeMaterial));
    return mesh;
  }
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: BODY, roughness: 0.85, flatShading: true });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x0b1226, roughness: 0.9, flatShading: true });
  for (const m of [edgeMaterial, bodyMaterial, darkMaterial]) m.userData.keep = true;
  function accentMaterial(pin) {
    const material = new THREE.MeshStandardMaterial({ color: pin.color, emissive: pin.color, emissiveIntensity: 0.12, roughness: 0.6, flatShading: true });
    pin.accents.push(material);
    return material;
  }

  // Rover: forward is +x. The simple box rover below is shown until the Blender model
  // (models/rover.py -> /assets/models/rover.glb) loads, and stays if loading fails.
  const rover = new THREE.Group();
  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x22335f, roughness: 0.8, flatShading: true });
  const lampMaterial = new THREE.MeshBasicMaterial({ color: AMBER });
  const tailMaterial = new THREE.MeshBasicMaterial({ color: 0xff6b6b });
  const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: AMBER }));
  const simple = new THREE.Group();
  let roverBody = solid(new THREE.BoxGeometry(1.7, 0.5, 1.05), bodyMaterial);
  let bodyBase = 0.55;
  roverBody.position.y = bodyBase;
  const cabin = solid(new THREE.BoxGeometry(0.8, 0.42, 0.86), trimMaterial);
  cabin.position.set(-0.1, 0.99, 0);
  simple.add(roverBody, cabin);
  // Wheels roll by the distance driven; the loaded model swaps in its own list and axle.
  let wheels = [];
  // Parts of the loaded rover model that animate: front wheels steer, the antenna dish turns.
  let frontWheels = [], roverAntenna = null, wheelYaw = 0;
  // Body sway: squats on acceleration, dives under braking, leans out of turns, settles on a spring.
  const sway = { pitch: 0, pitchSpeed: 0, roll: 0, rollSpeed: 0, lastSpeed: 0 };
  let rollWheel = (wheel, distance) => { wheel.rotation.y += distance / 0.3; };
  for (const [x, z] of [[0.55, 0.56], [-0.55, 0.56], [0.55, -0.56], [-0.55, -0.56]]) {
    const wheel = solid(new THREE.CylinderGeometry(0.3, 0.3, 0.24, 12), darkMaterial);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, 0.3, z);
    wheels.push(wheel);
    simple.add(wheel);
  }
  const antenna = solid(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6), bodyMaterial, false);
  antenna.position.set(-0.55, 1.15, -0.3);
  antennaTip.position.set(-0.55, 1.52, -0.3);
  simple.add(antenna, antennaTip);
  for (const z of [0.3, -0.3]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.22), lampMaterial);
    lamp.position.set(0.86, 0.62, z);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.18), tailMaterial);
    tail.position.set(-0.86, 0.62, z * 1.05);
    simple.add(lamp, tail);
  }
  rover.add(simple);
  const headlights = [];
  function headlight(z) {
    const light = new THREE.SpotLight(0xffc46b, lite ? 420 : 260, 30, 0.5, 0.5, 1.6);
    light.position.set(0.8, 0.75, z);
    light.target.position.set(9, 0, z * 3);
    if (!lite) {
      light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.bias = -0.0006;
      light.shadow.camera.near = 0.5;
      light.shadow.camera.far = 28;
    }
    rover.add(light, light.target);
    headlights.push(light);
    return light;
  }
  if (lite) headlight(0); else { headlight(0.3); headlight(-0.3); }
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(4.2, 11, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.rotation.z = Math.PI / 2;
  beam.position.set(0.9 + 5.5, 0.7, 0);
  rover.add(beam);
  world.add(rover);

  // Blender model. Materials are swapped by name for the site's own flat materials.
  const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x4a6fae, emissive: 0x1d3566, emissiveIntensity: 0.6, roughness: 0.3, flatShading: true });
  const roverMaterials = { body: bodyMaterial, trim: trimMaterial, tire: darkMaterial, glass: glassMaterial, lamp: lampMaterial, tail: tailMaterial, accent: lampMaterial };
  const ROVER_SCALE = 0.9;
  // Tyres, lamps and the project colour stay without white edges: at map scale they turn into noise.
  const NO_EDGES = new Set(["tire", "lamp", "tail", "accent", "paper", "figure", "ink"]);
  function outline(model) {
    model.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = !lite && object.userData.material !== "glass";
      object.receiveShadow = !lite;
      object.geometry.userData.keep = true;
      // Figures are shaded smooth, like painted resin; everything else stays faceted.
      if (object.userData.material === "figure") object.geometry.computeVertexNormals();
      if (!NO_EDGES.has(object.userData.material)) {
        const edges = new THREE.EdgesGeometry(object.geometry, 30);
        edges.userData.keep = true;
        object.add(new THREE.LineSegments(edges, edgeMaterial));
      }
    });
    return model;
  }
  function dress(model, pick) {
    model.traverse((object) => { if (object.isMesh) object.material = pick(object.parent.name, object.userData.material); });
    return model;
  }
  loadGLB(THREE, "/assets/models/rover.glb").then((model) => {
    if (!alive) return;
    dress(outline(model), (node, name) => (node === "antenna" && name === "lamp" ? antennaTip.material : roverMaterials[name] || bodyMaterial));
    model.scale.setScalar(ROVER_SCALE);
    rover.remove(simple);
    simple.traverse((child) => { if (child.geometry) child.geometry.dispose(); });
    rover.add(model);
    roverBody = model.getObjectByName("rover_body");
    wheels = model.children.filter((child) => child.name.startsWith("wheel_"));
    rollWheel = (wheel, distance) => { wheel.rotation.z -= distance / 0.27; };
    frontWheels = wheels.filter((wheel) => wheel.name.endsWith("0"));
    roverAntenna = model.getObjectByName("antenna");
    // The antenna rides on the body so it sways with it.
    if (roverAntenna) model.getObjectByName("rover_body")?.attach(roverAntenna);
    bodyBase = roverBody.position.y;
    headlights.forEach((light) => light.position.set(0.9, 0.55, Math.sign(light.position.z) * 0.24));
  }).catch((error) => console.warn("Rover model not loaded:", error));

  const state = { x: 0, z: 0, angle: -0.6, speed: 0 };
  let startAngle = -0.6;
  const keys = { up: false, down: false, left: false, right: false };
  let target = null, current = null, active = false, touched = false, alive = true;
  let mapW = 44, mapD = 28, unit = 1, hub = { x: 0, z: 0 };
  let root = null;

  function disposeTree(object) {
    object.traverse((child) => {
      if (child.geometry && !child.geometry.userData.keep) child.geometry.dispose();
      if (child.material && !child.material.userData.keep) {
        [].concat(child.material).forEach((m) => m.dispose());
      }
    });
  }

  function seeded(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Project models from Blender (models/<id>.py). The simple shapes below stand in until the file
  // loads and stay for projects that have no model yet or if loading fails.
  const STATION_FILES = new Set(["nightscout", "debugych", "meeting", "quizroom", "mail"]);
  const screenMaterial = new THREE.MeshStandardMaterial({ color: 0x070c1c, emissive: 0x0b1530, roughness: 0.4, flatShading: true });
  const paperMaterial = new THREE.MeshStandardMaterial({ color: 0xc9d3ec, roughness: 1, flatShading: true });
  // Lenses are see-through so the object under them stays visible from the camera.
  const lensMaterial = new THREE.MeshBasicMaterial({ color: 0x9fc2ff, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  // Characters (Debugych and his bug) carry their own colours from the original textures
  // and are shaded smooth and slightly glossy, like a painted figurine.
  const figureMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.05 });
  for (const m of [trimMaterial, screenMaterial, paperMaterial, lensMaterial, figureMaterial]) m.userData.keep = true;
  const stationTemplates = {};
  let buildId = 0;
  // Until it is found a project is only a dark shape with barely visible outlines: no colour, no glow,
  // no motion. The headlights reveal it (see discover()).
  const shadeMaterial = new THREE.MeshStandardMaterial({ color: 0x0a1124, roughness: 1, flatShading: true });
  const faintEdgeMaterial = new THREE.LineBasicMaterial({ color: PAPER, transparent: true, opacity: 0.14 });
  for (const m of [shadeMaterial, faintEdgeMaterial]) m.userData.keep = true;
  function veil(pin, group) {
    if (pin.found) return;
    group.traverse((object) => {
      if (object.userData.veil) return;
      if (object.isLight || object.isPoints || object.isInstancedMesh || (object.isMesh && object.material.transparent)) {
        object.userData.veil = { visible: object.visible };
        object.visible = false;
      } else if (object.isMesh) {
        object.userData.veil = { material: object.material };
        object.material = shadeMaterial;
      } else if (object.isLineSegments) {
        object.userData.veil = { material: object.material };
        object.material = faintEdgeMaterial;
      }
    });
  }
  function unveil(group) {
    group.traverse((object) => {
      const saved = object.userData.veil;
      if (!saved) return;
      if (saved.material) object.material = saved.material; else object.visible = saved.visible;
      delete object.userData.veil;
    });
  }
  function swapInModel(pin, group, accent) {
    const id = buildId;
    stationTemplates[pin.id] ||= loadGLB(THREE, `/assets/models/${pin.id}.glb`).then(outline);
    stationTemplates[pin.id].then((template) => {
      if (!alive || id !== buildId) return;
      const materials = { body: bodyMaterial, trim: trimMaterial, screen: screenMaterial, paper: paperMaterial, glass: lensMaterial, figure: figureMaterial, ink: screenMaterial, accent, lamp: accent };
      const copy = dress(template.clone(), (node, name) => materials[name] || bodyMaterial);
      // The accent material stays: the model uses it and the glow animation tracks it.
      group.traverse((child) => { if (child.geometry) child.geometry.dispose(); });
      group.clear();
      group.add(copy);
      pin.parts = animatedParts(pin, copy);
      veil(pin, group);
    }).catch((error) => console.warn(`Model ${pin.id} not loaded:`, error));
  }

  // Small loops that make each project model feel alive, plus a short "performance" when the
  // rover finds it. Driven from decorate(); everything is built from the loaded model.
  const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
  const turn = new THREE.Quaternion();
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  const glowMaterial = (color, opacity) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  function animatedParts(pin, model) {
    const get = (name) => model.getObjectByName(name);
    const withBase = (node) => node && { node, base: node.quaternion.clone(), y: node.position.y };
    if (pin.id === "nightscout") {
      // Scan line on the screen, a beacon on top, and a real searchlight beam with a spot on the ground.
      const screen = get("screen");
      const scan = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.05, 0.004), glowMaterial(pin.color, 0.8));
      scan.position.z = 0.096;
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff5a4f }));
      beacon.position.y = 0.53;
      screen?.add(scan, beacon);
      const cone = new THREE.ConeGeometry(1, 1, 24, 1, true);
      cone.translate(0, -0.5, 0); // tip at the origin, opening downwards
      const beam = new THREE.Mesh(cone, glowMaterial(0xffe2a8, 0.07));
      const spot = new THREE.Mesh(new THREE.CircleGeometry(1, 32), glowMaterial(0xffd28a, 0.22));
      spot.rotation.x = -Math.PI / 2;
      root.add(beam, spot);
      const light = withBase(get("searchlight"));
      const ahead = new THREE.Vector3(1, 0, 0).applyQuaternion(light.base);
      light.yaw0 = Math.atan2(-ahead.z, ahead.x);
      return { scan, beacon, beam, spot, searchlight: light, track: 0, hold: 0 };
    }
    if (pin.id === "debugych") return { hero: withBase(get("debugych")), bug: withBase(get("bug")) };
    if (pin.id === "meeting") {
      // Light pulses run along the tape from the cassette into the spec.
      const halo = glowMaterial(pin.color, 0.18);
      const pulses = [0, 1, 2].map(() => {
        const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), glowMaterial(0xffffff, 0.75));
        pulse.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), halo));
        model.add(pulse);
        return pulse;
      });
      const path = [new THREE.Vector3(-0.12, 0.54, -0.08), new THREE.Vector3(0.02, 0.43, 0.62), new THREE.Vector3(0.2, 0.51, 0)];
      // The marker on the spec steps down the text lines, as if each line is being written from the recording.
      const marker = get("highlight");
      const markerMesh = marker?.children.find((child) => child.isMesh);
      if (markerMesh) markerMesh.material = glowMaterial(pin.color, 0.5);
      return { reels: [get("reel_L"), get("reel_R")].filter(Boolean), pulses, path, phase: 0,
        marker, markerMesh, markerBase: marker?.position.clone(), rows: 0 };
    }
    if (pin.id === "quizroom") {
      const buzzers = [1, 2, 3].map((i) => get(`buzzer_${i}`)).filter(Boolean).map((node) => ({
        node, y: node.position.y, dome: node.children.find((child) => child.isMesh && child.userData.material !== "trim"),
      }));
      // A ring of light flashes from the pressed buzzer; confetti falls while the rover is here.
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.17, 32), glowMaterial(pin.color, 0.9));
      ring.rotation.x = -Math.PI / 2;
      const count = lite ? 18 : 36;
      const confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.045), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), count);
      const palette = [pin.color, 0xffb547, 0xe9eefb, 0xb9a3ff, 0xff8a7a].map((c) => new THREE.Color(c));
      for (let i = 0; i < count; i++) confetti.setColorAt(i, palette[i % palette.length]);
      confetti.visible = false;
      model.add(confetti);
      return { buzzers, accent: pin.accents[0], ring, confetti, count, active: -1 };
    }
    if (pin.id === "mail") {
      // The door opens as the rover arrives, the envelope slides out, rises and circles the box;
      // when the rover leaves it flies back in and the door shuts.
      const letter = get("letter");
      if (letter) letter.rotation.order = "YXZ";
      return { flag: get("flag"), door: get("door"), letter, rest: letter?.position.clone(),
        open: 0, angle: 0, flagAngle: Math.PI / 2, flagSpeed: 0 };
    }
    return null;
  }

  let lastDecorate = 0;
  let fireflies = null;
  // Soft round dot for point sprites (drawn on a canvas, so nothing extra is downloaded).
  const softDot = (() => {
    const dot = document.createElement("canvas");
    dot.width = dot.height = 32;
    const g = dot.getContext("2d");
    const fade = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    fade.addColorStop(0, "rgba(255,255,255,1)");
    fade.addColorStop(0.4, "rgba(255,255,255,0.6)");
    fade.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = fade;
    g.fillRect(0, 0, 32, 32);
    const texture = new THREE.CanvasTexture(dot);
    texture.userData.keep = true;
    return texture;
  })();
  const FLY = new THREE.Color(0xffd98a);
  function animateFireflies(time) {
    if (!fireflies) return;
    const base = fireflies.userData.base;
    const pos = fireflies.geometry.attributes.position, col = fireflies.geometry.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i,
        base[i * 3] + Math.sin(time * 0.0004 + i * 1.7) * 0.7,
        base[i * 3 + 1] + Math.sin(time * 0.0011 + i) * 0.3,
        base[i * 3 + 2] + Math.cos(time * 0.0005 + i * 2.3) * 0.7);
      const light = Math.max(0, Math.sin(time * 0.0021 + i * 3.1)) ** 2;
      col.setXYZ(i, FLY.r * light, FLY.g * light, FLY.b * light);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  // Dust from the rear wheels at speed: a small pool of points that rise, spread and fade.
  const DUST = lite ? 16 : 40;
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(DUST * 3).fill(-50), 3));
  dustGeometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(DUST * 3), 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({
    size: 0.5, map: softDot, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  dust.frustumCulled = false;
  world.add(dust);
  const dustLife = new Float32Array(DUST), dustVel = new Float32Array(DUST * 3);
  let dustNext = 0, dustDue = 0;
  function animateDust(dt) {
    const pos = dustGeometry.attributes.position, col = dustGeometry.attributes.color;
    const speed = Math.abs(state.speed);
    dustDue += speed > 2.5 ? dt * 30 * Math.min(1, speed / 9) : 0;
    const fx = Math.cos(state.angle), fz = Math.sin(state.angle);
    while (dustDue >= 1) {
      dustDue -= 1;
      const i = dustNext, side = i % 2 ? 1 : -1;
      dustNext = (dustNext + 1) % DUST;
      const back = state.speed > 0 ? -0.75 : 0.75;
      pos.setXYZ(i, state.x + (fx * back - fz * side * 0.55) * unit, 0.15, state.z + (fz * back + fx * side * 0.55) * unit);
      dustVel.set([(Math.random() - 0.5) * 0.6 - fx * Math.sign(state.speed) * 0.5, 0.45 + Math.random() * 0.3,
        (Math.random() - 0.5) * 0.6 - fz * Math.sign(state.speed) * 0.5], i * 3);
      dustLife[i] = 1;
    }
    for (let i = 0; i < DUST; i++) {
      if (dustLife[i] <= 0) { col.setXYZ(i, 0, 0, 0); continue; }
      dustLife[i] = Math.max(0, dustLife[i] - dt * 1.3);
      pos.setXYZ(i, pos.getX(i) + dustVel[i * 3] * dt, pos.getY(i) + dustVel[i * 3 + 1] * dt, pos.getZ(i) + dustVel[i * 3 + 2] * dt);
      const fade = dustLife[i] * 0.45;
      col.setXYZ(i, 0.55 * fade, 0.6 * fade, 0.75 * fade);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }
  const dummy3 = new THREE.Object3D();
  function animateParts(pin, time, dt) {
    // Reactions follow the rover being here now (nearGlow), not the project having been found once.
    pin.nearGlow += ((pin.near ? 1 : 0) - pin.nearGlow) * Math.min(1, dt * 3);
    const parts = pin.parts, glow = pin.nearGlow;
    if (!parts) return;
    if (parts.scan) parts.scan.position.y = 0.38 - ((time * 0.00035) % 1) * 0.76;
    if (parts.beacon) parts.beacon.visible = time % 1400 < 220;
    if (parts.beam) {
      // Sweep around the tower. Once the rover is found the beam locks on and keeps following it
      // for a couple of seconds after it leaves, then lets go and returns to the sweep.
      if (pin.near) { parts.track = Math.min(1, parts.track + dt * 3); parts.hold = 2.5; }
      else if (parts.hold > 0) parts.hold -= dt * (Math.hypot(state.x - pin.pos.x, state.z - pin.pos.z) > 14 * unit ? 3 : 1);
      else parts.track = Math.max(0, parts.track - dt / 1.6);
      const follow = parts.track * parts.track * (3 - 2 * parts.track);
      const node = parts.searchlight.node, a = time * 0.00045, r = 4.5 * unit;
      tmpB.set(pin.pos.x + Math.cos(a) * r, 0.03, pin.pos.z + Math.sin(a) * r * 0.75);
      tmpB.x += (state.x - tmpB.x) * follow;
      tmpB.z += (state.z - tmpB.z) * follow;
      node.getWorldPosition(tmpA);
      tmpA.y += 0.26 * unit;
      turn.setFromAxisAngle(UP, Math.atan2(-(tmpB.z - tmpA.z), tmpB.x - tmpA.x) - parts.searchlight.yaw0);
      node.quaternion.copy(turn).multiply(parts.searchlight.base);
      parts.beam.position.copy(tmpA);
      tmpB.sub(tmpA);
      const length = tmpB.length(), radius = length * 0.13;
      parts.beam.quaternion.setFromUnitVectors(DOWN, tmpB.normalize());
      parts.beam.scale.set(radius, length, radius);
      parts.spot.position.copy(tmpA).addScaledVector(tmpB, length);
      parts.spot.position.y = 0.04;
      parts.spot.scale.setScalar(radius * 1.15);
    }
    if (parts.hero) {
      // Debugych looks around; when the rover comes, he turns a little more.
      turn.setFromAxisAngle(UP, Math.sin(time * 0.0009) * (0.08 + glow * 0.12));
      parts.hero.node.quaternion.copy(turn).multiply(parts.hero.base);
    }
    if (parts.bug) {
      // The bug fidgets, and trembles and hops when the headlights find it.
      const fear = 0.3 + glow;
      turn.setFromAxisAngle(UP, Math.sin(time * 0.025) * 0.06 * fear);
      parts.bug.node.quaternion.copy(turn).multiply(parts.bug.base);
      parts.bug.node.position.y = parts.bug.y + Math.abs(Math.sin(time * 0.011)) * 0.05 * fear;
    }
    if (parts.reels) for (const reel of parts.reels) reel.rotation.z -= dt * (1 + glow * 1.5);
    if (parts.pulses) {
      parts.phase += dt * (0.16 + glow * 0.14);
      const [p0, p1, p2] = parts.path;
      parts.pulses.forEach((pulse, i) => {
        const t = (parts.phase + i / parts.pulses.length) % 1, u = 1 - t;
        pulse.position.set(0, 0, 0).addScaledVector(p0, u * u).addScaledVector(p1, 2 * u * t).addScaledVector(p2, t * t);
        // Fade in at the cassette and out at the sheet instead of popping.
        pulse.scale.setScalar(Math.sin(Math.PI * t) * (0.8 + glow * 0.25));
      });
    }
    if (parts.marker) {
      parts.rows += dt * (0.4 + glow * 0.25);
      const row = Math.floor(parts.rows) % 6, step = parts.rows % 1;
      parts.marker.position.copy(parts.markerBase);
      parts.marker.translateY(-row * 0.085);
      // Soft fade in and out on each line rather than a blink.
      parts.markerMesh.material.opacity = 0.42 * Math.sin(Math.PI * step);
    }
    if (parts.buzzers) {
      // Players buzz in turn: the pressed button dips, lights up and sends out a ring.
      const period = glow > 0.5 ? 650 : 1100, active = Math.floor(time / period) % parts.buzzers.length, phase = (time % period) / period;
      parts.buzzers.forEach((buzzer, i) => {
        if (buzzer.dome) buzzer.dome.material = i === active ? parts.accent : paperMaterial;
        buzzer.node.position.y = buzzer.y - (i === active && phase < 0.16 ? 0.025 : 0);
      });
      if (parts.active !== active) { parts.active = active; parts.buzzers[active].node.add(parts.ring); }
      parts.ring.position.y = 0.1;
      parts.ring.scale.setScalar(1 + phase * 3);
      parts.ring.material.opacity = 0.9 * (1 - phase);
    }
    if (parts.confetti) {
      parts.confetti.visible = glow > 0.05;
      if (parts.confetti.visible) {
        for (let i = 0; i < parts.count; i++) {
          const fall = (time * 0.00035 + i / parts.count) % 1;
          dummy3.position.set(Math.sin(i * 12.9) * 1.1 + Math.sin(time * 0.002 + i) * 0.12, 2.6 - fall * 2.4, Math.cos(i * 7.3) * 0.55);
          dummy3.rotation.set(time * 0.004 + i, time * 0.003 + i * 2, 0);
          dummy3.scale.setScalar(glow);
          dummy3.updateMatrix();
          parts.confetti.setMatrixAt(i, dummy3.matrix);
        }
        parts.confetti.instanceMatrix.needsUpdate = true;
      }
    }
    if (parts.door) {
      // One eased progress value drives the whole sequence: door, then slide out, then lift.
      // Opening is brisk; after the rover leaves the envelope first glides back to the front of the
      // box, and only then slowly tucks itself in and the door shuts.
      const home = Math.abs(wrap(parts.angle)) < 0.35;
      if (pin.near) parts.open += (1 - parts.open) * Math.min(1, dt * 1.6);
      else if (home) parts.open -= parts.open * Math.min(1, dt * 0.75);
      const ease = (v) => { const c = Math.min(1, Math.max(0, v)); return c * c * (3 - 2 * c); };
      const door = ease(parts.open / 0.35), slide = ease((parts.open - 0.25) / 0.35), lift = ease((parts.open - 0.55) / 0.45);
      parts.door.rotation.x = door * 1.35;
      if (parts.letter) {
        // Out of the mouth and up in front of the box...
        tmpA.copy(parts.rest);
        tmpA.z += slide * 0.55;
        tmpA.y += lift * 0.75;
        // ...then onto a circle around the box, starting from the front. While the rover is near the
        // circle keeps turning; on the way back the angle eases home so the envelope re-enters at the front.
        const orbit = ease((parts.open - 0.7) / 0.3);
        if (pin.near) parts.angle += dt * 1.3 * orbit;
        else parts.angle -= wrap(parts.angle) * Math.min(1, dt * 0.9);
        const a = parts.angle, radius = 0.95;
        tmpB.set(Math.sin(a) * radius, 0.95 + Math.sin(a * 2) * 0.1, Math.cos(a) * radius);
        parts.letter.position.lerpVectors(tmpA, tmpB, orbit);
        parts.letter.position.y += Math.sin(time * 0.0022) * 0.04 * lift;
        // Face outwards, tipped up towards the camera, with a little flutter.
        parts.letter.rotation.set(lift * 1.05, a * orbit, Math.sin(time * 0.003) * 0.12 * lift);
      }
      // The flag goes up while the rover is here, with a little spring.
      const want = pin.near ? 0 : Math.PI / 2;
      parts.flagSpeed += ((want - parts.flagAngle) * 60 - parts.flagSpeed * 9) * dt;
      parts.flagAngle += parts.flagSpeed * dt;
      parts.flag.rotation.x = parts.flagAngle;
    }
  }

  function model(pin) {
    const group = new THREE.Group();
    const accent = accentMaterial(pin);
    const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); group.add(mesh); return mesh; };
    if (STATION_FILES.has(pin.id)) swapInModel(pin, group, accent);
    if (pin.id === "nightscout") {
      add(solid(new THREE.BoxGeometry(1.3, 0.2, 1.3), bodyMaterial), 0, 0.1, 0);
      add(solid(new THREE.CylinderGeometry(0.08, 0.1, 2.2, 6), bodyMaterial), 0, 1.3, 0);
      add(solid(new THREE.BoxGeometry(1.1, 0.12, 1.1), bodyMaterial), 0, 2.45, 0);
      add(solid(new THREE.BoxGeometry(1.5, 0.9, 0.08), accent), 0, 3.0, -0.2);
      const lamp = add(solid(new THREE.CylinderGeometry(0.16, 0.24, 0.36, 8), bodyMaterial), 0.45, 2.7, 0.3);
      lamp.rotation.z = Math.PI / 2;
    } else if (pin.id === "debugych") {
      const ring = add(solid(new THREE.TorusGeometry(0.85, 0.09, 8, 28), bodyMaterial), 0, 1.75, 0);
      ring.rotation.y = 0.5;
      const handle = add(solid(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6), bodyMaterial), 0.55, 0.62, 0.32);
      handle.rotation.z = 0.6;
      const bug = add(solid(new THREE.SphereGeometry(0.38, 10, 8), accent), 0, 0.3, 0);
      bug.scale.set(1, 0.6, 1.4);
      add(solid(new THREE.SphereGeometry(0.17, 8, 6), accent), 0, 0.32, 0.6);
      for (const s of [-1, 1]) for (const z of [-0.25, 0.05, 0.35]) {
        const leg = add(solid(new THREE.BoxGeometry(0.42, 0.04, 0.04), bodyMaterial, false), s * 0.42, 0.18, z);
        leg.rotation.z = s * -0.4;
      }
    } else if (pin.id === "meeting") {
      add(solid(new THREE.BoxGeometry(2, 0.3, 1.2), bodyMaterial), 0, 0.15, 0);
      add(solid(new THREE.BoxGeometry(1.1, 0.03, 0.5), darkMaterial, false), 0, 0.31, 0);
      for (const x of [-0.45, 0.45]) add(solid(new THREE.CylinderGeometry(0.22, 0.22, 0.09, 12), accent), x, 0.36, 0);
      const sheet = add(solid(new THREE.BoxGeometry(1, 0.04, 1.3), new THREE.MeshStandardMaterial({ color: 0xc9d3ec, roughness: 1, flatShading: true })), 1.7, 0.6, 0);
      sheet.rotation.z = 0.95;
    } else if (pin.id === "quizroom") {
      [[-1, 0.6, bodyMaterial], [0, 0.95, accent], [1, 0.45, bodyMaterial]].forEach(([x, h, domeMaterial]) => {
        add(solid(new THREE.BoxGeometry(0.8, h, 0.8), bodyMaterial), x, h / 2, 0);
        add(solid(new THREE.SphereGeometry(0.28, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), domeMaterial), x, h, 0);
      });
      add(solid(new THREE.BoxGeometry(2, 0.75, 0.08), bodyMaterial), 0, 2.0, -0.7);
      [[-0.55, 0.25], [0, 0.45], [0.55, 0.32]].forEach(([x, h]) => add(solid(new THREE.BoxGeometry(0.28, h, 0.04), accent, false), x, 1.72 + h / 2, -0.65));
    } else {
      add(solid(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 6), bodyMaterial), 0, 0.55, 0);
      add(solid(new THREE.BoxGeometry(1, 0.5, 0.6), bodyMaterial), 0, 1.33, 0);
      const roof = add(solid(new THREE.CylinderGeometry(0.3, 0.3, 1, 12, 1, false, 0, Math.PI), bodyMaterial), 0, 1.58, 0);
      roof.rotation.z = Math.PI / 2;
      add(solid(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 5), bodyMaterial, false), 0.56, 1.6, 0.2);
      add(solid(new THREE.BoxGeometry(0.4, 0.24, 0.03), accent), 0.76, 1.88, 0.2);
    }
    group.scale.setScalar(unit);
    return group;
  }

  function ribbon(points, width) {
    const positions = [], indices = [];
    points.forEach((p, i) => {
      const next = points[Math.min(i + 1, points.length - 1)], prev = points[Math.max(i - 1, 0)];
      const dx = next.x - prev.x, dz = next.z - prev.z, len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len * width / 2, nz = dx / len * width / 2;
      positions.push(p.x + nx, 0.02, p.z + nz, p.x - nx, 0.02, p.z - nz);
      // Counter-clockwise seen from above, so the strip faces up (the other order faced down and was culled).
      if (i < points.length - 1) { const a = i * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  function build() {
    if (root) { world.remove(root); disposeTree(root); }
    buildId += 1;
    pins.forEach((pin) => { pin.accents = []; pin.light = null; pin.parts = null; });
    root = new THREE.Group();
    const portrait = portraitQuery.matches;
    // An exploration map: bigger than one screen, the camera follows the rover, and the projects are
    // spread out so that from the start at most one (NightScout) is in sight; the rest have to be found.
    mapW = portrait ? 22 : 64;
    mapD = portrait ? 50 : 40;
    unit = portrait ? 0.85 : 1;
    // World positions relative to the start. The 2D and static maps show the whole field at once and keep
    // their own spots from the stylesheet (--x/--y, --mx/--my).
    const layout = portrait ? {
      start: [0, -4],
      nightscout: [3, -5], debugych: [-6, -15], mail: [7, 10], meeting: [-6, 14], quizroom: [4, 24],
    } : {
      start: [0, 0],
      nightscout: [6, -5], debugych: [22, -12], quizroom: [20, 11], meeting: [-18, 8], mail: [-16, -11],
    };
    hub = { x: layout.start[0], z: layout.start[1] };
    for (const pin of pins) {
      const spot = layout[pin.id];
      if (spot) pin.pos.set(hub.x + spot[0], 0, hub.z + spot[1]);
      else pin.pos.set(((portrait ? pin.mx : pin.fx) - 0.5) * mapW, 0, ((portrait ? pin.my : pin.fy) - 0.5) * mapD);
    }

    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x15234a, roughness: 1 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(mapW + 40, mapD + 40), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = !lite;
    root.add(ground);
    const size = Math.ceil(Math.max(mapW, mapD) + 40);
    const grid = new THREE.GridHelper(size, size / 2, 0x4a5f92, 0x283866);
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    grid.position.y = 0.01;
    root.add(grid);
    const edge = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(a * mapW / 2, 0.03, b * mapD / 2))),
      new THREE.LineDashedMaterial({ color: AMBER, dashSize: 0.6, gapSize: 0.6, transparent: true, opacity: 0.45 }),
    );
    edge.computeLineDistances();
    root.add(edge);

    // A network of trails drawn like a site plan: a main trail through the start (sparse centre line) and
    // forks off it. Some forks lead to a project and end at its ring, some wander off to a lookout, so the
    // visitor has to choose where to go. Thin pale kerbs, and a fill in the ground's own colour that hides
    // the grid inside the trail. Only a hint: the rover still drives anywhere.
    const kerbMaterial = new THREE.LineBasicMaterial({ color: PAPER, transparent: true, opacity: 0.4 });
    const centreMaterial = new THREE.LineDashedMaterial({ color: PAPER, dashSize: 0.35, gapSize: 0.6, transparent: true, opacity: 0.3 });
    const mainWidth = 1.3 * unit, forkWidth = 1.0 * unit, lookoutRadius = 0.9 * unit;
    const ringOf = (pin) => blockOf(pin) + 0.07 * unit;
    const P = ([x, z]) => new THREE.Vector3(hub.x + x, 0, hub.z + z);
    // Trails in start-relative coordinates; "to" is the project a fork ends at, "lookout" a viewpoint.
    const plan = portrait ? [
      { main: true, way: [[0.5, -19], [1, -12], [0.6, -6], [0, 0], [-0.8, 7], [-0.4, 13], [0.6, 19]] },
      { way: [[0.9, -12.5], [-2.5, -14], [-6, -15]], to: "debugych" },
      { way: [[-0.6, 5.5], [3.5, 8], [7, 10]], to: "mail" },
      { way: [[-0.5, 11.5], [-3.5, 13], [-6, 14]], to: "meeting" },
      { way: [[0.6, 19], [2, 21.5], [4, 24]], to: "quizroom" },
      { way: [[0.2, -1.5], [-3.5, -2.5], [-7, -3.5]], lookout: true },
      { way: [[1, -9], [4, -10.5], [7, -12.5]], lookout: true },
    ] : [
      { main: true, way: [[-28, 3], [-17, 2.5], [-8, 2], [0, 0], [9, -1], [17, 0], [28, -1]] },
      { way: [[3.5, -0.5], [5, -2.5], [6, -5]], to: "nightscout" },
      { way: [[15, -0.3], [18, -6], [22, -12]], to: "debugych" },
      { way: [[19, 0], [20, 5.5], [20, 11]], to: "quizroom" },
      { way: [[-13, 2.3], [-16, 5], [-18, 8]], to: "meeting" },
      { way: [[-7, 1.8], [-12, -4], [-16, -11]], to: "mail" },
      { way: [[2, -0.2], [3, 6], [6, 11]], lookout: true },
      { way: [[-2, 0.6], [-4, -5], [-3, -12]], lookout: true },
      { way: [[25, -0.8], [27, -8], [26, -15]], lookout: true },
    ];
    const lookouts = [];
    const trails = plan.map((trail) => {
      const way = trail.way.map(P);
      const pin = trail.to && pins.find((p) => p.id === trail.to);
      if (pin) {
        // End where the trail meets the project's ring.
        const prev = way[way.length - 2];
        way[way.length - 1] = pin.pos.clone().addScaledVector(prev.clone().sub(pin.pos).normalize(), ringOf(pin));
      }
      if (trail.lookout) lookouts.push(way[way.length - 1]);
      const length = way.reduce((sum, p, i) => sum + (i ? p.distanceTo(way[i - 1]) : 0), 0);
      const points = new THREE.CatmullRomCurve3(way, false, "centripetal").getPoints(Math.max(12, Math.round(length * 4)));
      return { points, width: trail.main ? mainWidth : forkWidth, main: !!trail.main };
    });
    const samples = trails.flatMap((t) => t.points);
    for (const t of trails) {
      const fill = new THREE.Mesh(ribbon(t.points, t.width), groundMaterial);
      fill.receiveShadow = !lite;
      root.add(fill);
    }
    // Lookouts: a small round clearing with a pale outline.
    for (const spot of lookouts) {
      const pad = new THREE.Mesh(new THREE.CircleGeometry(lookoutRadius, 28), groundMaterial);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(spot.x, 0.021, spot.z);
      root.add(pad);
      const rim = [];
      for (let k = 0; k <= 40; k++) { const a = k / 40 * Math.PI * 2; rim.push(new THREE.Vector3(spot.x + Math.cos(a) * lookoutRadius, 0.04, spot.z + Math.sin(a) * lookoutRadius)); }
      root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rim), kerbMaterial));
    }
    // A kerb stops where it runs onto another trail, into a lookout or into a project's ring.
    const covered = (v, own) => trails.some((t, j) => j !== own && t.points.some((p) => Math.hypot(p.x - v.x, p.z - v.z) < t.width / 2 - 0.02))
      || lookouts.some((l) => Math.hypot(l.x - v.x, l.z - v.z) < lookoutRadius - 0.02)
      || pins.some((pin) => Math.hypot(pin.pos.x - v.x, pin.pos.z - v.z) < ringOf(pin) - 0.02);
    trails.forEach((t, i) => {
      const { points, width: w } = t;
      const kerbs = [];
      for (const side of [-1, 1]) {
        const line = points.map((p, k) => {
          const next = points[Math.min(k + 1, points.length - 1)], prev = points[Math.max(k - 1, 0)];
          const dx = next.x - prev.x, dz = next.z - prev.z, len = Math.hypot(dx, dz) || 1;
          return new THREE.Vector3(p.x - dz / len * side * w / 2, 0.04, p.z + dx / len * side * w / 2);
        });
        for (let k = 0; k < line.length - 1; k++) if (!covered(line[k], i) && !covered(line[k + 1], i)) kerbs.push(line[k], line[k + 1]);
      }
      // Rounded caps where a trail simply ends (both ends of the main trail).
      if (t.main) {
        for (const [end, inner] of [[points[0], points[1]], [points[points.length - 1], points[points.length - 2]]]) {
          const back = Math.atan2(end.z - inner.z, end.x - inner.x);
          for (let k = 0; k < 12; k++) {
            const a0 = back + Math.PI / 2 - (k / 12) * Math.PI, a1 = back + Math.PI / 2 - ((k + 1) / 12) * Math.PI;
            kerbs.push(new THREE.Vector3(end.x + Math.cos(a0) * w / 2, 0.04, end.z + Math.sin(a0) * w / 2),
              new THREE.Vector3(end.x + Math.cos(a1) * w / 2, 0.04, end.z + Math.sin(a1) * w / 2));
          }
          const capFill = new THREE.Mesh(new THREE.CircleGeometry(w / 2, 20), groundMaterial);
          capFill.rotation.x = -Math.PI / 2;
          capFill.position.set(end.x, 0.02, end.z);
          root.add(capFill);
        }
        const centre = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p.x, 0.04, p.z))), centreMaterial);
        centre.computeLineDistances();
        root.add(centre);
      }
      root.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(kerbs), kerbMaterial));
    });
    // The rover starts on the main trail, facing along it towards the first project.
    {
      const main = trails.find((t) => t.main).points, first = pins.find((p) => p.id === "nightscout") || pins[0];
      let k = 0, best = Infinity;
      main.forEach((p, i) => { const d = Math.hypot(p.x - hub.x, p.z - hub.z); if (d < best) { best = d; k = i; } });
      const a = main[Math.max(k - 1, 0)], b = main[Math.min(k + 1, main.length - 1)];
      let dx = b.x - a.x, dz = b.z - a.z;
      if (dx * (first.pos.x - hub.x) + dz * (first.pos.z - hub.z) < 0) { dx = -dx; dz = -dz; }
      startAngle = Math.atan2(dz, dx);
    }

    const random = seeded(23);
    const treeGeometry = new THREE.ConeGeometry(0.45, 1.4, 5);
    treeGeometry.translate(0, 0.7, 0);
    // Scaled with the bigger map.
    const treeCount = lite ? 70 : 170;
    const trees = new THREE.InstancedMesh(treeGeometry, new THREE.MeshStandardMaterial({ color: 0x2b5a78, roughness: 0.9, flatShading: true }), treeCount);
    trees.castShadow = !lite;
    const dummy = new THREE.Object3D();
    let placed = 0;
    obstacles = pins.map((pin) => ({ x: pin.pos.x, z: pin.pos.z, r: blockOf(pin) }));
    for (let tries = 0; placed < treeCount && tries < treeCount * 20; tries++) {
      const x = (random() - 0.5) * (mapW + 10), z = (random() - 0.5) * (mapD + 10);
      const clear = samples.every((p) => Math.hypot(p.x - x, p.z - z) > 1.8)
        && pins.every((p) => Math.hypot(p.pos.x - x, p.pos.z - z) > blockOf(p) + 2.4)
        && Math.hypot(hub.x - x, hub.z - z) > 3;
      if (!clear) continue;
      const scale = (0.7 + random() * 0.8) * unit;
      dummy.position.set(x, 0, z);
      dummy.scale.setScalar(scale);
      obstacles.push({ x, z, r: 0.45 * scale + ROVER_RADIUS * unit });
      dummy.rotation.y = random() * Math.PI;
      dummy.updateMatrix();
      trees.setMatrixAt(placed++, dummy.matrix);
    }
    trees.count = placed;
    root.add(trees);

    // Fireflies drift over the map and blink (additive vertex colours: black is invisible).
    const flyCount = lite ? 24 : 60;
    const flyBase = new Float32Array(flyCount * 3);
    for (let i = 0; i < flyCount; i++) {
      flyBase.set([(random() - 0.5) * mapW, 0.6 + random() * 1.8, (random() - 0.5) * mapD], i * 3);
    }
    const flyGeometry = new THREE.BufferGeometry();
    flyGeometry.setAttribute("position", new THREE.BufferAttribute(flyBase.slice(), 3));
    flyGeometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(flyCount * 3), 3));
    fireflies = new THREE.Points(flyGeometry, new THREE.PointsMaterial({
      size: 0.34, map: softDot, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    fireflies.userData.base = flyBase;
    fireflies.frustumCulled = false;
    root.add(fireflies);

    for (const pin of pins) {
      pin.found = false;
      const station = model(pin);
      station.position.copy(pin.pos);
      root.add(station);
      pin.station = station;
      veil(pin, station);
      const ring = new THREE.Mesh(new THREE.RingGeometry(blockOf(pin) - 0.08 * unit, blockOf(pin) + 0.07 * unit, 48), new THREE.MeshBasicMaterial({ color: pin.color, transparent: true, opacity: 0.2, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(pin.pos.x, 0.05, pin.pos.z);
      root.add(ring);
      pin.ring = ring;
      const blip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: pin.color, transparent: true, opacity: 0.7 }));
      blip.position.set(pin.pos.x, 4.2 * unit, pin.pos.z);
      root.add(blip);
      pin.blip = blip;
      if (!lite) {
        pin.light = new THREE.PointLight(pin.color, 0, 8, 1.5);
        // In front of the model, towards the camera: inside a tall model the light would blow out its top.
        pin.light.position.set(pin.pos.x, 2.4 * unit, pin.pos.z + 1.6 * unit);
        root.add(pin.light);
      }
      pin.glow = 0;
      pin.near = false;
      pin.nearGlow = 0;
    }
    world.add(root);
    // The rover starts on the road, facing along it.
    Object.assign(state, { x: hub.x, z: hub.z, speed: 0, angle: startAngle });
    target = null;
    reversing = 0;
    hideCard();
    sinceFind = 0;
    updateCount();
  }

  // Camera follows the rover from above at three quarters.
  const lookAt = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  let width = 1, height = 1;
  function resize() {
    width = scene.clientWidth || 1;
    height = scene.clientHeight || 1;
    renderer.setSize(width, height, false);
    sizeDark();
    camera.aspect = width / height;
    // A tall phone screen is narrow: widen the lens so both project columns fit across it.
    camera.fov = portraitQuery.matches ? 44 : 36;
    // Keep the rover to the right of the hero text on wide screens.
    if (!portraitQuery.matches) camera.setViewOffset(width, height, -width * 0.16, 0, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  function placeCamera(snap, dt = 0.016) {
    const portrait = portraitQuery.matches;
    // On a phone the camera stays over the middle of the road and only half-follows sideways,
    // standing further back so the view is about 11 units across.
    const tx = portrait ? state.x * 0.5 : clamp(state.x, -mapW / 2 + 6, mapW / 2 - 6);
    const tz = clamp(state.z, -mapD / 2 + 4, mapD / 2 - 4);
    const back = portrait ? 12.6 : 10.5;
    const want = new THREE.Vector3(tx, portrait ? 16.3 : 12.5, tz + back);
    if (snap) camPos.copy(want); else camPos.lerp(want, 1 - Math.exp(-dt * 3.5));
    lookAt.set(camPos.x, 0, camPos.z - back);
    camera.position.copy(camPos);
    camera.lookAt(lookAt);
  }

  // Simulation.
  // Clearance between the rover centre and each project model (models differ in size).
  const BLOCK = { nightscout: 1.5, debugych: 1.6, meeting: 1.6, quizroom: 1.9, mail: 1.3 };
  const ROVER_RADIUS = 0.6;
  let obstacles = [];
  let reversing = 0, stuckTime = 0, dodge = 1;
  const blockOf = (pin) => (BLOCK[pin.id] || 1.6) * unit;
  const findOf = (pin) => blockOf(pin) + 1.9 * unit;

  // A target inside an obstacle or past the map edge is moved to the nearest place the rover can reach.
  function reachable(x, z) {
    const mx = mapW / 2 - 1.3, mz = mapD / 2 - 1.3;
    x = clamp(x, -mx, mx);
    z = clamp(z, -mz, mz);
    for (const o of obstacles) {
      const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), edge = o.r + 0.9 * unit;
      if (d < edge) {
        let ux = dx, uz = dz;
        if (d < 0.001) { ux = state.x - o.x; uz = state.z - o.z; }
        const len = Math.hypot(ux, uz) || 1;
        return { x: o.x + ux / len * edge, z: o.z + uz / len * edge };
      }
    }
    return { x, z };
  }

  // Where the autopilot steers right now: straight at the target, or past the side of the first
  // obstacle that stands on the straight line (the target's own project is ignored).
  function aimPoint(tx, tz, skip) {
    const dx = tx - state.x, dz = tz - state.z, len = Math.hypot(dx, dz);
    if (len < 0.01) return { x: tx, z: tz };
    const ux = dx / len, uz = dz / len;
    let block = null, along = Infinity, offset = 0;
    for (const o of obstacles) {
      if (o === skip) continue;
      const ox = o.x - state.x, oz = o.z - state.z;
      const t = ox * ux + oz * uz;
      const s = -ox * uz + oz * ux;
      if (t <= 0 || t - o.r > len || Math.abs(s) > o.r + 0.35 * unit || t >= along) continue;
      block = o; along = t; offset = s;
    }
    if (!block) return { x: tx, z: tz };
    // Pass on the side the rover is already on (the one it remembers, for a dead-centre hit).
    const side = Math.abs(offset) > 0.05 ? -Math.sign(offset) : dodge;
    const clear = block.r + 0.9 * unit;
    return { x: block.x - uz * side * clear + ux * block.r * 0.6, z: block.z + ux * side * clear + uz * block.r * 0.6 };
  }
  function driveTo(x, z, stop, pin = null) {
    const spot = pin ? { x, z } : reachable(x, z);
    target = { x: spot.x, z: spot.z, stop, pin, skip: pin ? obstacles[pins.indexOf(pin)] : null, best: Infinity, idle: 0, age: 0 };
    reversing = 0;
    stuckTime = 0;
    touched = true;
    marker.position.set(spot.x, 0.06, spot.z);
    marker.visible = !pin;
    // Every accepted tap flashes the ring, so the visitor sees it registered even before the rover turns.
    marker.userData.pop = 1;
  }
  const driveToPin = (pin) => driveTo(pin.pos.x, pin.pos.z, blockOf(pin) + 1 * unit, pin);

  function update(dt) {
    const MAX = lite ? 7.5 : 9, ACC = 16, TURN = 2.5;
    let throttle = 0, steer = 0, cap = Infinity;
    const manual = keys.up || keys.down || keys.left || keys.right;
    if (manual) {
      target = null;
      reversing = 0;
      throttle = keys.up ? 1 : keys.down ? -0.6 : 0;
      steer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    } else if (target) {
      const dist = Math.hypot(target.x - state.x, target.z - state.z);
      const aim = aimPoint(target.x, target.z, target.skip);
      const diff = wrap(Math.atan2(aim.z - state.z, aim.x - state.x) - state.angle);
      // Watchdog: if the distance has not shrunk for a few seconds the rover is circling or boxed in, so it stops.
      if (dist < target.best - 0.25) { target.best = dist; target.idle = 0; } else target.idle += dt;
      target.age += dt;
      // A point right beside the rover is inside its turning circle: after a short try, close enough counts as arrived.
      const beside = target.age > 1.5 && dist < 1.3 * unit + target.stop && Math.abs(diff) > 1.1;
      if (dist <= target.stop || beside || target.idle > 4) {
        target = null;
        reversing = 0;
      } else if (reversing > 0) {
        // Blocked: back up and swing aside, then try again from a new angle.
        reversing = Math.max(0, reversing - dt);
        throttle = -0.7;
        steer = dodge;
      } else if (Math.abs(diff) > 2.2 && dist < 4 * unit) {
        // The target is right behind: back up with the wheels turned so the nose swings toward it.
        throttle = -0.7;
        steer = -clamp(diff * 2.4, -1, 1);
      } else {
        steer = clamp(diff * 2.4, -1, 1);
        throttle = clamp(dist / 5, 0.3, 1) * (Math.abs(diff) > 1.5 ? 0.35 : 1);
      }
      // Slow down near the target and in sharp turns, so the turning circle never exceeds the distance left.
      cap = (dist * 1.6 + 0.6) * (Math.abs(diff) > 0.8 && Math.abs(diff) < 2.2 ? 0.45 : 1);
    }
    // Pressing against the motion brakes harder than the engine accelerates.
    const braking = throttle * state.speed < 0 ? 2.2 : 1;
    state.speed += throttle * ACC * braking * dt;
    state.speed *= 1 - Math.min(1, dt * (throttle ? 0.7 : 3));
    state.speed = clamp(state.speed, -Math.min(MAX * 0.5, cap), Math.min(MAX, cap));
    // Car steering: turning needs motion, gets sharper with speed up to a limit, and reverses when backing up.
    state.angle = wrap(state.angle + steer * TURN * clamp(state.speed / 2.5, -1, 1) * dt);

    const intended = Math.abs(state.speed * dt);
    let nx = state.x + Math.cos(state.angle) * state.speed * dt;
    let nz = state.z + Math.sin(state.angle) * state.speed * dt;
    const mx = mapW / 2 - 1, mz = mapD / 2 - 1;
    nx = clamp(nx, -mx, mx);
    nz = clamp(nz, -mz, mz);
    for (const o of obstacles) {
      const dx = nx - o.x, dz = nz - o.z, d = Math.hypot(dx, dz);
      // Only movement toward an obstacle is blocked; the rover slides along it and can always drive away.
      if (d < o.r && d > 0.001 && d < Math.hypot(state.x - o.x, state.z - o.z)) {
        nx = o.x + dx / d * o.r;
        nz = o.z + dz / d * o.r;
      }
    }
    const moved = Math.hypot(nx - state.x, nz - state.z);
    if (intended > 0.0001 && moved < intended * 0.98) state.speed *= 0.6 + 0.4 * (moved / intended);
    // Autopilot that pushes but barely moves is stuck: back up and swing aside.
    if (target && Math.abs(throttle) > 0.2 && moved < dt * 0.4) stuckTime += dt; else stuckTime = 0;
    if (stuckTime > 0.35 && !reversing) { reversing = 0.7; stuckTime = 0; dodge = -dodge; }
    state.x = nx; state.z = nz;
    if (moved) document.dispatchEvent(new CustomEvent("scene:distance", { detail: moved * 25 }));
    rover.position.set(state.x, 0, state.z);
    rover.rotation.y = -state.angle;
    rover.scale.setScalar(unit);
    for (const wheel of wheels) rollWheel(wheel, state.speed * dt);
    // Front wheels follow the steering input (Euler XYZ: roll about the axle, then turn about the vertical).
    wheelYaw += (-steer * 0.45 - wheelYaw) * Math.min(1, dt * 10);
    for (const wheel of frontWheels) wheel.rotation.y = wheelYaw;
    const accel = dt > 0 ? (state.speed - sway.lastSpeed) / dt : 0;
    sway.lastSpeed = state.speed;
    const wantPitch = clamp(accel * 0.007, -0.1, 0.1);
    const wantRoll = clamp(-steer * state.speed * 0.014, -0.11, 0.11);
    sway.pitchSpeed += ((wantPitch - sway.pitch) * 70 - sway.pitchSpeed * 7) * dt;
    sway.pitch += sway.pitchSpeed * dt;
    sway.rollSpeed += ((wantRoll - sway.roll) * 70 - sway.rollSpeed * 7) * dt;
    sway.roll += sway.rollSpeed * dt;
    checkPins();
  }

  function checkPins() {
    let nearest = null, best = Infinity;
    for (const pin of pins) {
      const d = Math.hypot(pin.pos.x - state.x, pin.pos.z - state.z);
      pin.near = d < findOf(pin);
      if (d - findOf(pin) < best - (nearest ? findOf(nearest) : 0)) { best = d; nearest = pin; }
      // Found when the headlights reach it (ahead, within the beam) or when the rover rolls up to it,
      // but only once the visitor has started driving: nothing is found for them while they just look.
      if (!pin.found && touched) {
        const off = Math.abs(wrap(Math.atan2(pin.pos.z - state.z, pin.pos.x - state.x) - state.angle));
        if (pin.near || (d < 9 * unit && off < 0.45)) discover(pin);
      }
    }
    if (nearest && best < findOf(nearest)) {
      if (current !== nearest) showCard(nearest);
    } else if (current && Math.hypot(current.pos.x - state.x, current.pos.z - state.z) > findOf(current) + 2.2 * unit
               && !card.contains(document.activeElement) && document.activeElement !== current.el) {
      hideCard();
    }
  }

  // Progress: "Найдено N из 5" in the hint bar; when all are found, a firework of fireflies and a
  // pointer to the contacts. Every visit starts a new game (nothing is stored).
  const counter = document.createElement("p");
  counter.className = "scene-count";
  hint.after(counter);
  let sinceFind = 0, finaleTime = -1;
  function updateCount() {
    const found = pins.filter((pin) => pin.found).length;
    counter.replaceChildren();
    if (found < pins.length) {
      counter.textContent = `Найдено ${found} из ${pins.length}`;
      return;
    }
    const link = document.createElement("a");
    link.href = "#contact";
    link.textContent = "напишите мне";
    counter.append("Все проекты найдены — ", link);
  }
  function discover(pin) {
    pin.found = true;
    if (pin.station) unveil(pin.station);
    if (pin.parts?.beam) { pin.parts.beam.visible = true; pin.parts.spot.visible = true; }
    sinceFind = 0;
    updateCount();
    const all = pins.every((p) => p.found);
    live.textContent = all ? `Найдено: ${pin.title}. Все проекты найдены.` : `Найдено: ${pin.title}`;
    if (all) finaleTime = 0;
  }

  // A visitor who has found nothing for 15 seconds gets a soft arrow towards the nearest unfound
  // project: at the edge of the map when it is off screen, above it when it is in view.
  const arrow = document.createElement("div");
  arrow.className = "scene-arrow";
  arrow.setAttribute("aria-hidden", "true");
  scene.append(arrow);
  function placeArrow(dt) {
    const left = pins.filter((pin) => !pin.found);
    sinceFind += dt;
    if (!left.length || sinceFind < 15) { arrow.classList.remove("is-on"); return; }
    let goal = left[0], best = Infinity;
    for (const pin of left) { const d = Math.hypot(pin.pos.x - state.x, pin.pos.z - state.z); if (d < best) { best = d; goal = pin; } }
    const p = screenOf(goal), m = 34;
    let x, y, angle;
    if (p.x > m && p.x < width - m && p.y > m + 30 && p.y < height - m) {
      x = p.x; y = p.y - 46 * unit - 20; angle = Math.PI / 2;
    } else {
      roverPoint.set(state.x, 0.6 * unit, state.z).project(camera);
      const cx = (roverPoint.x + 1) / 2 * width, cy = (1 - roverPoint.y) / 2 * height;
      angle = Math.atan2(p.y - cy, p.x - cx);
      // Walk from the rover towards the target until the edge margin.
      const tx = Math.cos(angle), ty = Math.sin(angle);
      const k = Math.min(tx > 0 ? (width - m - cx) / tx : tx < 0 ? (m - cx) / tx : Infinity,
        ty > 0 ? (height - m - cy) / ty : ty < 0 ? (m - cy) / ty : Infinity);
      x = cx + tx * k; y = cy + ty * k;
    }
    arrow.style.transform = `translate(${x - 8}px, ${y - 9}px) rotate(${angle}rad)`;
    arrow.classList.add("is-on");
  }

  // Night: the map is always dark, except in the headlight beam and a small pool of light around
  // the rover. Found projects light up their surroundings in their own colour and become landmarks;
  // the beacons of unfound projects shine through the dark as faint lights.
  // Drawn on a low-resolution 2D canvas above the 3D one; the hint, card and arrow stay above it.
  const dark = document.createElement("canvas");
  dark.className = "scene-dark";
  dark.setAttribute("aria-hidden", "true");
  canvas.after(dark);
  const darkCtx = dark.getContext("2d");
  const darkScale = lite ? 0.5 : 0.75;
  const spriteOf = (stops) => {
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 64;
    const g = sprite.getContext("2d"), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    stops.forEach(([at, colour]) => grad.addColorStop(at, colour));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return sprite;
  };
  const softHole = spriteOf([[0, "rgba(255,255,255,1)"], [0.45, "rgba(255,255,255,.85)"], [1, "rgba(255,255,255,0)"]]);
  const beaconGlow = spriteOf([[0, "rgba(233,238,251,1)"], [0.18, "rgba(233,238,251,.6)"], [1, "rgba(233,238,251,0)"]]);
  // A coloured glow per project, for the light it casts once found.
  const tintGlow = (pin) => pin.darkGlow ||= (() => {
    const hex = new THREE.Color(pin.color).getHexString();
    const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
    return spriteOf([[0, `rgba(${rgb},.55)`], [0.5, `rgba(${rgb},.22)`], [1, `rgba(${rgb},0)`]]);
  })();
  function sizeDark() {
    dark.width = Math.max(1, Math.round(width * darkScale));
    dark.height = Math.max(1, Math.round(height * darkScale));
  }
  const darkPoint = new THREE.Vector3();
  function toDark(x, y, z) {
    darkPoint.set(x, y, z).project(camera);
    return [(darkPoint.x + 1) / 2 * dark.width, (1 - darkPoint.y) / 2 * dark.height, darkPoint.z];
  }
  // A soft ellipse around a point (the ground is seen at an angle): a hole in the dark, or a glow.
  function splash(sprite, x, y, z, r, alpha) {
    if (alpha <= 0.01) return;
    const [cx, cy, depth] = toDark(x, y, z);
    if (depth > 1) return;
    const rx = Math.abs(toDark(x + r, y, z)[0] - cx);
    const ry = Math.abs(toDark(x, y, z + r)[1] - toDark(x, y, z - r)[1]) / 2;
    if (cx + rx < 0 || cx - rx > dark.width || cy + ry < 0 || cy - ry > dark.height) return;
    darkCtx.globalAlpha = alpha;
    darkCtx.drawImage(sprite, cx - rx, cy - ry, rx * 2, ry * 2);
  }
  function drawDark(time) {
    const w = dark.width, h = dark.height;
    darkCtx.globalCompositeOperation = "source-over";
    darkCtx.globalAlpha = 1;
    darkCtx.clearRect(0, 0, w, h);
    darkCtx.fillStyle = "rgba(3, 6, 16, .95)";
    darkCtx.fillRect(0, 0, w, h);
    darkCtx.globalCompositeOperation = "destination-out";
    // Found projects: a pool of light on the ground and one higher up, so the whole model shows.
    for (const pin of pins) {
      if (pin.glow < 0.01) continue;
      const breathe = 1 + Math.sin(time * 0.0015 + pin.pos.x) * 0.04;
      splash(softHole, pin.pos.x, 0, pin.pos.z, 4.4 * unit * breathe, 0.95 * pin.glow);
      splash(softHole, pin.pos.x, 1.6 * unit, pin.pos.z, 2.4 * unit, 0.9 * pin.glow);
    }
    splash(softHole, state.x, 0, state.z, 2.6 * unit, 1);
    // The finale firework lights up a wide circle for a moment.
    if (finaleTime >= 0) splash(softHole, state.x, 1.5, state.z, 8 * unit, 0.85 * Math.min(1, finaleTime * 4, (3 - finaleTime) / 1.2));
    // The beam: soft pools along the heading, wider and fainter further out.
    const ca = Math.cos(state.angle), sa = Math.sin(state.angle);
    for (let s = 1; s <= 8.6; s += 0.8) {
      splash(softHole, state.x + ca * s * unit, 0, state.z + sa * s * unit, (0.7 + s * 0.45) * unit, s > 6 ? 1 - (s - 6) / 3.5 : 1);
    }
    darkCtx.globalCompositeOperation = "source-over";
    // The light of found projects is tinted with their colour.
    for (const pin of pins) splash(tintGlow(pin), pin.pos.x, 0, pin.pos.z, 5 * unit, 0.5 * pin.glow);
    // Beacons of unfound projects pierce the dark.
    for (const pin of pins) {
      if (pin.glow > 0.95) continue;
      const [bx, by, depth] = toDark(pin.pos.x, pin.blip.position.y, pin.pos.z);
      if (depth > 1) continue;
      const r = (lite ? 16 : 22) * darkScale;
      darkCtx.globalAlpha = (1 - pin.glow) * (0.45 + 0.3 * Math.sin(time * 0.003 + pin.pos.x));
      darkCtx.drawImage(beaconGlow, bx - r, by - r, r * 2, r * 2);
    }
    darkCtx.globalAlpha = 1;
  }

  // Finale: fireflies burst up from the rover in the projects' colours.
  let burst = null;
  function animateFinale(dt) {
    if (finaleTime < 0) return;
    if (!burst) {
      const count = lite ? 60 : 120, colours = pins.map((pin) => new THREE.Color(pin.color));
      const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3), velocity = [];
      for (let i = 0; i < count; i++) {
        positions.set([state.x, 1, state.z], i * 3);
        colours[i % colours.length].toArray(colors, i * 3);
        const a = Math.random() * Math.PI * 2, up = 4 + Math.random() * 5, out = 1.5 + Math.random() * 3.5;
        velocity.push([Math.cos(a) * out, up, Math.sin(a) * out]);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      burst = new THREE.Points(geometry, new THREE.PointsMaterial({
        size: 0.45, map: softDot, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      burst.userData.velocity = velocity;
      burst.frustumCulled = false;
      world.add(burst);
    }
    finaleTime += dt;
    const positions = burst.geometry.attributes.position;
    burst.userData.velocity.forEach((v, i) => {
      v[1] -= 6 * dt;
      positions.setXYZ(i, positions.getX(i) + v[0] * dt, Math.max(0.1, positions.getY(i) + v[1] * dt), positions.getZ(i) + v[2] * dt);
    });
    positions.needsUpdate = true;
    burst.material.opacity = Math.max(0, 1 - Math.max(0, finaleTime - 1.6) / 1.4);
    if (finaleTime > 3) {
      world.remove(burst);
      burst.geometry.dispose();
      burst.material.dispose();
      burst = null;
      finaleTime = -1;
    }
  }

  const projected = new THREE.Vector3();
  function screenOf(pin) {
    projected.set(pin.pos.x, 1.4 * unit, pin.pos.z).project(camera);
    return { x: (projected.x + 1) / 2 * width, y: (1 - projected.y) / 2 * height };
  }
  function showCard(pin) {
    current = pin;
    cardSpot = 0;
    card.style.setProperty("--c", pin.color);
    cardTitle.textContent = pin.title;
    cardDesc.textContent = pin.desc;
    cardLink.textContent = pin.cta;
    cardLink.href = pin.href;
    card.hidden = false;
    scene.classList.add("has-card");
    placeCard();
  }
  function hideCard() { current = null; card.hidden = true; scene.classList.remove("has-card"); }
  const roverPoint = new THREE.Vector3();
  const heroParts = [...document.querySelectorAll(".hero-text > *")];
  let cardSpot = 0;
  function placeCard() {
    if (!current) return;
    const p = screenOf(current), cw = card.offsetWidth, ch = card.offsetHeight;
    // On a phone a floating card would cover most of the map: dock it along the bottom edge
    // (its width comes from the stylesheet).
    if (portraitQuery.matches) {
      card.style.left = "12px";
      card.style.top = `${height - ch - 12}px`;
      return;
    }
    roverPoint.set(state.x, 0.6 * unit, state.z).project(camera);
    const rx = (roverPoint.x + 1) / 2 * width, ry = (1 - roverPoint.y) / 2 * height;
    // Try beside, above and below the project; take the first spot that fits and leaves the rover visible.
    const spots = [
      [p.x + 40, p.y - ch / 2], [p.x - 40 - cw, p.y - ch / 2],
      [p.x - cw / 2, p.y - 50 - ch], [p.x - cw / 2, p.y + 50],
    ].map(([x, y]) => [clamp(x, 12, width - cw - 12), clamp(y, 12, height - ch - 12)]);
    // Keep clear of the rover and of the hero text that sits over the scene on wide screens.
    const sceneBox = scene.getBoundingClientRect();
    const textBoxes = heroParts.map((el) => el.getBoundingClientRect())
      .map((b) => ({ l: b.left - sceneBox.left, t: b.top - sceneBox.top, r: b.right - sceneBox.left, b: b.bottom - sceneBox.top }));
    const blocksView = ([x, y]) => (rx > x - 45 && rx < x + cw + 45 && ry > y - 45 && ry < y + ch + 45)
      || textBoxes.some((b) => x < b.r + 12 && x + cw > b.l - 12 && y < b.b + 12 && y + ch > b.t - 12);
    // Stay on the current side while it still works, so the card does not jump around.
    if (blocksView(spots[cardSpot])) {
      const free = spots.findIndex((spot) => !blocksView(spot));
      cardSpot = free === -1 ? 0 : free;
    }
    const [left, top] = spots[cardSpot];
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }
  function placePins() {
    for (const pin of pins) {
      const p = screenOf(pin);
      pin.el.style.left = `${clamp(p.x, 28, width - 28)}px`;
      pin.el.style.top = `${clamp(p.y, 28, height - 28)}px`;
    }
  }

  const paleColor = new THREE.Color(PAPER);
  function decorate(time) {
    const dt = lastDecorate ? Math.min(0.1, (time - lastDecorate) / 1000) : 0;
    lastDecorate = time;
    if (roverAntenna) roverAntenna.rotation.y = time * 0.0015;
    animateFireflies(time);
    animateDust(dt);
    animateFinale(dt);
    for (const pin of pins) {
      if (pin.found) animateParts(pin, time, dt);
      else if (pin.parts?.beam) { pin.parts.beam.visible = false; pin.parts.spot.visible = false; }
      pin.glow += ((pin.found ? 1 : 0) - pin.glow) * 0.05;
      // Ring and beacon are pale until the project is found, then take its colour.
      pin.ring.material.color.lerpColors(paleColor, pin.tint ||= new THREE.Color(pin.color), pin.glow);
      pin.blip.material.color.lerpColors(paleColor, pin.tint, pin.glow);
      pin.ring.material.opacity = 0.2 + pin.glow * 0.7;
      pin.accents.forEach((m) => { m.emissiveIntensity = 0.12 + pin.glow * 0.9; });
      if (pin.light) pin.light.intensity = pin.glow * 40;
      pin.blip.material.opacity = (1 - pin.glow) * (0.45 + 0.35 * Math.sin(time * 0.003 + pin.pos.x));
      pin.blip.position.y = (4.2 + Math.sin(time * 0.002 + pin.pos.z) * 0.15) * unit;
    }
    antennaTip.material.color.setHex(Math.sin(time * 0.006) > 0 ? AMBER : 0x7a5520);
    // Engine shake grows with speed; pitch and roll come from the springs in update().
    roverBody.position.y = bodyBase + Math.sin(time * 0.02) * 0.012 * Math.min(1, Math.abs(state.speed));
    roverBody.rotation.z = sway.pitch;
    roverBody.rotation.x = sway.roll;
  }

  // Controls, mirroring the 2D map.
  function updateHint() {
    if (touchQuery.matches) {
      driveButton.hidden = true;
      hint.textContent = "Тапните по карте — вездеход поедет туда.";
    } else if (active) {
      driveButton.hidden = false;
      driveButton.textContent = "Выйти";
      hint.textContent = "Клик по карте — ехать туда. Стрелки или WASD — рулить. Esc — выйти.";
    } else {
      driveButton.hidden = false;
      driveButton.textContent = "Поехать";
      hint.textContent = "Найдите проекты светом фар";
    }
  }
  function activate() {
    if (touchQuery.matches || active) return;
    active = true;
    scene.classList.add("is-active");
    updateHint();
  }
  function deactivate() {
    if (!active) return;
    active = false;
    Object.keys(keys).forEach((k) => { keys[k] = false; });
    scene.classList.remove("is-active");
    updateHint();
  }
  driveButton.addEventListener("click", () => {
    if (!alive) return;
    touched = true;
    if (active) deactivate(); else { activate(); driveButton.focus(); }
  });
  // A project link keeps focus after it is clicked. Once the visitor drives off (keys or a click on the map)
  // that focus would pin the card open and, after a key press, draw a focus ring at the map edge.
  const releasePinFocus = () => { if (pinEls.includes(document.activeElement)) document.activeElement.blur(); };
  const keyMap = { ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" };
  window.addEventListener("keydown", (event) => {
    if (!alive || !active) return;
    if (event.key === "Escape") { deactivate(); return; }
    const name = keyMap[event.code];
    if (!name || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    releasePinFocus();
    keys[name] = true;
    touched = true;
  });
  window.addEventListener("keyup", (event) => { const name = keyMap[event.code]; if (name) keys[name] = false; });
  window.addEventListener("blur", () => Object.keys(keys).forEach((k) => { keys[k] = false; }));
  document.addEventListener("pointerdown", (event) => { if (alive && active && !scene.contains(event.target)) deactivate(); });
  scene.addEventListener("focusout", (event) => {
    if (alive && active && event.relatedTarget && !scene.contains(event.relatedTarget)) deactivate();
  });

  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  let press = null;
  canvas.addEventListener("pointerdown", (event) => { releasePinFocus(); press = { x: event.clientX, y: event.clientY, t: performance.now() }; });
  // The page scrolled under the finger instead: not a tap.
  canvas.addEventListener("pointercancel", () => { press = null; });
  canvas.addEventListener("pointerup", (event) => {
    if (!press || !alive) return;
    // The map has no drag, so a mouse click always counts, even a fast one where the hand is already
    // moving to the next spot. A finger that travelled far was scrolling the page (the browser usually
    // cancels those itself), and a long press is not a tap.
    const touch = event.pointerType !== "mouse";
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    const held = performance.now() - press.t;
    press = null;
    if (touch && (moved > 24 || held > 800)) return;
    if (!touch) activate();
    tapAt(event.clientX, event.clientY, event.pointerType);
  });
  function tapAt(clientX, clientY, pointerType) {
    const box = canvas.getBoundingClientRect();
    const px = clientX - box.left, py = clientY - box.top;
    // A tap on or near a project model means "go to that project": the ground behind the model
    // is not what the visitor pointed at. Fingers get a bigger target than the mouse.
    // The project the rover is already at does not count: a tap around it means "drive over there".
    const reach = pointerType === "mouse" ? 36 : 52;
    let nearPin = null, nearest = reach;
    for (const pin of pins) {
      if (pin.near) continue;
      const p = screenOf(pin), d = Math.hypot(p.x - px, p.y - py);
      if (d < nearest) { nearest = d; nearPin = pin; }
    }
    if (nearPin) { driveToPin(nearPin); return; }
    const ndc = new THREE.Vector2(px / box.width * 2 - 1, -(py / box.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(groundPlane, hit)) return;
    driveTo(hit.x, hit.z, 0.5);
  }
  for (const pin of pins) {
    pin.el.addEventListener("click", (event) => {
      if (!alive) return;
      event.preventDefault();
      // The (invisible) project links sit over the models and catch taps meant for the map.
      // A pointer tap goes through the same rules as a tap on the map; keyboard (detail 0) drives to the project.
      if (event.detail > 0) {
        releasePinFocus();
        if (event.pointerType === "mouse" || !touchQuery.matches) activate();
        tapAt(event.clientX, event.clientY, touchQuery.matches ? "touch" : "mouse");
      } else driveToPin(pin);
    });
    pin.el.addEventListener("focus", () => { if (alive) showCard(pin); });
  }
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 32), new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.9, depthWrite: false }));
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  world.add(marker);

  // Loop with a frame-rate guard; lite mode renders at most 30 frames per second.
  let running = false, visible = true, last = 0, lastRender = 0, frames = 0, slowTime = 0;
  const budget = lite ? 50 : 34;
  function frame(time) {
    if (!running || !alive) return;
    requestAnimationFrame(frame);
    if (lite && lastRender && time - lastRender < 32) return;
    const delta = lastRender ? time - lastRender : 16;
    lastRender = time;
    if (last && delta < 200 && frames < 150) {
      frames++;
      if (frames > 20) slowTime += delta;
      if (frames === 150 && slowTime / 130 > budget) { fail(); return; }
    }
    last = time;
    update(Math.min(0.05, delta / 1000));
    if (!target) marker.visible = false;
    if (marker.visible) {
      const pop = marker.userData.pop = Math.max(0, (marker.userData.pop || 0) - delta / 350);
      marker.scale.setScalar(1 + pop * 1.4);
      marker.material.opacity = 0.9 - pop * 0.4;
    }
    decorate(time);
    placeCamera(false, Math.min(0.05, delta / 1000));
    placePins();
    placeCard();
    placeArrow(Math.min(0.05, delta / 1000));
    renderer.render(world, camera);
    drawDark(time);
  }
  function start() {
    if (running || !visible || document.hidden || !alive) return;
    running = true; lastRender = 0; last = 0;
    requestAnimationFrame(frame);
  }
  function stop() { running = false; }

  function fail() {
    alive = false;
    stop();
    deactivate();
    hideCard();
    for (const pin of pins) { pin.el.style.left = ""; pin.el.style.top = ""; }
    scene.classList.remove("is-3d");
    counter.remove();
    arrow.remove();
    dark.remove();
    renderer.dispose();
    canvas.remove();
    scene.dispatchEvent(new Event("scene:resume"));
  }

  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible) start(); else stop();
  }).observe(scene);
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); else start(); });
  new ResizeObserver(() => { if (alive) { resize(); placeCamera(true); } }).observe(scene);
  portraitQuery.addEventListener("change", () => { if (alive) { build(); resize(); placeCamera(true); } });
  touchQuery.addEventListener("change", () => { if (alive) updateHint(); });

  // Phones may drop the WebGL context (for example after the browser was backgrounded): hand back to 2D.
  canvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); if (alive) fail(); });

  // Build, render once, then take over from the 2D map.
  build();
  resize();
  rover.position.set(state.x, 0, state.z);
  rover.rotation.y = -state.angle;
  placeCamera(true);
  renderer.render(world, camera);
  drawDark(0);
  scene.dispatchEvent(new Event("scene:handoff"));
  scene.classList.add("is-3d");
  updateHint();
  start();
  // The rover waits for the visitor: no drive on its own when the page opens.
}
