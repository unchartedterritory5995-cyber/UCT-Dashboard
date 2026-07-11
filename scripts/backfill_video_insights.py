"""Library-wide insights backfill for The Desk → Videos.

Gives EVERY educational/library video the same rich zones as the Zoom Live
Sessions (chapters / key takeaways / tickers / searchable transcript) by:
  1. GET the work-list of videos lacking chapters from prod,
  2. fetching each video's YouTube captions (LOCALLY — YouTube blocks caption
     scraping from cloud IPs, so this can't run on Railway),
  3. running the SAME Opus pipeline (`generate_insights`) the Zoom sessions use,
  4. POSTing the generated insights back to prod for storage.

Idempotent: a stored video gains chapters → drops off the work-list, so re-runs
only pick up new/failed videos. Run from the repo root with the backend env:

    python scripts/backfill_video_insights.py            # whole library
    python scripts/backfill_video_insights.py 3          # first 3 only (smoke test)
    python scripts/backfill_video_insights.py 3 --base http://localhost:8000
"""
from __future__ import annotations

import os
import sys
import time

import requests

# Windows consoles default to cp1252 and choke on the ✓ / — glyphs we log.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# ── repo root on path + load backend env (ANTHROPIC_API_KEY, PUSH_SECRET) ────────
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _ROOT)
for _envpath in (os.path.join(_ROOT, ".env"), r"C:\Users\Patrick\uct-dashboard\.env"):
    if os.path.exists(_envpath):
        for _line in open(_envpath, encoding="utf-8"):
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _v = _line.split("=", 1)
                os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))
        break

from youtube_transcript_api import YouTubeTranscriptApi  # noqa: E402
from api.services.desk_session_insights import generate_insights, _timestamped_block  # noqa: E402

BASE = "https://uctintelligence.com"
if "--base" in sys.argv:
    BASE = sys.argv[sys.argv.index("--base") + 1]
LIMIT = next((int(a) for a in sys.argv[1:] if a.isdigit()), None)
SECRET = os.environ.get("PUSH_SECRET", "")
# Cloudflare 1010-blocks non-browser UAs to uctintelligence.com.
HEADERS = {
    "Authorization": f"Bearer {SECRET}",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 uct-backfill",
}
_yt = YouTubeTranscriptApi()


def fetch_cues(youtube_id: str):
    """[{t, text}] from YouTube captions, or None if unavailable/blocked."""
    try:
        fetched = _yt.fetch(youtube_id, languages=["en", "en-US", "en-GB"])
    except Exception as e:  # TranscriptsDisabled / NoTranscriptFound / IP block / etc.
        print(f"    no captions ({type(e).__name__})")
        return None
    cues = []
    for s in fetched:
        txt = (s.text or "").replace("\n", " ").strip()
        if txt:
            cues.append({"t": int(s.start), "text": txt})
    return cues or None


def main():
    r = requests.get(f"{BASE}/api/education/insights-backfill/pending?limit=2000",
                     headers=HEADERS, timeout=30)
    r.raise_for_status()
    vids = r.json()["videos"]
    if LIMIT:
        vids = vids[:LIMIT]
    print(f"{len(vids)} videos to process\n")

    done = skipped = failed = 0
    for i, v in enumerate(vids, 1):
        vid, yt, title = v["id"], v["youtube_id"], (v["title"] or "")
        print(f"[{i}/{len(vids)}] {yt} — {title[:64]}")
        cues = fetch_cues(yt)
        if not cues:
            skipped += 1
            continue
        # Opus occasionally emits slightly malformed JSON — retry (nondeterministic).
        ins, gen_err = None, None
        for _attempt in range(3):
            try:
                ins = generate_insights(title, cues)
                break
            except Exception as e:
                gen_err = e
                time.sleep(2)
        if ins is None:
            print(f"    generate failed ({type(gen_err).__name__}: {str(gen_err)[:120]})")
            failed += 1
            continue
        if not ins.get("chapters"):
            print("    no chapters produced — skip")
            skipped += 1
            continue
        payload = {
            "transcript": _timestamped_block(cues),
            "chapters": ins["chapters"],
            "ticker_moments": ins["ticker_moments"],
            "headline": ins.get("headline", ""),
            "summary": ins.get("summary", []),
        }
        try:
            pr = requests.post(f"{BASE}/api/education/videos/{vid}/insights-store",
                               json=payload, headers=HEADERS, timeout=30)
        except Exception as e:
            print(f"    store request failed ({type(e).__name__})")
            failed += 1
            continue
        if pr.ok:
            print(f"    ✓ {len(ins['chapters'])} chapters · {len(ins['ticker_moments'])} tickers · "
                  f"{len(cues)} cues")
            done += 1
        else:
            print(f"    store HTTP {pr.status_code}: {pr.text[:160]}")
            failed += 1
        time.sleep(1.2)  # polite to YouTube + Anthropic

    print(f"\nDONE — {done} enriched · {skipped} no-captions · {failed} failed")


if __name__ == "__main__":
    main()
