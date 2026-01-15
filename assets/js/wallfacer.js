const app = document.getElementById("wallfacer-app");
const stage = document.getElementById("wallfacer-stage");
const message = document.getElementById("wallfacer-message");

const state = {
  spacing: 260,
  offsetX: 0,
  offsetY: 0,
  targetOffsetX: 0,
  targetOffsetY: 0,
  tiles: [],
  dragging: false,
  dragStart: { x: 0, y: 0 },
  dragOffset: { x: 0, y: 0 },
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const imageExtensions = ["png", "jpg", "jpeg", "gif", "webp", "avif"];

const hasImageExtension = (filename) =>
  imageExtensions.some((extension) =>
    filename.toLowerCase().endsWith(`.${extension}`)
  );

const parseImageData = (filename) => {
  const baseName = filename.split("/").pop() || filename;
  const nameWithoutExt = baseName.replace(/\.[^.]+$/, "");
  const match = nameWithoutExt.match(/^(-?\d+)\s*[x,]\s*(-?\d+)(?:[ _-]+)?(.*)?$/);

  if (match) {
    const [, x, y, label] = match;
    const caption = label ? label.trim() : "";
    return {
      kind: "image",
      file: filename,
      x: Number.parseInt(x, 10),
      y: Number.parseInt(y, 10),
      caption,
      title: nameWithoutExt,
    };
  }

  return {
    kind: "image",
    file: filename,
    x: 0,
    y: 0,
    caption: nameWithoutExt,
    title: nameWithoutExt,
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

const renderTiles = (entries) => {
  stage.innerHTML = "";
  state.tiles = entries
    .map((entry) => {
      if (!entry) {
        return null;
      }
      const tile = document.createElement("div");
      tile.className = "wallfacer-tile";
      tile.dataset.x = String(entry.x);
      tile.dataset.y = String(entry.y);

      if (entry.kind === "text") {
        const textBlock = document.createElement("div");
        textBlock.className = "wallfacer-text-block";
        textBlock.textContent = entry.text;
        tile.appendChild(textBlock);
      } else {
        if (entry.caption) {
          const caption = document.createElement("div");
          caption.className = "wallfacer-caption";
          caption.textContent = entry.caption;
          tile.appendChild(caption);
        }

        const img = document.createElement("img");
        img.src = `../wallfacer/${entry.file}`;
        img.alt = entry.caption || entry.title;
        img.title = entry.title;
        img.loading = "lazy";
        img.addEventListener("load", () => {
          tile.classList.toggle("is-wide", img.naturalWidth >= img.naturalHeight);
          tile.classList.toggle(
            "is-tall",
            img.naturalWidth < img.naturalHeight
          );
        });
        tile.appendChild(img);
      }

      stage.appendChild(tile);
      return tile;
    })
    .filter(Boolean);
};

const updateTiles = () => {
  let closestTile = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  const tileData = state.tiles.map((tile) => {
    const gridX = Number.parseInt(tile.dataset.x, 10);
    const gridY = Number.parseInt(tile.dataset.y, 10);
    const worldX = gridX * state.spacing + state.offsetX;
    const worldY = gridY * state.spacing + state.offsetY;
    const distance = Math.hypot(worldX, worldY);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestTile = tile;
    }
    return { tile, worldX, worldY, distance };
  });

  tileData.forEach(({ tile, worldX, worldY, distance }) => {
    const depth = -distance * 0.18;
    const baseScale = clamp(1.12 - distance * 0.0014, 0.5, 1.08);
    const centerBoost = tile === closestTile ? 1.22 : 1;
    const scale = clamp(baseScale * centerBoost, 0.5, 1.32);
    const rotateX = clamp(-worldY * 0.0004, -10, 10);
    const rotateY = clamp(worldX * 0.0004, -10, 10);
    const opacity = clamp(1 - distance * 0.0014, 0.25, 1);

    tile.style.setProperty(
      "--tile-transform",
      `translate3d(${worldX}px, ${worldY}px, ${depth}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${scale})`
    );
    tile.style.opacity = `${opacity}`;
    tile.classList.toggle("is-center", tile === closestTile);
  });
};

const animate = () => {
  state.offsetX += (state.targetOffsetX - state.offsetX) * 0.12;
  state.offsetY += (state.targetOffsetY - state.offsetY) * 0.12;
  updateTiles();
  requestAnimationFrame(animate);
};

const handleKeydown = (event) => {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    return;
  }
  event.preventDefault();

  const step = state.spacing;
  switch (event.key) {
    case "ArrowLeft":
      state.targetOffsetX += step;
      break;
    case "ArrowRight":
      state.targetOffsetX -= step;
      break;
    case "ArrowUp":
      state.targetOffsetY += step;
      break;
    case "ArrowDown":
      state.targetOffsetY -= step;
      break;
    default:
      break;
  }
};

const handlePointerDown = (event) => {
  state.dragging = true;
  app.classList.add("is-dragging");
  state.dragStart = { x: event.clientX, y: event.clientY };
  state.dragOffset = { x: state.targetOffsetX, y: state.targetOffsetY };
  app.setPointerCapture(event.pointerId);
};

const handlePointerMove = (event) => {
  if (!state.dragging) {
    return;
  }
  const dx = event.clientX - state.dragStart.x;
  const dy = event.clientY - state.dragStart.y;
  state.targetOffsetX = state.dragOffset.x + dx;
  state.targetOffsetY = state.dragOffset.y + dy;
};

const handlePointerUp = (event) => {
  state.dragging = false;
  app.classList.remove("is-dragging");
  app.releasePointerCapture(event.pointerId);
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
    animate();
  } catch (error) {
    message.textContent =
      "Unable to load Wallfacer images. Ensure /wallfacer has images or update wallfacer/manifest.json.";
  }
};

window.addEventListener("keydown", handleKeydown);
app.addEventListener("pointerdown", handlePointerDown);
app.addEventListener("pointermove", handlePointerMove);
app.addEventListener("pointerup", handlePointerUp);
app.addEventListener("pointercancel", handlePointerUp);
app.addEventListener("pointerleave", () => {
  state.dragging = false;
  app.classList.remove("is-dragging");
});

init();
