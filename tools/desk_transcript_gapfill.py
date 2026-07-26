"""Gap-fill transcripts for Desk videos with no stored transcript.

Enumerates gaps by sweeping /transcript-cues across ALL candidate ids (the
insights-backfill/pending endpoint only lists videos lacking CHAPTERS, which
misses a real edge case: a live-session video whose Zoom AI-summary supplied
chapters but whose Zoom transcript VTT never arrived before max-wait, so
`chapters` got stored while `transcript` stayed NULL — invisible to
pending/needs-posters/needs-setups alike, see resolve_video_map() below).
Audio comes straight from R2 (desk_audio/<yt>.m4a, backfilled 7/25); whisper
runs locally on CPU.

id -> youtube_id resolution is LIVE-PROD-ONLY (never the local
C:\\data\\education.db copy) — a spot-check found that file's `id` column
does NOT line up with prod's current ids for a majority of rows (e.g. local
id=60 is a completely different video from prod's live id=60), almost
certainly because it's an independently-seeded local/dev copy rather than a
downloaded snapshot of the Railway volume. Trusting it would risk writing a
freshly-transcribed audio track onto the WRONG video's record. A gap id with
no youtube_id resolvable from any LIVE endpoint is reported and skipped
(never guessed).

Usage:  python tools/desk_transcript_gapfill.py [--dry-run] [--limit N] [--ids 60,267]
"""
import argparse
import os
import sys
import tempfile
import time

import requests
from dotenv import load_dotenv

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _ROOT)
load_dotenv(os.path.join(r"C:\Users\Patrick\uct-dashboard", ".env"))

BASE = "https://uctintelligence.com"
HDRS = {
    "Authorization": f"Bearer {os.environ.get('PUSH_SECRET', '')}",
    # Cloudflare 1010-blocks non-browser User-Agents on uctintelligence.com.
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 desk-gapfill",
}

# Cushion above the highest id any live listing endpoint reports. Kept at 0:
# transcript-cues never 404s (empty cues for a nonexistent id look identical
# to a real gap), so any cushion here manufactures phantom "gap" ids beyond
# the real max. This is safe to leave at 0 — the one edge case a cushion
# could help with (a video whose chapters came from Zoom's summary but whose
# transcript never arrived) can only occur >=24h after creation
# (DESK_SESSION_TRANSCRIPT_MAX_WAIT_HRS, default 24 in desk_session_insights),
# and ANY video that young still lacks chapters entirely, so it already
# shows up in /insights-backfill/pending and extends id_map's own max — no
# cushion needed for correctness.
_PROBE_CUSHION = 0
_SWEEP_SLEEP = 0.15


class AuthFailure(Exception):
    """Raised when insights-store returns 401/403. Auth is SYSTEMIC (one
    broken PUSH_SECRET breaks every video, not just this one) — the caller
    aborts the rest of the batch instead of burning CPU transcribing 20 more
    videos that are all going to fail the same way."""


def _get(path: str, **params):
    """GET with a short retry — a live sweep of ~300 sequential requests hits
    the occasional transient 502/network blip; without a retry, that id
    silently drops out of the sweep entirely (looks identical to 'checked,
    not a gap' in the printed list) rather than actually being re-checked."""
    last_err = None
    for attempt in range(3):
        try:
            r = requests.get(f"{BASE}/api/education{path}", headers=HDRS,
                             params=params, timeout=30)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last_err = e
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
    raise last_err


def resolve_video_map() -> dict:
    """{id: {"youtube_id":..., "title":...}} merged from every LIVE
    PUSH_SECRET work-list endpoint prod exposes. This is a best-effort UNION,
    not a full video listing (no such PUSH_SECRET endpoint exists) — it
    covers:
      - pending           : chapters not yet generated
      - needs-posters     : has chapters, no poster yet
      - needs-setups      : has chapters + transcript, no setup tags yet
    A video whose chapters came from Zoom's own AI summary but whose
    transcript never arrived (chapters set, transcript NULL, poster usually
    already set too) is invisible to all three — such an id will show up as
    a gap (empty /transcript-cues) but with no resolvable youtube_id here.
    As of 2026-07-25 the known members of this class are 267/273/276/286 —
    `--ids 267` (etc.) against any of them silently no-ops (prints under
    UNRESOLVED) rather than guessing a youtube_id from the untrusted local DB.

    NOTE: id -> youtube_id is deliberately NOT sourced from the local
    C:\\data\\education.db copy — a spot-check found its `id` column doesn't
    line up with prod's live ids for most rows (e.g. local id=60 is an
    entirely different video than prod's live id=60), so trusting it risks
    writing a transcript onto the wrong video. Only live prod data is used.
    """
    m: dict[int, dict] = {}
    for path in ("/insights-backfill/pending", "/insights-backfill/needs-posters",
                 "/insights-backfill/needs-setups"):
        try:
            data = _get(path, limit=2000)
        except Exception as e:
            print(f"  ! {path} fetch failed (non-fatal): {e}")
            continue
        for v in data.get("videos", []):
            vid, yt = v.get("id"), v.get("youtube_id")
            if vid and yt:
                m[int(vid)] = {"youtube_id": yt, "title": v.get("title") or ""}
    return m


