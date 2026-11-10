/* Shared Wallfacer helpers (viewer + editor).
 *
 * manifest.json shape:
 *   {
 *     "images": [
 *       "0,5.GIF",                          // image; position comes from the filename
 *       "1,3 \"some text\"",                // text tile
 *       "5,3 \"label\" https://example.com" // link tile
 *     ],
 *     "cuts": ["0,0|1,0"]                   // adjacent pairs that are NOT connected
 *   }
 */
(function () {
  const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "avif"];
  const POS = String.raw`(-?\d+)\s*[x,]\s*(-?\d+)`;
  const LINK_RE = new RegExp(String.raw`^${POS}\s+"(.+?)"\s+(https?:\/\/\S+)\s*$`);
  const TEXT_RE = new RegExp(String.raw`^${POS}\s+"(.+)"\s*$`);
  const FILE_RE = new RegExp(String.raw`^${POS}`);

  const int = (v) => Number.parseInt(v, 10) || 0;
  const key = (x, y) => `${x},${y}`;
  const extOf = (name) => (name.match(/\.[^.\/]+$/) || [""])[0];
  const stemOf = (name) => (name.split("/").pop() || name).replace(/\.[^.]+$/, "");
  const isImageName = (name) => IMAGE_EXTS.includes(extOf(name).slice(1).toLowerCase());
  const isAnimatedName = (name) => extOf(name).toLowerCase() === ".gif";

  const parseEntry = (entry) => {
    if (typeof entry === "string") {
      let m = entry.match(LINK_RE);
      if (m) return { kind: "link", x: int(m[1]), y: int(m[2]), text: m[3], href: m[4] };
      m = entry.match(TEXT_RE);
      if (m) return { kind: "text", x: int(m[1]), y: int(m[2]), text: m[3] };
      m = stemOf(entry).match(FILE_RE);
      return { kind: "image", file: entry, x: m ? int(m[1]) : 0, y: m ? int(m[2]) : 0 };
    }
    if (entry && typeof entry === "object") {
      const x = int(entry.x);
      const y = int(entry.y);
      if (entry.href) return { kind: "link", x, y, text: entry.text || entry.label || "", href: entry.href };
      if (entry.text) return { kind: "text", x, y, text: entry.text };
      if (entry.file) return parseEntry(entry.file);
    }
    return null;
  };

  const serializeEntry = (tile) => {
    const text = String(tile.text || "").replace(/\s+/g, " ").trim();
    if (tile.kind === "link") return `${tile.x},${tile.y} "${text || tile.href}" ${tile.href}`;
    if (tile.kind === "text") return `${tile.x},${tile.y} "${text}"`;
    return tile.file;
  };

  // Canonical, order-independent key for the edge between two adjacent cells.
  const edgeKey = (ax, ay, bx, by) =>
    ax < bx || (ax === bx && ay < by) ? `${ax},${ay}|${bx},${by}` : `${bx},${by}|${ax},${ay}`;

  const parseManifest = (data) => {
    const raw = Array.isArray(data && data.images) ? data.images : [];
    const tiles = raw.map(parseEntry).filter(Boolean);
    const cuts = new Set();
    (Array.isArray(data && data.cuts) ? data.cuts : []).forEach((c) => {
      const m = String(c).match(/^\s*(-?\d+),(-?\d+)\s*\|\s*(-?\d+),(-?\d+)\s*$/);
      if (m) cuts.add(edgeKey(int(m[1]), int(m[2]), int(m[3]), int(m[4])));
    });
    return { tiles, cuts };
  };

  const buildManifest = (tiles, cuts) => {
    const images = tiles.filter((t) => t.kind === "image").map(serializeEntry);
    const others = tiles.filter((t) => t.kind !== "image").map(serializeEntry);
    const out = { images: images.concat(others) };
    const cutList = Array.from(cuts || []).sort();
    if (cutList.length) out.cuts = cutList;
    return out;
  };

  const optName = (file) => `opt/${stemOf(file)}.webp`;

  window.WallfacerCore = {
    IMAGE_EXTS, key, extOf, stemOf, isImageName, isAnimatedName,
    parseEntry, serializeEntry, edgeKey, parseManifest, buildManifest, optName,
    PREVIEW_KEY: "wallfacer:preview",
  };
})();
