(function () {
  const Core = window.WallfacerCore;
  const app = document.getElementById("wallfacer-app");
  const stage = document.getElementById("wallfacer-stage");
  const message = document.getElementById("wallfacer-message");
  const BASE = new URL("../wallfacer/", window.location.href);
  const SVG_NS = "http://www.w3.org/2000/svg";

  // Fisheye: grid distance d (in cells) maps to a screen radius of
  // d * (1 + K) / (1 + K * d). Distance 1 stays put, close tiles bulge
  // out slightly, and the far wall compresses toward the rim. Raise K for
  // a stronger lens.
  const FISHEYE = 0.5;
  const SPACING = 250; // px between cells at distance 1
  const LOAD_RADIUS = 3.2; // cells; images load once they come this close
  const DRAG_THRESHOLD = 6;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  const state = {
    offsetX: 0, // camera position, in cells
    offsetY: 0,
    targetX: 0,
    targetY: 0,
    tiles: [],
    byKey: new Map(),
    cuts: new Set(),
    connections: [],
    svg: null,
    pointer: null, // active pointer gesture
    suppressClick: false,
    raf: 0,
    srcOverrides: {},
    centerTile: null,
  };

  const connected = (ax, ay, bx, by) =>
    state.byKey.has(Core.key(bx, by)) && !state.cuts.has(Core.edgeKey(ax, ay, bx, by));

  const DIRS = [
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
  ];

  /* ---------- rendering ---------- */

  const imageSrc = (entry) => state.srcOverrides[Core.key(entry.x, entry.y)] || null;

  const createTile = (entry) => {
    const el = document.createElement("div");
    el.className = "wallfacer-tile";
    const tile = { el, entry, x: entry.x, y: entry.y, img: null, loaded: false };

    if (entry.kind === "text" || entry.kind === "link") {
      const block = document.createElement("div");
      block.className = "wallfacer-text-block";
      if (entry.kind === "link") {
        const a = document.createElement("a");
        a.href = entry.href;
        a.textContent = entry.text || entry.href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.draggable = false;
        block.appendChild(a);
      } else {
        block.textContent = entry.text;
      }
      el.appendChild(block);
    } else {
      const frame = document.createElement("div");
      frame.className = "wallfacer-image";
      frame.style.setProperty("--static-delay", `${(Math.random() * -1.6).toFixed(2)}s`);
      frame.style.setProperty("--static-speed", `${(0.18 + Math.random() * 0.22).toFixed(2)}s`);
      const img = document.createElement("img");
      img.alt = Core.stemOf(entry.file);
      img.decoding = "async";
      img.draggable = false;
      img.addEventListener("load", () => {
        const wide = img.naturalWidth >= img.naturalHeight;
        el.classList.toggle("is-wide", wide);
        el.classList.toggle("is-tall", !wide);
        el.classList.add("is-loaded");
      });
      frame.appendChild(img);
      el.appendChild(frame);
      tile.img = img;
    }
    return tile;
  };

  const loadImage = (tile) => {
    tile.loaded = true;
    const override = imageSrc(tile.entry);
    if (override) {
      tile.img.src = override;
      return;
    }
    const original = new URL(tile.entry.file, BASE).href;
    tile.img.addEventListener(
      "error",
      () => {
        if (tile.img.src !== original) tile.img.src = original;
      },
      { once: true }
    );
    tile.img.src = new URL(Core.optName(tile.entry.file), BASE).href;
  };

  const render = (tiles, cuts) => {
    stage.textContent = "";
    state.byKey.clear();
    state.cuts = cuts;
    state.tiles = tiles.map(createTile);

    state.svg = document.createElementNS(SVG_NS, "svg");
    state.svg.setAttribute("class", "wallfacer-connections");
    state.svg.setAttribute("aria-hidden", "true");
    stage.appendChild(state.svg);

    const frag = document.createDocumentFragment();
    state.tiles.forEach((t) => {
      state.byKey.set(Core.key(t.x, t.y), t);
      frag.appendChild(t.el);
    });
    stage.appendChild(frag);

    state.connections = [];
    state.tiles.forEach((t) => {
      [
        [1, 0],
        [0, 1],
      ].forEach(([dx, dy]) => {
        const other = state.byKey.get(Core.key(t.x + dx, t.y + dy));
        if (!other || state.cuts.has(Core.edgeKey(t.x, t.y, other.x, other.y))) return;
        const line = document.createElementNS(SVG_NS, "line");
        line.setAttribute("class", "wallfacer-connection");
        state.svg.appendChild(line);
        state.connections.push({ line, a: t, b: other });
      });
    });
  };

  const project = (gx, gy) => {
    const dx = gx - state.offsetX;
    const dy = gy - state.offsetY;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return { sx: 0, sy: 0, d: 0, ux: 0, uy: 0, r: 0 };
    const r = (d * (1 + FISHEYE)) / (1 + FISHEYE * d);
    const ux = dx / d;
    const uy = dy / d;
    return { sx: ux * r * SPACING, sy: uy * r * SPACING, d, ux, uy, r };
  };

  const layout = () => {
    let center = null;
    let best = Infinity;

    state.tiles.forEach((t) => {
      const p = project(t.x, t.y);
      t.p = p;
      if (p.d < best) {
        best = p.d;
        center = t;
      }
    });

    state.tiles.forEach((t) => {
      const { sx, sy, d, ux, uy, r } = t.p;
      const k = 1 + FISHEYE * d;
      const scale = clamp(1.4 / (k * k), 0.16, 1.4);
      const tilt = clamp(r * 16, 0, 38);
      const opacity = clamp(1.05 - d * 0.2, 0.16, 1);
      const isCenter = t === center;
      const isFar = d > 1.15;

      t.el.style.transform =
        `translate(-50%, -50%) translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) ` +
        `perspective(900px) rotateX(${(-uy * tilt).toFixed(2)}deg) rotateY(${(ux * tilt).toFixed(2)}deg) ` +
        `scale(${scale.toFixed(3)})${isCenter ? " translateY(-10px)" : ""}`;
      t.el.style.opacity = opacity.toFixed(3);
      t.el.style.zIndex = String(1000 - Math.round(d * 20));
      t.el.style.setProperty("--static-opacity", clamp(d * 0.55, 0.2, 0.9).toFixed(2));
      t.el.style.setProperty("--dim-opacity", clamp(0.95 - d * 0.35, 0.2, 0.85).toFixed(2));

      if (t.isCenter !== isCenter) {
        t.el.classList.toggle("is-center", isCenter);
        t.el.classList.toggle("is-dim", !isCenter);
        t.isCenter = isCenter;
      }
      if (t.isFar !== isFar) {
        t.el.classList.toggle("is-far", isFar);
        t.isFar = isFar;
      }
      if (t.img && !t.loaded && d <= LOAD_RADIUS) loadImage(t);
    });

    state.connections.forEach(({ line, a, b }) => {
      line.setAttribute("x1", a.p.sx.toFixed(1));
      line.setAttribute("y1", a.p.sy.toFixed(1));
      line.setAttribute("x2", b.p.sx.toFixed(1));
      line.setAttribute("y2", b.p.sy.toFixed(1));
    });

    state.centerTile = center;
  };

  /* ---------- animation loop (runs only while something is moving) ---------- */

  const tick = () => {
    state.raf = 0;
    const ease = reducedMotion ? 1 : 0.14;
    state.offsetX += (state.targetX - state.offsetX) * ease;
    state.offsetY += (state.targetY - state.offsetY) * ease;
    const settled =
      Math.abs(state.targetX - state.offsetX) < 0.0015 &&
      Math.abs(state.targetY - state.offsetY) < 0.0015;
    if (settled) {
      state.offsetX = state.targetX;
      state.offsetY = state.targetY;
    }
    layout();
    if (!settled) {
      state.raf = requestAnimationFrame(tick);
    } else {
      writeHash();
    }
  };

  const wake = () => {
    if (!state.raf) state.raf = requestAnimationFrame(tick);
  };

  const goTo = (x, y) => {
    state.targetX = x;
    state.targetY = y;
    wake();
  };

  const currentCell = () => ({ x: Math.round(state.targetX), y: Math.round(state.targetY) });

  /* ---------- deep links: #x,y ---------- */

  const writeHash = () => {
    const { x, y } = currentCell();
    const hash = `#${x},${y}`;
    if (location.hash !== hash) history.replaceState(null, "", hash);
  };

  const readHash = () => {
    const m = location.hash.match(/^#(-?\d+),(-?\d+)$/);
    if (!m) return null;
    const x = Number(m[1]);
    const y = Number(m[2]);
    return state.byKey.has(Core.key(x, y)) ? { x, y } : null;
  };

  /* ---------- input ---------- */

  const handleKeydown = (event) => {
    const dir = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!dir) return;
    event.preventDefault();
    const { x, y } = currentCell();
    const nx = x + dir[0];
    const ny = y + dir[1];
    if (connected(x, y, nx, ny)) goTo(nx, ny);
  };

  const onPointerDown = (event) => {
    if (event.button !== 0 || state.pointer) return;
    const { x, y } = currentCell();
    state.pointer = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      from: { x, y },
      dragging: false,
      neighbors: DIRS.filter(({ dx, dy }) => connected(x, y, x + dx, y + dy)),
    };
  };

  const onPointerMove = (event) => {
    const p = state.pointer;
    if (!p || p.id !== event.pointerId) return;
    const ddx = event.clientX - p.startX;
    const ddy = event.clientY - p.startY;
    if (!p.dragging) {
      if (Math.hypot(ddx, ddy) < DRAG_THRESHOLD) return;
      p.dragging = true;
      app.classList.add("is-dragging");
      app.setPointerCapture(event.pointerId);
    }

    // Dragging the wall left moves the camera right, so flip the sign.
    const mx = -ddx / SPACING;
    const my = -ddy / SPACING;
    let best = null;
    let bestDot = 0;
    p.neighbors.forEach((n) => {
      const dot = mx * n.dx + my * n.dy;
      if (dot > bestDot) {
        bestDot = dot;
        best = n;
      }
    });

    let tx = p.from.x;
    let ty = p.from.y;
    if (best) {
      const t = clamp(bestDot, 0, 1);
      tx += best.dx * t;
      ty += best.dy * t;
    }
    // A little wiggle off-axis so it feels physical.
    const wiggle = 0.1;
    const px = best ? (best.dx === 0 ? clamp(mx, -wiggle, wiggle) : 0) : clamp(mx, -wiggle, wiggle);
    const py = best ? (best.dy === 0 ? clamp(my, -wiggle, wiggle) : 0) : clamp(my, -wiggle, wiggle);
    state.targetX = tx + px;
    state.targetY = ty + py;
    wake();
  };

  const onPointerUp = (event) => {
    const p = state.pointer;
    if (!p || p.id !== event.pointerId) return;
    state.pointer = null;
    if (!p.dragging) return;
    state.suppressClick = true;
    setTimeout(() => (state.suppressClick = false), 0);
    app.classList.remove("is-dragging");
    if (app.hasPointerCapture(event.pointerId)) app.releasePointerCapture(event.pointerId);
    const nx = Math.round(state.targetX);
    const ny = Math.round(state.targetY);
    const moved = nx !== p.from.x || ny !== p.from.y;
    if (moved && connected(p.from.x, p.from.y, nx, ny)) goTo(nx, ny);
    else goTo(p.from.x, p.from.y);
  };

  /* ---------- data ---------- */

  const loadData = async () => {
    const params = new URLSearchParams(location.search);
    if (params.has("preview")) {
      const raw = localStorage.getItem(Core.PREVIEW_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        state.srcOverrides = data.srcs || {};
        document.title = "Wallfacer (preview)";
        app.classList.add("is-preview");
        return data.manifest;
      }
    }
    const res = await fetch(new URL("manifest.json", BASE));
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    return res.json();
  };

  const show = (manifest, keepPosition) => {
    const { tiles, cuts } = Core.parseManifest(manifest);
    if (!tiles.length) {
      message.textContent = "No tiles yet. Add some with the Wallfacer editor.";
      message.classList.remove("wallfacer-hidden");
      return;
    }
    message.classList.add("wallfacer-hidden");
    render(tiles, cuts);
    let start = keepPosition ? currentCell() : readHash() || { x: 0, y: 0 };
    if (!state.byKey.has(Core.key(start.x, start.y))) {
      start = tiles.reduce((a, b) => (Math.hypot(a.x, a.y) <= Math.hypot(b.x, b.y) ? a : b));
    }
    state.offsetX = state.targetX = start.x;
    state.offsetY = state.targetY = start.y;
    layout();
    writeHash();
  };

  const init = async () => {
    try {
      show(await loadData(), false);
    } catch (error) {
      console.error(error);
      message.textContent = "Unable to load the Wallfacer manifest.";
    }
  };

  // Live-reload while the editor's Preview tab is open.
  window.addEventListener("storage", (event) => {
    if (event.key !== Core.PREVIEW_KEY || !new URLSearchParams(location.search).has("preview")) return;
    const data = JSON.parse(event.newValue || "null");
    if (!data) return;
    state.srcOverrides = data.srcs || {};
    show(data.manifest, true);
  });

  window.addEventListener("hashchange", () => {
    const h = readHash();
    if (h) goTo(h.x, h.y);
  });
  window.addEventListener("keydown", handleKeydown);
  app.addEventListener("pointerdown", onPointerDown);
  app.addEventListener("pointermove", onPointerMove);
  app.addEventListener("pointerup", onPointerUp);
  app.addEventListener("pointercancel", onPointerUp);
  app.addEventListener(
    "click",
    (event) => {
      if (state.suppressClick) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true
  );

  init();
})();
