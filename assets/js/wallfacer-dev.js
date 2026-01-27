let app = null;
let stage = null;
let message = null;
let output = null;
let spacingInput = null;
let spacingValue = null;
let deleteButton = null;
let copyButton = null;
let downloadButton = null;

const CLICK_SUPPRESS_MS = 240;

const state = {
  spacing: 260,
  offsetX: 0,
  offsetY: 0,
  tiles: [],
  panning: false,
  draggingTile: null,
  selectedTile: null,
  tileStart: { x: 0, y: 0 },
  dragOffset: { x: 0, y: 0 },
  panStart: { x: 0, y: 0 },
  offsetStart: { x: 0, y: 0 },
  panMoved: false,
  dragMoved: false,
  pointerStart: { x: 0, y: 0 },
  lastInteractionAt: 0,
};

const imageExtensions = ["png", "jpg", "jpeg", "gif", "webp", "avif"];
const wallfacerBaseUrl = new URL("../wallfacer/", window.location.href);
const wallfacerManifestUrl = new URL("manifest.json", wallfacerBaseUrl);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const hasImageExtension = (filename) =>
  imageExtensions.some((extension) =>
    filename.toLowerCase().endsWith(`.${extension}`)
  );

const parseImageData = (filename) => {
  const baseName = filename.split("/").pop() || filename;
  const extensionMatch = baseName.match(/\.[^.]+$/);
  const extension = extensionMatch ? extensionMatch[0] : "";
  const nameWithoutExt = baseName.replace(/\.[^.]+$/, "");
  const match = nameWithoutExt.match(/^(-?\d+)\s*[x,]\s*(-?\d+)(?:[ _-]+)?(.*)?$/);

  if (match) {
    const [, x, y, label] = match;
    const cleanedLabel = label ? label.trim() : "";
    return {
      kind: "image",
      file: filename,
      x: Number.parseInt(x, 10),
      y: Number.parseInt(y, 10),
      label: cleanedLabel,
      title: nameWithoutExt,
      extension,
    };
  }

  return {
    kind: "image",
    file: filename,
    x: 0,
    y: 0,
    label: nameWithoutExt,
    title: nameWithoutExt,
    extension,
  };
};

const parseTextEntry = (entry) => {
  const match = entry.match(/^(-?\d+)\s*[x,]\s*(-?\d+)\s+"(.+)"\s*$/);
  if (!match) {
    return null;
  }
  const [, x, y, text] = match;
  return {
    kind: "text",
    x: Number.parseInt(x, 10),
    y: Number.parseInt(y, 10),
    text,
    title: `${x},${y}`,
  };
};

const parseLinkEntry = (entry) => {
  const match = entry.match(
    /^(-?\d+)\s*[x,]\s*(-?\d+)\s+"(.+?)"\s+(https?:\/\/\S+)\s*$/
  );
  if (!match) {
    return null;
  }
  const [, x, y, text, href] = match;
  return {
    kind: "link",
    x: Number.parseInt(x, 10),
    y: Number.parseInt(y, 10),
    text,
    href,
    title: `${x},${y}`,
  };
};

const parseManifestEntry = (entry) => {
  if (typeof entry === "string") {
    const linkEntry = parseLinkEntry(entry);
    if (linkEntry) {
      return linkEntry;
    }
    const textEntry = parseTextEntry(entry);
    if (textEntry) {
      return textEntry;
    }
    if (hasImageExtension(entry)) {
      return parseImageData(entry);
    }
    return parseImageData(entry);
  }

  if (entry && typeof entry === "object") {
    if (entry.type === "link" || entry.href) {
      return {
        kind: "link",
        x: Number.parseInt(entry.x, 10) || 0,
        y: Number.parseInt(entry.y, 10) || 0,
        text: entry.text || entry.label || "",
        href: entry.href || "",
        title: `${entry.x ?? 0},${entry.y ?? 0}`,
      };
    }

    if (entry.type === "text" || entry.text) {
      return {
        kind: "text",
        x: Number.parseInt(entry.x, 10) || 0,
        y: Number.parseInt(entry.y, 10) || 0,
        text: entry.text || "",
        title: `${entry.x ?? 0},${entry.y ?? 0}`,
      };
    }

    if (entry.file) {
      return parseImageData(entry.file);
    }
  }

  return null;
};

