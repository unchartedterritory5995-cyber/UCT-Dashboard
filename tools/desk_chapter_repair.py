"""Repair corrupted AI chapter timestamps across the Desk video library.

── The finding ──────────────────────────────────────────────────────────────

`tools/taxonomy_out/trader_audit.json` flagged ~129 of 290 prod videos with
broken `chapters` timestamps (feeds the theater chapter rail, deep-search
timestamps, and the curriculum's "watch from" notes). A video's chapters are
BROKEN if any chapter's `t`: is negative, exceeds the video's real end (last
transcript CUE time + a 120s cushion — the `duration` TEXT column is missing
on many rows and can't be trusted), or is non-monotonic vs the previous
chapter.

── The corruption pattern (diagnosed on a 10-video sample, holds across all
   129) ───────────────────────────────────────────────────────────────────

Every single broken video shows the SAME shape — never a swapped-order /
negative-t case (`--diagnose` verified 0 of 129 fail on monotonicity alone;
100% fail purely on the range check):

  - The first ~60-90% of a video's chapters are timestamped CORRECTLY —
    within normal chapter-granularity fuzziness (tens of seconds) of where
    their title's actual content sits in the transcript.
  - Starting at some index (`first_bad_idx`, typically chapter ~8-13 of 12-28),
    timestamps abruptly start OUTRUNNING real elapsed time and never come
    back — small drift at first, then runaway. In the worst cases the final
    chapter lands 5-15x past the video's real length (id=155: last chapter
    t=73000s vs a true ~4840s cue-extent; id=209: t=26000s vs 1697s; id=138:
    t=25200s vs 10838s).

This is consistent with the chapter-generation LLM staying accurately
grounded to the transcript while it's within/near its working context, then
extrapolating remaining chapter start times (roughly evenly-spaced
increments once grounding is lost) once the transcript got long — the error
compounds forward and never self-corrects, so lategame chapters end up
wildly beyond the actual runtime. It is NOT a fixed offset and NOT a clean
linear/2x rescale — ratios vary per video — so a single global transform
can't repair it; each chapter has to be independently relocated.

── Repair strategy ──────────────────────────────────────────────────────────

Per broken video, for each chapter (in order):
  1. Pull "distinctive words" from its title (ALL-CAPS 2-6 letter tokens —
     tickers/acronyms — always qualify; other tokens qualify at length>=4 and
     not a stopword). Normalized case-insensitive, punctuation-stripped.
  2. Fuzzy-locate: search transcript cues FORWARD from the previous chapter's
     REPAIRED position (preserves monotonicity by construction) for the
     first (earliest) 45s cue window where >=2 distinct title words
     co-occur. That window's start time is the chapter's true position.
  3. Titles with <2 distinctive words, or no matching window anywhere
     forward, can't be confidently located — deferred to interpolation:
     proportional-by-original-spacing between the nearest located chapters
     before/after it (or the video's real end, for a trailing run with no
     located chapter after it).
  4. If a video ends up with <2 confidently-located chapters, it's
     UNREPAIRABLE — left completely UNCHANGED and reported, rather than
     interpolating blind between guesses.

A final monotonic + range safety clamp runs over every repaired video's
chapters (never lets a repaired `t` fall below the previous repaired `t`, or
exceed the video's real cue-extent) — belt-and-suspenders on top of the
forward-search invariant.

── Modes ────────────────────────────────────────────────────────────────────

--dry-run (default):
    Loads tools/taxonomy_out/videos_dump.json, validates, diagnoses a 10-video
    sample, repairs every broken video in memory, gates the repaired output
    (re-validates — must be 0 broken among repaired videos), writes
    tools/taxonomy_out/chapters_repaired.json (full per-video summary). NO
    network call.

--execute:
    Re-does the dry-run pipeline, then POSTs `{"chapters": [...]}` to
    `POST /api/education/videos/{id}/insights-store` for every video with
    status "repaired" (0.3s pacing + 5xx retry, mirrors
    tools/desk_transcript_gapfill.py's `process_one`/`_get` idioms; a 401/403
    is treated as systemic auth failure and aborts the rest of the batch).
    Then runs a read-only railway-ssh verification sample (10 ids) against
    live prod `/data/education.db`, and regenerates
    tools/taxonomy_out/chapters_index.json from the (successfully-posted)
    repaired data.

--verify:
    Standalone: re-runs just the railway-ssh sample verification against
    whatever is currently on prod (no POST). Useful to re-check later without
    re-running the whole repair.

Usage:
    python tools/desk_chapter_repair.py                 # dry-run
    python tools/desk_chapter_repair.py --execute        # the real thing
    python tools/desk_chapter_repair.py --verify          # re-check prod only
    python tools/desk_chapter_repair.py --diagnose-only   # just print the sample diagnosis
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import time
from collections import Counter

import requests
from dotenv import load_dotenv

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _ROOT)

MAIN_REPO_DIR = r"C:\Users\Patrick\uct-dashboard"
load_dotenv(os.path.join(MAIN_REPO_DIR, ".env"))

BASE = "https://uctintelligence.com"
HDRS = {
    "Authorization": f"Bearer {os.environ.get('PUSH_SECRET', '')}",
    # Cloudflare 1010-blocks non-browser User-Agents on uctintelligence.com.
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 desk-chapter-repair",
}

_OUT_DIR = os.path.join(_ROOT, "tools", "taxonomy_out")
_DUMP_PATH = os.path.join(_OUT_DIR, "videos_dump.json")
_REPAIRED_PATH = os.path.join(_OUT_DIR, "chapters_repaired.json")
_INDEX_PATH = os.path.join(_OUT_DIR, "chapters_index.json")

# Dead/degenerate rows per the taxonomy project's known findings — never
# validated or touched (id 29 = dead YT video; 157/158/268/285 = near-empty
# / bad session recordings with no usable transcript). 295 dump rows - these
# 5 = the 290 the ~129-broken finding is scoped to.
EXCLUDED_IDS = {29, 157, 158, 268, 285}

_OOB_CUSHION = 120       # seconds beyond the last transcript cue a chapter may still land on
_SWEEP_SLEEP = 0.3
_MATCH_WINDOW = 45       # seconds — cue window for fuzzy title-word co-occurrence
_MIN_MATCH_WORDS = 2     # spec: >=2 distinct title content-words must co-occur
_COMMON_WORD_FLOOR = 5       # a word appearing in more cues than this AND...
_COMMON_WORD_FRACTION = 0.006  # ...more than this fraction of all cues is filler
                              # ("like", "yeah", "trades", "chart" in a casual
                              # 60-90min trading conversation) — too common to
                              # localize anything, so it's dropped from the
                              # distinctive-word set even if it passed the
                              # static stopword/length filter.
_DIAGNOSE_SAMPLE = 10
_VERIFY_SAMPLE = 10

_STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "at", "for",
    "with", "this", "that", "these", "those", "is", "are", "was", "were",
    "be", "been", "being", "it", "its", "as", "by", "from", "into", "up",
    "down", "out", "over", "under", "again", "further", "then", "once",
    "here", "there", "when", "where", "why", "how", "all", "any", "both",
    "each", "few", "more", "most", "other", "some", "such", "no", "nor",
    "not", "only", "own", "same", "so", "than", "too", "very", "just",
    "don", "now", "vs", "about", "after", "before", "between", "during",
    "you", "your", "we", "our", "he", "she", "they", "them", "his", "her",
    "their", "what", "which", "who", "whom", "if", "because", "while",
    "against", "above", "below", "new", "using", "into", "onto", "off",
}

_TICKER_RE = re.compile(r"^[A-Z]{2,6}$")
_WORD_RE = re.compile(r"[A-Za-z0-9']+")


# ── Load + parse ─────────────────────────────────────────────────────────────

def load_dump(path: str = _DUMP_PATH) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return [v for v in data if v["id"] not in EXCLUDED_IDS]


def parse_chapters(v: dict) -> list[dict] | None:
    """Chapters are stored as a JSON *string* (or already a list, defensively).
    Empty/None -> no chapters at all (distinct from broken)."""
    ch = v.get("chapters")
    if not ch:
        return None
    if isinstance(ch, str):
        try:
            parsed = json.loads(ch)
        except (TypeError, ValueError):
            return None
    else:
        parsed = ch
    return parsed if parsed else None


def sorted_cues(v: dict) -> list[dict]:
    cues = v.get("transcript_cues") or []
    return sorted(cues, key=lambda c: c.get("t", 0))


def max_cue_t(cues: list[dict]) -> int:
    return max((c.get("t", 0) for c in cues), default=0)


# ── Validation (the gate this whole tool exists to satisfy) ────────────────

def validate_chapters(chapters: list[dict], cues: list[dict]) -> tuple[bool, str | None]:
    """Returns (is_broken, reason). A video's chapters are broken if any
    chapter t<0, t exceeds (last cue t + cushion), or is non-monotonic vs the
    previous chapter."""
    limit = max_cue_t(cues) + _OOB_CUSHION
    prev_t = None
    for i, ch in enumerate(chapters):
        t = ch.get("t")
        if t is None:
            return True, f"chapter[{i}] has no t"
        if t < 0:
            return True, f"chapter[{i}] t={t} < 0"
        if t > limit:
            return True, f"chapter[{i}] t={t} > limit={limit} (last_cue+{_OOB_CUSHION})"
        if prev_t is not None and t < prev_t:
            return True, f"chapter[{i}] t={t} < previous chapter t={prev_t} (non-monotonic)"
        prev_t = t
    return False, None


def classify_videos(videos: list[dict]) -> dict:
    """{'no_chapters': [ids], 'ok': [ids], 'broken': [(id, reason)]}"""
    out = {"no_chapters": [], "ok": [], "broken": []}
    for v in videos:
        chapters = parse_chapters(v)
        if chapters is None:
            out["no_chapters"].append(v["id"])
            continue
        cues = sorted_cues(v)
        is_broken, reason = validate_chapters(chapters, cues)
        (out["broken"].append((v["id"], reason)) if is_broken else out["ok"].append(v["id"]))
    return out


# ── Fuzzy title-word location ───────────────────────────────────────────────

def cue_word_freq(cues: list[dict]) -> Counter:
    """Per-video {word: number of distinct cues containing it} — the adaptive
    half of distinctiveness. A fixed stopword list can't anticipate every
    conversational filler ('like', 'yeah', 'trades', 'chart' show up
    constantly in a casual 60-90min trading conversation); this measures
    actual commonality within THIS video's transcript instead."""
    freq: Counter = Counter()
    for c in cues:
        words_in_cue = {w.lower() for w in _WORD_RE.findall(c.get("text", ""))}
        freq.update(words_in_cue)
    return freq


