"""One-shot LOCAL backfill: episode labels for "The Mental Game" videos.

The Mental Game episodes self-identify in their opening minutes ("welcome to
season 12 episode 9 of the mental game", "S10E9", "episode 51 of season
three", "sharpening trading skills episode 42.4", "episode 14 on the third
volume"). This script:

  1. Reads ids + APPLIED categories from tools/taxonomy_out/videos_meta.json
     + assignments.json (the category in assignments.json is authoritative).
  2. For every video assigned "The Mental Game", fetches its stored transcript
     cues from prod (read-only GET, PUSH_SECRET bearer + browser UA, 0.2s
     pacing, retry-on-5xx).
  3. Regexes the first ~25 cues for season/episode self-identification
     (digits, word numbers one–twenty, ordinals first–twentieth, decimal
     episode numbers).
  4. Normalizes: season+episode → "S{n} · E{m}"; episode-only → "E{m}";
     unparseable → SKIP (no write ever happens for those).

Usage (from anywhere; paths are absolute-safe):
  python tools/desk_episode_backfill.py --dry-run    # print the id→label table
  python tools/desk_episode_backfill.py --execute    # POST insights-store per id

NEVER touches category/title — the only field written is episode_label, via
the insights-store rail (which only writes provided fields).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time

import requests

BASE = "https://uctintelligence.com"
HERE = os.path.dirname(os.path.abspath(__file__))
TAXONOMY_OUT = os.path.join(HERE, "taxonomy_out")
ENV_PATH = r"C:\Users\Patrick\uct-dashboard\.env"
CATEGORY = "The Mental Game"
CUE_WINDOW = 25          # only the opening self-identification matters
PACING_SECS = 0.2
RETRIES = 3

# ── number words (one–twenty) + ordinals (first–twentieth) ───────────────────

_CARDINALS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
}
_ORDINALS = {
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6,
    "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10, "eleventh": 11,
    "twelfth": 12, "thirteenth": 13, "fourteenth": 14, "fifteenth": 15,
    "sixteenth": 16, "seventeenth": 17, "eighteenth": 18, "nineteenth": 19,
    "twentieth": 20,
}
_WORDS = {**_CARDINALS, **_ORDINALS}

_NUM = r"(\d+(?:\.\d+)?|" + "|".join(_WORDS) + r")"
# Loose joiner between the two halves: optional stray punctuation (the ASR
# emits "episode 51. of season three") + a preposition + "the".
_JOIN = r"[\s.,]*(?:of|in|on|for|from)?\s*(?:the\s+)?"
# Spoken filler between "season N" and "episode M" ("season five we got
# episode nine") — bounded so distant, unrelated mentions can't pair up.
_GAP20 = r"[\s\S]{0,20}?"
_GAP40 = r"[\s\S]{0,40}?"

# (pattern, kind) — kind maps groups → (season, episode).
# Ordered most-specific first; the bare episode-only pattern is LAST.
_PATTERNS: list[tuple[re.Pattern, str]] = [
    # "season 12 episode 9" / "season twelve, episode nine" /
    # "season five we got episode nine" (≤20 chars of filler)
    (re.compile(rf"\bseason\s+{_NUM}\b{_GAP20}\bepisode\s+{_NUM}\b", re.I), "se"),
    # "episode 19 season 12" / "episode 51. of season three"
    (re.compile(rf"\bepisode\s+{_NUM}\b{_JOIN}season\s+{_NUM}\b", re.I), "es"),
    # "episode 14 on the third volume"  (volume = season, ordinal-first)
    (re.compile(rf"\bepisode\s+{_NUM}\b{_JOIN}{_NUM}\s+volume\b", re.I), "es"),
    # "episode 14 of volume 3"
    (re.compile(rf"\bepisode\s+{_NUM}\b{_JOIN}volume\s+{_NUM}\b", re.I), "es"),
    # "the fourth season … we're on episode two" (reversed, ≤40 chars filler)
    (re.compile(rf"\b{_NUM}\s+season\b{_GAP40}\bepisode\s+{_NUM}\b", re.I), "se"),
    # compact "S10E9" / "S10 E9"
    (re.compile(r"\bs(\d{1,2})\s*e(\d+(?:\.\d+)?)\b", re.I), "se"),
    # episode-only, incl. decimals ("sharpening trading skills episode 42.4")
    (re.compile(rf"\bepisode\s+{_NUM}\b", re.I), "e"),
]


def _ep_str(raw: str) -> str | None:
    """Episode token → display string. Words → int; decimals kept verbatim."""
    s = raw.strip().lower()
    if s in _WORDS:
        return str(_WORDS[s])
    if "." in s:
        return s  # decimal episode e.g. "42.4"
    try:
        return str(int(s))
    except ValueError:
        return None


def _season_int(raw: str) -> int | None:
    s = raw.strip().lower()
    if s in _WORDS:
        return _WORDS[s]
    if "." in s:  # a decimal can never be a season — reject the match
        return None
    try:
        return int(s)
    except ValueError:
        return None


def extract_label(text: str) -> str | None:
    """First season/episode self-identification in `text`, normalized."""
    for pat, kind in _PATTERNS:
        for m in pat.finditer(text):
            if kind == "se":
                season, ep = _season_int(m.group(1)), _ep_str(m.group(2))
            elif kind == "es":
                ep, season = _ep_str(m.group(1)), _season_int(m.group(2))
            else:  # "e" — episode only
                ep = _ep_str(m.group(1))
                if ep is None:
                    continue
                return f"E{ep}"
            if season is None or ep is None:
                continue  # e.g. decimal in the season slot — try next match
            return f"S{season} · E{ep}"
    return None


# ── prod I/O ─────────────────────────────────────────────────────────────────

def _push_secret() -> str:
    secret = os.environ.get("PUSH_SECRET", "")
    if not secret and os.path.exists(ENV_PATH):
        for line in open(ENV_PATH, encoding="utf-8", errors="ignore"):
            line = line.strip()
            if line.startswith("PUSH_SECRET="):
                secret = line.split("=", 1)[1].strip().strip('"').strip("'")
                break
    if not secret:
        sys.exit(f"PUSH_SECRET not found (env or {ENV_PATH})")
    return secret


def _session(secret: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "Authorization": f"Bearer {secret}",
        # Cloudflare 1010-blocks raw python UAs on this domain
        "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/126.0.0.0 Safari/537.36"),
    })
    return s


def _get_json(sess: requests.Session, url: str) -> dict | None:
    for attempt in range(1, RETRIES + 1):
        try:
            r = sess.get(url, timeout=30)
        except requests.RequestException as e:
            if attempt == RETRIES:
                print(f"    !! request error: {e}", file=sys.stderr)
                return None
            time.sleep(1.5 * attempt)
            continue
        if r.status_code >= 500:  # retry-on-5xx
            if attempt == RETRIES:
                print(f"    !! {r.status_code} after {RETRIES} tries", file=sys.stderr)
                return None
            time.sleep(1.5 * attempt)
            continue
        if r.status_code != 200:
            print(f"    !! HTTP {r.status_code}", file=sys.stderr)
            return None
        try:
            return r.json()
        except ValueError:
            print("    !! non-JSON response", file=sys.stderr)
            return None
    return None


def _mental_game_rows() -> list[dict]:
    meta = json.load(open(os.path.join(TAXONOMY_OUT, "videos_meta.json"), encoding="utf-8"))
    assign = json.load(open(os.path.join(TAXONOMY_OUT, "assignments.json"), encoding="utf-8"))
    titles = {v["id"]: v.get("title", "") for v in meta}
    rows = [{"id": a["id"], "title": titles.get(a["id"], "?")}
            for a in assign["assignments"] if a.get("category") == CATEGORY]
    return sorted(rows, key=lambda r: r["id"])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mx = ap.add_mutually_exclusive_group(required=True)
    mx.add_argument("--dry-run", action="store_true",
                    help="fetch + extract + print the full id→label table (read-only)")
    mx.add_argument("--execute", action="store_true",
                    help="POST {'episode_label': ...} per parsed id to insights-store")
    args = ap.parse_args()

    sess = _session(_push_secret())
    rows = _mental_game_rows()
    print(f"{CATEGORY}: {len(rows)} videos (from assignments.json)\n")

    parsed: list[tuple[int, str, str, str]] = []  # (id, title, label, source)
    skipped: list[tuple[int, str, str]] = []      # (id, title, reason)
    for row in rows:
        vid, title = row["id"], row["title"]
        data = _get_json(sess, f"{BASE}/api/education/videos/{vid}/transcript-cues")
        time.sleep(PACING_SECS)
        cues = (data or {}).get("cues") or []
        if not cues:
            skipped.append((vid, title, "no transcript cues" if data is not None else "fetch failed"))
            continue
        opening = " ".join(str(c.get("text") or "") for c in cues[:CUE_WINDOW])
        label = extract_label(opening)
        if label:
            parsed.append((vid, title, label, "transcript"))
            continue
        # Fallback: some episodes self-identify in the TITLE instead of the
        # opening cues ("The Mental Game Season 1, Episode 3 …"). Read-only
        # use of the title — this rail never writes category/title.
        label = extract_label(title)
        if label:
            parsed.append((vid, title, label, "title"))
        else:
            skipped.append((vid, title, "no season/episode self-id in opening cues or title"))

    w = max((len(t) for _, t, *_ in parsed + skipped), default=10)
    w = min(w, 60)
    print(f"{'id':>4}  {'title':<{w}}  label / reason")
    print("-" * (w + 30))
    for vid, title, label, source in parsed:
        note = "" if source == "transcript" else f"   (from {source})"
        print(f"{vid:>4}  {title[:w]:<{w}}  {label}{note}")
    for vid, title, reason in skipped:
        print(f"{vid:>4}  {title[:w]:<{w}}  SKIP — {reason}")
    print(f"\nhit rate: {len(parsed)}/{len(rows)} parsed "
          f"({sum(1 for p in parsed if p[3] == 'transcript')} transcript, "
          f"{sum(1 for p in parsed if p[3] == 'title')} title), {len(skipped)} skipped")

    if args.execute:
        print("\n--execute: writing episode_label via insights-store …")
        ok = 0
        for vid, title, label, _source in parsed:
            r = sess.post(f"{BASE}/api/education/videos/{vid}/insights-store",
                          json={"episode_label": label}, timeout=30)
            status = "OK" if r.status_code == 200 else f"HTTP {r.status_code}"
            if r.status_code == 200:
                ok += 1
            print(f"  id {vid}: {label} → {status}")
            time.sleep(PACING_SECS)
        print(f"\nwrote {ok}/{len(parsed)}")


if __name__ == "__main__":
    main()
