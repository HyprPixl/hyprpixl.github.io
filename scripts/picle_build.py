"""Build today's Picle puzzles: trending Wikipedia pictures, pre-judged by Clef-Flash.

The site has no backend, so every AI call happens here, once a day:
  1. Wikipedia's most-read articles (with photos) are the candidate pictures.
  2. Clef-Flash (a typed decision model) keeps the ones that are family-friendly and clearly
     recognisable from their photo.
  3. A small chat model lists ~90 guesses players might type; Clef-Flash scores every guess against
     the real photo: closeness to naming the answer (1-10) and P(the guess names it).
     The judge (one dry, witty voice) writes a line for each wrong guess, plus a daily pool of
     cold / warm / hot lines with a {g} slot for guesses nobody predicted. The writer is never told
     the answer, so lines react to the guess and can't give the picture away.
  4. Everything is written to pages/picle/puzzles/<date>.json (+ latest.json). The page matches a
     player's guess to these scored guesses in the browser.

  python scripts/picle_build.py                         # Workers AI (needs CF_ACCOUNT_ID, CF_API_TOKEN)
  python scripts/picle_build.py --local                 # local Clef-Flash (~/laya-bench) + Ollama
  python scripts/picle_build.py --local --requip        # rewrite only the judge's lines for latest.json
Options: --date YYYY-MM-DD (puzzle date; uses the previous day's most-read list), --count 5
"""
import argparse
import base64
import datetime as dt
import io
import json
import os
import random
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "pages" / "picle" / "puzzles"
UA = "PicleBot/1.0 (https://hyprpixl.ca/pages/picle.html; hyprpixlstudios@gmail.com)"
CLEF = "@cf/cloudflare/clef-flash"
CHAT = "@cf/meta/llama-3.2-3b-instruct"          # guess lists
WRITER = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"  # the judge's lines: wit needs a bigger model

BLOCK = re.compile(r"murder|kill|terror|shoot|massacre|assassin|bomb|war\b|attack|crime|criminal|prison|"
                   r"execut|death|died|dead|suicide|abuse|rape|sex|porn|nazi|genocide|disaster|crash|"
                   r"election|politic|scandal|cartel|gang", re.I)
def levels(t):
    """Closeness to naming the answer: generic descriptions sit mid-scale, only the name is near the top."""
    return [f"0: unrelated to {t}", "1: almost nothing in common", "2: a vague connection (colour, setting)",
            "3: wrong but same broad kind of thing",
            f"4: right general category (e.g. 'a person') but nothing specific to {t}",
            f"5: right field, role or type that {t} belongs to", f"6: a closely related name, work or detail of {t}",
            f"7: almost names {t}: partial or misspelled", f"8: names {t} with small differences",
            f"9: exactly names {t}"]
GENERIC = ["dog", "cat", "a man", "a woman", "a person", "a car", "a tree", "a house", "a flower", "a bird",
           "food", "a building", "mountains", "the ocean", "a phone", "a robot", "a banana", "a horse",
           "a city", "a book", "a movie poster", "a painting", "a statue", "a map", "a flag", "a logo",
           "a football player", "a singer", "an actor", "a politician", "a baby", "a crowd", "a castle",
           "a church", "a bridge", "a boat", "a plane", "a guitar", "a monkey", "a fish"]