def distinctive_words(title: str, freq: Counter, num_cues: int) -> list[str]:
    """Distinctive content words from a chapter title (order-preserved,
    de-duped, lowercased for matching). ALL-CAPS 2-6 letter tokens (tickers/
    acronyms, e.g. 'AMD', 'BE', 'MU', 'IPO') always qualify regardless of
    length; other tokens qualify at length>=4 and not a stopword. Either way,
    a word that shows up in more than `_COMMON_WORD_FLOOR` AND more than
    `_COMMON_WORD_FRACTION` of this video's cues is too common to localize
    anything and is dropped."""
    common_cutoff = max(_COMMON_WORD_FLOOR, _COMMON_WORD_FRACTION * num_cues)
    seen: set[str] = set()
    out: list[str] = []
    for tok in _WORD_RE.findall(title):
        is_ticker = bool(_TICKER_RE.match(tok))
        low = tok.lower()
        if not is_ticker and (len(tok) < 4 or low in _STOPWORDS):
            continue
        if low in seen:
            continue
        if freq.get(low, 0) > common_cutoff:
            continue
        seen.add(low)
        out.append(low)
    return out


def locate_chapter(words: list[str], cues: list[dict], start_t: int, end_t: int) -> int | None:
    """First (earliest) `_MATCH_WINDOW`-second cue window, searching forward
    from `start_t` (inclusive) through `end_t`, where >=`_MIN_MATCH_WORDS`
    distinct words co-occur (case-insensitive, word-boundary). Returns the
    window's start timestamp, or None if no such window exists forward of
    start_t — i.e. this title can't be confidently located."""
    if len(words) < _MIN_MATCH_WORDS:
        return None
    patterns = [re.compile(r"\b" + re.escape(w) + r"\b", re.IGNORECASE) for w in words]
    candidates = [c for c in cues if start_t <= c.get("t", 0) <= end_t]
    n = len(candidates)
    for i in range(n):
        t0 = candidates[i]["t"]
        matched: set[int] = set()
        j = i
        while j < n and candidates[j]["t"] - t0 <= _MATCH_WINDOW:
            text = candidates[j].get("text", "")
            for wi, pat in enumerate(patterns):
                if wi not in matched and pat.search(text):
                    matched.add(wi)
            if len(matched) >= _MIN_MATCH_WORDS:
                return t0
            j += 1
    return None