const updateStageTransform = () => {
  stage.style.setProperty("--stage-offset-x", `${state.offsetX}px`);
  stage.style.setProperty("--stage-offset-y", `${state.offsetY}px`);
};

const isUiElement = (target) =>
  target.closest(
    "#wallfacer-dev-hud, .wallfacer-dev-output-panel, button, input, textarea, select, label"
  );

const updateTilePosition = (tile) => {
  const x = Number.parseInt(tile.dataset.x, 10);
  const y = Number.parseInt(tile.dataset.y, 10);
  tile.style.setProperty("--tile-x", `${x * state.spacing}px`);
  tile.style.setProperty("--tile-y", `${y * state.spacing}px`);
  const badge = tile.querySelector(".wallfacer-dev-badge");
  if (badge) {
    badge.textContent = `(${x}, ${y})`;
  }
};

const buildNewName = (image, x, y) => {
  const labelSuffix = image.label ? ` ${image.label}` : "";
  return `${x},${y}${labelSuffix}${image.extension}`;
};

const updateOutput = () => {
  if (!output) {
    return;
  }
  const entries = [];
  const renames = [];

  state.tiles.forEach(({ tile, entry }) => {
    const x = Number.parseInt(tile.dataset.x, 10);
    const y = Number.parseInt(tile.dataset.y, 10);
    if (entry.kind === "text") {
      entries.push(`${x},${y} "${entry.text}"`);
      return;
    }
    if (entry.kind === "link") {
      entries.push(`${x},${y} "${entry.text}" ${entry.href}`);
      return;
    }
    const newName = buildNewName(entry, x, y);
    entries.push(newName);
    renames.push(`wallfacer/${entry.file} → wallfacer/${newName}`);
  });

  output.value = JSON.stringify({ images: entries, renames }, null, 2);
};

const renderTiles = (entries) => {
  stage.innerHTML = "";
  state.tiles = entries
    .map((entry) => {
      if (!entry) {
        return null;
      }
      const tile = document.createElement("div");
      tile.className = "wallfacer-dev-tile";
      tile.dataset.x = String(entry.x);
      tile.dataset.y = String(entry.y);

      if (entry.kind === "text" || entry.kind === "link") {
        const textBlock = document.createElement("div");
        textBlock.className = "wallfacer-dev-text-block";
        if (entry.kind === "link") {
          const link = document.createElement("a");
          link.href = entry.href;
          link.textContent = entry.text || entry.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          textBlock.appendChild(link);
        } else {
          textBlock.textContent = entry.text;
        }
        tile.appendChild(textBlock);
      } else {
        const img = document.createElement("img");
        img.src = new URL(entry.file, wallfacerBaseUrl).toString();
        img.alt = entry.label || entry.title;
        img.title = entry.title;
        img.loading = "lazy";
        img.draggable = false;

        const caption = document.createElement("div");
        caption.className = "wallfacer-dev-caption";
        caption.textContent = entry.label || entry.title;

        tile.appendChild(img);
        tile.appendChild(caption);
      }

      const badge = document.createElement("div");
      badge.className = "wallfacer-dev-badge";

      tile.appendChild(badge);
      stage.appendChild(tile);

      updateTilePosition(tile);
      
      // Add event handlers directly to each tile
      tile.addEventListener("pointerdown", handleTilePointerDown);
      tile.addEventListener("pointermove", handleTilePointerMove);
      tile.addEventListener("pointerup", handleTilePointerUp);
      tile.addEventListener("pointercancel", handleTilePointerUp);
      
      return { tile, entry };
    })
    .filter(Boolean);

  updateOutput();
};

