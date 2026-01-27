const app = document.getElementById("wallfacer-app");
const stage = document.getElementById("wallfacer-stage");
const message = document.getElementById("wallfacer-message");

const state = {
  spacing: 240,
  offsetX: 0,
  offsetY: 0,
  targetOffsetX: 0,
  targetOffsetY: 0,
  tiles: [],
  connections: [],
  connectionLayer: null,
  dragging: false,
  dragStart: { x: 0, y: 0 },
  dragOffset: { x: 0, y: 0 },
  dragGridStart: { x: 0, y: 0 },
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

      if (entry.kind === "text" || entry.kind === "link") {
        const textBlock = document.createElement("div");
        textBlock.className = "wallfacer-text-block";
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
        if (entry.caption) {
          const caption = document.createElement("div");
          caption.className = "wallfacer-caption";
          caption.textContent = entry.caption;
          tile.appendChild(caption);
        }

        const imageFrame = document.createElement("div");
        imageFrame.className = "wallfacer-image";
        imageFrame.style.setProperty(
          "--static-delay",
          `${(Math.random() * -1.6).toFixed(2)}s`
        );
        imageFrame.style.setProperty(
          "--static-speed",
          `${(0.18 + Math.random() * 0.22).toFixed(2)}s`
        );
        imageFrame.style.setProperty(
          "--static-size",
          `${Math.round(84 + Math.random() * 56)}px`
        );

        const img = document.createElement("img");
        img.dataset.src = `/wallfacer/${entry.file}`;
        img.alt = entry.caption || entry.title;
        img.title = entry.title;
        img.loading = "lazy";
        img.decoding = "async";
        img.addEventListener("load", () => {
          tile.classList.toggle("is-wide", img.naturalWidth >= img.naturalHeight);
          tile.classList.toggle(
            "is-tall",
            img.naturalWidth < img.naturalHeight
          );
        });
        imageFrame.appendChild(img);
        tile.appendChild(imageFrame);
      }

      stage.appendChild(tile);
      return tile;
    })
    .filter(Boolean);
  buildConnections();
};

const hasTileAt = (gridX, gridY) =>
  state.tiles.some((tile) => {
    const x = Number.parseInt(tile.dataset.x, 10);
    const y = Number.parseInt(tile.dataset.y, 10);
    return x === gridX && y === gridY;
  });

const buildConnections = () => {
  state.connections = [];
  state.connectionLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  state.connectionLayer.setAttribute("class", "wallfacer-connections");
  state.connectionLayer.setAttribute("aria-hidden", "true");
  stage.appendChild(state.connectionLayer);

  const tileMap = new Map();
  state.tiles.forEach((tile) => {
    const x = Number.parseInt(tile.dataset.x, 10);
    const y = Number.parseInt(tile.dataset.y, 10);
    tileMap.set(`${x},${y}`, { x, y });
  });

  const directions = [
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
  ];

  tileMap.forEach(({ x, y }) => {
    directions.forEach(({ dx, dy }) => {
      const neighborKey = `${x + dx},${y + dy}`;
      if (!tileMap.has(neighborKey)) {
        return;
      }
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("class", "wallfacer-connection");
      state.connectionLayer.appendChild(line);
      state.connections.push({
        line,
        from: { x, y },
        to: { x: x + dx, y: y + dy },
      });
    });
  });
};