def transcript_cues_empty(video_id: int) -> bool:
    data = _get(f"/videos/{video_id}/transcript-cues")
    return not (data.get("cues") or [])


def gap_ids(id_map: dict):
    """Sweep every candidate id (1 .. highest known id + cushion) for an empty
    stored transcript. Returns (resolved, unresolved, failed_probe):
      resolved     -> [(id, youtube_id, title), ...] ready to process
      unresolved   -> [id, ...] confirmed empty transcript but no live-resolved
                      youtube_id (skipped — see resolve_video_map docstring)
      failed_probe -> [id, ...] the /transcript-cues check itself never
                      succeeded (even after _get's retries) — NOT known to be
                      a gap or not; re-run to actually check these
    """
    hi = (max(id_map) if id_map else 0) + _PROBE_CUSHION
    resolved, unresolved, failed_probe = [], [], []
    for vid in range(1, hi + 1):
        try:
            empty = transcript_cues_empty(vid)
        except Exception as e:
            print(f"  ! transcript-cues probe failed for id={vid} after retries "
                  f"(non-fatal, re-run to check it): {e}")
            failed_probe.append(vid)
            continue
        if empty:
            info = id_map.get(vid)
            (resolved.append((vid, info["youtube_id"], info["title"]))
             if info else unresolved.append(vid))
        time.sleep(_SWEEP_SLEEP)
    return resolved, unresolved, failed_probe


def fetch_audio(yt: str, dest: str) -> bool:
    """Download the backfilled R2 audio for a youtube_id straight from R2
    (never via the paid-cookie-gated /videos/{id}/audio redirect). Uses
    data_sync's real functions (object_exists / presigned_get) + the shared
    R2 key convention from desk_background_audio.audio_key."""
    from api.services import data_sync, desk_background_audio
    key = desk_background_audio.audio_key(yt)
    if not data_sync.object_exists(key):
        return False
    url = data_sync.presigned_get(key, expires=3600)
    if not url:
        return False
    with requests.get(url, stream=True, timeout=300) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    return True


def load_whisper_model():
    """Load the whisper model ONCE for the whole batch. Instantiating
    WhisperModel per video (the original skeleton) reloads weights from disk
    on every single one of the ~20 videos — wasted work that only gets worse
    the longer the unattended run goes."""
    from faster_whisper import WhisperModel
    return WhisperModel("base.en", device="cpu", compute_type="int8")


def transcribe(model, path: str) -> list[dict]:
    segments, _info = model.transcribe(path, word_timestamps=False, vad_filter=True)
    return [{"t": int(seg.start), "text": seg.text.strip()} for seg in segments if seg.text.strip()]


