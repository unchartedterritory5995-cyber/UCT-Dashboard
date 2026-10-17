"""Fetch captions for the #tsdr / #bracco YouTube-link lessons and send them in.

YouTube refuses captions to the web pod, but not to an ordinary connection, so
this runs on the operator's machine:

    PUSH_SECRET=... python tools/tsdr_link_transcripts.py [--base URL]

It asks the site which linked videos still lack a transcript, reads each one's
captions with youtube-transcript-api, and posts them back. The site rewrites
those lessons as full recaps on its next run (every 15 minutes). Safe to run
again: a video that already has a transcript is not listed.
"""
from __future__ import annotations

import argparse
import os
import sys

import httpx

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/141.0 Safari/537.36")   # Cloudflare refuses bare clients


def captions(video_id: str) -> str:
    from youtube_transcript_api import YouTubeTranscriptApi
    fetched = YouTubeTranscriptApi().fetch(video_id, languages=["en", "en-US"])
    return " ".join(str(getattr(s, "text", "") or "") for s in fetched).strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://uctintelligence.com")
    args = ap.parse_args()
    secret = os.environ.get("PUSH_SECRET", "")
    if not secret:
        print("PUSH_SECRET is not set")
        return 2
    headers = {"Authorization": f"Bearer {secret}", "User-Agent": UA}
    with httpx.Client(base_url=args.base, headers=headers, timeout=60.0) as c:
        r = c.get("/api/tsdr-lessons/links-needing-transcript")
        r.raise_for_status()
        videos = r.json()["videos"]
        print(f"{len(videos)} linked videos need a transcript")
        counts = {"sent": 0, "no captions": 0, "failed": 0}
        for v in videos:
            vid = v["video_id"]
            try:
                text = captions(vid)
            except Exception as e:  # noqa: BLE001 — a video with no captions is ordinary
                print(f"  {vid}: no captions ({type(e).__name__})")
                counts["no captions"] += 1
                continue
            resp = c.post("/api/tsdr-lessons/link-transcript",
                          json={"video_id": vid, "transcript": text})
            if resp.status_code == 200:
                print(f"  {vid}: {len(text.split())} words -> {resp.json()['result']}")
                counts["sent"] += 1
            else:
                print(f"  {vid}: site answered {resp.status_code}")
                counts["failed"] += 1
    print(counts)
    return 0 if counts["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