const getCurrentEntries = () =>
  state.tiles.map(({ tile, entry }) => {
    const x = Number.parseInt(tile.dataset.x, 10);
    const y = Number.parseInt(tile.dataset.y, 10);
    if (!Number.isNaN(x) && !Number.isNaN(y)) {
      if (entry.x !== x || entry.y !== y) {
        entry.x = x;
        entry.y = y;
        if (entry.kind === "text" || entry.kind === "link") {
          entry.title = `${x},${y}`;
        }
      }
    }
    return entry;
  });

const snapTileToGrid = (tile, x, y) => {
  tile.dataset.x = String(x);
  tile.dataset.y = String(y);
  const tileRecord = state.tiles.find((item) => item.tile === tile);
  if (tileRecord) {
    tileRecord.entry.x = x;
    tileRecord.entry.y = y;
    if (tileRecord.entry.kind === "text" || tileRecord.entry.kind === "link") {
      tileRecord.entry.title = `${x},${y}`;
    }
  }
  updateTilePosition(tile);
  updateOutput();
};

const clearSelectedTile = () => {
  if (state.selectedTile) {
    state.selectedTile.classList.remove("is-selected");
    state.selectedTile = null;
  }
};

const selectTile = (tile) => {
  if (state.selectedTile === tile) {
    return;
  }
  clearSelectedTile();
  state.selectedTile = tile;
  tile.classList.add("is-selected");
};

const removeTile = (tile) => {
  if (!tile) {
    return;
  }
  tile.remove();
  state.tiles = state.tiles.filter(({ tile: candidate }) => candidate !== tile);
  clearSelectedTile();
  updateOutput();
};

const getStageOrigin = () => {
  const rect = app.getBoundingClientRect();
  return {
    originX: rect.left + rect.width / 2 + state.offsetX,
    originY: rect.top + rect.height / 2 + state.offsetY,
  };
};

const getPointerStagePosition = (event) => {
  const { originX, originY } = getStageOrigin();
  return {
    x: event.clientX - originX,
    y: event.clientY - originY,
  };
};

const handleTilePointerDown = (event) => {
  const tile = event.currentTarget;
  event.preventDefault();
  event.stopPropagation();
  selectTile(tile);
  state.draggingTile = tile;
  state.dragMoved = false;
  state.pointerStart = { x: event.clientX, y: event.clientY };
  state.tileStart = {
    x: Number.parseInt(tile.dataset.x, 10) * state.spacing,
    y: Number.parseInt(tile.dataset.y, 10) * state.spacing,
  };
  const pointerPosition = getPointerStagePosition(event);
  state.dragOffset = {
    x: pointerPosition.x - state.tileStart.x,
    y: pointerPosition.y - state.tileStart.y,
  };
  tile.classList.add("is-dragging");
  tile.setPointerCapture(event.pointerId);
};

const handleTilePointerMove = (event) => {
  if (!state.draggingTile) {
    return;
  }
  const dragDx = event.clientX - state.pointerStart.x;
  const dragDy = event.clientY - state.pointerStart.y;
  if (Math.abs(dragDx) > 4 || Math.abs(dragDy) > 4) {
    state.dragMoved = true;
  }
  const pointerPosition = getPointerStagePosition(event);
  const nextX = pointerPosition.x - state.dragOffset.x;
  const nextY = pointerPosition.y - state.dragOffset.y;
  const tile = state.draggingTile;
  tile.style.setProperty("--tile-x", `${nextX}px`);
  tile.style.setProperty("--tile-y", `${nextY}px`);
};

const handleTilePointerUp = (event) => {
  if (!state.draggingTile) {
    return;
  }
  const pointerPosition = getPointerStagePosition(event);
  const nextX = pointerPosition.x - state.dragOffset.x;
  const nextY = pointerPosition.y - state.dragOffset.y;
  const tile = state.draggingTile;
  const snappedX = Math.round(nextX / state.spacing);
  const snappedY = Math.round(nextY / state.spacing);
  snapTileToGrid(tile, snappedX, snappedY);
  tile.classList.remove("is-dragging");
  tile.releasePointerCapture(event.pointerId);
  state.draggingTile = null;
  if (state.dragMoved) {
    state.lastInteractionAt = Date.now();
  }
};

