/* Wallfacer editor.
 *
 * Model: tiles have stable ids; cuts are stored as id pairs so they travel
 * with tiles when you move them. Everything serializes back to the plain
 * manifest.json format the viewer reads (see wallfacer-core.js).
 *
 * Saving: with a connected folder (File System Access API, Chromium) the
 * editor renames/adds/deletes image files in wallfacer/, keeps wallfacer/opt/
 * in sync, and writes manifest.json. Without one it downloads the manifest
 * plus a git-mv script.
 */
(function () {
  const Core = window.WallfacerCore;
  const $ = (id) => document.getElementById(id);
  const BASE = new URL("../wallfacer/", window.location.href);
  const CELL = 180;
  const OPT_EDGE = 800;
  const POS_PREFIX = /^-?\d+\s*[x,]\s*-?\d+/;

  const el = {
    viewport: $("wfe-viewport"),
    world: $("wfe-world"),
    tiles: $("wfe-tiles"),
    edges: $("wfe-edges"),
    marquee: $("wfe-marquee"),
    dropHint: $("wfe-drop-hint"),
    status: $("wfe-status"),
    undo: $("wfe-undo"),
    redo: $("wfe-redo"),
    save: $("wfe-save"),
    connect: $("wfe-connect"),
    preview: $("wfe-preview"),
    fileInput: $("wfe-file-input"),
    emptySel: $("wfe-empty-sel"),
    selFields: $("wfe-sel-fields"),
    selPreview: $("wfe-sel-preview"),
    x: $("wfe-x"),
    y: $("wfe-y"),
    kindWrap: $("wfe-kind-wrap"),
    kind: $("wfe-kind"),
    textWrap: $("wfe-text-wrap"),
    text: $("wfe-text"),
    hrefWrap: $("wfe-href-wrap"),
    href: $("wfe-href"),
    file: $("wfe-file"),
    links: $("wfe-links"),
    multi: $("wfe-multi"),
    del: $("wfe-delete"),
    changes: $("wfe-changes"),
    dialog: $("wfe-dialog"),
    dialogTitle: $("wfe-dialog-title"),
    dialogBody: $("wfe-dialog-body"),
    dialogOk: $("wfe-dialog-ok"),
    toast: $("wfe-toast"),
  };

  const state = {
    tiles: [],
    cuts: new Set(), // "idA|idB" (sorted)
    baseline: null, // { tiles: Map(id -> copy), manifest }
    selection: new Set(),
    undo: [],
    redo: [],
    view: { x: 0, y: 0, zoom: 1 },
    dir: null, // FileSystemDirectoryHandle for wallfacer/
    gesture: null,
    hoverCell: { x: 0, y: 0 },
    tileEls: new Map(),
    previewOpen: false,
    pendingEditSnapshot: null,
  };

  let nextId = 1;
  const newId = () => `t${nextId++}`;
  const cutKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const byId = (id) => state.tiles.find((t) => t.id === id);
  const tileAt = (x, y) => state.tiles.find((t) => t.x === x && t.y === y);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  /* ---------- naming ---------- */

  const imageName = (t) => `${t.x},${t.y}${t.suffix}`;
  const tileLabel = (t) =>
    t.kind === "image"
      ? t.orig
        ? t.orig.file
        : t.blob
          ? t.blob.name || "new image"
          : "image"
      : `"${String(t.text || "").slice(0, 28)}${String(t.text || "").length > 28 ? "…" : ""}"`;

  /* ---------- model <-> manifest ---------- */

  const tilesFromManifest = (manifest) => {
    const { tiles, cuts } = Core.parseManifest(manifest);
    const built = tiles.map((entry) => {
      const t = { id: newId(), kind: entry.kind, x: entry.x, y: entry.y };
      if (entry.kind === "image") {
        t.orig = { file: entry.file };
        t.suffix = entry.file.replace(POS_PREFIX, "") || ".png";
        t.url = null;
        t.blob = null;
      } else {
        t.text = entry.text;
        if (entry.kind === "link") t.href = entry.href;
      }
      return t;
    });
    const at = new Map(built.map((t) => [Core.key(t.x, t.y), t]));
    const idCuts = new Set();
    cuts.forEach((c) => {
      const [a, b] = c.split("|");
      const ta = at.get(a);
      const tb = at.get(b);
      if (ta && tb) idCuts.add(cutKey(ta.id, tb.id));
    });
    return { tiles: built, cuts: idCuts };
  };

  const adjacent = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

  const currentManifest = () => {
    const entries = state.tiles.map((t) =>
      t.kind === "image" ? { ...t, file: imageName(t) } : t
    );
    const cuts = new Set();
    state.cuts.forEach((c) => {
      const [a, b] = c.split("|").map(byId);
      if (a && b && adjacent(a, b)) cuts.add(Core.edgeKey(a.x, a.y, b.x, b.y));
    });
    return Core.buildManifest(entries, cuts);
  };

  const manifestText = (m) => `${JSON.stringify(m, null, 2)}\n`;

  /* ---------- history ---------- */

  const snapshot = () => ({
    tiles: state.tiles.map((t) => ({ ...t })),
    cuts: new Set(state.cuts),
  });

  const restore = (snap) => {
    state.tiles = snap.tiles.map((t) => ({ ...t }));
    state.cuts = new Set(snap.cuts);
    state.selection = new Set([...state.selection].filter(byId));
  };

  const commit = () => {
    state.undo.push(snapshot());
    if (state.undo.length > 200) state.undo.shift();
    state.redo = [];
  };

  const undo = () => {
    if (!state.undo.length) return;
    state.redo.push(snapshot());
    restore(state.undo.pop());
    render();
  };

  const redo = () => {
    if (!state.redo.length) return;
    state.undo.push(snapshot());
    restore(state.redo.pop());
    render();
  };

  const setBaseline = () => {
    state.baseline = {
      tiles: new Map(state.tiles.map((t) => [t.id, { ...t }])),
      manifest: currentManifest(),
    };
  };

  const isDirty = () =>
    state.baseline && manifestText(currentManifest()) !== manifestText(state.baseline.manifest);

  /* ---------- view ---------- */

  const applyView = () => {
    const { x, y, zoom } = state.view;
    el.world.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    const size = CELL * zoom;
    el.viewport.style.backgroundSize = `${size}px ${size}px`;
    el.viewport.style.backgroundPosition = `${x - size / 2}px ${y - size / 2}px`;
  };

  const screenToWorld = (cx, cy) => {
    const r = el.viewport.getBoundingClientRect();
    return {
      x: (cx - r.left - state.view.x) / state.view.zoom,
      y: (cy - r.top - state.view.y) / state.view.zoom,
    };
  };

  const screenToCell = (cx, cy) => {
    const w = screenToWorld(cx, cy);
    return { x: Math.round(w.x / CELL), y: Math.round(w.y / CELL) };
  };

  const zoomAt = (factor, cx, cy) => {
    const r = el.viewport.getBoundingClientRect();
    const px = cx === undefined ? r.width / 2 : cx - r.left;
    const py = cy === undefined ? r.height / 2 : cy - r.top;
    const zoom = Math.min(2.5, Math.max(0.2, state.view.zoom * factor));
    const k = zoom / state.view.zoom;
    state.view.x = px - (px - state.view.x) * k;
    state.view.y = py - (py - state.view.y) * k;
    state.view.zoom = zoom;
    applyView();
  };

  const fit = () => {
    const r = el.viewport.getBoundingClientRect();
    if (!state.tiles.length) {
      state.view = { x: r.width / 2, y: r.height / 2, zoom: 1 };
      applyView();
      return;
    }
    const xs = state.tiles.map((t) => t.x);
    const ys = state.tiles.map((t) => t.y);
    const minX = Math.min(...xs) - 0.6;
    const maxX = Math.max(...xs) + 0.6;
    const minY = Math.min(...ys) - 0.6;
    const maxY = Math.max(...ys) + 0.6;
    const zoom = Math.min(1.4, Math.max(0.2, Math.min(r.width / ((maxX - minX) * CELL), r.height / ((maxY - minY) * CELL))));
    state.view = {
      zoom,
      x: r.width / 2 - ((minX + maxX) / 2) * CELL * zoom,
      y: r.height / 2 - ((minY + maxY) / 2) * CELL * zoom,
    };
    applyView();
  };

  const viewCenterCell = () => {
    const r = el.viewport.getBoundingClientRect();
    return screenToCell(r.left + r.width / 2, r.top + r.height / 2);
  };

  /* ---------- rendering ---------- */

  const fallbackToOriginal = (img, t) => {
    img.addEventListener(
      "error",
      () => {
        const original = new URL(t.orig.file, BASE).href;
        if (img.src !== original) img.src = original;
      },
      { once: true }
    );
  };

  const displaySrc = (t) => t.url || (t.orig ? new URL(Core.optName(t.orig.file), BASE).href : "");

  const tileContentSig = (t) => [t.kind, t.text, t.href, displaySrc(t)].join("\u0000");

  const renderTiles = () => {
    const live = new Set();
    state.tiles.forEach((t) => {
      live.add(t.id);
      let node = state.tileEls.get(t.id);
      if (!node) {
        node = document.createElement("div");
        node.className = "wfe-tile";
        node.dataset.id = t.id;
        state.tileEls.set(t.id, node);
        el.tiles.appendChild(node);
      }
      const sig = tileContentSig(t);
      if (node.dataset.sig !== sig) {
        node.dataset.sig = sig;
        node.textContent = "";
        if (t.kind === "image") {
          const img = document.createElement("img");
          img.decoding = "async";
          img.loading = "lazy";
          if (!t.url && t.orig) fallbackToOriginal(img, t);
          img.src = displaySrc(t);
          img.alt = tileLabel(t);
          node.appendChild(img);
        } else {
          const div = document.createElement("div");
          div.className = "wfe-text";
          div.textContent = t.text || (t.kind === "link" ? t.href : "");
          node.appendChild(div);
        }
        const coord = document.createElement("span");
        coord.className = "wfe-coord";
        node.appendChild(coord);
      }
      node.querySelector(".wfe-coord").textContent = `${t.x},${t.y}`;
      node.title = t.kind === "link" ? `${t.text}\n${t.href}` : tileLabel(t);
      if (!node.classList.contains("is-dragging")) {
        node.style.left = `${t.x * CELL}px`;
        node.style.top = `${t.y * CELL}px`;
        node.style.transform = "";
      }
      const base = state.baseline && state.baseline.tiles.get(t.id);
      node.classList.toggle("is-selected", state.selection.has(t.id));
      node.classList.toggle("is-link", t.kind === "link");
      node.classList.toggle("is-new", !base);
      node.classList.toggle("is-moved", !!base && (base.x !== t.x || base.y !== t.y));
    });
    state.tileEls.forEach((node, id) => {
      if (!live.has(id)) {
        node.remove();
        state.tileEls.delete(id);
      }
    });
  };

  const renderEdges = () => {
    const at = new Map(state.tiles.map((t) => [Core.key(t.x, t.y), t]));
    let svg = "";
    state.tiles.forEach((a) => {
      [
        [1, 0],
        [0, 1],
      ].forEach(([dx, dy]) => {
        const b = at.get(Core.key(a.x + dx, a.y + dy));
        if (!b) return;
        const cut = state.cuts.has(cutKey(a.id, b.id));
        const x1 = a.x * CELL;
        const y1 = a.y * CELL;
        const x2 = b.x * CELL;
        const y2 = b.y * CELL;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        svg +=
          `<g class="wfe-edge${cut ? " is-cut" : ""}" data-a="${a.id}" data-b="${b.id}">` +
          `<title>${cut ? "Cut: click to reconnect" : "Connected: click to cut"} (${a.x},${a.y} ↔ ${b.x},${b.y})</title>` +
          `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>` +
          `<circle cx="${mx}" cy="${my}" r="10"/>` +
          (cut ? `<text x="${mx}" y="${my}">✕</text>` : "") +
          `</g>`;
      });
    });
    el.edges.innerHTML = svg;
  };

  const renderPanel = () => {
    const ids = [...state.selection];
    const one = ids.length === 1 ? byId(ids[0]) : null;
    el.emptySel.hidden = ids.length > 0;
    el.selFields.hidden = !one;
    el.multi.hidden = ids.length < 2;
    el.del.hidden = ids.length === 0;
    el.del.textContent = ids.length > 1 ? `Delete ${ids.length} tiles` : "Delete";
    if (ids.length > 1) el.multi.textContent = `${ids.length} tiles selected. Drag or use the arrow keys to move them together.`;
    if (!one) return;

    const editing = document.activeElement;
    if (editing !== el.x) el.x.value = one.x;
    if (editing !== el.y) el.y.value = one.y;
    const isImage = one.kind === "image";
    el.kindWrap.hidden = isImage;
    el.textWrap.hidden = isImage;
    el.hrefWrap.hidden = one.kind !== "link";
    el.kind.value = isImage ? "text" : one.kind;
    if (editing !== el.text) el.text.value = one.text || "";
    if (editing !== el.href) el.href.value = one.href || "";
    el.file.hidden = !isImage;
    if (isImage) {
      const name = imageName(one);
      el.file.textContent =
        one.orig && one.orig.file !== name ? `${one.orig.file} → ${name}` : one.orig ? name : `new → ${name}`;
    }
    const src = isImage ? displaySrc(one) : "";
    if (el.selPreview.dataset.src !== src) {
      el.selPreview.dataset.src = src;
      el.selPreview.innerHTML = src ? `<img alt="" src="${esc(src)}">` : "";
    }

    const dirs = [
      ["←", -1, 0],
      ["→", 1, 0],
      ["↑", 0, -1],
      ["↓", 0, 1],
    ];
    el.links.innerHTML = "";
    dirs.forEach(([arrow, dx, dy]) => {
      const n = tileAt(one.x + dx, one.y + dy);
      if (!n) return;
      const cut = state.cuts.has(cutKey(one.id, n.id));
      const b = document.createElement("button");
      b.type = "button";
      b.className = cut ? "is-cut" : "";
      b.textContent = `${arrow} ${n.x},${n.y}`;
      b.title = cut ? "Connection cut: click to restore" : "Connected: click to cut";
      b.addEventListener("click", () => toggleCut(one.id, n.id));
      el.links.appendChild(b);
    });
    if (!el.links.children.length) el.links.innerHTML = `<span class="wfe-muted">No neighbours.</span>`;
  };

  const renderChanges = () => {
    const items = [];
    if (state.baseline) {
      const seen = new Set();
      state.tiles.forEach((t) => {
        seen.add(t.id);
        const b = state.baseline.tiles.get(t.id);
        if (!b) {
          items.push(`Added ${t.kind} ${tileLabel(t)} at ${t.x},${t.y}`);
          return;
        }
        if (b.x !== t.x || b.y !== t.y) items.push(`Moved ${tileLabel(t)} ${b.x},${b.y} → ${t.x},${t.y}`);
        if (b.kind !== t.kind || b.text !== t.text || b.href !== t.href) items.push(`Edited ${tileLabel(t)} at ${t.x},${t.y}`);
      });
      state.baseline.tiles.forEach((b, id) => {
        if (!seen.has(id)) items.push(`Deleted ${tileLabel(b)} from ${b.x},${b.y}`);
      });
      const before = new Set(state.baseline.manifest.cuts || []);
      const after = new Set(currentManifest().cuts || []);
      after.forEach((c) => !before.has(c) && items.push(`Cut ${c.replace("|", " ↔ ")}`));
      before.forEach((c) => !after.has(c) && items.push(`Reconnected ${c.replace("|", " ↔ ")}`));
    }
    el.changes.innerHTML = items.length
      ? items.map((i) => `<li>${esc(i)}</li>`).join("")
      : `<li class="wfe-muted">None yet.</li>`;
  };

  const renderStatus = () => {
    const dirty = isDirty();
    const where = state.dir ? `folder: ${state.dir.name}/` : "not connected";
    el.status.textContent = `${state.tiles.length} tiles · ${where}${dirty ? " · unsaved" : ""}`;
    el.status.classList.toggle("is-dirty", dirty);
    el.undo.disabled = !state.undo.length;
    el.redo.disabled = !state.redo.length;
    el.connect.textContent = state.dir ? "Reconnect" : "Connect folder";
  };

  let previewTimer = 0;
  const writePreview = () => {
    const srcs = {};
    state.tiles.forEach((t) => {
      if (t.kind === "image" && t.url) srcs[Core.key(t.x, t.y)] = t.url;
    });
    try {
      localStorage.setItem(Core.PREVIEW_KEY, JSON.stringify({ manifest: currentManifest(), srcs, at: Date.now() }));
    } catch (e) {
      console.warn("preview update failed", e);
    }
  };
  const pushPreview = () => {
    if (!state.previewOpen) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(writePreview, 120);
  };

  const render = () => {
    renderTiles();
    renderEdges();
    renderPanel();
    renderChanges();
    renderStatus();
    pushPreview();
  };

  /* ---------- toasts / dialogs ---------- */

  let toastTimer = 0;
  const toast = (msg, isError) => {
    el.toast.textContent = msg;
    el.toast.classList.toggle("is-error", !!isError);
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.toast.hidden = true), isError ? 6000 : 3000);
  };

  const ask = (title, html, okLabel = "OK") =>
    new Promise((resolve) => {
      el.dialogTitle.textContent = title;
      el.dialogBody.innerHTML = html;
      el.dialogOk.textContent = okLabel;
      el.dialog.returnValue = "";
      el.dialog.addEventListener("close", () => resolve(el.dialog.returnValue === "ok"), { once: true });
      el.dialog.showModal();
    });

  /* ---------- mutations ---------- */

  // Move a group by (dx, dy). Tiles in the way slide back along the move
  // direction into the cells the group vacated (a 1-tile move = swap).
  const moveGroup = (ids, dx, dy) => {
    if (!dx && !dy) return false;
    const group = new Set(ids);
    const moving = state.tiles.filter((t) => group.has(t.id));
    const targets = new Set(moving.map((t) => Core.key(t.x + dx, t.y + dy)));
    const displaced = [];
    state.tiles.forEach((t) => {
      if (group.has(t.id) || !targets.has(Core.key(t.x, t.y))) return;
      let px = t.x - dx;
      let py = t.y - dy;
      while (targets.has(Core.key(px, py))) {
        px -= dx;
        py -= dy;
      }
      displaced.push([t, px, py]);
    });
    commit();
    moving.forEach((t) => {
      t.x += dx;
      t.y += dy;
    });
    displaced.forEach(([t, x, y]) => {
      t.x = x;
      t.y = y;
    });
    return true;
  };

  const previewMove = (ids, dx, dy) => {
    const group = new Set(ids);
    const targets = new Set();
    state.tiles.forEach((t) => group.has(t.id) && targets.add(Core.key(t.x + dx, t.y + dy)));
    return [...targets].map((k) => {
      const [x, y] = k.split(",").map(Number);
      const occ = tileAt(x, y);
      return { x, y, swap: !!occ && !group.has(occ.id) };
    });
  };

  const toggleCut = (a, b) => {
    commit();
    const k = cutKey(a, b);
    if (state.cuts.has(k)) state.cuts.delete(k);
    else state.cuts.add(k);
    render();
  };

  const deleteSelection = () => {
    if (!state.selection.size) return;
    commit();
    state.tiles = state.tiles.filter((t) => !state.selection.has(t.id));
    state.selection.clear();
    render();
  };

  const freeCellNear = (x, y, taken) => {
    const free = (cx, cy) => !tileAt(cx, cy) && !taken.has(Core.key(cx, cy));
    if (free(x, y)) return { x, y };
    for (let r = 1; r < 50; r += 1) {
      const ring = [];
      for (let i = -r; i <= r; i += 1) {
        ring.push([x + i, y - r], [x + i, y + r], [x - r, y + i], [x + r, y + i]);
      }
      ring.sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y));
      const hit = ring.find(([cx, cy]) => free(cx, cy));
      if (hit) return { x: hit[0], y: hit[1] };
    }
    return { x, y };
  };

  const addText = (x, y) => {
    const cell = freeCellNear(x, y, new Set());
    commit();
    const t = { id: newId(), kind: "text", x: cell.x, y: cell.y, text: "new text" };
    state.tiles.push(t);
    state.selection = new Set([t.id]);
    render();
    el.text.focus();
    el.text.select();
  };

  const addImages = (files, x, y) => {
    const images = [...files].filter((f) => f.type.startsWith("image/") || Core.isImageName(f.name));
    if (!images.length) {
      toast("No image files in that drop.", true);
      return;
    }
    commit();
    const taken = new Set();
    const added = images.map((file) => {
      const cell = freeCellNear(x, y, taken);
      taken.add(Core.key(cell.x, cell.y));
      let ext = (Core.extOf(file.name) || `.${(file.type.split("/")[1] || "png").replace("jpeg", "jpg")}`).toLowerCase();
      if (!Core.isImageName(`a${ext}`)) ext = ".png";
      const t = {
        id: newId(),
        kind: "image",
        x: cell.x,
        y: cell.y,
        suffix: ext,
        orig: null,
        blob: file,
        url: URL.createObjectURL(file),
      };
      state.tiles.push(t);
      return t;
    });
    state.selection = new Set(added.map((t) => t.id));
    render();
    toast(`Added ${added.length} image${added.length > 1 ? "s" : ""}.`);
  };

  /* ---------- pointer interaction ---------- */

  const clearGhosts = () => el.tiles.querySelectorAll(".wfe-ghost").forEach((g) => g.remove());

  const drawGhosts = (cells) => {
    clearGhosts();
    cells.forEach(({ x, y, swap }) => {
      const g = document.createElement("div");
      g.className = `wfe-ghost${swap ? " is-swap" : ""}`;
      g.style.left = `${x * CELL}px`;
      g.style.top = `${y * CELL}px`;
      el.tiles.appendChild(g);
    });
  };

  const onPointerDown = (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    el.viewport.focus({ preventScroll: true });
    const edge = e.target.closest(".wfe-edge");
    const tileNode = e.target.closest(".wfe-tile");
    const g = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false };

    if (e.button === 1) {
      g.mode = "pan";
    } else if (edge) {
      g.mode = "edge";
      g.a = edge.dataset.a;
      g.b = edge.dataset.b;
    } else if (tileNode) {
      const id = tileNode.dataset.id;
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (additive) {
        if (state.selection.has(id)) {
          state.selection.delete(id);
          renderTiles();
          renderPanel();
          return;
        }
        state.selection.add(id);
      } else if (!state.selection.has(id)) {
        state.selection = new Set([id]);
      }
      g.mode = "tile";
      g.clicked = id;
      g.additive = additive;
      g.ids = [...state.selection];
      g.dx = 0;
      g.dy = 0;
      renderTiles();
      renderPanel();
    } else if (e.shiftKey) {
      g.mode = "marquee";
      g.base = new Set(state.selection);
    } else {
      g.mode = "pan";
      g.vx = state.view.x;
      g.vy = state.view.y;
    }
    g.vx = state.view.x;
    g.vy = state.view.y;
    state.gesture = g;
    el.viewport.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    state.hoverCell = screenToCell(e.clientX, e.clientY);
    const g = state.gesture;
    if (!g || g.id !== e.pointerId) return;
    const ddx = e.clientX - g.sx;
    const ddy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(ddx, ddy) < 4) return;
    g.moved = true;

    if (g.mode === "pan") {
      el.viewport.classList.add("is-panning");
      state.view.x = g.vx + ddx;
      state.view.y = g.vy + ddy;
      applyView();
    } else if (g.mode === "tile") {
      const z = state.view.zoom;
      g.ids.forEach((id) => {
        const node = state.tileEls.get(id);
        if (!node) return;
        node.classList.add("is-dragging");
        node.style.transform = `translate(${ddx / z}px, ${ddy / z}px)`;
      });
      const dx = Math.round(ddx / z / CELL);
      const dy = Math.round(ddy / z / CELL);
      if (dx !== g.dx || dy !== g.dy) {
        g.dx = dx;
        g.dy = dy;
        if (dx || dy) drawGhosts(previewMove(g.ids, dx, dy));
        else clearGhosts();
      }
    } else if (g.mode === "marquee") {
      const r = el.viewport.getBoundingClientRect();
      const x1 = Math.min(g.sx, e.clientX);
      const y1 = Math.min(g.sy, e.clientY);
      const x2 = Math.max(g.sx, e.clientX);
      const y2 = Math.max(g.sy, e.clientY);
      Object.assign(el.marquee.style, {
        left: `${x1 - r.left}px`,
        top: `${y1 - r.top}px`,
        width: `${x2 - x1}px`,
        height: `${y2 - y1}px`,
      });
      el.marquee.hidden = false;
      const a = screenToWorld(x1, y1);
      const b = screenToWorld(x2, y2);
      state.selection = new Set(g.base);
      state.tiles.forEach((t) => {
        const cx = t.x * CELL;
        const cy = t.y * CELL;
        if (cx >= a.x && cx <= b.x && cy >= a.y && cy <= b.y) state.selection.add(t.id);
      });
      renderTiles();
      renderPanel();
    }
  };

  const onPointerUp = (e) => {
    const g = state.gesture;
    if (!g || g.id !== e.pointerId) return;
    state.gesture = null;
    el.viewport.classList.remove("is-panning");
    el.marquee.hidden = true;
    if (el.viewport.hasPointerCapture(e.pointerId)) el.viewport.releasePointerCapture(e.pointerId);

    const cell = screenToCell(e.clientX, e.clientY);
    const now = performance.now();
    const last = state.lastClick;
    const isDouble =
      !g.moved && last && now - last.t < 400 && last.x === cell.x && last.y === cell.y && last.mode === g.mode;
    state.lastClick = g.moved || isDouble ? null : { t: now, x: cell.x, y: cell.y, mode: g.mode };

    if (isDouble && g.mode === "tile" && !g.additive) {
      const t = byId(g.clicked);
      state.selection = new Set([g.clicked]);
      render();
      if (t && t.kind !== "image") {
        el.text.focus();
        el.text.select();
      }
      return;
    }
    if (isDouble && g.mode === "pan" && e.button === 0) {
      addText(cell.x, cell.y);
      return;
    }

    if (g.mode === "edge" && !g.moved) {
      toggleCut(g.a, g.b);
    } else if (g.mode === "tile") {
      clearGhosts();
      g.ids.forEach((id) => {
        const node = state.tileEls.get(id);
        if (node) node.classList.remove("is-dragging");
      });
      if (g.moved && (g.dx || g.dy)) {
        moveGroup(g.ids, g.dx, g.dy);
      } else if (!g.moved && !g.additive) {
        state.selection = new Set([g.clicked]);
      }
      render();
    } else if (g.mode === "pan" && !g.moved && e.button === 0) {
      state.selection.clear();
      renderTiles();
      renderPanel();
    }
  };

  /* ---------- panel inputs ---------- */

  const selected = () => (state.selection.size === 1 ? byId([...state.selection][0]) : null);

  const beginEdit = () => {
    state.pendingEditSnapshot = snapshot();
  };

  const editField = (fn) => {
    const t = selected();
    if (!t) return;
    if (state.pendingEditSnapshot) {
      state.undo.push(state.pendingEditSnapshot);
      state.redo = [];
      state.pendingEditSnapshot = null;
    }
    fn(t);
    render();
  };

  [el.text, el.href].forEach((input) => input.addEventListener("focus", beginEdit));
  el.text.addEventListener("input", () => editField((t) => (t.text = el.text.value)));
  el.href.addEventListener("input", () => editField((t) => (t.href = el.href.value.trim())));
  el.kind.addEventListener("change", () => {
    beginEdit();
    editField((t) => {
      t.kind = el.kind.value;
      if (t.kind === "link" && !t.href) t.href = "https://";
      if (t.kind === "text") delete t.href;
    });
    if (el.kind.value === "link") el.href.focus();
  });

  const onPosInput = () => {
    const t = selected();
    if (!t) return;
    const nx = Number.parseInt(el.x.value, 10);
    const ny = Number.parseInt(el.y.value, 10);
    if (Number.isNaN(nx) || Number.isNaN(ny)) return;
    if (moveGroup([t.id], nx - t.x, ny - t.y)) render();
  };
  el.x.addEventListener("change", onPosInput);
  el.y.addEventListener("change", onPosInput);

  el.del.addEventListener("click", deleteSelection);

  /* ---------- keyboard / clipboard ---------- */

  const typing = () => {
    const a = document.activeElement;
    return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT");
  };

  window.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
      return;
    }
    if (el.dialog.open || typing()) return;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      state.selection = new Set(state.tiles.map((t) => t.id));
      render();
      return;
    }
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (arrow && state.selection.size) {
      e.preventDefault();
      moveGroup([...state.selection], arrow[0], arrow[1]);
      render();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && state.selection.size) {
      e.preventDefault();
      deleteSelection();
    } else if (e.key === "Escape") {
      state.selection.clear();
      render();
    } else if (e.key === "+" || e.key === "=") {
      zoomAt(1.2);
    } else if (e.key === "-") {
      zoomAt(1 / 1.2);
    } else if (e.key === "0") {
      fit();
    } else if (e.key === "Enter" && state.selection.size === 1) {
      const t = selected();
      if (t && t.kind !== "image") el.text.focus();
    }
  });

  window.addEventListener("paste", (e) => {
    if (typing()) return;
    const files = [...(e.clipboardData ? e.clipboardData.files : [])];
    if (files.length) {
      e.preventDefault();
      const c = state.hoverCell || viewCenterCell();
      addImages(files, c.x, c.y);
    }
  });

  /* ---------- drag & drop from desktop ---------- */

  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  let dragDepth = 0;

  el.viewport.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth += 1;
    el.viewport.classList.add("is-dropping");
    el.dropHint.hidden = false;
  });
  el.viewport.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const c = screenToCell(e.clientX, e.clientY);
    el.dropHint.textContent = `Drop to add at ${c.x},${c.y}${tileAt(c.x, c.y) ? " (nearest empty cell)" : ""}`;
    drawGhosts([{ x: c.x, y: c.y, swap: !!tileAt(c.x, c.y) }]);
  });
  const endDrag = () => {
    dragDepth = 0;
    el.viewport.classList.remove("is-dropping");
    el.dropHint.hidden = true;
    clearGhosts();
  };
  el.viewport.addEventListener("dragleave", () => {
    dragDepth -= 1;
    if (dragDepth <= 0) endDrag();
  });
  el.viewport.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    endDrag();
    const c = screenToCell(e.clientX, e.clientY);
    addImages(e.dataTransfer.files, c.x, c.y);
  });
  // Dropping outside the canvas shouldn't navigate away from unsaved work.
  window.addEventListener("dragover", (e) => hasFiles(e) && e.preventDefault());
  window.addEventListener("drop", (e) => hasFiles(e) && e.preventDefault());

  /* ---------- other canvas events ---------- */

  el.viewport.addEventListener("pointerdown", onPointerDown);
  el.viewport.addEventListener("pointermove", onPointerMove);
  el.viewport.addEventListener("pointerup", onPointerUp);
  el.viewport.addEventListener("pointercancel", onPointerUp);
  el.viewport.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), e.clientX, e.clientY);
      } else {
        state.view.x -= e.deltaX;
        applyView();
      }
    },
    { passive: false }
  );

  el.undo.addEventListener("click", undo);
  el.redo.addEventListener("click", redo);
  $("wfe-add-text").addEventListener("click", () => {
    const c = viewCenterCell();
    addText(c.x, c.y);
  });
  $("wfe-add-image").addEventListener("click", () => el.fileInput.click());
  el.fileInput.addEventListener("change", () => {
    const c = viewCenterCell();
    addImages(el.fileInput.files, c.x, c.y);
    el.fileInput.value = "";
  });
  $("wfe-zoom-in").addEventListener("click", () => zoomAt(1.2));
  $("wfe-zoom-out").addEventListener("click", () => zoomAt(1 / 1.2));
  $("wfe-fit").addEventListener("click", fit);
  el.preview.addEventListener("click", () => {
    state.previewOpen = true;
    clearTimeout(previewTimer);
    writePreview();
    window.open("wallfacer.html?preview", "wallfacer-preview");
  });
  window.addEventListener("resize", applyView);
  window.addEventListener("beforeunload", (e) => {
    if (isDirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  /* ---------- folder access (File System Access API) ---------- */

  const idb = (mode, fn) =>
    new Promise((resolve, reject) => {
      const open = indexedDB.open("wallfacer-editor", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("kv");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("kv", mode);
        const req = fn(tx.objectStore("kv"));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
      };
    });
  const storeHandle = (h) => idb("readwrite", (s) => s.put(h, "dir")).catch(() => {});
  const loadHandle = () => idb("readonly", (s) => s.get("dir")).catch(() => null);

  const getEntry = async (dir, name) => {
    try {
      return await dir.getFileHandle(name);
    } catch {
      return null;
    }
  };

  const resolveWallfacerDir = async (dir) => {
    if (await getEntry(dir, "manifest.json")) return dir;
    try {
      const sub = await dir.getDirectoryHandle("wallfacer");
      if (await getEntry(sub, "manifest.json")) return sub;
    } catch {
      /* not a repo root */
    }
    return null;
  };

  const loadFromDir = async (dir) => {
    const fh = await getEntry(dir, "manifest.json");
    const manifest = JSON.parse(await (await fh.getFile()).text());
    return manifest;
  };

  const attachLocalImages = async () => {
    await Promise.all(
      state.tiles.map(async (t) => {
        if (t.kind !== "image" || t.blob || !t.orig) return;
        const fh = await getEntry(state.dir, t.orig.file);
        if (fh) t.url = URL.createObjectURL(await fh.getFile());
      })
    );
  };

  const connect = async (forcePicker) => {
    if (!window.showDirectoryPicker) {
      await ask(
        "Folder access not supported",
        "<p>This browser can't write to local folders. Use Edge or Chrome to save directly. Here, Save will download <code>manifest.json</code> plus a rename script instead.</p>"
      );
      return false;
    }
    let handle = null;
    const stored = await loadHandle();
    if (stored && !forcePicker) {
      try {
        if ((await stored.requestPermission({ mode: "readwrite" })) === "granted") handle = stored;
      } catch {
        handle = null;
      }
    }
    if (!handle) {
      try {
        handle = await window.showDirectoryPicker({ id: "wallfacer", mode: "readwrite" });
      } catch {
        return false; // user cancelled
      }
    }
    const dir = await resolveWallfacerDir(handle);
    if (!dir) {
      toast("That folder has no manifest.json. Pick the repo's wallfacer/ folder (or the repo root).", true);
      return false;
    }
    const diskManifest = await loadFromDir(dir);
    const sameAsLoaded =
      state.baseline && manifestText(diskManifest) === manifestText(state.baseline.manifest);

    if (!sameAsLoaded && isDirty()) {
      const ok = await ask(
        "Local manifest differs",
        "<p>The manifest in that folder doesn't match the one you started editing. Reload from the folder? Your unsaved changes here will be discarded.</p>",
        "Reload from folder"
      );
      if (!ok) return false;
    }
    state.dir = dir;
    storeHandle(handle);
    if (!sameAsLoaded) loadManifest(diskManifest);
    await attachLocalImages();
    render();
    toast(`Connected to ${dir.name}/`);
    return true;
  };

  el.connect.addEventListener("click", () => connect(!!state.dir));

  /* ---------- saving ---------- */

  const makeOptimized = async (blob) => {
    try {
      const bmp = await createImageBitmap(blob);
      const scale = Math.min(1, OPT_EDGE / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close();
      const out = await new Promise((r) => canvas.toBlob(r, "image/webp", 0.8));
      return out && out.type === "image/webp" ? out : null;
    } catch {
      return null;
    }
  };

  const buildPlan = () => {
    const renames = [];
    const adds = [];
    const deletes = [];
    state.tiles.forEach((t) => {
      if (t.kind !== "image") return;
      const to = imageName(t);
      if (!t.orig) adds.push({ t, to });
      else if (t.orig.file !== to) renames.push({ t, from: t.orig.file, to });
    });
    const live = new Set(state.tiles.map((t) => t.id));
    state.baseline.tiles.forEach((b, id) => {
      if (b.kind === "image" && b.orig && !live.has(id)) deletes.push(b.orig.file);
    });
    return { renames, adds, deletes, manifest: currentManifest() };
  };

  const describePlan = (plan) => {
    const li = (s) => `<li>${esc(s)}</li>`;
    let html = "<ul>";
    plan.renames.forEach((r) => (html += li(`rename ${r.from} → ${r.to}`)));
    plan.adds.forEach((a) => (html += li(`add ${a.to}${Core.isAnimatedName(a.to) ? " (run optimize script for opt/)" : ""}`)));
    plan.deletes.forEach((d) => (html += li(`delete ${d}`)));
    html += li("write manifest.json");
    return `${html}</ul>`;
  };

  const readBlob = async (name) => {
    const fh = await getEntry(state.dir, name);
    return fh ? fh.getFile() : null;
  };

  const writeBlob = async (dir, name, blob) => {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  };

  const removeQuiet = async (dir, name) => {
    try {
      await dir.removeEntry(name);
    } catch {
      /* already gone */
    }
  };

  const saveToFolder = async (plan) => {
    const dir = state.dir;
    const optDir = await dir.getDirectoryHandle("opt", { create: true });
    const optFile = (name) => Core.optName(name).slice(4);
    const getOpt = async (name) => {
      try {
        return await (await optDir.getFileHandle(optFile(name))).getFile();
      } catch {
        return null;
      }
    };

    // 1. Read everything that moves into memory first (handles swaps/chains).
    const writes = []; // [dirHandle, name, blob]
    for (const r of plan.renames) {
      const blob = await readBlob(r.from);
      if (!blob) throw new Error(`${r.from} is missing from the folder`);
      writes.push([dir, r.to, blob]);
      const opt = (await getOpt(r.from)) || (Core.isAnimatedName(r.to) ? null : await makeOptimized(blob));
      if (opt) writes.push([optDir, optFile(r.to), opt]);
    }
    for (const a of plan.adds) {
      writes.push([dir, a.to, a.t.blob]);
      const opt = Core.isAnimatedName(a.to) ? null : await makeOptimized(a.t.blob);
      if (opt) writes.push([optDir, optFile(a.to), opt]);
    }

    // 2. Write new names (overwriting is fine: originals are already in memory).
    for (const [d, name, blob] of writes) await writeBlob(d, name, blob);

    // 3. Remove old names that nothing was written over.
    const written = new Set(writes.filter(([d]) => d === dir).map(([, n]) => n));
    const writtenOpt = new Set(writes.filter(([d]) => d === optDir).map(([, n]) => n));
    const stale = plan.renames.map((r) => r.from).concat(plan.deletes);
    for (const name of stale) {
      if (!written.has(name)) await removeQuiet(dir, name);
      if (!writtenOpt.has(optFile(name))) await removeQuiet(optDir, optFile(name));
    }

    // 4. Manifest last, so a half-finished save never points at missing files.
    await writeBlob(dir, "manifest.json", new Blob([manifestText(plan.manifest)], { type: "application/json" }));
  };

  const download = (name, blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const shq = (s) => `'${s.replace(/'/g, "'\\''")}'`;

  const saveAsDownloads = (plan) => {
    download("manifest.json", new Blob([manifestText(plan.manifest)], { type: "application/json" }));
    const lines = ["#!/bin/sh", "# Run from the repo root, after copying manifest.json into wallfacer/.", "set -e", "cd wallfacer"];
    plan.renames.forEach((r, i) => lines.push(`git mv ${shq(r.from)} ${shq(`__tmp${i}__${r.to}`)}`));
    plan.renames.forEach((r, i) => lines.push(`git mv ${shq(`__tmp${i}__${r.to}`)} ${shq(r.to)}`));
    plan.deletes.forEach((d) => lines.push(`git rm ${shq(d)}`));
    if (plan.adds.length) lines.push(`# copy the downloaded new images into wallfacer/: ${plan.adds.map((a) => a.to).join(", ")}`);
    lines.push("cd .. && python scripts/optimize_wallfacer.py");
    download("apply-wallfacer.sh", new Blob([`${lines.join("\n")}\n`], { type: "text/x-sh" }));
    plan.adds.forEach((a) => download(a.to, a.t.blob));
  };

  const afterSave = (plan) => {
    plan.renames.concat(plan.adds).forEach(({ t, to }) => {
      const live = byId(t.id);
      if (!live) return;
      if (!live.url && live.orig) live.url = displaySrc(live); // keep showing the served copy
      live.orig = { file: to };
      live.blob = null;
    });
    // History entries still reference pre-save filenames; keep them simple.
    state.undo = [];
    state.redo = [];
    setBaseline();
    render();
  };

  const save = async () => {
    if (!state.baseline) return;
    if (!isDirty()) {
      toast("Nothing to save.");
      return;
    }
    const plan = buildPlan();
    const bad = state.tiles.find(
      (t) =>
        (t.kind !== "image" && !String(t.text || "").trim() && t.kind !== "link") ||
        (t.kind === "link" && !/^https?:\/\/\S+$/.test(t.href || ""))
    );
    if (bad) {
      state.selection = new Set([bad.id]);
      render();
      toast(
        bad.kind === "link"
          ? `The link at ${bad.x},${bad.y} needs a full http(s) URL.`
          : `The text tile at ${bad.x},${bad.y} is empty.`,
        true
      );
      return;
    }
    if (!state.dir && window.showDirectoryPicker) {
      const go = await ask(
        "Connect your wallfacer folder?",
        "<p>Saving writes straight into your local clone. Choose the repo's <code>wallfacer/</code> folder (or the repo root).</p>",
        "Choose folder"
      );
      if (!go || !(await connect())) return;
      if (!isDirty()) return;
    }
    if (state.dir) {
      const ok = await ask(`Save to ${state.dir.name}/`, `${describePlan(buildPlan())}<p class="wfe-muted">Commit the result with git when you're happy.</p>`, "Save");
      if (!ok) return;
      try {
        const finalPlan = buildPlan();
        await saveToFolder(finalPlan);
        afterSave(finalPlan);
        toast("Saved. Commit the changes in wallfacer/ when ready.");
      } catch (err) {
        console.error(err);
        toast(`Save failed: ${err.message}. Run git status in the repo to inspect.`, true);
      }
    } else {
      const ok = await ask(
        "Download changes",
        `${describePlan(plan)}<p>This downloads <code>manifest.json</code>, <code>apply-wallfacer.sh</code> (git mv commands) and any new images.</p>`,
        "Download"
      );
      if (!ok) return;
      saveAsDownloads(plan);
      afterSave(plan);
    }
  };

  el.save.addEventListener("click", save);

  /* ---------- boot ---------- */

  const loadManifest = (manifest) => {
    const { tiles, cuts } = tilesFromManifest(manifest);
    state.tiles = tiles;
    state.cuts = cuts;
    state.selection.clear();
    state.undo = [];
    state.redo = [];
    state.tileEls.forEach((n) => n.remove());
    state.tileEls.clear();
    setBaseline();
    render();
    fit();
  };

  const boot = async () => {
    applyView();
    try {
      const res = await fetch(new URL("manifest.json", BASE), { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      loadManifest(await res.json());
    } catch {
      loadManifest({ images: [] });
      toast("Couldn't fetch the manifest. Click Connect folder and choose your wallfacer/ folder.", true);
    }
  };

  boot();
})();