def get(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    return data if binary else json.loads(data)


# ----------------------------------------------------------------------------- model backends
# Neurons per million tokens, from developers.cloudflare.com/workers-ai/platform/pricing (Oct 2026).
# Unknown models are charged at the most expensive rate so the budget errs on the safe side.
RATES = {CLEF: (8182, 0), CHAT: (4625, 30475), WRITER: (26668, 204805)}
BUDGET = int(os.environ.get("PICLE_NEURON_BUDGET", "7000"))    # free plan: 10,000 / day


class BudgetExceeded(RuntimeError):
    pass


class WorkersAI:
    """Workers AI REST calls with a hard daily budget: the run stops before it can spend past BUDGET."""

    def __init__(self):
        self.acct, self.token = os.environ["CF_ACCOUNT_ID"], os.environ["CF_API_TOKEN"]
        self.spent = 0.0

    def _charge(self, model, body, result):
        usage = result.get("usage") or {}
        tin = usage.get("prompt_tokens") or usage.get("input_tokens")
        tout = usage.get("completion_tokens") or usage.get("output_tokens") or 0
        if tin is None:                                   # no usage reported: estimate from size
            tin = len(json.dumps(body)) / 3
            tout = tout or body.get("max_tokens", 0)
        rin, rout = RATES.get(model, (max(r[0] for r in RATES.values()), max(r[1] for r in RATES.values())))
        self.spent += (tin * rin + tout * rout) / 1e6

    def _check(self, model, body):
        """Refuse a call whose worst case would cross the budget."""
        rin, rout = RATES.get(model, (30000, 210000))
        worst = (len(json.dumps(body)) / 2 * rin + body.get("max_tokens", 1024) * rout) / 1e6
        if self.spent + worst > BUDGET:
            raise BudgetExceeded(f"stopping: {self.spent:.0f} neurons spent, next call could cost {worst:.0f}, "
                                 f"budget {BUDGET}")

    def run(self, model, body):
        self._check(model, body)
        url = f"https://api.cloudflare.com/client/v4/accounts/{self.acct}/ai/run/{model}"
        req = urllib.request.Request(url, json.dumps(body).encode(), {
            "Authorization": f"Bearer {self.token}", "Content-Type": "application/json", "User-Agent": UA})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    result = json.load(r)["result"]
                self._charge(model, body, result)
                return result
            except urllib.error.HTTPError as e:
                if attempt == 3 or e.code < 500 and e.code != 429:
                    raise RuntimeError(f"{model}: {e.code} {e.read()[:300]!r}")
                time.sleep(5 * (attempt + 1))

    def clef(self, state, questions, image=None):
        body = {"model": "clef-flash", "state": state, "questions": questions}
        if image is not None:
            body["images"] = [data_url(image)]
        return self.run(CLEF, body)["answers"]

    def chat(self, system, prompt, max_tokens=400, temperature=0.9, writer=False):
        r = self.run(WRITER if writer else CHAT, {"messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                            "max_tokens": max_tokens, "temperature": temperature})
        return r["response"]


class Local:
    """Same calls on this Mac: Clef-Flash release code (~/laya-bench) + Ollama. Unloads when done."""

    def __init__(self):
        sys.path.insert(0, str(Path.home() / "laya-bench"))
        import clef
        self.rt = clef.Clef("clef-flash")

    def clef(self, state, questions, image=None):
        req = {"model": "clef-flash", "state": state, "questions": questions}
        if image is not None:
            req["images"] = [image]
        return self.rt.jsm.systemone(self.rt.model, self.rt.processor, req)["answers"]

    WRITER = "qwen3.6-uncensored:latest"      # 35B local stand-in for the 70B writer

    def chat(self, system, prompt, max_tokens=400, temperature=0.9, writer=False):
        model = self.WRITER if writer else "qwen3:4b-instruct"
        if writer:
            prompt += " /no_think"
        body = {"model": model, "stream": False, "keep_alive": "1m", "think": False,
                "options": {"temperature": temperature, "num_predict": max_tokens},
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]}
        req = urllib.request.Request("http://localhost:11434/api/chat", json.dumps(body).encode(),
                                     {"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r:
            return re.sub(r"<think>.*?</think>", "", json.load(r)["message"]["content"], flags=re.S)

    def close(self):
        try:
            urllib.request.urlopen(urllib.request.Request(
                "http://localhost:11434/api/generate",
                json.dumps({"model": "qwen3:4b-instruct", "keep_alive": 0}).encode()), timeout=10).read()
            urllib.request.urlopen(urllib.request.Request(
                "http://localhost:11434/api/generate",
                json.dumps({"model": self.WRITER, "keep_alive": 0}).encode()), timeout=10).read()
        except Exception:
            pass


def data_url(img):
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


# ----------------------------------------------------------------------------- pipeline
def candidates(date):
    """Pictures from the day before `date`: most-read articles first, then 'on this day' pages and the
    featured article (places, things and events, so the day isn't all people). Resizable JPEGs only."""
    feed = get(f"https://api.wikimedia.org/feed/v1/wikipedia/en/featured/{(date - dt.timedelta(days=1)):%Y/%m/%d}")
    pages = [(a, "trending") for a in feed.get("mostread", {}).get("articles", [])]
    pages += [(p, "on this day") for ev in feed.get("onthisday", []) for p in ev.get("pages", [])]
    if feed.get("tfa"):
        pages.append((feed["tfa"], "featured"))
    out, seen = [], set()
    for a, source in pages:
        t = a.get("thumbnail", {}).get("source", "").split("?")[0]
        title, desc = a.get("normalizedtitle", ""), a.get("description", "") or ""
        if (title in seen or "/thumb/" not in t or not re.search(r"\.jpe?g/", t, re.I) or ":" in a.get("title", "")
                or title == "Main Page" or title.startswith("List of")
                or BLOCK.search(title + " " + desc + " " + a.get("extract", "")[:300])):
            continue
        seen.add(title)
        out.append({"title": title, "description": desc, "page": a["content_urls"]["desktop"]["page"],
                    "thumb": re.sub(r"/\d+px-", "/{w}px-", t), "views": a.get("views", 0), "source": source,
                    "file": a.get("originalimage", {}).get("source", "")})
    return out


def curate(m, cands, count, max_people=1):
    """Clef-Flash picks family-friendly, recognisable subjects (at most `max_people` real people), then
    checks each photo actually shows its subject."""
    cands = cands[:42]
    state = {"task": "choosing pictures for a family-friendly 'guess the pixelated picture' game",
             "candidates": {f"c{i}": f"{c['title']} - {c['description']}" for i, c in enumerate(cands)}}
    qs = {}
    for i, c in enumerate(cands):
        qs[f"fun{i}"] = {"type": "noul", "instructions": f"Is candidate c{i} ({c['title']}) a fun, family-friendly "
                         "subject for a public guessing game (no crime, violence, tragedy, politics or sexual content)?"}
        qs[f"known{i}"] = {"type": "noul", "instructions": f"Would many people recognise and be able to name "
                           f"candidate c{i} ({c['title']}) from a photo?"}
        qs[f"person{i}"] = {"type": "noul", "instructions": f"Is candidate c{i} ({c['title']}) a specific real person?"}
    ans = {}
    for chunk in range(0, len(qs), 64):
        keys = list(qs)[chunk:chunk + 64]
        ans.update(m.clef(state, {k: qs[k] for k in keys}))
    ranked = sorted(range(len(cands)), key=lambda i: -(ans[f"fun{i}"]["noul"] * ans[f"known{i}"]["noul"]))
    picked, people = [], 0
    for i in ranked:
        c = cands[i]
        if ans[f"fun{i}"]["noul"] < 0.5 or ans[f"known{i}"]["noul"] < 0.3:
            continue
        is_person = ans[f"person{i}"]["noul"] >= 0.5
        if is_person and people >= max_people:
            continue
        img = Image.open(io.BytesIO(get(c["thumb"].format(w=330), binary=True))).convert("RGB")
        shown = m.clef({"subject": c["title"], "about": c["description"]}, {"shows": {
            "type": "noul", "instructions": "Does this photo clearly show the subject itself (a person, place, "
            "thing or poster you could guess), not a map, chart, logo, document or unrelated scene?"}}, img)
        print(f"  {c['title']:40s} [{c['source']}] fun {ans[f'fun{i}']['noul']:.2f} known {ans[f'known{i}']['noul']:.2f} "
              f"person {ans[f'person{i}']['noul']:.2f} photo {shown['shows']['noul']:.2f}", flush=True)
        if shown["shows"]["noul"] >= 0.5:
            picked.append({**c, "image": img})
            people += is_person
        if len(picked) == count:
            break
    return picked


def aliases(title):
    base = re.sub(r"\s*\(.*?\)", "", title).strip()
    out = {title.lower(), base.lower()}
    words = base.split()
    if len(words) == 2 and all(w[:1].isupper() for w in words):      # likely a person: surname counts
        out.add(words[1].lower())
    return sorted(out)


def guesses(m, c, want=40):
    """~45 guesses a player might type. Uses the writer model (small models often return too few)."""
    base = (f"A picture-guessing game shows a pixelated photo of: {c['title']} ({c['description']}).\n"
            "List 45 different guesses players might type: exact answers, nicknames, partial answers, related "
            "people/things, the general category, and common wrong guesses for a blurry photo like this. "
            "Short (1-6 words).")
    pool = set()
    for fmt in ("One per line, no numbering, nothing else.", "Reply as a single comma-separated list, nothing else."):
        text = m.chat("You write game data.", f"{base} {fmt}", 700, 0.8, writer=True)
        for part in re.split(r"[\n,]", text):
            g = re.sub(r"^[\s\-*\d.)]+", "", part).strip().strip('"').lower()
            if 1 < len(g) <= 60:
                pool.add(g)
        if len(pool) >= want:
            break
    pool |= set(aliases(c["title"])) | {g.lower() for g in random.sample(GENERIC, 25)}
    return sorted(pool)[:96]


def judge(m, c, pool):
    """-> {guess: (closeness 1-10, P(names the subject))}, anchored to the answer so 'a woman' is warm, not a win."""
    t = c["title"]
    state = {"game": "Picle: players guess what a hidden picture shows", "answer": f"{t} - {c['description']}"}
    scored = {}
    for i in range(0, len(pool), 32):
        part = pool[i:i + 32]
        qs = {}
        for j, g in enumerate(part):
            qs[f"s{j}"] = {"type": "score", "instructions": f"How close is the guess \"{g}\" to naming the answer, {t}?",
                           "criteria": levels(t)}
            qs[f"n{j}"] = {"type": "noul", "instructions": f"Does the guess \"{g}\" identify {t} specifically, by name "
                           "or an unmistakable nickname (spelling slips allowed)?"}
        ans = m.clef(state, qs, c["image"])
        for j, g in enumerate(part):
            scored[g] = (round(ans[f"s{j}"]["score"] + 1, 2), round(ans[f"n{j}"]["noul"], 3))
    return scored


JUDGE = ("You are the judge of Picle, a daily picture-guessing game in the style of the New York Times games. "
         "Your voice: dry, clever, warm underneath; one short line (max 16 words). Tease the guess, never the "
         "person. Never mean, never crude, no emojis, no exclamation-mark pileups.\n"
         "The voice, by example (do not reuse these):\n"
         "- \"a toaster\" (cold): Bold of you to assume this is kitchen-related.\n"
         "- \"a dog\" (cold): Every blurry photo is a dog if you believe hard enough.\n"
         "- \"sun king's palace\" (hot): The apostrophe is doing a lot of work. So are you.\n"
         "- \"some guy\" (warm): Technically accurate, spiritually unhelpful.\n"
         "Be specific to the exact words of the guess; never generic filler like 'interesting choice'.")
STOP = {"the", "and", "of", "a", "an", "in", "on", "for", "to", "with", "from", "film", "band", "river"}


def leaks(line, answer, aliases):
    """True if a line names (part of) the answer."""
    low = line.lower()
    words = {w for a in [answer, *aliases] for w in re.findall(r"[a-z0-9']+", a.lower()) if len(w) >= 4 and w not in STOP}
    return any(re.search(rf"\b{re.escape(w)}", low) for w in words)


def band(score):
    return "hot" if score >= 6.5 else "warm" if score >= 5 else "cold"


def quips(m, answer, about, aliases, scored):
    """One judge line per wrong guess, written 15 at a time, without the answer (so nothing can leak).
    The answer is still used to drop any line that happens to name it."""
    todo = [(g, s) for g, (s, p) in scored.items() if p < 0.6]
    out = {}
    for i in range(0, len(todo), 15):
        part = todo[i:i + 15]
        listing = "\n".join(f"{k + 1}. \"{g}\" ({band(s)})" for k, (g, s) in enumerate(part))
        # The writer never sees the answer, so a line can't describe or hint at it. It reacts to the guess
        # and to how close the guess is (which the player sees anyway on the warmth bar).
        prompt = (f"Players are guessing a hidden, pixelated picture. You do NOT know what it is.\n"
                  f"Their guesses, with how close each one is:\n{listing}\n\n"
                  "Write the judge's one-line reaction to each guess: wry about the guess itself (what it says "
                  "about the player, the word they chose), grudgingly encouraging when warm or hot. Never claim "
                  "anything about what the picture is. Avoid stock phrases like 'not quite' or 'close but'. "
                  "Reply as numbered lines only, same numbering.")
        text = m.chat(JUDGE, prompt, 1200, 0.9, writer=True)
        for line in text.splitlines():
            mm = re.match(r"\s*(\d+)[.)]\s*(.+)", line)
            if not mm or not (1 <= int(mm.group(1)) <= len(part)):
                continue
            q = mm.group(2).strip().strip('"').strip()
            q = re.sub(r'^"?[^"]{0,60}"?\s*[:\u2014-]\s+', "", q) if q.startswith('"') else q   # drop echoed guess
            if 8 <= len(q) <= 160 and not leaks(q, answer, aliases):
                out[part[int(mm.group(1)) - 1][0]] = q
    return out


def fallback_pool(m, n=14):
    """Answer-agnostic lines with a literal {g} slot, by temperature, for unpredicted guesses."""
    ask = {"cold": "a guess that is nowhere close", "warm": "a guess that is in the right neighbourhood",
           "hot": "a guess that is very close but not quite"}
    pool = {}
    for k, what in ask.items():
        lines = []
        for _ in range(3):
            text = m.chat(JUDGE, f"Write {n} different one-line judge reactions to {what}. Put the literal "
                          "placeholder {g} where the player's guess goes, once per line. Each must work for any "
                          "guess and any picture. Avoid stock phrases. Numbered lines only.", 1200, 1.0, writer=True)
            for line in text.splitlines():
                q = re.sub(r"^[\s\-*\d.)]+", "", line).strip().strip('"')
                if q.count("{g}") == 1 and 10 <= len(q) <= 160 and q not in lines:
                    lines.append(q)
            if len(lines) >= n:
                break
        pool[k] = lines[:n]
    return pool


def reveal(secret, key):
    raw = base64.b64decode(secret)
    k = key.encode()
    return json.loads(bytes(b ^ k[i % len(k)] for i, b in enumerate(raw)))


def pack(img, side=128):
    """Downsampled photo the page pixelates on a canvas (it never needs more detail than this)."""
    small = img.copy()
    small.thumbnail((side, side), Image.LANCZOS)
    buf = io.BytesIO()
    small.save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def hide(obj, key):
    """Light obfuscation so answers aren't readable at a glance in the JSON (not security)."""
    raw = json.dumps(obj, ensure_ascii=False).encode()
    k = key.encode()
    return base64.b64encode(bytes(b ^ k[i % len(k)] for i, b in enumerate(raw))).decode()


class ChatOnly(Local):
    def __init__(self):                                  # no Clef needed to rewrite lines
        pass


def requip(a):
    doc = json.loads((OUT / "latest.json").read_text())
    m = ChatOnly() if a.local else WorkersAI()
    try:
        for pz in doc["puzzles"]:
            key = f"picle-{doc['date']}-{pz['n']}"
            sec = reveal(pz["secret"], key)
            sec["answer"] = re.sub(r"\s*\(.*?\)", "", sec["answer"]).strip()
            scored = {g: (v[0], v[1]) for g, v in sec["guesses"].items()}
            lines = quips(m, sec["answer"], sec["about"], sec["aliases"], scored)
            sec["guesses"] = {g: [s, p, lines.get(g)] for g, (s, p) in scored.items()}
            pz["secret"] = hide(sec, key)
            print(f"#{pz['n']} {sec['answer']}: {len(lines)} judge lines", flush=True)
        doc["lines"] = fallback_pool(m)
        doc.pop("fallbacks", None)
    finally:
        m.close()
    for name in ("latest.json", f"{doc['date']}.json"):
        (OUT / name).write_text(json.dumps(doc, separators=(",", ":")))
    print("pool:", {k: len(v) for k, v in doc["lines"].items()})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--local", action="store_true")
    ap.add_argument("--date", default=dt.date.today().isoformat())
    ap.add_argument("--count", type=int, default=5)
    ap.add_argument("--requip", action="store_true", help="only rewrite the judge's lines in latest.json")
    a = ap.parse_args()
    if a.requip:
        return requip(a)
    date = dt.date.fromisoformat(a.date)
    random.seed(a.date)
    m = Local() if a.local else WorkersAI()
    t0 = time.time()
    try:
        cands = candidates(date)
        print(f"{len(cands)} candidates after filters", flush=True)
        picked = curate(m, cands, a.count)
        puzzles = []
        for n, c in enumerate(picked):
            pool = guesses(m, c)
            scored = judge(m, c, pool)
            answer = re.sub(r"\s*\(.*?\)", "", c["title"]).strip()
            lines = quips(m, answer, c["description"], aliases(c["title"]), scored)
            best = sorted(scored.items(), key=lambda kv: -kv[1][0])[:3]
            print(f"#{n + 1} {c['title']}: {len(scored)} guesses scored, {len(lines)} judge lines; top {best}", flush=True)
            puzzles.append({"n": n + 1, "pixels": pack(c["image"]),
                            "secret": hide({"answer": re.sub(r"\s*\(.*?\)", "", c["title"]).strip(), "about": c["description"], "page": c["page"],
                                            "photo": c["thumb"].format(w=500), "file": c["file"],
                                            "aliases": aliases(c["title"]),
                                            "guesses": {g: [s, p, lines.get(g)] for g, (s, p) in scored.items()}},
                                           f"picle-{a.date}-{n + 1}")})
        pool = fallback_pool(m)
    finally:
        if hasattr(m, "close"):
            m.close()
    OUT.mkdir(parents=True, exist_ok=True)
    doc ={"date": a.date, "source": "Wikipedia (most read, on this day, featured); photos from Wikimedia Commons",
           "judge": "Cloudflare Clef-Flash", "puzzles": puzzles, "lines": pool}
    (OUT / f"{a.date}.json").write_text(json.dumps(doc, separators=(",", ":")))
    (OUT / "latest.json").write_text(json.dumps(doc, separators=(",", ":")))
    for old in OUT.glob("20*.json"):                     # keep two weeks of history
        if old.stem < (date - dt.timedelta(days=14)).isoformat():
            old.unlink()
    print(f"wrote {len(puzzles)} puzzles for {a.date} in {time.time() - t0:.0f} s"
          + (f"; ~{m.spent:.0f} Workers AI neurons (budget {BUDGET})" if hasattr(m, "spent") else ""))


if __name__ == "__main__":
    main()
