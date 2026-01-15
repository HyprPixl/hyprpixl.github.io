const app = document.getElementById("wallfacer-dev-app");
const stage = document.getElementById("wallfacer-dev-stage");
const message = document.getElementById("wallfacer-dev-message");
const output = document.getElementById("wallfacer-dev-output");
const spacingInput = document.getElementById("wallfacer-dev-spacing");
const spacingValue = document.getElementById("wallfacer-dev-spacing-value");
const centerButton = document.getElementById("wallfacer-dev-center");
const snapButton = document.getElementById("wallfacer-dev-snap");
const copyButton = document.getElementById("wallfacer-dev-copy");
const downloadButton = document.getElementById("wallfacer-dev-download");

const state = {
  spacing: Number.parseInt(spacingInput.value, 10),
  offsetX: 0,
  offsetY: 0,
  tiles: [],
  panning: false,
  draggingTile: null,
  dragStart: { x: 0, y: 0 },
  tileStart: { x: 0, y: 0 },
  panStart: { x: 0, y: 0 },
  offsetStart: { x: 0, y: 0 },
  panMoved: false,
};

const imageExtensions = ["png", "jpg", "jpeg", "gif", "webp", "avif"];

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

const parseManifestEntry = (entry) => {
  if (typeof entry === "string") {
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
  const entries = state.tiles.map(({ tile, entry }) => {
    const x = Number.parseInt(tile.dataset.x, 10);
    const y = Number.parseInt(tile.dataset.y, 10);
    if (entry.kind === "text") {
      return `${x},${y} "${entry.text}"`;
    }
    return buildNewName(entry, x, y);
  });
  output.value = JSON.stringify({ images: entries }, null, 2);
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

      if (entry.kind === "text") {
        const textBlock = document.createElement("div");
        textBlock.className = "wallfacer-dev-text-block";
        textBlock.textContent = entry.text;
        tile.appendChild(textBlock);
      } else {
        const img = document.createElement("img");
        img.src = `../wallfacer/${entry.file}`;
        img.alt = entry.label || entry.title;
        img.title = entry.title;
        img.loading = "lazy";

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
      return { tile, entry };
    })
    .filter(Boolean);

  updateOutput();
};

const snapTileToGrid = (tile, x, y) => {
  tile.dataset.x = String(x);
  tile.dataset.y = String(y);
  updateTilePosition(tile);
  updateOutput();
};

const handleTilePointerDown = (event) => {
  const tile = event.currentTarget;
  state.draggingTile = tile;
  state.dragStart = { x: event.clientX, y: event.clientY };
  state.tileStart = {
    x: Number.parseInt(tile.dataset.x, 10) * state.spacing,
    y: Number.parseInt(tile.dataset.y, 10) * state.spacing,
  };
  tile.classList.add("is-dragging");
  tile.setPointerCapture(event.pointerId);
};

const handleTilePointerMove = (event) => {
  if (!state.draggingTile) {
    return;
  }
  const dx = event.clientX - state.dragStart.x;
  const dy = event.clientY - state.dragStart.y;
  const tile = state.draggingTile;
  tile.style.setProperty("--tile-x", `${state.tileStart.x + dx}px`);
  tile.style.setProperty("--tile-y", `${state.tileStart.y + dy}px`);
};

const handleTilePointerUp = (event) => {
  if (!state.draggingTile) {
    return;
  }
  const dx = event.clientX - state.dragStart.x;
  const dy = event.clientY - state.dragStart.y;
  const tile = state.draggingTile;
  const snappedX = Math.round((state.tileStart.x + dx) / state.spacing);
  const snappedY = Math.round((state.tileStart.y + dy) / state.spacing);
  snapTileToGrid(tile, snappedX, snappedY);
  tile.classList.remove("is-dragging");
  tile.releasePointerCapture(event.pointerId);
  state.draggingTile = null;
};

const handlePanPointerDown = (event) => {
  if (event.target.closest(".wallfacer-dev-tile")) {
    return;
  }
  state.panning = true;
  state.panMoved = false;
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
  if (!state.panMoved) {
    handleEmptyCellInput(event);
  }
};

const loadImagesFromDirectoryListing = async () => {
  const response = await fetch("../wallfacer/");
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
  const response = await fetch("../wallfacer/manifest.json");
  if (!response.ok) {
    throw new Error("manifest not found");
  }
  const data = await response.json();
  return Array.isArray(data.images) ? data.images : [];
};

const getGridPosition = (clientX, clientY) => {
  const rect = app.getBoundingClientRect();
  const originX = rect.left + rect.width / 2 + state.offsetX;
  const originY = rect.top + rect.height / 2 + state.offsetY;
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
  renderTiles([...state.tiles.map(({ entry }) => entry), entry]);
  wireTileDragHandlers();
};

const init = async () => {
  try {
    let entries = [];
    try {
      entries = await loadEntriesFromManifest();
    } catch (manifestError) {
      entries = [];
    }

    if (!entries.length) {
      try {
        entries = await loadImagesFromDirectoryListing();
      } catch (listingError) {
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
    message.textContent =
      "Unable to load Wallfacer images. Ensure /wallfacer has images or update wallfacer/manifest.json.";
  }
};

const handleSpacingChange = () => {
  state.spacing = clamp(Number.parseInt(spacingInput.value, 10), 120, 420);
  spacingValue.textContent = `${state.spacing}px`;
  state.tiles.forEach(({ tile }) => updateTilePosition(tile));
  updateOutput();
};

const handleCenter = () => {
  state.offsetX = 0;
  state.offsetY = 0;
  updateStageTransform();
};

const handleSnapAll = () => {
  state.tiles.forEach(({ tile }) => {
    const x = Number.parseInt(tile.dataset.x, 10);
    const y = Number.parseInt(tile.dataset.y, 10);
    snapTileToGrid(tile, x, y);
  });
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
};

const wireTileDragHandlers = () => {
  stage.querySelectorAll(".wallfacer-dev-tile").forEach((tile) => {
    tile.addEventListener("pointerdown", handleTilePointerDown);
    tile.addEventListener("pointermove", handleTilePointerMove);
    tile.addEventListener("pointerup", handleTilePointerUp);
    tile.addEventListener("pointercancel", handleTilePointerUp);
  });
};

spacingInput.addEventListener("input", handleSpacingChange);
centerButton.addEventListener("click", handleCenter);
snapButton.addEventListener("click", handleSnapAll);
copyButton.addEventListener("click", handleCopy);
downloadButton.addEventListener("click", handleDownload);

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

init().then(() => {
  wireTileEvents();
  wireTileDragHandlers();
});
