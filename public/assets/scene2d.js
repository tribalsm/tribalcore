(() => {
  "use strict";

  // 2D map: the same exploration game as the 3D map, seen from above and drawn like a site plan.
  // Same world (project spots, trails, trees), same rules: a dark night where only the headlights
  // show the way, projects are found by their light, a counter, a hint arrow and a finale.
  // It runs on devices without WebGL, on slow ones, and at tribalcore.bond/?2d.

  const PAPER = "#e9eefb";
  const AMBER = "#ffb547";
  const GROUND = "#13203f";
  const SHADE = "#0a1124";
  // Without canvas or with reduced motion, keep the static map.
  const scene = document.getElementById("scene");
  const canvas = scene && scene.querySelector(".scene-canvas");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const ctx = canvas && canvas.getContext && canvas.getContext("2d");
  if (!scene || !ctx || reduce.matches) return;

  const card = document.getElementById("scene-card");
  const cardTitle = card.querySelector("strong");
  const cardDesc = card.querySelector(".card-desc");
  const cardLink = card.querySelector(".card-link");
  const live = document.getElementById("scene-live");
  const driveButton = document.getElementById("drive");
  const hint = document.getElementById("hint-text");
  const portraitQuery = window.matchMedia("(max-width: 735px)");
  const touchQuery = window.matchMedia("(hover: none)");
  const liteQuery = window.matchMedia("(max-width: 735px), (hover: none)");

  const pins = [...scene.querySelectorAll(".pin")].map((el) => ({
    el,
    id: el.dataset.id,
    title: el.dataset.title,
    desc: el.dataset.desc,
    cta: el.dataset.cta,
    href: el.getAttribute("href"),
    color: getComputedStyle(el).getPropertyValue("--c").trim() || AMBER,
    x: 0, z: 0, found: false, near: false, glow: 0,
  }));

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  function seeded(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------------------------------------
  // World, in the same units and coordinates as the 3D map (x to the right, z down the screen).

  const BLOCK = { nightscout: 1.5, debugych: 1.6, meeting: 1.6, quizroom: 1.9, mail: 1.3 };
  const ROVER_RADIUS = 0.6;
  let mapW = 64, mapD = 40, unit = 1, lite = false, hub = { x: 0, z: 0 }, startAngle = 0;
  let trails = [], lookouts = [], trees = [], obstacles = [], fireflies = [];
  const blockOf = (pin) => (BLOCK[pin.id] || 1.6) * unit;
  const findOf = (pin) => blockOf(pin) + 1.9 * unit;
  const ringOf = (pin) => blockOf(pin) + 0.07 * unit;

  const state = { x: 0, z: 0, angle: 0, speed: 0 };
  const keys = { up: false, down: false, left: false, right: false };
  let target = null, current = null, active = false, touched = false;
  let tracks = [], sinceTrack = 0;
  let sinceFind = 0, finaleTime = -1, burst = [];
  let built = false;

  // Catmull-Rom through the way points, about four samples per unit.
  function curve(way) {
    const out = [];
    for (let i = 0; i < way.length - 1; i++) {
      const p0 = way[Math.max(i - 1, 0)], p1 = way[i], p2 = way[i + 1], p3 = way[Math.min(i + 2, way.length - 1)];
      const steps = Math.max(6, Math.round(Math.hypot(p2.x - p1.x, p2.z - p1.z) * 4));
      for (let k = 0; k < steps; k++) {
        const t = k / steps, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
        out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
      }
    }
    out.push(way[way.length - 1]);
    return out;
  }

  function buildWorld() {
    const portrait = portraitQuery.matches;
    lite = liteQuery.matches;
    mapW = portrait ? 22 : 64;
    mapD = portrait ? 50 : 40;
    unit = portrait ? 0.85 : 1;
    const layout = portrait ? {
      start: [0, -4],
      nightscout: [3, -5], debugych: [-6, -15], mail: [7, 10], meeting: [-6, 14], quizroom: [4, 24],
    } : {
      start: [0, 0],
      nightscout: [6, -5], debugych: [22, -12], quizroom: [20, 11], meeting: [-18, 8], mail: [-16, -11],
    };
    hub = { x: layout.start[0], z: layout.start[1] };
    for (const pin of pins) {
      const spot = layout[pin.id] || [0, 0];
      pin.x = hub.x + spot[0];
      pin.z = hub.z + spot[1];
      pin.found = false; pin.near = false; pin.glow = 0;
    }

    // The trail network of the 3D map: a main trail through the start, forks to the projects
    // (ending at their rings) and forks to empty lookouts.
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
    lookouts = [];
    trails = plan.map((trail) => {
      const way = trail.way.map(([x, z]) => ({ x: hub.x + x, z: hub.z + z }));
      const pin = trail.to && pins.find((p) => p.id === trail.to);
      if (pin) {
        const prev = way[way.length - 2];
        const dx = prev.x - pin.x, dz = prev.z - pin.z, len = Math.hypot(dx, dz) || 1;
        way[way.length - 1] = { x: pin.x + dx / len * ringOf(pin), z: pin.z + dz / len * ringOf(pin) };
      }
      if (trail.lookout) lookouts.push(way[way.length - 1]);
      return { points: curve(way), width: (trail.main ? 1.3 : 1.0) * unit, main: !!trail.main };
    });

    // The rover starts on the main trail, facing along it towards NightScout.
    {
      const main = trails.find((t) => t.main).points, first = pins.find((p) => p.id === "nightscout") || pins[0];
      let k = 0, best = Infinity;
      main.forEach((p, i) => { const d = Math.hypot(p.x - hub.x, p.z - hub.z); if (d < best) { best = d; k = i; } });
      const a = main[Math.max(k - 1, 0)], b = main[Math.min(k + 1, main.length - 1)];
      let dx = b.x - a.x, dz = b.z - a.z;
      if (dx * (first.x - hub.x) + dz * (first.z - hub.z) < 0) { dx = -dx; dz = -dz; }
      startAngle = Math.atan2(dz, dx);
    }

    // Trees: obstacles, kept off the trails, the projects and the start.
    const samples = trails.flatMap((t) => t.points);
    const random = seeded(23);
    obstacles = pins.map((pin) => ({ x: pin.x, z: pin.z, r: blockOf(pin) }));
    trees = [];
    const treeCount = lite ? 70 : 170;
    for (let tries = 0; trees.length < treeCount && tries < treeCount * 20; tries++) {
      const x = (random() - 0.5) * (mapW + 10), z = (random() - 0.5) * (mapD + 10);
      const clear = samples.every((p) => Math.hypot(p.x - x, p.z - z) > 1.8)
        && pins.every((p) => Math.hypot(p.x - x, p.z - z) > blockOf(p) + 2.4)
        && Math.hypot(hub.x - x, hub.z - z) > 3;
      if (!clear) continue;
      const scale = (0.7 + random() * 0.8) * unit;
      trees.push({ x, z, r: 0.5 * scale, turn: random() * Math.PI });
      obstacles.push({ x, z, r: 0.45 * scale + ROVER_RADIUS * unit });
    }
    const flies = seeded(7);
    fireflies = Array.from({ length: lite ? 24 : 60 }, () => ({
      x: (flies() - 0.5) * mapW, z: (flies() - 0.5) * mapD, phase: flies() * 6.28, drift: 0.3 + flies() * 0.5,
    }));

    Object.assign(state, { x: hub.x, z: hub.z, speed: 0, angle: startAngle });
    target = null; reversing = 0; tracks = []; burst = [];
    sinceFind = 0; finaleTime = -1;
    hideCard();
    updateCount();
    built = true;
  }

  // ---------------------------------------------------------------------------------------------
  // View: a camera that follows the rover. S is pixels per world unit.

  let width = 0, height = 0, dpr = 1, S = 40, offX = 0;
  const cam = { x: 0, z: 0 };
  const ground = document.createElement("canvas");
  const gctx = ground.getContext("2d");
  const fog = document.createElement("canvas");
  const fctx = fog.getContext("2d");
  let gpx = 1, gx0 = 0, gz0 = 0, fogScale = 1;
  const MARGIN = 14;

  const toScreen = (x, z) => ({ x: (x - cam.x) * S + width / 2 + offX, y: (z - cam.z) * S + height / 2 });

  function camGoal() {
    const viewW = width / S, viewH = height / S, off = offX / S, pad = 2;
    const minX = -mapW / 2 - pad + viewW / 2 + off, maxX = mapW / 2 + pad - viewW / 2 + off;
    const minZ = -mapD / 2 - pad + viewH / 2, maxZ = mapD / 2 + pad - viewH / 2;
    return {
      x: minX > maxX ? (minX + maxX) / 2 : clamp(state.x, minX, maxX),
      z: minZ > maxZ ? (minZ + maxZ) / 2 : clamp(state.z, minZ, maxZ),
    };
  }

  // The static part of the world (ground, grid, map edge, trails, lookouts, trees), drawn once.
  function paintGround() {
    gx0 = -mapW / 2 - MARGIN; gz0 = -mapD / 2 - MARGIN;
    const gw = mapW + MARGIN * 2, gd = mapD + MARGIN * 2;
    gpx = Math.min(S * Math.min(dpr, 1.5), 4096 / gw, 4096 / gd);
    ground.width = Math.round(gw * gpx);
    ground.height = Math.round(gd * gpx);
    const g = gctx, px = 1 / gpx;
    g.setTransform(gpx, 0, 0, gpx, -gx0 * gpx, -gz0 * gpx);
    g.fillStyle = GROUND;
    g.fillRect(gx0, gz0, gw, gd);

    // Grid every 2 units, a little stronger every 10.
    g.lineWidth = px;
    for (let x = Math.ceil(gx0 / 2) * 2; x <= gx0 + gw; x += 2) {
      g.strokeStyle = x % 10 === 0 ? "rgba(90,115,175,.32)" : "rgba(74,95,146,.2)";
      g.beginPath(); g.moveTo(x, gz0); g.lineTo(x, gz0 + gd); g.stroke();
    }
    for (let z = Math.ceil(gz0 / 2) * 2; z <= gz0 + gd; z += 2) {
      g.strokeStyle = z % 10 === 0 ? "rgba(90,115,175,.32)" : "rgba(74,95,146,.2)";
      g.beginPath(); g.moveTo(gx0, z); g.lineTo(gx0 + gw, z); g.stroke();
    }
    // Map edge.
    g.strokeStyle = "rgba(255,181,71,.45)";
    g.lineWidth = 1.2 * px;
    g.setLineDash([0.6, 0.6]);
    g.strokeRect(-mapW / 2, -mapD / 2, mapW, mapD);
    g.setLineDash([]);

    // Trails like a site plan: thin pale kerbs (a pale stroke under a ground-coloured one), so kerbs
    // vanish where trails meet; a sparse centre line on the main trail.
    const trace = (pts) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.z) : g.moveTo(p.x, p.z))); };
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "rgba(233,238,251,.4)";
    g.fillStyle = "rgba(233,238,251,.4)";
    for (const t of trails) { g.lineWidth = t.width + 2.4 * px; trace(t.points); g.stroke(); }
    for (const l of lookouts) { g.beginPath(); g.arc(l.x, l.z, 0.9 * unit + 1.2 * px, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = GROUND;
    g.fillStyle = GROUND;
    for (const t of trails) { g.lineWidth = t.width - 0.4 * px; trace(t.points); g.stroke(); }
    for (const l of lookouts) { g.beginPath(); g.arc(l.x, l.z, 0.9 * unit - 0.2 * px, 0, Math.PI * 2); g.fill(); }
    // Project clearings: the trails end at the ring, nothing crosses it.
    for (const pin of pins) { g.beginPath(); g.arc(pin.x, pin.z, ringOf(pin), 0, Math.PI * 2); g.fill(); }
    g.lineCap = "butt";
    g.strokeStyle = "rgba(233,238,251,.3)";
    g.lineWidth = 1.2 * px;
    g.setLineDash([0.35, 0.6]);
    for (const t of trails) if (t.main) { trace(t.points); g.stroke(); }
    g.setLineDash([]);

    // Trees seen from above: five-sided crowns with ridges to the top.
    for (const tree of trees) {
      g.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = tree.turn + k * Math.PI * 2 / 5;
        g[k ? "lineTo" : "moveTo"](tree.x + Math.cos(a) * tree.r, tree.z + Math.sin(a) * tree.r);
      }
      g.closePath();
      g.fillStyle = "rgba(43,90,120,.6)";
      g.fill();
      g.strokeStyle = "rgba(233,238,251,.28)";
      g.lineWidth = 1.1 * px;
      g.stroke();
      g.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = tree.turn + k * Math.PI * 2 / 5;
        g.moveTo(tree.x, tree.z);
        g.lineTo(tree.x + Math.cos(a) * tree.r, tree.z + Math.sin(a) * tree.r);
      }
      g.strokeStyle = "rgba(233,238,251,.12)";
      g.stroke();
    }
  }

  function layout() {
    width = scene.clientWidth;
    height = scene.clientHeight;
    if (!width || !height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    if (!built) buildWorld();
    const portrait = portraitQuery.matches;
    S = portrait ? width / 11.5 : clamp(width / 22, 36, 64);
    // Keep the rover to the right of the hero text on wide screens, as on the 3D map.
    offX = portrait ? 0 : width * 0.16;
    fogScale = lite ? 0.5 : 1;
    fog.width = Math.max(1, Math.round(width * fogScale));
    fog.height = Math.max(1, Math.round(height * fogScale));
    paintGround();
    Object.assign(cam, camGoal());
    if (current) placeCard();
    updateHint();
  }

  // ---------------------------------------------------------------------------------------------
  // Driving: the same car-like rover and autopilot as on the 3D map.

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

  let reversing = 0, stuckTime = 0, dodge = 1;
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
    const side = Math.abs(offset) > 0.05 ? -Math.sign(offset) : dodge;
    const clear = block.r + 0.9 * unit;
    return { x: block.x - uz * side * clear + ux * block.r * 0.6, z: block.z + ux * side * clear + uz * block.r * 0.6 };
  }

  const marker = { x: 0, z: 0, visible: false, pop: 0 };
  function driveTo(x, z, stop, pin = null) {
    const spot = pin ? { x, z } : reachable(x, z);
    target = { x: spot.x, z: spot.z, stop, pin, skip: pin ? obstacles[pins.indexOf(pin)] : null, best: Infinity, idle: 0, age: 0 };
    reversing = 0;
    stuckTime = 0;
    touched = true;
    Object.assign(marker, { x: spot.x, z: spot.z, visible: !pin, pop: 1 });
  }
  const driveToPin = (pin) => driveTo(pin.x, pin.z, blockOf(pin) + 1 * unit, pin);

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
      // Watchdog: no progress for a few seconds means circling or boxed in, so the rover stops.
      if (dist < target.best - 0.25) { target.best = dist; target.idle = 0; } else target.idle += dt;
      target.age += dt;
      // A point right beside the rover is inside its turning circle: after a short try, close enough counts as arrived.
      const beside = target.age > 1.5 && dist < 1.3 * unit + target.stop && Math.abs(diff) > 1.1;
      if (dist <= target.stop || beside || target.idle > 4) {
        target = null;
        reversing = 0;
      } else if (reversing > 0) {
        reversing = Math.max(0, reversing - dt);
        throttle = -0.7;
        steer = dodge;
      } else if (Math.abs(diff) > 2.2 && dist < 4 * unit) {
        throttle = -0.7;
        steer = -clamp(diff * 2.4, -1, 1);
      } else {
        steer = clamp(diff * 2.4, -1, 1);
        throttle = clamp(dist / 5, 0.3, 1) * (Math.abs(diff) > 1.5 ? 0.35 : 1);
      }
      cap = (dist * 1.6 + 0.6) * (Math.abs(diff) > 0.8 && Math.abs(diff) < 2.2 ? 0.45 : 1);
    }
    const braking = throttle * state.speed < 0 ? 2.2 : 1;
    state.speed += throttle * ACC * braking * dt;
    state.speed *= 1 - Math.min(1, dt * (throttle ? 0.7 : 3));
    state.speed = clamp(state.speed, -Math.min(MAX * 0.5, cap), Math.min(MAX, cap));
    state.angle = wrap(state.angle + steer * TURN * clamp(state.speed / 2.5, -1, 1) * dt);

    const intended = Math.abs(state.speed * dt);
    let nx = state.x + Math.cos(state.angle) * state.speed * dt;
    let nz = state.z + Math.sin(state.angle) * state.speed * dt;
    const mx = mapW / 2 - 1, mz = mapD / 2 - 1;
    nx = clamp(nx, -mx, mx);
    nz = clamp(nz, -mz, mz);
    for (const o of obstacles) {
      const dx = nx - o.x, dz = nz - o.z, d = Math.hypot(dx, dz);
      if (d < o.r && d > 0.001 && d < Math.hypot(state.x - o.x, state.z - o.z)) {
        nx = o.x + dx / d * o.r;
        nz = o.z + dz / d * o.r;
      }
    }
    const moved = Math.hypot(nx - state.x, nz - state.z);
    if (intended > 0.0001 && moved < intended * 0.98) state.speed *= 0.6 + 0.4 * (moved / intended);
    if (target && Math.abs(throttle) > 0.2 && moved < dt * 0.4) stuckTime += dt; else stuckTime = 0;
    if (stuckTime > 0.35 && !reversing) { reversing = 0.7; stuckTime = 0; dodge = -dodge; }
    state.x = nx; state.z = nz;
    if (moved) {
      document.dispatchEvent(new CustomEvent("scene:distance", { detail: moved * 25 }));
      sinceTrack += moved;
      if (sinceTrack > 0.3) {
        sinceTrack = 0;
        tracks.push({ x: state.x, z: state.z, a: state.angle });
        if (tracks.length > 300) tracks.shift();
      }
    }
    checkPins();
  }

  // ---------------------------------------------------------------------------------------------
  // Game: discovery, counter, hint arrow, finale.

  function checkPins() {
    let nearest = null, best = Infinity;
    for (const pin of pins) {
      const d = Math.hypot(pin.x - state.x, pin.z - state.z);
      pin.near = d < findOf(pin);
      if (d - findOf(pin) < best - (nearest ? findOf(nearest) : 0)) { best = d; nearest = pin; }
      // Found when the headlights reach it or the rover rolls up to it, once the visitor has started driving.
      if (!pin.found && touched) {
        const off = Math.abs(wrap(Math.atan2(pin.z - state.z, pin.x - state.x) - state.angle));
        if (pin.near || (d < 9 * unit && off < 0.45)) discover(pin);
      }
    }
    if (nearest && best < findOf(nearest)) {
      if (current !== nearest) showCard(nearest);
    } else if (current && Math.hypot(current.x - state.x, current.z - state.z) > findOf(current) + 2.2 * unit
               && !card.contains(document.activeElement) && document.activeElement !== current.el) {
      hideCard();
    }
  }

  const counter = document.createElement("p");
  counter.className = "scene-count";
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
    sinceFind = 0;
    updateCount();
    const all = pins.every((p) => p.found);
    live.textContent = all ? `Найдено: ${pin.title}. Все проекты найдены.` : `Найдено: ${pin.title}`;
    if (all) startFinale();
  }

  const arrow = document.createElement("div");
  arrow.className = "scene-arrow";
  arrow.setAttribute("aria-hidden", "true");
  function placeArrow(dt) {
    const left = pins.filter((pin) => !pin.found);
    sinceFind += dt;
    if (!left.length || sinceFind < 15) { arrow.classList.remove("is-on"); return; }
    let goal = left[0], best = Infinity;
    for (const pin of left) { const d = Math.hypot(pin.x - state.x, pin.z - state.z); if (d < best) { best = d; goal = pin; } }
    const p = toScreen(goal.x, goal.z), m = 34;
    let x, y, angle;
    if (p.x > m && p.x < width - m && p.y > m + 30 && p.y < height - m) {
      x = p.x; y = p.y - blockOf(goal) * S - 24; angle = Math.PI / 2;
    } else {
      const r = toScreen(state.x, state.z);
      angle = Math.atan2(p.y - r.y, p.x - r.x);
      const tx = Math.cos(angle), ty = Math.sin(angle);
      const k = Math.min(tx > 0 ? (width - m - r.x) / tx : tx < 0 ? (m - r.x) / tx : Infinity,
        ty > 0 ? (height - m - r.y) / ty : ty < 0 ? (m - r.y) / ty : Infinity);
      x = r.x + tx * k; y = r.y + ty * k;
    }
    arrow.style.transform = `translate(${x - 8}px, ${y - 9}px) rotate(${angle}rad)`;
    arrow.classList.add("is-on");
  }

  // Finale: fireflies burst out from the rover in the projects' colours.
  function startFinale() {
    finaleTime = 0;
    burst = Array.from({ length: lite ? 60 : 120 }, (_, i) => {
      const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 6;
      return { x: state.x, z: state.z, vx: Math.cos(a) * v, vz: Math.sin(a) * v, color: pins[i % pins.length].color, size: 1.5 + Math.random() * 2 };
    });
  }
  function animateFinale(dt) {
    if (finaleTime < 0) return;
    finaleTime += dt;
    for (const p of burst) {
      p.x += p.vx * dt; p.z += p.vz * dt;
      p.vx *= 1 - Math.min(1, dt * 1.6); p.vz *= 1 - Math.min(1, dt * 1.6);
    }
    if (finaleTime > 3) { finaleTime = -1; burst = []; }
  }

  // ---------------------------------------------------------------------------------------------
  // Card, hint and controls.

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

  const heroParts = [...document.querySelectorAll(".hero-text > *")];
  let cardSpot = 0;
  function placeCard() {
    if (!current) return;
    const p = toScreen(current.x, current.z), cw = card.offsetWidth, ch = card.offsetHeight;
    // On a phone a floating card would cover most of the map: dock it along the bottom edge.
    if (portraitQuery.matches) {
      card.style.left = "12px";
      card.style.top = `${height - ch - 12}px`;
      return;
    }
    const r = toScreen(state.x, state.z), gap = blockOf(current) * S + 14;
    const spots = [
      [p.x + gap, p.y - ch / 2], [p.x - gap - cw, p.y - ch / 2],
      [p.x - cw / 2, p.y - gap - ch], [p.x - cw / 2, p.y + gap],
    ].map(([x, y]) => [clamp(x, 12, width - cw - 12), clamp(y, 12, height - ch - 12)]);
    const sceneBox = scene.getBoundingClientRect();
    const textBoxes = heroParts.map((el) => el.getBoundingClientRect())
      .map((b) => ({ l: b.left - sceneBox.left, t: b.top - sceneBox.top, r: b.right - sceneBox.left, b: b.bottom - sceneBox.top }));
    const blocksView = ([x, y]) => (r.x > x - 40 && r.x < x + cw + 40 && r.y > y - 40 && r.y < y + ch + 40)
      || textBoxes.some((b) => x < b.r + 12 && x + cw > b.l - 12 && y < b.b + 12 && y + ch > b.t - 12);
    if (blocksView(spots[cardSpot])) {
      const free = spots.findIndex((spot) => !blocksView(spot));
      cardSpot = free === -1 ? 0 : free;
    }
    const [left, top] = spots[cardSpot];
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  // The (invisible) project links follow the projects, so a tap on a project lands on its link.
  function placePins() {
    for (const pin of pins) {
      const p = toScreen(pin.x, pin.z);
      pin.el.style.left = `${clamp(p.x, 28, width - 28)}px`;
      pin.el.style.top = `${clamp(p.y, 28, height - 28)}px`;
    }
  }
  function releasePins() { for (const pin of pins) { pin.el.style.left = ""; pin.el.style.top = ""; } }

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
    if (disposed) return;
    touched = true;
    if (active) { deactivate(); return; }
    activate();
    driveButton.focus();
  });

  const releasePinFocus = () => { if (pins.some((pin) => pin.el === document.activeElement)) document.activeElement.blur(); };
  const keyMap = { ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" };
  window.addEventListener("keydown", (event) => {
    if (disposed || !active) return;
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
  document.addEventListener("pointerdown", (event) => { if (!disposed && active && !scene.contains(event.target)) deactivate(); });
  scene.addEventListener("focusout", (event) => {
    if (!disposed && active && event.relatedTarget && !scene.contains(event.relatedTarget)) deactivate();
  });

  let press = null;
  canvas.addEventListener("pointerdown", (event) => { releasePinFocus(); press = { x: event.clientX, y: event.clientY, t: performance.now() }; });
  canvas.addEventListener("pointercancel", () => { press = null; });
  canvas.addEventListener("pointerup", (event) => {
    if (!press || disposed) return;
    // The map has no drag, so a mouse click always counts; a finger that travelled far was scrolling,
    // and a long press is not a tap.
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
    // A tap on or near a project means "go to that project" (not the one the rover is already at).
    // The target is the drawing itself, or a finger-sized circle when the drawing is small.
    const base = pointerType === "mouse" ? 36 : 52;
    let nearPin = null, nearest = Infinity;
    for (const pin of pins) {
      if (pin.near) continue;
      const p = toScreen(pin.x, pin.z), d = Math.hypot(p.x - px, p.y - py);
      if (d < Math.max(base, blockOf(pin) * S) && d < nearest) { nearest = d; nearPin = pin; }
    }
    if (nearPin) { driveToPin(nearPin); return; }
    driveTo((px - width / 2 - offX) / S + cam.x, (py - height / 2) / S + cam.z, 0.5);
  }
  for (const pin of pins) {
    pin.el.addEventListener("click", (event) => {
      if (disposed) return;
      event.preventDefault();
      // A pointer tap goes through the same rules as a tap on the map; keyboard (detail 0) drives to the project.
      if (event.detail > 0) {
        releasePinFocus();
        if (!touchQuery.matches) activate();
        tapAt(event.clientX, event.clientY, touchQuery.matches ? "touch" : "mouse");
      } else driveToPin(pin);
    });
    pin.el.addEventListener("focus", () => { if (!disposed) showCard(pin); });
  }

  // ---------------------------------------------------------------------------------------------
  // Drawing. Projects are small plan drawings: dark silhouettes until found, then lit in their colour.

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // Style for a project drawing: line, fill and accent, by how "found" it is.
  function pen(pin) {
    const k = pin.glow;
    return {
      line: `rgba(233,238,251,${0.16 + 0.66 * k})`,
      faint: `rgba(233,238,251,${0.08 + 0.3 * k})`,
      fill: k > 0.5 ? "#16264b" : SHADE,
      accent: k > 0.05 ? pin.color : "rgba(233,238,251,.14)",
      lw: 1.3 / S,
      k,
    };
  }
  const shape = (c, s, fill = s.fill) => { c.fillStyle = fill; c.fill(); c.strokeStyle = s.line; c.lineWidth = s.lw; c.stroke(); };

  const sketches = {
    // Watchtower from above: splayed legs, cross bracing, a platform and a searchlight that sweeps once found.
    nightscout(c, pin, s, t) {
      if (s.k > 0.05) {
        const a = t * 0.0008;
        const beam = c.createRadialGradient(0, 0, 0.1, 0, 0, 3.4);
        beam.addColorStop(0, `rgba(255,181,71,${0.4 * s.k})`);
        beam.addColorStop(1, "rgba(255,181,71,0)");
        c.fillStyle = beam;
        c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 3.4, a - 0.24, a + 0.24); c.closePath(); c.fill();
      }
      const legs = [[-0.8, -0.8], [0.8, -0.8], [0.8, 0.8], [-0.8, 0.8]];
      c.strokeStyle = s.faint; c.lineWidth = s.lw;
      c.beginPath();
      legs.forEach(([x, z], i) => { const [nx, nz] = legs[(i + 1) % 4]; c.moveTo(x, z); c.lineTo(nx, nz); c.moveTo(x, z); c.lineTo(x * 0.5, z * 0.5); });
      c.moveTo(-0.8, -0.8); c.lineTo(0.8, 0.8); c.moveTo(0.8, -0.8); c.lineTo(-0.8, 0.8);
      c.stroke();
      for (const [x, z] of legs) { c.beginPath(); c.rect(x - 0.09, z - 0.09, 0.18, 0.18); shape(c, s); }
      roundRect(c, -0.45, -0.45, 0.9, 0.9, 0.06); shape(c, s);
      c.beginPath(); c.arc(0, 0, 0.17, 0, Math.PI * 2); c.fillStyle = s.accent; c.fill();
    },
    // A tester's desk with a monitor, and a bug that crawls around it once found.
    debugych(c, pin, s, t) {
      roundRect(c, -1, -0.6, 2, 1.2, 0.1); shape(c, s);
      roundRect(c, -0.65, -0.5, 1.3, 0.18, 0.04); shape(c, s, s.k > 0.05 ? "#22355f" : s.fill);
      c.strokeStyle = s.accent; c.lineWidth = s.lw * 1.4; c.stroke();
      roundRect(c, -0.35, 0.02, 0.7, 0.22, 0.04); c.strokeStyle = s.faint; c.lineWidth = s.lw; c.stroke();
      const a = s.k > 0.05 ? t * 0.0006 : 0.7;
      const bx = Math.cos(a) * 1.3, bz = Math.sin(a) * 1.3;
      c.save();
      c.translate(bx, bz);
      c.rotate(a + Math.PI / 2);
      c.strokeStyle = s.accent; c.lineWidth = s.lw;
      c.beginPath();
      for (const side of [-1, 1]) for (const y of [-0.08, 0, 0.08]) { c.moveTo(0, y); c.lineTo(side * 0.2, y + (y - 0.02) * 0.6); }
      c.moveTo(0.03, -0.14); c.lineTo(0.09, -0.24); c.moveTo(-0.03, -0.14); c.lineTo(-0.09, -0.24);
      c.stroke();
      c.beginPath(); c.ellipse(0, 0, 0.1, 0.15, 0, 0, Math.PI * 2); c.fillStyle = s.accent; c.fill();
      c.restore();
    },
    // A round table with chairs, the spec sheet on it, and sound rings from the recorder once found.
    meeting(c, pin, s, t) {
      for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3 + Math.PI / 6;
        c.save(); c.translate(Math.cos(a) * 1.05, Math.sin(a) * 1.05); c.rotate(a);
        roundRect(c, -0.13, -0.15, 0.26, 0.3, 0.06); shape(c, s); c.restore();
      }
      c.beginPath(); c.arc(0, 0, 0.72, 0, Math.PI * 2); shape(c, s);
      c.fillStyle = s.k > 0.05 ? `rgba(233,238,251,${0.15 + 0.6 * s.k})` : "rgba(233,238,251,.06)";
      c.fillRect(-0.36, -0.3, 0.42, 0.56);
      c.strokeStyle = s.k > 0.05 ? "rgba(10,17,36,.7)" : "rgba(233,238,251,.06)"; c.lineWidth = s.lw;
      c.beginPath(); for (const y of [-0.18, -0.06, 0.06, 0.16]) { c.moveTo(-0.3, y); c.lineTo(0, y); } c.stroke();
      c.beginPath(); c.arc(0.32, 0, 0.08, 0, Math.PI * 2); c.fillStyle = s.accent; c.fill();
      if (s.k > 0.05) {
        for (let k = 0; k < 3; k++) {
          const p = ((t * 0.0006) + k / 3) % 1;
          c.strokeStyle = pin.color; c.globalAlpha = (1 - p) * 0.7 * s.k; c.lineWidth = s.lw;
          c.beginPath(); c.arc(0.32, 0, 0.12 + p * 0.5, -0.9, 0.9); c.stroke();
        }
        c.globalAlpha = 1;
      }
    },
    // A quiz stage: a screen and three player desks whose buttons light up in turn once found.
    quizroom(c, pin, s, t) {
      roundRect(c, -1.35, -1.05, 2.7, 0.4, 0.06); shape(c, s, s.k > 0.05 ? "#1d3157" : s.fill);
      c.strokeStyle = s.accent; c.lineWidth = s.lw * 1.4; c.strokeRect(-1.15, -0.97, 2.3, 0.24);
      const lit = Math.floor(t / 450) % 3;
      [-0.9, 0, 0.9].forEach((x, i) => {
        roundRect(c, x - 0.3, 0.15, 0.6, 0.5, 0.06); shape(c, s);
        c.beginPath(); c.arc(x, 0.4, 0.11, 0, Math.PI * 2);
        c.fillStyle = s.k > 0.05 && i === lit ? pin.color : s.k > 0.05 ? "rgba(111,214,200,.25)" : "rgba(233,238,251,.1)";
        c.fill();
      });
      c.strokeStyle = s.faint; c.lineWidth = s.lw;
      c.beginPath(); c.moveTo(-1.2, 1.0); c.lineTo(1.2, 1.0); c.stroke();
    },
    // A mailbox on a post with its flag, and a letter beside it; the flag goes up once found.
    mail(c, pin, s, t) {
      c.beginPath(); c.rect(-0.1, -0.1, 0.2, 0.2); shape(c, s);
      c.beginPath();
      c.moveTo(-0.55, -0.3); c.lineTo(0.3, -0.3); c.arc(0.3, 0, 0.3, -Math.PI / 2, Math.PI / 2); c.lineTo(-0.55, 0.3); c.closePath();
      shape(c, s);
      c.strokeStyle = s.faint; c.lineWidth = s.lw;
      c.beginPath(); c.moveTo(0.42, -0.14); c.lineTo(0.42, 0.14); c.stroke();
      c.save();
      c.translate(-0.4, -0.3);
      c.rotate(s.k > 0.05 ? -Math.PI / 2 * s.k : 0);
      c.fillStyle = s.k > 0.05 ? "#ff6b6b" : "rgba(233,238,251,.12)";
      c.fillRect(0, -0.04, 0.55, 0.08);
      c.fillRect(0.4, -0.16, 0.15, 0.14);
      c.restore();
      const bob = s.k > 0.05 ? Math.sin(t * 0.003) * 0.05 : 0;
      c.save(); c.translate(0.05, 0.85 + bob); c.rotate(-0.15);
      roundRect(c, -0.32, -0.2, 0.64, 0.4, 0.04); shape(c, s, s.k > 0.05 ? `rgba(255,217,160,${0.25 + 0.5 * s.k})` : s.fill);
      c.strokeStyle = s.k > 0.05 ? "rgba(10,17,36,.6)" : s.faint; c.lineWidth = s.lw;
      c.beginPath(); c.moveTo(-0.32, -0.2); c.lineTo(0, 0.03); c.lineTo(0.32, -0.2); c.stroke();
      c.restore();
    },
  };

  function drawProject(pin, t) {
    const s = pen(pin);
    ctx.save();
    ctx.translate(pin.x, pin.z);
    // The ring: pale until found, then the project's colour.
    const r = blockOf(pin);
    ctx.lineWidth = 1.6 / S;
    ctx.strokeStyle = "rgba(233,238,251,.2)";
    ctx.globalAlpha = 1 - s.k;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = pin.color;
    ctx.globalAlpha = s.k * 0.9;
    ctx.stroke();
    if (s.k > 0.05) {
      ctx.setLineDash([4 / S, 6 / S]);
      ctx.rotate(t * 0.0004);
      ctx.globalAlpha = s.k * 0.5;
      ctx.beginPath(); ctx.arc(0, 0, r + 0.3, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.rotate(-t * 0.0004);
    }
    ctx.globalAlpha = 1;
    ctx.scale(unit, unit);
    (sketches[pin.id] || sketches.nightscout)(ctx, pin, s, t);
    ctx.restore();
  }

  function drawRover() {
    ctx.save();
    ctx.translate(state.x, state.z);
    ctx.rotate(state.angle);
    ctx.scale(unit / 28, unit / 28);
    ctx.fillStyle = PAPER;
    for (const [x, y] of [[-13, -14], [6, -14], [-13, 10], [6, 10]]) { roundRect(ctx, x, y, 9, 4.5, 1.5); ctx.fill(); }
    ctx.fillStyle = "#1b2950";
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 1.6;
    roundRect(ctx, -18, -11, 36, 22, 5); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 1;
    roundRect(ctx, -7, -7, 13, 14, 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-10, 0); ctx.stroke();
    ctx.fillStyle = AMBER;
    ctx.beginPath(); ctx.arc(16, -6.5, 2.3, 0, Math.PI * 2); ctx.arc(16, 6.5, 2.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ff6b6b";
    ctx.fillRect(-18.5, -8, 2, 4); ctx.fillRect(-18.5, 4, 2, 4);
    ctx.restore();
  }

  function drawLabel(pin) {
    const p = toScreen(pin.x, pin.z);
    ctx.font = `500 ${portraitQuery.matches ? 11 : 12}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const w = ctx.measureText(pin.title).width + 12;
    const y = p.y + (blockOf(pin) + 0.45) * S;
    ctx.globalAlpha = pin.glow;
    ctx.fillStyle = "rgba(11,18,38,.92)";
    roundRect(ctx, p.x - w / 2, y - 2, w, 19, 3);
    ctx.fill();
    ctx.fillStyle = pin.color;
    ctx.fillText(pin.title, p.x, y + 1);
    ctx.globalAlpha = 1;
  }

  // Night: dark everywhere except the headlight beam, a small pool around the rover and the light
  // of found projects (tinted with their colour).
  function drawNight(t) {
    const f = fctx, k = fogScale;
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = "source-over";
    f.clearRect(0, 0, fog.width, fog.height);
    f.fillStyle = "rgba(3,6,16,.95)";
    f.fillRect(0, 0, fog.width, fog.height);
    f.setTransform(k * S, 0, 0, k * S, k * (width / 2 + offX - cam.x * S), k * (height / 2 - cam.z * S));
    f.globalCompositeOperation = "destination-out";
    const hole = (x, z, r, a) => {
      if (a <= 0.01) return;
      const g = f.createRadialGradient(x, z, 0, x, z, r);
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(0.45, `rgba(0,0,0,${a * 0.85})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      f.fillStyle = g;
      f.fillRect(x - r, z - r, r * 2, r * 2);
    };
    for (const pin of pins) hole(pin.x, pin.z, 4.4 * unit * (1 + Math.sin(t * 0.0015 + pin.x) * 0.04), 0.95 * pin.glow);
    hole(state.x, state.z, 2.6 * unit, 1);
    if (finaleTime >= 0) hole(state.x, state.z, 8 * unit, 0.85 * Math.min(1, finaleTime * 4, (3 - finaleTime) / 1.2));
    // The beam.
    const fx = state.x + Math.cos(state.angle) * 0.5 * unit, fz = state.z + Math.sin(state.angle) * 0.5 * unit;
    const reach = 9.5 * unit;
    const beam = f.createRadialGradient(fx, fz, 0.1, fx, fz, reach);
    beam.addColorStop(0, "rgba(0,0,0,1)");
    beam.addColorStop(0.6, "rgba(0,0,0,.85)");
    beam.addColorStop(1, "rgba(0,0,0,0)");
    f.fillStyle = beam;
    // Soft edges: a narrow full cone over two wider, fainter ones.
    for (const [spread, alpha] of [[0.62, 0.35], [0.54, 0.5], [0.42, 1]]) {
      f.globalAlpha = alpha;
      f.beginPath(); f.moveTo(fx, fz); f.arc(fx, fz, reach, state.angle - spread, state.angle + spread); f.closePath(); f.fill();
    }
    f.globalAlpha = 1;
    // Coloured light of found projects.
    f.globalCompositeOperation = "source-over";
    for (const pin of pins) {
      if (pin.glow < 0.01) continue;
      const r = 5 * unit, g = f.createRadialGradient(pin.x, pin.z, 0, pin.x, pin.z, r);
      g.addColorStop(0, pin.color);
      g.addColorStop(1, "rgba(0,0,0,0)");
      f.globalAlpha = 0.16 * pin.glow;
      f.fillStyle = g;
      f.fillRect(pin.x - r, pin.z - r, r * 2, r * 2);
    }
    f.globalAlpha = 1;
    ctx.drawImage(fog, 0, 0, width, height);

    // Warm tint of the headlights.
    ctx.save();
    ctx.setTransform(dpr * S, 0, 0, dpr * S, dpr * (width / 2 + offX - cam.x * S), dpr * (height / 2 - cam.z * S));
    ctx.globalCompositeOperation = "lighter";
    const warm = ctx.createRadialGradient(fx, fz, 0, fx, fz, reach);
    warm.addColorStop(0, "rgba(255,181,71,.22)");
    warm.addColorStop(0.5, "rgba(255,181,71,.07)");
    warm.addColorStop(1, "rgba(255,181,71,0)");
    ctx.fillStyle = warm;
    for (const [spread, alpha] of [[0.56, 0.5], [0.42, 1]]) {
      ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.moveTo(fx, fz); ctx.arc(fx, fz, reach, state.angle - spread, state.angle + spread); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function draw(t, dt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, width, height);
    // Visible part of the painted ground.
    const vx0 = cam.x - (width / 2 + offX) / S, vz0 = cam.z - height / 2 / S;
    ctx.drawImage(ground, (vx0 - gx0) * gpx, (vz0 - gz0) * gpx, width / S * gpx, height / S * gpx, 0, 0, width, height);

    // World layer.
    ctx.setTransform(dpr * S, 0, 0, dpr * S, dpr * (width / 2 + offX - cam.x * S), dpr * (height / 2 - cam.z * S));
    ctx.fillStyle = "rgba(233,238,251,.16)";
    const dot = 2 / S;
    for (const p of tracks) {
      const ox = Math.cos(p.a + Math.PI / 2) * 0.32 * unit, oz = Math.sin(p.a + Math.PI / 2) * 0.32 * unit;
      ctx.fillRect(p.x + ox - dot / 2, p.z + oz - dot / 2, dot, dot);
      ctx.fillRect(p.x - ox - dot / 2, p.z - oz - dot / 2, dot, dot);
    }
    for (const pin of pins) drawProject(pin, t);
    if (marker.visible && target) {
      marker.pop = Math.max(0, marker.pop - dt * 2.9);
      ctx.strokeStyle = AMBER;
      ctx.globalAlpha = 0.9 - marker.pop * 0.4;
      ctx.lineWidth = 1.6 / S;
      ctx.beginPath(); ctx.arc(marker.x, marker.z, 0.4 * (1 + marker.pop * 1.4), 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    drawRover();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawNight(t);

    // Above the night: fireflies, beacons of unfound projects, labels of found ones, the finale.
    ctx.globalCompositeOperation = "lighter";
    for (const fly of fireflies) {
      const x = fly.x + Math.sin(t * 0.0004 * fly.drift + fly.phase) * 0.8;
      const z = fly.z + Math.cos(t * 0.0003 * fly.drift + fly.phase * 1.3) * 0.8;
      const p = toScreen(x, z);
      if (p.x < -10 || p.x > width + 10 || p.y < -10 || p.y > height + 10) continue;
      ctx.globalAlpha = 0.25 + 0.3 * Math.sin(t * 0.002 + fly.phase);
      ctx.fillStyle = "#ffd98a";
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2); ctx.fill();
    }
    for (const pin of pins) {
      if (pin.glow > 0.95) continue;
      const p = toScreen(pin.x, pin.z);
      const a = (1 - pin.glow) * (0.45 + 0.3 * Math.sin(t * 0.003 + pin.x));
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 14);
      g.addColorStop(0, `rgba(233,238,251,${a})`);
      g.addColorStop(0.2, `rgba(233,238,251,${a * 0.6})`);
      g.addColorStop(1, "rgba(233,238,251,0)");
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.fillRect(p.x - 14, p.y - 14, 28, 28);
    }
    for (const b of burst) {
      const p = toScreen(b.x, b.z);
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, finaleTime - 1.6) / 1.4);
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, b.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    for (const pin of pins) if (pin.glow > 0.05) drawLabel(pin);
  }

  // ---------------------------------------------------------------------------------------------
  // Loop with a performance guard that falls back to the static map; on phones at most 30 fps.

  let running = false, visible = true, last = 0, frames = 0, slowTime = 0, disposed = false, tooSlow = false;
  function frame(time) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (lite && last && time - last < 32) return;
    const delta = last ? time - last : 16;
    const dt = Math.min(0.05, delta / 1000);
    if (last && delta < 200 && frames < 150) {
      frames++;
      if (frames > 20) slowTime += delta;
      if (frames === 150 && slowTime / 130 > (lite ? 60 : 45)) { fallBack(); return; }
    }
    last = time;
    update(dt);
    for (const pin of pins) pin.glow += ((pin.found ? 1 : 0) - pin.glow) * Math.min(1, dt * 3);
    animateFinale(dt);
    const goal = camGoal();
    cam.x += (goal.x - cam.x) * (1 - Math.exp(-dt * 3.5));
    cam.z += (goal.z - cam.z) * (1 - Math.exp(-dt * 3.5));
    draw(time, dt);
    placePins();
    placeCard();
    placeArrow(dt);
  }
  function start() {
    if (running || !visible || document.hidden || disposed) return;
    running = true; last = 0;
    requestAnimationFrame(frame);
  }
  function stop() { running = false; }
  function attach() {
    hint.after(counter);
    scene.append(arrow);
  }
  function detach() {
    counter.remove();
    arrow.remove();
    arrow.classList.remove("is-on");
  }
  function fallBack() {
    stop();
    deactivate();
    hideCard();
    detach();
    releasePins();
    scene.classList.remove("is-live", "is-active");
    disposed = true;
    tooSlow = true;
  }

  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (disposed) return;
    if (visible) start(); else stop();
  }).observe(scene);
  document.addEventListener("visibilitychange", () => {
    if (disposed) return;
    if (document.hidden) stop(); else start();
  });
  new ResizeObserver(() => { if (!disposed) layout(); }).observe(scene);
  portraitQuery.addEventListener("change", () => {
    built = false;
    if (!disposed) layout();
  });
  touchQuery.addEventListener("change", () => { if (!disposed) updateHint(); });

  // 3D takes over the shared DOM (pins, card, hint) once it is ready, and hands back on failure.
  scene.addEventListener("scene:handoff", () => {
    deactivate();
    stop();
    hideCard();
    detach();
    disposed = true;
  });
  scene.addEventListener("scene:resume", () => {
    if (tooSlow) return;
    disposed = false;
    built = false;
    scene.classList.add("is-live");
    attach();
    layout();
    start();
  });

  scene.classList.add("is-live");
  attach();
  layout();
  start();
  // The rover waits for the visitor: no drive on its own when the page opens.
})();