# ── Interpolation ────────────────────────────────────────────────────────────

def _frac(oi, oa, ob, i, a, b) -> float:
    """Proportional-by-original-spacing fraction of oi between oa and ob,
    falling back to index-based spacing when the original values are
    degenerate (equal / missing)."""
    if oi is not None and oa is not None and ob is not None and ob != oa:
        f = (oi - oa) / (ob - oa)
    else:
        f = (i - a) / (b - a) if b != a else 0.0
    return min(max(f, 0.0), 1.0)


def interpolate_positions(n: int, located: list[int | None], orig_t: list) -> list[int | None]:
    """Fill every None slot in `located` by proportional-by-original-spacing
    interpolation between the nearest located neighbors (leading run
    proportions from 0, trailing run has no upper anchor here — caller clamps
    against the video's real end separately)."""
    located_idx = [i for i, p in enumerate(located) if p is not None]
    if not located_idx:
        return list(located)
    final: list[int | None] = list(located)

    first = located_idx[0]
    for i in range(first):
        f = _frac(orig_t[i], 0, orig_t[first], i, -1, first)
        final[i] = f * located[first]

    for a, b in zip(located_idx, located_idx[1:]):
        for i in range(a + 1, b):
            f = _frac(orig_t[i], orig_t[a], orig_t[b], i, a, b)
            final[i] = located[a] + f * (located[b] - located[a])

    return final