const handlePanPointerDown = (event) => {
  if (event.target.closest(".wallfacer-dev-tile") || isUiElement(event.target)) {
    return;
  }
  state.panning = true;
  state.panMoved = false;
  clearSelectedTile();
  state.panStart = { x: event.clientX, y: event.clientY };
  state.offsetStart = { x: state.offsetX, y: state.offsetY };
  app.classList.add("is-panning");
  app.setPointerCapture(event.pointerId);
};

const handlePanPointerMove = (event) => {
  if (!state.panning) {
    return;
  }
  const dx = event.clientX - state.panStart.x;
  const dy = event.clientY - state.panStart.y;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
    state.panMoved = true;
  }
  state.offsetX = state.offsetStart.x + dx;
  state.offsetY = state.offsetStart.y + dy;
  updateStageTransform();
};

const handlePanPointerUp = (event) => {
  if (!state.panning) {
    return;
  }
  state.panning = false;
  app.classList.remove("is-panning");
  app.releasePointerCapture(event.pointerId);
  if (state.panMoved) {
    state.lastInteractionAt = Date.now();
  }
};

const loadImagesFromDirectoryListing = async () => {
  const response = await fetch(wallfacerBaseUrl);
  if (!response.ok) {
    throw new Error("directory listing unavailable");
  }

  const text = await response.text();
  const regex = new RegExp(
    `href=["']([^"']+\\.(${imageExtensions.join("|")}))["']`,
    "gi"
  );

  const files = new Set();
  let match = regex.exec(text);
  while (match) {
    const href = match[1];
    const file = decodeURIComponent(href.split("/").pop() || href);
    files.add(file);
    match = regex.exec(text);
  }

  return Array.from(files);
};

const loadEntriesFromManifest = async () => {
  const response = await fetch(wallfacerManifestUrl);
  if (!response.ok) {
    throw new Error("manifest not found");
  }
  const data = await response.json();
  return Array.isArray(data.images) ? data.images : [];
};

const getGridPosition = (clientX, clientY) => {
  const { originX, originY } = getStageOrigin();
  const gridX = Math.round((clientX - originX) / state.spacing);
  const gridY = Math.round((clientY - originY) / state.spacing);
  return { gridX, gridY };
};

const isOccupied = (x, y) =>
  state.tiles.some(({ tile }) => {
    const tileX = Number.parseInt(tile.dataset.x, 10);
    const tileY = Number.parseInt(tile.dataset.y, 10);
    return tileX === x && tileY === y;
  });

const handleEmptyCellInput = (event) => {
  // Check if click originated from a button or has recent drag/pan activity
  if (
    isUiElement(event.target)
  ) {
    return;
  }
  const { gridX, gridY } = getGridPosition(event.clientX, event.clientY);
  if (isOccupied(gridX, gridY)) {
    return;
  }
  const text = window.prompt(`Enter text for (${gridX}, ${gridY})`);
  const trimmedText = text ? text.trim() : "";
  if (!trimmedText) {
    return;
  }
  const entry = {
    kind: "text",
    x: gridX,
    y: gridY,
    text: trimmedText,
    title: `${gridX},${gridY}`,
  };
  renderTiles([...getCurrentEntries(), entry]);
};

const init = async () => {
  try {
    let entries = [];
    try {
      entries = await loadEntriesFromManifest();
    } catch (manifestError) {
      console.warn("Manifest not found, trying directory listing:", manifestError);
      entries = [];
    }

    if (!entries.length) {
      try {
        entries = await loadImagesFromDirectoryListing();
      } catch (listingError) {
        console.warn("Directory listing unavailable:", listingError);
        entries = [];
      }
    }

    if (!entries.length) {
      message.textContent =
        "No images yet. Add files to /wallfacer named with grid positions (e.g. 1,-1.jpg) or update wallfacer/manifest.json.";
      return;
    }

    message.classList.add("wallfacer-hidden");
    const parsedEntries = entries
      .map(parseManifestEntry)
      .filter((entry) => entry);
    renderTiles(parsedEntries);
  } catch (error) {
    console.error("Init error:", error);
    message.textContent =
      "Unable to load Wallfacer images. Ensure /wallfacer has images or update wallfacer/manifest.json.";
  }
};

