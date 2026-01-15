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

const parseImageData = (filename) => {
  const baseName = filename.split("/").pop() || filename;
  const nameWithoutExt = baseName.replace(/\.[^.]+$/, "");
  const match = nameWithoutExt.match(/^(-?\d+)\s*[x,]\s*(-?\d+)(?:[ _-]+)?(.*)?$/);

  if (match) {
    const [, x, y, label] = match;
    const caption = label ? label.trim() : "";
    return {
      file: filename,
      x: Number.parseInt(x, 10),
      y: Number.parseInt(y, 10),
      caption,
      title: nameWithoutExt,
    };
  }

  return {
    file: filename,
    x: 0,
    y: 0,
    caption: nameWithoutExt,
    title: nameWithoutExt,
  };
};

const renderTiles = (images) => {
  stage.innerHTML = "";
  state.tiles = images.map((image) => {
    const tile = document.createElement("div");
    tile.className = "wallfacer-tile";
    tile.dataset.x = String(image.x);
    tile.dataset.y = String(image.y);

    if (image.caption) {
      const caption = document.createElement("div");
      caption.className = "wallfacer-caption";
      caption.textContent = image.caption;
      tile.appendChild(caption);
    }

    const img = document.createElement("img");
    img.src = `../wallfacer/${image.file}`;
    img.alt = image.caption || image.title;
    img.title = image.title;
    img.loading = "lazy";
    tile.appendChild(img);

    stage.appendChild(tile);
    return tile;
  });
};

const updateTiles = () => {
  let closestTile = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  state.tiles.forEach((tile) => {
    const gridX = Number.parseInt(tile.dataset.x, 10);
    const gridY = Number.parseInt(tile.dataset.y, 10);
    const worldX = gridX * state.spacing + state.offsetX;
    const worldY = gridY * state.spacing + state.offsetY;

    const depth = -((worldX ** 2 + worldY ** 2) * 0.000006);
    const scale = clamp(1 + depth * 0.002, 0.7, 1.1);
    const rotateX = clamp(-worldY * 0.0004, -9, 9);
    const rotateY = clamp(worldX * 0.0004, -9, 9);
    const opacity = clamp(1 + depth * 0.015, 0.35, 1);

    tile.style.setProperty(
      "--tile-transform",
      `translate3d(${worldX}px, ${worldY}px, ${depth}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${scale})`
    );
    tile.style.opacity = `${opacity}`;

    const distance = Math.hypot(worldX, worldY);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestTile = tile;
    }
  });

  state.tiles.forEach((tile) => {
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

const init = async () => {
  try {
    const response = await fetch("../wallfacer/manifest.json");
    if (!response.ok) {
      throw new Error("manifest not found");
    }
    const data = await response.json();
    const images = Array.isArray(data.images) ? data.images : [];

    if (!images.length) {
      message.textContent =
        "No images yet. Add files to /wallfacer and list them in wallfacer/manifest.json.";
      return;
    }

    message.classList.add("wallfacer-hidden");
    const parsedImages = images.map(parseImageData);
    renderTiles(parsedImages);
    animate();
  } catch (error) {
    message.textContent =
      "Unable to load the Wallfacer manifest. Make sure wallfacer/manifest.json exists.";
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