# ── Per-video repair ─────────────────────────────────────────────────────────

def repair_video(chapters: list[dict], cues: list[dict]) -> dict:
    """Attempt to repair one broken video's chapters. Returns a summary dict
    with status in {'repaired', 'unrepairable'} and always the full
    `chapters` list (repaired, or the untouched original when unrepairable)."""
    n = len(chapters)
    orig_t = [ch.get("t") for ch in chapters]
    end_t = max_cue_t(cues)
    freq = cue_word_freq(cues)
    num_cues = len(cues)

    located: list[int | None] = [None] * n
    cursor = 0
    for i, ch in enumerate(chapters):
        words = distinctive_words(ch.get("title") or "", freq, num_cues)
        pos = locate_chapter(words, cues, cursor, end_t)
        if pos is not None:
            located[i] = pos
            cursor = pos
    n_located = sum(1 for p in located if p is not None)

    if n_located < _MIN_MATCH_WORDS:
        return {
            "status": "unrepairable", "chapters": chapters, "n_chapters": n,
            "n_located": n_located, "n_interpolated": 0,
            "reason": f"only {n_located} of {n} chapters confidently located (<2)",
        }

    final = interpolate_positions(n, located, orig_t)

    # Trailing run past the last located chapter: anchor to the video's real
    # end (no located chapter exists after it to interpolate toward).
    located_idx = [i for i, p in enumerate(located) if p is not None]
    last = located_idx[-1]
    if last < n - 1:
        for i in range(last + 1, n):
            f = _frac(orig_t[i], orig_t[last], orig_t[n - 1], i, last, n - 1)
            final[i] = located[last] + f * (end_t - located[last])

    # Belt-and-suspenders: monotonic non-decreasing + in-range clamp.
    prev = 0
    chapter_status = []
    repaired_chapters = []
    for i, ch in enumerate(chapters):
        p = final[i] if final[i] is not None else prev
        p = max(prev, min(int(round(p)), end_t))
        prev = p
        repaired_chapters.append({**ch, "t": p})
        chapter_status.append("located" if located[i] is not None else "interpolated")

    return {
        "status": "repaired", "chapters": repaired_chapters, "n_chapters": n,
        "n_located": n_located, "n_interpolated": n - n_located,
        "chapter_status": chapter_status,
    }


