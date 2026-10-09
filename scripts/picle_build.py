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
  5. pages/picle/used.json remembers every subject and photo ever used, so a picture never repeats.
     pages/picle/lines.json is a pool of answer-agnostic judge lines that grows a little every day.

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
USED = ROOT / "pages" / "picle" / "used.json"
LINES = ROOT / "pages" / "picle" / "lines.json"
UA = "PicleBot/1.0 (https://hyprpixl.ca/pages/picle.html; hyprpixlstudios@gmail.com)"
CLEF = "@cf/cloudflare/clef-flash"
CHAT = "@cf/meta/llama-3.2-3b-instruct"          # guess lists
WRITER = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"  # the judge's lines: wit needs a bigger model

BLOCK = re.compile(r"murder|kill|terror|shoot|massacre|assassin|bomb|war\b|attack|crime|criminal|prison|"
                   r"execut|death|died|dead|suicide|abuse|rape|sex|porn|nazi|genocide|disaster|crash|"
                   r"election|politic|scandal|cartel|gang|abortion|weapon|firearm|drug|disease|cancer", re.I)
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
def load_used():
    """Every subject and photo Picle has ever shown. Seeded from the puzzle files the first time."""
    if USED.exists():
        return json.loads(USED.read_text())
    used = {"titles": [], "files": []}
    for f in sorted(OUT.glob("20*.json")):
        doc = json.loads(f.read_text())
        for pz in doc["puzzles"]:
            sec = reveal(pz["secret"], f"picle-{doc['date']}-{pz['n']}")
            used["titles"].append(sec["answer"].lower())
            used["files"].append(sec.get("file", ""))
    return used


VITAL = ["Biology and health sciences/Animals", "Everyday life", "Everyday life/Sports, games and recreation",
         "Technology"]