const getNeighborOffsets = (gridX, gridY) => {
  const candidates = [
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
  ];

  return candidates
    .filter(({ dx, dy }) => hasTileAt(gridX + dx, gridY + dy))
    .map(({ dx, dy }) => ({
      dx,
      dy,
      offsetX: -dx * state.spacing,
      offsetY: -dy * state.spacing,
    }));
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
    const viewDistance = distance / state.spacing;
    if (distance < closestDistance) {
      closestDistance = distance;
      closestTile = tile;
    }
    return { tile, worldX, worldY, distance, viewDistance };
  });

  tileData.forEach(({ tile, worldX, worldY, distance, viewDistance }) => {
    const depth = -distance * 0.18;
    const baseScale = clamp(1.06 - distance * 0.0016, 0.45, 1.02);
    const centerBoost = tile === closestTile ? 1.32 : 1;
    const scale = clamp(baseScale * centerBoost, 0.45, 1.38);
    const rotateX = clamp(-worldY * 0.0004, -10, 10);
    const rotateY = clamp(worldX * 0.0004, -10, 10);
    const baseOpacity = clamp(1 - distance * 0.0016, 0.22, 1);
    const opacity = tile === closestTile ? baseOpacity : baseOpacity * 0.72;
    const staticStrength = clamp(distance * 0.0032, 0.2, 0.9);
    const dimOpacity = clamp(0.9 - distance * 0.0018, 0.2, 0.85);

    tile.style.setProperty(
      "--tile-transform",
      `translate3d(${worldX}px, ${worldY}px, ${depth}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${scale})`
    );
    tile.style.opacity = `${opacity}`;
    tile.style.setProperty("--static-opacity", `${staticStrength}`);
    tile.style.setProperty("--dim-opacity", `${dimOpacity}`);
    const isCenter = tile === closestTile;
    const isFar = viewDistance > 1.1;
    tile.classList.toggle("is-center", isCenter);
    tile.classList.toggle("is-dim", !isCenter);
    tile.classList.toggle("is-far", isFar);

    const img = tile.querySelector("img");
    if (img) {
      const inRange = viewDistance <= 3;
      const hasSrc = Boolean(img.getAttribute("src"));
      if (inRange && !hasSrc && img.dataset.src) {
        img.src = img.dataset.src;
      } else if (!inRange && hasSrc) {
        img.removeAttribute("src");
      }
    }
  });

  if (state.connectionLayer && state.connections.length) {
    state.connections.forEach(({ line, from, to }) => {
      const x1 = from.x * state.spacing + state.offsetX;
      const y1 = from.y * state.spacing + state.offsetY;
      const x2 = to.x * state.spacing + state.offsetX;
      const y2 = to.y * state.spacing + state.offsetY;
      line.setAttribute("x1", x1);
      line.setAttribute("y1", y1);
      line.setAttribute("x2", x2);
      line.setAttribute("y2", y2);
    });
  }
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
  const currentGridX = Math.round(-state.targetOffsetX / step);
  const currentGridY = Math.round(-state.targetOffsetY / step);
  let nextGridX = currentGridX;
  let nextGridY = currentGridY;

  switch (event.key) {
    case "ArrowLeft":
      nextGridX -= 1;
      break;
    case "ArrowRight":
      nextGridX += 1;
      break;
    case "ArrowUp":
      nextGridY -= 1;
      break;
    case "ArrowDown":
      nextGridY += 1;
      break;
    default:
      break;
  }

  if (!hasTileAt(nextGridX, nextGridY)) {
    return;
  }

  state.targetOffsetX = -nextGridX * step;
  state.targetOffsetY = -nextGridY * step;
};

const handlePointerDown = (event) => {
  state.dragging = true;
  app.classList.add("is-dragging");
  state.dragStart = { x: event.clientX, y: event.clientY };
  state.dragOffset = { x: state.targetOffsetX, y: state.targetOffsetY };
  state.dragGridStart = {
    x: Math.round(-state.targetOffsetX / state.spacing),
    y: Math.round(-state.targetOffsetY / state.spacing),
  };
  app.setPointerCapture(event.pointerId);
};

const handlePointerMove = (event) => {
  if (!state.dragging) {
    return;
  }
  const dragDx = event.clientX - state.dragStart.x;
  const dragDy = event.clientY - state.dragStart.y;
  const neighbors = getNeighborOffsets(
    state.dragGridStart.x,
    state.dragGridStart.y
  );

  if (!neighbors.length) {
    state.targetOffsetX = state.dragOffset.x;
    state.targetOffsetY = state.dragOffset.y;
    return;
  }

  let best = null;
  let bestDot = Number.NEGATIVE_INFINITY;
  neighbors.forEach((neighbor) => {
    const dot = dragDx * neighbor.offsetX + dragDy * neighbor.offsetY;
    if (dot > bestDot) {
      bestDot = dot;
      best = neighbor;
    }
  });

  if (!best || bestDot <= 0) {
    state.targetOffsetX = state.dragOffset.x;
    state.targetOffsetY = state.dragOffset.y;
    return;
  }

  const dirX = best.offsetX;
  const dirY = best.offsetY;
  const dirLenSq = dirX * dirX + dirY * dirY || 1;
  const tRaw = (dragDx * dirX + dragDy * dirY) / dirLenSq;
  const t = clamp(tRaw, 0, 1);
  const projX = dirX * t;
  const projY = dirY * t;
  let perpX = dragDx - projX;
  let perpY = dragDy - projY;
  const wiggleLimit = state.spacing * 0.12;
  const perpLen = Math.hypot(perpX, perpY);
  if (perpLen > wiggleLimit) {
    const scale = wiggleLimit / perpLen;
    perpX *= scale;
    perpY *= scale;
  }

  state.targetOffsetX = state.dragOffset.x + projX + perpX;
  state.targetOffsetY = state.dragOffset.y + projY + perpY;
};

const handlePointerUp = (event) => {
  state.dragging = false;
  app.classList.remove("is-dragging");
  app.releasePointerCapture(event.pointerId);
  const currentGridX = Math.round(-state.targetOffsetX / state.spacing);
  const currentGridY = Math.round(-state.targetOffsetY / state.spacing);
  if (!hasTileAt(currentGridX, currentGridY)) {
    let closest = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    state.tiles.forEach((tile) => {
      const x = Number.parseInt(tile.dataset.x, 10);
      const y = Number.parseInt(tile.dataset.y, 10);
      const distance = Math.hypot(x - currentGridX, y - currentGridY);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = { x, y };
      }
    });
    if (closest) {
      state.targetOffsetX = -closest.x * state.spacing;
      state.targetOffsetY = -closest.y * state.spacing;
    }
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