# ── Diagnose (human-readable, run before ever repairing) ───────────────────

def diagnose_sample(videos_by_id: dict, broken: list[tuple], n: int = _DIAGNOSE_SAMPLE) -> None:
    print(f"\n=== DIAGNOSIS — sample of {min(n, len(broken))} broken videos ===")
    step = max(1, len(broken) // n)
    sample = broken[::step][:n]
    for vid, reason in sample:
        v = videos_by_id[vid]
        chapters = parse_chapters(v)
        cues = sorted_cues(v)
        end_t = max_cue_t(cues)
        limit = end_t + _OOB_CUSHION
        print(f"\n--- id={vid}  {v.get('title', '')!r}  cue-extent={end_t}s  limit={limit}s ---")
        print(f"  first broken reason: {reason}")
        prev_t = None
        for i, ch in enumerate(chapters):
            t = ch["t"]
            flags = []
            if t > limit:
                flags.append(f"OOB by {t - limit}s")
            if prev_t is not None and t < prev_t:
                flags.append("non-monotonic")
            flag_str = f"  <-- {', '.join(flags)}" if flags else ""
            print(f"    [{i:2d}] t={t:6d}  {ch['title'][:70]!r}{flag_str}")
            prev_t = t


# ── railway-ssh verification (mirrors tools/desk_taxonomy_dump.py's
#    _regen_command idiom: base64-encoded self-contained snippet, run via
#    `railway ssh --service web` from the MAIN repo dir where railway is
#    linked, read-only URI so it can never contend with a live app write) ──

def _verify_snippet(ids: list[int]) -> str:
    id_list = ",".join(str(i) for i in ids)
    return f"""
import json, sqlite3
con = sqlite3.connect("file:/data/education.db?mode=ro", uri=True, timeout=10)
con.row_factory = sqlite3.Row
ids = [{id_list}]
placeholders = ",".join("?" for _ in ids)
rows = con.execute("SELECT id, chapters FROM edu_videos WHERE id IN (" + placeholders + ")", ids).fetchall()
print(json.dumps([dict(r) for r in rows]))
con.close()
""".strip()


def verify_via_railway_ssh(ids: list[int]) -> list[dict] | None:
    """Read-only railway-ssh fetch of {id, chapters} for the given ids
    straight from live prod's /data/education.db. Returns the parsed row
    list, or None on any failure (printed loudly)."""
    if not ids:
        return []
    snippet = _verify_snippet(ids)
    b64 = base64.b64encode(snippet.encode("utf-8")).decode("ascii")
    remote = f"echo {b64} | base64 -d | /opt/venv/bin/python"
    cmd = f'railway ssh --service web "{remote}"'
    print(f"\n[verify] running from {MAIN_REPO_DIR} (railway is linked there):\n  {cmd}\n")
    try:
        proc = subprocess.run(cmd, shell=True, cwd=MAIN_REPO_DIR,
                               capture_output=True, text=True, timeout=120)
    except Exception as e:
        print(f"[verify] subprocess failed to launch: {e}")
        return None
    if proc.returncode != 0:
        print(f"[verify] railway ssh exited {proc.returncode}\n"
              f"--- stderr ---\n{proc.stderr[-3000:]}\n--- stdout ---\n{proc.stdout[-1000:]}")
        return None
    out = proc.stdout.strip()
    try:
        start = out.index("[")
        return json.loads(out[start:])
    except Exception as e:
        print(f"[verify] could not parse JSON from railway ssh stdout ({e}).\n"
              f"--- stdout (last 3000 chars) ---\n{out[-3000:]}")
        return None


# ── POST to prod ─────────────────────────────────────────────────────────────

class AuthFailure(Exception):
    """401/403 from insights-store — systemic (bad PUSH_SECRET breaks every
    video), so the caller aborts the rest of the batch."""


def post_chapters(video_id: int, chapters: list[dict]) -> int:
    """POST {"chapters": [...]} ONLY — never transcript/category/title (those
    fields are Optional[...]=None on the server and a None is never written,
    per education_service.set_video_insights's partial-update contract, but
    we still keep the payload minimal by convention/instruction). 5xx retried
    3x with backoff (mirrors desk_transcript_gapfill.process_one); 401/403
    raises AuthFailure (not retried — it means every remaining POST will fail
    the same way)."""
    body = {"chapters": chapters}
    r = None
    for attempt in range(3):
        try:
            r = requests.post(f"{BASE}/api/education/videos/{video_id}/insights-store",
                               headers=HDRS, json=body, timeout=60)
        except requests.RequestException as e:
            print(f"  id={video_id}: insights-store attempt {attempt + 1} raised "
                  f"({type(e).__name__}) — retrying")
            r = None
        else:
            if r.status_code in (401, 403):
                raise AuthFailure(f"insights-store returned {r.status_code} for id={video_id} "
                                   f"— PUSH_SECRET/auth is broken")
            if r.status_code < 500:
                break
        if attempt < 2:
            time.sleep(3 * (attempt + 1))
    return r.status_code if r is not None else -1


# ── Orchestration ────────────────────────────────────────────────────────────

def build_repair_plan(videos: list[dict]) -> dict:
    """Runs the full validate -> diagnose -> repair -> gate pipeline in
    memory. Returns the full plan dict (same shape written to
    chapters_repaired.json)."""
    videos_by_id = {v["id"]: v for v in videos}
    cls = classify_videos(videos)
    print(f"Loaded {len(videos)} videos (excluded {sorted(EXCLUDED_IDS)}).")
    print(f"  no_chapters={len(cls['no_chapters'])}  ok={len(cls['ok'])}  "
          f"broken={len(cls['broken'])}")

    diagnose_sample(videos_by_id, cls["broken"])

    print(f"\n=== REPAIRING {len(cls['broken'])} broken videos ===")
    result_videos: dict[str, dict] = {}
    n_repaired = n_unrepairable = n_located_total = n_interp_total = 0
    unrepairable_list: list[tuple] = []

    for vid in cls["no_chapters"]:
        v = videos_by_id[vid]
        result_videos[str(vid)] = {
            "status": "no_chapters", "youtube_id": v.get("youtube_id"),
            "title": v.get("title"), "chapters": [],
        }
    for vid in cls["ok"]:
        v = videos_by_id[vid]
        result_videos[str(vid)] = {
            "status": "ok", "youtube_id": v.get("youtube_id"), "title": v.get("title"),
            "chapters": parse_chapters(v),
        }
    for vid, reason in cls["broken"]:
        v = videos_by_id[vid]
        chapters = parse_chapters(v)
        cues = sorted_cues(v)
        summary = repair_video(chapters, cues)
        summary["youtube_id"] = v.get("youtube_id")
        summary["title"] = v.get("title")
        summary["broken_reason"] = reason
        summary["original_chapters"] = chapters
        result_videos[str(vid)] = summary
        if summary["status"] == "repaired":
            n_repaired += 1
            n_located_total += summary["n_located"]
            n_interp_total += summary["n_interpolated"]
        else:
            n_unrepairable += 1
            unrepairable_list.append((vid, summary["reason"]))

    print(f"  repaired={n_repaired}  unrepairable={n_unrepairable}  "
          f"(located_chapters={n_located_total}  interpolated_chapters={n_interp_total})")
    if unrepairable_list:
        print(f"  UNREPAIRABLE (left unchanged): {unrepairable_list}")

    # GATE (lesson_gate_that_cannot_fail): re-validate every repaired video's
    # OUTPUT chapters. 0 broken required, loud list + nonzero exit otherwise.
    # Also assert chapter count is preserved (never drop a chapter).
    gate_failures = []
    for vid_str, rec in result_videos.items():
        if rec["status"] != "repaired":
            continue
        vid = int(vid_str)
        v = videos_by_id[vid]
        cues = sorted_cues(v)
        is_broken, reason = validate_chapters(rec["chapters"], cues)
        if is_broken:
            gate_failures.append((vid, "still broken after repair: " + reason))
        orig_n = len(rec["original_chapters"])
        new_n = len(rec["chapters"])
        if orig_n != new_n:
            gate_failures.append((vid, f"chapter count changed {orig_n} -> {new_n}"))

    plan = {
        "generated_at": int(time.time()),
        "excluded_ids": sorted(EXCLUDED_IDS),
        "counts": {
            "total_videos": len(videos),
            "no_chapters": len(cls["no_chapters"]),
            "ok": len(cls["ok"]),
            "broken": len(cls["broken"]),
            "repaired": n_repaired,
            "unrepairable": n_unrepairable,
            "located_chapters": n_located_total,
            "interpolated_chapters": n_interp_total,
        },
        "unrepairable": unrepairable_list,
        "gate_failures": gate_failures,
        "videos": result_videos,
    }

    print(f"\n=== GATE ===")
    if gate_failures:
        print(f"GATE FAILED — {len(gate_failures)} repaired video(s) still broken or "
              f"changed chapter count:")
        for vid, why in gate_failures:
            print(f"  id={vid}: {why}")
    else:
        print(f"GATE PASSED — all {n_repaired} repaired videos: 0 broken, "
              f"chapter counts preserved.")

    return plan


def write_repair_plan(plan: dict, path: str = _REPAIRED_PATH) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(plan, f, indent=2)
    print(f"\nWrote {path}")


def regenerate_chapters_index(plan: dict, posted_ok_ids: set[int] | None, path: str = _INDEX_PATH) -> None:
    """{video_id_str: [{t, title}, ...]} for every non-excluded video — same
    shape as the existing chapters_index.json (290 keys, [] for no-chapters
    rows). Repaired videos contribute their NEW chapters only if the id is in
    `posted_ok_ids` (or posted_ok_ids is None, meaning 'trust the local plan
    as-is' — used when regenerating without having just executed a live
    POST pass)."""
    index: dict[str, list] = {}
    for vid_str, rec in plan["videos"].items():
        if rec["status"] == "repaired" and posted_ok_ids is not None and int(vid_str) not in posted_ok_ids:
            # POST failed/skipped for this one — prod still has the ORIGINAL
            # (broken) chapters, so the index must reflect that, not the
            # local repair we never actually shipped.
            index[vid_str] = rec["original_chapters"]
        else:
            index[vid_str] = rec["chapters"]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2)
    print(f"Wrote {path} ({len(index)} videos)")