def evergreen(date, have, n=60):
    """Well-known things (animals, foods, inventions, sports) from Wikipedia's vital articles, so a day with
    little but people in the news still gets its three things. A fresh sample every day."""
    titles = []
    for page in VITAL:
        q = {"action": "query", "redirects": 1, "generator": "links", "gpllimit": "max", "gplnamespace": 0,
             "format": "json", "formatversion": 2, "titles": f"Wikipedia:Vital articles/Level/4/{page}"}
        for _ in range(6):
            try:
                d = get("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(q))
            except Exception as e:
                print("vital articles unavailable:", e)
                break
            titles += [x["title"] for x in d.get("query", {}).get("pages", [])]
            if "continue" not in d:
                break
            q.update(d["continue"])
    rng = random.Random(f"evergreen-{date}")
    out = []
    for t in rng.sample(sorted(set(titles)), min(n, len(set(titles)))):
        try:
            a = get("https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(t.replace(" ", "_"), safe=""))
        except Exception:
            continue
        if a.get("type") == "standard":
            a.setdefault("normalizedtitle", (a.get("titles") or {}).get("normalized") or a.get("title", ""))
            out.append((a, "evergreen"))
    print(f"{len(out)} evergreen candidates", flush=True)
    return out


def candidates(date, used):
    """Pictures for `date`, never one used before: the previous day's most-read articles first, then
    'on this day' pages and the featured article (places, things and events, so the day isn't all
    people), then the two days before that. Resizable JPEGs only."""
    day = date - dt.timedelta(days=1)
    feed = get(f"https://api.wikimedia.org/feed/v1/wikipedia/en/featured/{day:%Y/%m/%d}")
    pages = [(a, "trending") for a in feed.get("mostread", {}).get("articles", [])]
    pages += [(p, "on this day") for ev in feed.get("onthisday", []) for p in ev.get("pages", [])]
    if feed.get("tfa"):
        pages.append((feed["tfa"], "featured"))
    try:
        otd = get(f"https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all/{date:%m/%d}")
        pages += [(p, "on this day") for k in ("selected", "events", "holidays") for ev in otd.get(k, [])
                  for p in ev.get("pages", [])]
    except Exception as e:
        print("on this day feed unavailable:", e)
    pages += evergreen(date, len(pages))
    for back in (2, 3):
        try:
            older = get(f"https://api.wikimedia.org/feed/v1/wikipedia/en/featured/{date - dt.timedelta(days=back):%Y/%m/%d}")
            pages += [(a, "trending") for a in older.get("mostread", {}).get("articles", [])]
        except Exception as e:
            print(f"feed for {back} days back unavailable:", e)
    old_titles = {t.lower() for t in used["titles"]}
    old_files = {f for f in used["files"] if f}
    out, seen = [], set()
    for a, source in pages:
        t = a.get("thumbnail", {}).get("source", "").split("?")[0]
        title, desc = a.get("normalizedtitle", ""), a.get("description", "") or ""
        answer = re.sub(r"\s*\(.*?\)", "", title).strip().lower()
        file = a.get("originalimage", {}).get("source", "")
        if (title in seen or answer in old_titles or title.lower() in old_titles or (file and file in old_files)
                or "/thumb/" not in t or not re.search(r"\.jpe?g/", t, re.I) or ":" in a.get("title", "")
                or title == "Main Page" or title.startswith("List of")
                or BLOCK.search(title + " " + desc + " " + a.get("extract", "")[:300])):
            continue
        seen.add(title)
        seen.add(answer)
        out.append({"title": title, "description": desc, "page": a["content_urls"]["desktop"]["page"],
                    "thumb": re.sub(r"/\d+px-", "/{w}px-", t), "views": a.get("views", 0), "source": source,
                    "file": file})
    return out


MIX = {"person": 1, "place": 1, "thing": 3}     # a day's pictures: guessing several people is no fun


def curate(m, cands, count):
    """Clef-Flash picks family-friendly, recognisable subjects in the day's mix (MIX: one person, one place,
    the rest things), then checks each photo actually shows its subject. Works through the candidates 40 at
    a time; if the whole list still comes up short, a second pass accepts less famous subjects and lets an
    extra place or thing fill a gap. Never more than one person."""
    quota = {k: round(v * count / sum(MIX.values())) for k, v in MIX.items()}
    quota["thing"] += count - sum(quota.values())
    picked, tried, scored = [], set(), []
    for start in range(0, min(len(cands), 200), 40):
        window = cands[start:start + 40]
        ans = rate(m, window)
        scored += [(c, ans, i) for i, c in enumerate(window)]
        pick(m, [(c, ans, i) for i, c in enumerate(window)], picked, tried, quota, 0.45)
        if len(picked) >= count:
            return order(picked)
    print(f"  only {len(picked)} after the first pass; relaxing", flush=True)
    short = count - len(picked)
    pick(m, scored, picked, tried, {**quota, "place": quota["place"] + short, "thing": quota["thing"] + short}, 0.2,
         total=count)
    return order(picked)


def order(picked):
    """Mix the kinds through the day (random is seeded with the date, so reruns agree)."""
    random.shuffle(picked)
    return picked


def rate(m, cands):
    state = {"task": "choosing pictures for a family-friendly 'guess the pixelated picture' game",
             "candidates": {f"c{i}": f"{c['title']} - {c['description']}" for i, c in enumerate(cands)}}
    qs = {}
    for i, c in enumerate(cands):
        qs[f"fun{i}"] = {"type": "noul", "instructions": f"Is candidate c{i} ({c['title']}) a fun, family-friendly "
                         "subject for a public guessing game (no crime, violence, tragedy, politics or sexual content)?"}
        qs[f"known{i}"] = {"type": "noul", "instructions": f"Would many people recognise and be able to name "
                           f"candidate c{i} ({c['title']}) from a photo?"}
        qs[f"person{i}"] = {"type": "noul", "instructions": f"Is candidate c{i} ({c['title']}) a specific real person "
                            "or group of people (a band, a team)?"}
        qs[f"place{i}"] = {"type": "noul", "instructions": f"Is candidate c{i} ({c['title']}) a place: a city, country, "
                           "building, landmark, river, mountain or other location?"}
    ans = {}
    for chunk in range(0, len(qs), 64):
        keys = list(qs)[chunk:chunk + 64]
        ans.update(m.clef(state, {k: qs[k] for k in keys}))
    return ans


def kind(ans, i):
    if ans[f"person{i}"]["noul"] >= 0.5:
        return "person"
    return "place" if ans[f"place{i}"]["noul"] >= 0.5 else "thing"


def pick(m, scored, picked, tried, quota, min_known, total=None):
    """Adds photo-checked picks from [(candidate, answers, index)] to `picked` while their kind has room."""
    total = total or sum(quota.values())
    ranked = sorted(scored, key=lambda x: -(x[1][f"fun{x[2]}"]["noul"] * x[1][f"known{x[2]}"]["noul"]))
    for c, ans, i in ranked:
        if len(picked) >= total:
            break
        k = kind(ans, i)
        if (c["title"] in tried or ans[f"fun{i}"]["noul"] < 0.5 or ans[f"known{i}"]["noul"] < min_known
                or sum(p["kind"] == k for p in picked) >= quota[k]):
            continue
        tried.add(c["title"])
        img = Image.open(io.BytesIO(get(c["thumb"].format(w=330), binary=True))).convert("RGB")
        shown = m.clef({"subject": c["title"], "about": c["description"]}, {"shows": {
            "type": "noul", "instructions": "Does this photo clearly show the subject itself (a person, place, "
            "thing or poster you could guess), not a map, chart, logo, document or unrelated scene?"}}, img)
        print(f"  {c['title']:40s} [{c['source']}] {k:6s} fun {ans[f'fun{i}']['noul']:.2f} "
              f"known {ans[f'known{i}']['noul']:.2f} photo {shown['shows']['noul']:.2f}", flush=True)
        if shown["shows"]["noul"] >= 0.5:
            picked.append({**c, "image": img, "kind": k})


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
         "Your voice: a dry, quick-witted game-show judge who has seen every bad guess and still enjoys them. "
         "One short line, max 16 words. Tease the guess, never the person. No emojis, no crude jokes, at most one "
         "exclamation mark.\n"
         "The voice, by example (never reuse these):\n"
         "- \"a toaster\" (cold): Bold of you to assume this is kitchen-related.\n"
         "- \"a dog\" (cold): Every blurry photo is a dog if you believe hard enough.\n"
         "- \"sun king's palace\" (hot): The apostrophe is doing a lot of work. So are you.\n"
         "- \"some guy\" (warm): Technically accurate, spiritually unhelpful.\n"
         "- \"lasagna\" (cold): I admire the confidence. I do not admire the lasagna.\n"
         "- \"a famous actor\" (warm): You've narrowed it down to several thousand people. Progress.\n"
         "- \"big boat\" (hot): Size: correct. Vocabulary: on holiday.\n"
         "Variety matters most. Mix the shapes: a question, a fake ruling, a tiny story, a two-beat joke, a "
         "sports-commentator aside, a stage direction, a mock-formal verdict. Play with the exact words of the "
         "guess (a pun, a literal reading, its spelling). Never use these patterns: 'X is a ... but ...', "
         "'X shares a border', 'X is a creative/novel/interesting ...', 'not quite', 'close but', "
         "'in the right neighbourhood', 'a thread in the tapestry'. Never open two lines the same way.")
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
                  "Write the judge's one-line reaction to each guess: a joke about the guess itself (its exact "
                  "words, what it says about the player), grudgingly encouraging when warm or hot. Never claim "
                  "anything about what the picture is. Every line a different shape and a different first word. "
                  "Reply as numbered lines only, same numbering.")
        text = m.chat(JUDGE, prompt, 1200, 1.0, writer=True)
        for line in text.splitlines():
            mm = re.match(r"\s*(\d+)[.)]\s*(.+)", line)
            if not mm or not (1 <= int(mm.group(1)) <= len(part)):
                continue
            q = mm.group(2).strip().strip('"').strip()
            q = re.sub(r'^"?[^"]{0,60}"?\s*[:\u2014-]\s+', "", q) if q.startswith('"') else q   # drop echoed guess
            if 8 <= len(q) <= 160 and not leaks(q, answer, aliases):
                out[part[int(mm.group(1)) - 1][0]] = q
    return out


