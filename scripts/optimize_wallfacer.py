"""Generate web-optimized copies of Wallfacer images.

Every image listed in wallfacer/manifest.json gets a WebP sibling in
wallfacer/opt/ (same base name, e.g. "0,5.GIF" -> "opt/0,5.webp").
The viewer loads the opt copy first and falls back to the original.

- Stills are EXIF-rotated and capped at MAX_EDGE px on the long side.
- Animated GIFs become animated WebP capped at ANIM_MAX_EDGE (same timing).
- Up-to-date outputs are skipped; opt files with no matching original
  are removed so the folder never drifts from the manifest.

Usage:  python scripts/optimize_wallfacer.py [--force]
Needs:  Pillow (pip install pillow)
"""

import json
import sys
from pathlib import Path

from PIL import Image, ImageOps, ImageSequence

ROOT = Path(__file__).resolve().parent.parent
WALL = ROOT / "wallfacer"
OPT = WALL / "opt"
MAX_EDGE = 800
ANIM_MAX_EDGE = 480  # animations are heavy; tiles show them at ~280 CSS px
STILL_QUALITY = 80
ANIM_QUALITY = 60
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"}


def manifest_images():
    data = json.loads((WALL / "manifest.json").read_text(encoding="utf-8"))
    names = []
    for entry in data.get("images", []):
        name = entry.get("file") if isinstance(entry, dict) else entry
        if isinstance(name, str) and Path(name).suffix.lower() in IMAGE_EXTS:
            names.append(name)
    return names


def fit(size, edge=None):
    w, h = size
    scale = min(1.0, (edge or MAX_EDGE) / max(w, h))
    return max(1, round(w * scale)), max(1, round(h * scale))


def convert_still(src, dst):
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)
        im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
        if im.mode == "RGBA" and im.getextrema()[3][0] == 255:
            im = im.convert("RGB")
        im = im.resize(fit(im.size), Image.LANCZOS) if fit(im.size) != im.size else im
        im.save(dst, "WEBP", quality=STILL_QUALITY, method=6)


def convert_animated(src, dst):
    with Image.open(src) as im:
        target = fit(im.size, ANIM_MAX_EDGE)
        frames, durations = [], []
        for frame in ImageSequence.Iterator(im):
            durations.append(frame.info.get("duration", im.info.get("duration", 100)) or 100)
            f = frame.convert("RGBA")
            if f.size != target:
                f = f.resize(target, Image.LANCZOS)
            frames.append(f)
        frames[0].save(
            dst, "WEBP", save_all=True, append_images=frames[1:], duration=durations,
            loop=im.info.get("loop", 0), quality=ANIM_QUALITY, method=4,
        )


def main():
    force = "--force" in sys.argv
    OPT.mkdir(exist_ok=True)
    wanted = set()
    before = after = 0
    for name in manifest_images():
        src = WALL / name
        if not src.exists():
            print(f"  missing original: {name}")
            continue
        dst = OPT / (Path(name).stem + ".webp")
        wanted.add(dst.name)
        if not force and dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
            before += src.stat().st_size
            after += dst.stat().st_size
            continue
        with Image.open(src) as probe:
            animated = getattr(probe, "n_frames", 1) > 1 and probe.format == "GIF"
        (convert_animated if animated else convert_still)(src, dst)
        b, a = src.stat().st_size, dst.stat().st_size
        before += b
        after += a
        print(f"  {name:<14} {b / 1024:8.0f} KB -> {a / 1024:7.0f} KB")
    for stale in OPT.glob("*.webp"):
        if stale.name not in wanted:
            stale.unlink()
            print(f"  removed stale {stale.name}")
    print(f"total {before / 1048576:.1f} MB -> {after / 1048576:.1f} MB")


if __name__ == "__main__":
    main()