def execute_posts(plan: dict, limit: int = 0) -> set[int]:
    repaired = [(int(vid_str), rec) for vid_str, rec in plan["videos"].items()
                if rec["status"] == "repaired"]
    if limit:
        repaired = repaired[:limit]
    print(f"\n=== EXECUTE — POSTing {len(repaired)} repaired videos to prod ===")
    if not os.environ.get("PUSH_SECRET"):
        print("PUSH_SECRET not set (checked env + C:\\Users\\Patrick\\uct-dashboard\\.env)")
        return set()
    ok_ids: set[int] = set()
    failed_ids: list[int] = []
    for i, (vid, rec) in enumerate(repaired):
        try:
            status = post_chapters(vid, rec["chapters"])
        except AuthFailure as e:
            print(f"  ABORTING BATCH — {e}")
            failed_ids.extend(v for v, _ in repaired[i:])
            break
        print(f"  id={vid} ({rec.get('youtube_id')}): chapters={len(rec['chapters'])} "
              f"located={rec['n_located']} interpolated={rec['n_interpolated']} POST={status}")
        if isinstance(status, int) and status < 300:
            ok_ids.add(vid)
        else:
            failed_ids.append(vid)
        time.sleep(_SWEEP_SLEEP)
    print(f"\n{len(ok_ids)} posted OK, {len(failed_ids)} failed: {failed_ids}")
    return ok_ids