POOL_ASK = {
    "cold": ("a guess that is nowhere close", "{g}"),
    "warm": ("a guess that is in the right general area", "{g}"),
    "hot": ("a guess that is very close but not the answer", "{g}"),
    "warmer": ("a guess {g} that is clearly closer than the player's previous guess {prev}", "{g} {prev}"),
    "colder": ("a guess {g} that is further away than the player's previous guess {prev}", "{g} {prev}"),
}


def opener(line):
    return " ".join(re.findall(r"[a-z{}']+", line.lower())[:2])


def fresh_lines(m, have, n=12):
    """Up to `n` new answer-agnostic lines per kind, unlike the ones already in the pool."""
    new = {}
    for k, (what, slots) in POOL_ASK.items():
        known = list(have.get(k, []))
        avoid = "\n".join(f"- {x}" for x in random.sample(known, min(12, len(known))))
        lines = []
        for _ in range(2):
            text = m.chat(JUDGE, f"Write {n + 4} different one-line judge reactions to {what}. Use the literal "
                          f"placeholder{'s' if ' ' in slots else ''} {slots} exactly once each per line. Each must work "
                          "for any guess and any picture, and never say what the picture is. Every line a different "
                          "shape and a different first word."
                          + (f"\nAlready used, so write nothing like these:\n{avoid}" if avoid else "")
                          + "\nNumbered lines only.", 1200, 1.0, writer=True)
            for line in text.splitlines():
                q = re.sub(r"^[\s\-*\d.)]+", "", line).strip().strip('"')
                ok = all(q.count(slot) == 1 for slot in slots.split()) and 10 <= len(q) <= 160
                taken = {opener(x) for x in known + lines}
                if ok and q not in known and opener(q) not in taken:
                    lines.append(q)
            if len(lines) >= n:
                break
        new[k] = lines[:n]
    return new


