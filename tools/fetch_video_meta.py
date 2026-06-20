"""Fetch duration (+ description) for every video in the two seed files via
yt-dlp, and write tools/_video_meta.json:  { youtube_id: {duration, description} }

duration -> "MM:SS" / "H:MM:SS" string for the card badge.
description -> cleaned first chunk (channel videos are description-blank in the
seed; we only use this to backfill those).

Run:  python tools/fetch_video_meta.py
"""
from __future__ import annotations

import json
import re
import subprocess
import sys

SEED_FILES = [
    "api/services/education_seed.py",
    "api/services/education_channel_seed.py",
    "api/services/education_extra_seed.py",  # Interviews + Mental Game tabs (may not exist yet)
]
ID_RE = re.compile(r'"youtube_id":\s*[\'"]([A-Za-z0-9_-]{11})[\'"]')


def collect_ids() -> list[str]:
    import os
    ids = []
    seen = set()
    for f in SEED_FILES:
        if not os.path.exists(f):
            continue
        with open(f, encoding="utf-8") as fh:
            for m in ID_RE.finditer(fh.read()):
                if m.group(1) not in seen:
                    seen.add(m.group(1))
                    ids.append(m.group(1))
    return ids


def fmt_duration(secs) -> str:
    try:
        s = int(secs)
    except (TypeError, ValueError):
        return ""
    if s <= 0:
        return ""
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"


def clean_desc(raw: str) -> str:
    if not raw:
        return ""
    # First non-empty paragraph, minus obvious promo/link-only lines.
    for para in raw.split("\n\n"):
        p = para.strip()
        low = p.lower()
        if not p:
            continue
        if low.startswith(("http", "discord", "join ", "subscribe")):
            continue
        return p[:280].strip()
    return ""


def main():
    ids = collect_ids()
    print(f"Fetching metadata for {len(ids)} videos via yt-dlp…")
    meta: dict[str, dict] = {}
    CHUNK = 40
    for i in range(0, len(ids), CHUNK):
        chunk = ids[i:i + CHUNK]
        urls = [f"https://www.youtube.com/watch?v={vid}" for vid in chunk]
        cmd = ["python", "-m", "yt_dlp", "--skip-download", "--no-warnings",
               "--ignore-errors", "--dump-json", *urls]
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
        for line in (proc.stdout or "").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                j = json.loads(line)
            except json.JSONDecodeError:
                continue
            vid = j.get("id")
            if not vid:
                continue
            meta[vid] = {
                "duration": fmt_duration(j.get("duration")),
                "description": clean_desc(j.get("description") or ""),
            }
        print(f"  {min(i + CHUNK, len(ids))}/{len(ids)} done ({len(meta)} resolved)")

    with open("tools/_video_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=1, ensure_ascii=False)
    got_dur = sum(1 for v in meta.values() if v["duration"])
    print(f"Wrote tools/_video_meta.json: {len(meta)} videos, {got_dur} with duration")
    missing = [v for v in ids if v not in meta]
    if missing:
        print(f"Unresolved ({len(missing)}): {', '.join(missing[:10])}{'…' if len(missing) > 10 else ''}")


if __name__ == "__main__":
    main()