def run_verification(plan: dict, posted_ok_ids: set[int], n: int = _VERIFY_SAMPLE) -> bool:
    videos_by_id_dump = {int(k): v for k, v in plan["videos"].items()}
    sample_ids = sorted(posted_ok_ids)[:n] if len(posted_ok_ids) > n else sorted(posted_ok_ids)
    if not sample_ids:
        print("[verify] nothing to verify (no successfully-posted ids).")
        return True
    print(f"\n=== VERIFY — sampling {len(sample_ids)} posted ids against live prod ===")
    rows = verify_via_railway_ssh(sample_ids)
    if rows is None:
        print("[verify] railway ssh verification FAILED to run — cannot confirm prod state.")
        return False
    rows_by_id = {r["id"]: r for r in rows}
    all_ok = True
    for vid in sample_ids:
        row = rows_by_id.get(vid)
        rec = videos_by_id_dump[vid]
        if row is None:
            print(f"  id={vid}: NOT FOUND on prod (unexpected)")
            all_ok = False
            continue
        try:
            live_chapters = json.loads(row["chapters"]) if row["chapters"] else []
        except (TypeError, ValueError):
            live_chapters = None
        expected = rec["chapters"]
        matches = live_chapters == expected
        max_t = max((c["t"] for c in live_chapters), default=None) if live_chapters else None
        print(f"  id={vid}: prod chapters match local repair = {matches}  "
              f"(n={len(live_chapters or [])}, max_t={max_t})")
        if not matches:
            all_ok = False
    print(f"\n[verify] {'ALL MATCH' if all_ok else 'MISMATCH DETECTED'} "
          f"({len(sample_ids)} sampled).")
    return all_ok