def process_one(vid: int, yt: str, title: str, model) -> bool:
    """Process one gap video end-to-end. Returns True iff the transcript was
    successfully stored (POST < 300). Never raises for a per-video failure
    (dropped R2 stream, corrupt audio, a bad whisper decode, generate_insights
    erroring) — those are caught here, printed, and reported as a skip so one
    bad video can't kill an unattended multi-video run. AuthFailure is the
    one exception that's meant to propagate: a 401/403 is systemic, not
    per-video, and the caller should stop the batch rather than keep going."""
    from api.services.desk_session_insights import _timestamped_block, generate_insights

    with tempfile.TemporaryDirectory() as td:
        m4a = os.path.join(td, "a.m4a")

        try:
            got_audio = fetch_audio(yt, m4a)
        except Exception as e:
            print(f"  id={vid} ({yt}): fetch_audio raised ({type(e).__name__}: "
                  f"{str(e)[:160]}) — skip")
            return False
        if not got_audio:
            print(f"  id={vid} ({yt}): NO R2 AUDIO — skip (yt-dlp fallback needed)")
            return False

        try:
            cues = transcribe(model, m4a)
        except Exception as e:
            print(f"  id={vid} ({yt}): whisper transcribe raised ({type(e).__name__}: "
                  f"{str(e)[:160]}) — skip")
            return False
        if not cues:
            print(f"  id={vid} ({yt}): whisper produced no cues — skip")
            return False

        # Mirrors api.services.desk_session_insights._timestamped_block exactly
        # (same function, imported directly) — the "[h:mm:ss] text" block form
        # that _parse_timestamped_block can recover cues from later, 600k cap.
        block = _timestamped_block(cues)

        try:
            ins = generate_insights(title, cues) or {}
        except Exception as e:
            print(f"  id={vid} ({yt}): generate_insights failed ({type(e).__name__}: "
                  f"{str(e)[:120]}) — storing transcript alone")
            ins = {}

        # Mirrors scripts/backfill_video_insights.py's payload shape exactly —
        # ticker_moments is part of the SAME generate_insights() call and the
        # SAME insights-store body there. Without it, chip data is gone for
        # good: these are old library videos with no meeting_uuid, so they
        # can never enter the meeting_uuid-gated ticker-backfill loop later.
        body = {
            "transcript": block,
            "chapters": ins.get("chapters") or [],
            "ticker_moments": ins.get("ticker_moments") or [],
            "headline": ins.get("headline") or "",
            "summary": ins.get("summary") or [],
        }
        # insights-store is the load-bearing write — prod has shown transient
        # 502s during this sweep, and losing the store after a full local
        # whisper transcribe (minutes of CPU work) would be an expensive
        # silent loss, so retry a few times before giving up. A 401/403 is
        # NOT retried — it means PUSH_SECRET/auth is broken for every video,
        # not just this one, so we raise and let the caller stop the batch.
        r = None
        for attempt in range(3):
            try:
                r = requests.post(f"{BASE}/api/education/videos/{vid}/insights-store",
                                  headers=HDRS, json=body, timeout=60)
            except requests.RequestException as e:
                print(f"  id={vid} ({yt}): insights-store attempt {attempt + 1} "
                      f"raised ({type(e).__name__}) — retrying")
                r = None
            else:
                if r.status_code in (401, 403):
                    raise AuthFailure(
                        f"insights-store returned {r.status_code} for id={vid} "
                        f"({yt}) — PUSH_SECRET/auth is broken"
                    )
                if r.status_code < 500:
                    break
            if attempt < 2:
                time.sleep(3 * (attempt + 1))
        status = r.status_code if r is not None else "EXCEPTION"
        print(f"  id={vid} ({yt}): cues={len(cues)} chapters={len(body['chapters'])} "
              f"POST={status}")
        return isinstance(status, int) and status < 300


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--ids", default="", help="comma-separated video ids, e.g. 60,267")
    args = ap.parse_args()

    if not os.environ.get("PUSH_SECRET"):
        print("PUSH_SECRET not set (checked env + C:\\Users\\Patrick\\uct-dashboard\\.env)")
        return 1

    id_map = resolve_video_map()
    failed_probe = []
    if args.ids:
        ids = [int(i) for i in args.ids.split(",") if i.strip()]
        targets, unresolved = [], []
        for vid in ids:
            info = id_map.get(vid)
            (targets.append((vid, info["youtube_id"], info["title"]))
             if info else unresolved.append(vid))
    else:
        targets, unresolved, failed_probe = gap_ids(id_map)

    if args.limit:
        targets = targets[: args.limit]

    print(f"{len(targets) + len(unresolved)} gap videos "
          f"({len(targets)} resolved, {len(unresolved)} unresolved): "
          f"{[t[0] for t in targets] + unresolved}")
    if unresolved:
        print(f"  UNRESOLVED (empty transcript, no live-endpoint youtube_id — "
              f"see module docstring): {unresolved}")
    if failed_probe:
        print(f"  FAILED PROBE (never got a clean answer, re-run to check): {failed_probe}")

    if args.dry_run:
        return 0

    model = load_whisper_model()  # once for the whole batch, not per video
    failed_ids = []
    for i, (vid, yt, title) in enumerate(targets):
        try:
            if not process_one(vid, yt, title, model):
                failed_ids.append(vid)
        except AuthFailure as e:
            # Systemic — every remaining video would fail the same way.
            # Stop burning CPU transcribing them; report them all as failed.
            print(f"  ABORTING BATCH — {e}")
            failed_ids.extend(t[0] for t in targets[i:])
            break
        except Exception as e:
            print(f"  id={vid} ({yt}): UNEXPECTED ERROR ({type(e).__name__}: "
                  f"{str(e)[:200]}) — skipping, continuing batch")
            failed_ids.append(vid)

    if failed_ids:
        print(f"\n{len(failed_ids)} failed / skipped: {failed_ids}")
    else:
        print(f"\nall {len(targets)} processed cleanly")

    return 0


if __name__ == "__main__":
    sys.exit(main())