const handleSpacingChange = () => {
  state.spacing = clamp(Number.parseInt(spacingInput.value, 10), 120, 420);
  if (spacingValue) {
    spacingValue.textContent = `${state.spacing}px`;
  }
  state.tiles.forEach(({ tile }) => updateTilePosition(tile));
  updateOutput();
};

const handleDeleteSelected = () => {
  removeTile(state.selectedTile);
};

const handleCopy = async () => {
  if (!output.value) {
    return;
  }
  try {
    await navigator.clipboard.writeText(output.value);
    copyButton.textContent = "Copied";
    setTimeout(() => {
      copyButton.textContent = "Copy";
    }, 1200);
  } catch (error) {
    output.select();
    document.execCommand("copy");
  }
};

const handleDownload = () => {
  if (!output.value) {
    return;
  }
  const blob = new Blob([output.value], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "wallfacer-manifest.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const wireTileEvents = () => {
  app.addEventListener("pointerdown", handlePanPointerDown);
  app.addEventListener("pointermove", handlePanPointerMove);
  app.addEventListener("pointerup", handlePanPointerUp);
  app.addEventListener("pointercancel", handlePanPointerUp);
  app.addEventListener("click", (event) => {
    if (state.panning || state.draggingTile) {
      return;
    }
    if (Date.now() - state.lastInteractionAt < CLICK_SUPPRESS_MS) {
      return;
    }
    if (event.target.closest(".wallfacer-dev-tile") || isUiElement(event.target)) {
      return;
    }
    clearSelectedTile();
    handleEmptyCellInput(event);
  });

  document.addEventListener("keydown", (event) => {
    if (!state.selectedTile) {
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeTile(state.selectedTile);
    }
  });
};

const wireTileDragHandlers = () => {
  // Event handlers are now attached directly in renderTiles()
  // This function is kept for backward compatibility but does nothing
};

const initDom = () => {
  app = document.getElementById("wallfacer-dev-app");
  stage = document.getElementById("wallfacer-dev-stage");
  message = document.getElementById("wallfacer-dev-message");
  output = document.getElementById("wallfacer-dev-output");
  spacingInput = document.getElementById("wallfacer-dev-spacing");
  spacingValue = document.getElementById("wallfacer-dev-spacing-value");
  deleteButton = document.getElementById("wallfacer-dev-delete");
  copyButton = document.getElementById("wallfacer-dev-copy");
  downloadButton = document.getElementById("wallfacer-dev-download");

  if (!app || !stage || !message) {
    console.warn("Wallfacer dev: required elements missing.");
    return false;
  }

  if (spacingInput) {
    const parsedSpacing = Number.parseInt(spacingInput.value, 10);
    if (!Number.isNaN(parsedSpacing)) {
      state.spacing = parsedSpacing;
    }
    if (spacingValue) {
      spacingValue.textContent = `${state.spacing}px`;
    }
  }

  spacingInput?.addEventListener("input", handleSpacingChange);
  deleteButton?.addEventListener("click", handleDeleteSelected);
  copyButton?.addEventListener("click", handleCopy);
  downloadButton?.addEventListener("click", handleDownload);

  app.addEventListener("pointerleave", () => {
    if (state.draggingTile) {
      state.draggingTile.classList.remove("is-dragging");
      state.draggingTile = null;
    }
    if (state.panning) {
      state.panning = false;
      app.classList.remove("is-panning");
    }
  });

  return true;
};

const boot = () => {
  if (!initDom()) {
    return;
  }
  init().then(() => {
    wireTileEvents();
    wireTileDragHandlers();
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