# ── CLI ───────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="default; explicit no-op flag")
    ap.add_argument("--execute", action="store_true", help="POST repaired chapters to prod")
    ap.add_argument("--verify", action="store_true",
                     help="standalone: railway-ssh sample-verify current prod state only")
    ap.add_argument("--diagnose-only", action="store_true", help="print the diagnosis sample and exit")
    ap.add_argument("--sample", type=int, default=_VERIFY_SAMPLE, help="verification sample size")
    ap.add_argument("--limit", type=int, default=0, help="cap how many videos --execute POSTs (0=all)")
    args = ap.parse_args()

    if args.verify and not args.execute:
        videos = load_dump()
        plan = json.load(open(_REPAIRED_PATH, encoding="utf-8")) if os.path.exists(_REPAIRED_PATH) else None
        if plan is None:
            print(f"{_REPAIRED_PATH} not found — run a --dry-run first.")
            return 1
        repaired_ids = {int(k) for k, r in plan["videos"].items() if r["status"] == "repaired"}
        ok = run_verification(plan, repaired_ids, n=args.sample)
        return 0 if ok else 1

    videos = load_dump()
    videos_by_id = {v["id"]: v for v in videos}

    if args.diagnose_only:
        cls = classify_videos(videos)
        diagnose_sample(videos_by_id, cls["broken"])
        return 0

    plan = build_repair_plan(videos)

    if plan["gate_failures"]:
        # Loud + nonzero exit — never proceed to write/execute on a failed gate.
        return 1

    write_repair_plan(plan)

    if not args.execute:
        print("\n(dry-run — no network calls made. Re-run with --execute to POST to prod.)")
        return 0

    ok_ids = execute_posts(plan, limit=args.limit)
    verify_ok = run_verification(plan, ok_ids, n=args.sample)
    regenerate_chapters_index(plan, ok_ids)

    repaired_total = plan["counts"]["repaired"]
    if len(ok_ids) < repaired_total:
        print(f"\n{repaired_total - len(ok_ids)} of {repaired_total} repaired videos did NOT "
              f"post successfully — see failed ids above.")
    return 0 if (verify_ok and len(ok_ids) == repaired_total) else 1


if __name__ == "__main__":
    sys.exit(main())