def grow_pool(m, date, keep=150):
    """Adds today's new lines to pages/picle/lines.json, keeping the newest `keep` per kind."""
    pool = json.loads(LINES.read_text()) if LINES.exists() else {}
    if not pool:                                         # seed from the last puzzle file's pool
        try:
            pool = {k: list(v) for k, v in json.loads((OUT / "latest.json").read_text()).get("lines", {}).items()}
        except Exception:
            pool = {}
    for k, lines in fresh_lines(m, pool).items():
        pool[k] = (pool.get(k, []) + lines)[-keep:]
    pool["updated"] = date
    LINES.write_text(json.dumps(pool, ensure_ascii=False, indent=0))
    return {k: len(v) for k, v in pool.items() if isinstance(v, list)}


def reveal_lines(m, answer, about):
    """Lines for after the picture is revealed. These may name it, since the player has seen the answer."""
    text = m.chat(JUDGE, f"The hidden picture was {answer} ({about}). Write the judge's one-liner shown after "
                  "the reveal, in three situations:\n1. the player named it on the first or second guess\n"
                  "2. the player got it after many guesses\n3. the player gave up\n"
                  "Make each one specific to the subject (a fact, a pun, its reputation). Numbered lines only.",
                  300, 1.0, writer=True)
    out = {}
    for line in text.splitlines():
        mm = re.match(r"\s*([123])[.)]\s*(.+)", line)
        if mm:
            q = mm.group(2).strip().strip('"')
            if 8 <= len(q) <= 180:
                out[("quick", "slow", "gaveup")[int(mm.group(1)) - 1]] = q
    return out


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
        print("pool:", grow_pool(m, doc["date"]))
    finally:
        m.close()
    for name in ("latest.json", f"{doc['date']}.json"):
        (OUT / name).write_text(json.dumps(doc, separators=(",", ":")))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--local", action="store_true")
    ap.add_argument("--date", default=dt.date.today().isoformat())
    ap.add_argument("--count", type=int, default=5)
    ap.add_argument("--dry", action="store_true", help="only list candidates and picks; write nothing")
    ap.add_argument("--requip", action="store_true", help="only rewrite the judge's lines in latest.json")
    a = ap.parse_args()
    if a.requip:
        return requip(a)
    date = dt.date.fromisoformat(a.date)
    random.seed(a.date)
    m = Local() if a.local else WorkersAI()
    t0 = time.time()
    try:
        used = load_used()
        cands = candidates(date, used)
        print(f"{len(cands)} candidates after filters", flush=True)
        picked = curate(m, cands, a.count)
        puzzles = []
        for n, c in enumerate(picked):
            if a.dry:
                continue
            try:
                pool = guesses(m, c)
                scored = judge(m, c, pool)
                answer = re.sub(r"\s*\(.*?\)", "", c["title"]).strip()
                lines = quips(m, answer, c["description"], aliases(c["title"]), scored)
                after = reveal_lines(m, answer, c["description"])
                best = sorted(scored.items(), key=lambda kv: -kv[1][0])[:3]
                print(f"#{n + 1} {c['title']}: {len(scored)} guesses scored, {len(lines)} judge lines; top {best}", flush=True)
                puzzles.append({"n": n + 1, "pixels": pack(c["image"]),
                                "secret": hide({"answer": re.sub(r"\s*\(.*?\)", "", c["title"]).strip(), "about": c["description"], "page": c["page"],
                                                "photo": c["thumb"].format(w=500), "file": c["file"],
                                                "aliases": aliases(c["title"]), "after": after,
                                                "guesses": {g: [s, p, lines.get(g)] for g, (s, p) in scored.items()}},
                                               f"picle-{a.date}-{n + 1}")})
            except BudgetExceeded as e:             # keep the finished puzzles
                print(e)
                picked = picked[:n]
                break
        if a.dry:
            return
        try:
            print("line pool:", grow_pool(m, a.date))
        except BudgetExceeded as e:                      # the puzzles matter more than new lines
            print("line pool not grown today:", e)
    finally:
        if hasattr(m, "close"):
            m.close()
    OUT.mkdir(parents=True, exist_ok=True)
    doc ={"date": a.date, "source": "Wikipedia (most read, on this day, featured); photos from Wikimedia Commons",
           "judge": "Cloudflare Clef-Flash", "puzzles": puzzles}
    (OUT / f"{a.date}.json").write_text(json.dumps(doc, separators=(",", ":")))
    (OUT / "latest.json").write_text(json.dumps(doc, separators=(",", ":")))
    for c in picked:
        used["titles"].append(re.sub(r"\s*\(.*?\)", "", c["title"]).strip().lower())
        used["files"].append(c["file"])
    USED.write_text(json.dumps(used, ensure_ascii=False, indent=0))
    for old in OUT.glob("20*.json"):                     # keep two weeks of history
        if old.stem < (date - dt.timedelta(days=14)).isoformat():
            old.unlink()
    print(f"wrote {len(puzzles)} puzzles for {a.date} in {time.time() - t0:.0f} s"
          + (f"; ~{m.spent:.0f} Workers AI neurons (budget {BUDGET})" if hasattr(m, "spent") else ""))


if __name__ == "__main__":
    main()
