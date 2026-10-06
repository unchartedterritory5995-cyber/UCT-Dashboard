"""Rewrite the Join link in already-uploaded Desk video descriptions.

New uploads carry the tracked Whop link (`desk_daily_session.JOIN_URL`). Every
video published before 2026-10-05 carries the untracked legacy link
(`desk_daily_session.LEGACY_JOIN_URL`). This swaps exactly that URL and nothing
else, through the same `videos.update` path `refresh_description` uses
(`YouTubeClient.update_description`, which reads the current snippet and patches
only the description).

⛔ It is a TEXT SWAP of the current live description, never a recompose. The
back catalog's descriptions carry chapter titles written by hand or by the local
polish job (uct-recaps/desk_insights_polish.py); recomposing from the DB would
throw those away. A description that does not contain the legacy link is left
untouched.

Guarded twice, and DRY-RUN BY DEFAULT:
  * nothing is written unless `apply=True` (CLI: `--apply`);
  * an apply also requires DESK_SESSION_DESCRIPTION_CHAPTERS, the flag that
    gates every other videos.update in this pipeline, so clearing it stops a
    sweep in flight (re-checked per video).

CLI (run where the education DB lives, i.e. on the web pod):
    python -m api.services.desk_footer_link_backfill              # dry run
    python -m api.services.desk_footer_link_backfill --limit 3    # dry run, 3 videos
    python -m api.services.desk_footer_link_backfill --apply      # writes
"""
from __future__ import annotations

import argparse
import json
import re
import time

from api.services import desk_daily_session as dds

# The legacy URL exactly, not as a prefix of something longer.
_LEGACY_RE = re.compile(re.escape(dds.LEGACY_JOIN_URL) + r"(?![\w/.-])")


def rewrite_footer_link(description: str | None) -> str | None:
    """The description with every legacy Join link swapped for the tracked
    one, or None when there is nothing to change."""
    text = str(description or "")
    if not _LEGACY_RE.search(text):
        return None
    return _LEGACY_RE.sub(dds.JOIN_URL, text)


def candidate_videos() -> list[dict]:
    """Show-kind Desk videos that have a YouTube id, newest first. The show
    list is the category registry (edu_categories.kind), never a typed list."""
    from api.services import education_service
    shows = {c["name"] for c in education_service.list_category_meta()
             if c.get("kind") == "show"}
    return [v for v in education_service.list_video_creative_stubs()
            if (v.get("youtube_id") or "").strip() and v.get("category") in shows]


def run(*, apply: bool = False, limit: int | None = None, youtube=None,
        videos: list[dict] | None = None, sleep_secs: float = 1.0) -> dict:
    """Sweep the back catalog. Dry run unless `apply`. Never raises per video.

    Returns {"mode", "checked", "would_update"|"updated", "unchanged",
    "errors", "rows": [{youtube_id, title, outcome}]}.
    """
    if apply and not dds.chapters_description_enabled():
        return {"mode": "apply", "refused":
                "DESK_SESSION_DESCRIPTION_CHAPTERS is off; nothing written"}
    todo = list(videos if videos is not None else candidate_videos())
    if limit is not None:
        todo = todo[:max(0, int(limit))]
    if youtube is None:
        from api.services.youtube_client import YouTubeClient
        youtube = YouTubeClient()
    changed_key = "updated" if apply else "would_update"
    out = {"mode": "apply" if apply else "dry-run", "checked": 0,
           changed_key: 0, "unchanged": 0, "errors": 0, "rows": []}
    for v in todo:
        yid = (v.get("youtube_id") or "").strip()
        if apply and not dds.chapters_description_enabled():
            out["stopped"] = "DESK_SESSION_DESCRIPTION_CHAPTERS turned off"
            break
        out["checked"] += 1
        try:
            snippet = youtube.get_video_snippet(yid)
            new = rewrite_footer_link(snippet.get("description"))
            if new is None:
                outcome = "unchanged"
            elif not apply:
                outcome = changed_key
            else:
                youtube.update_description(yid, new)
                outcome = changed_key
        except Exception as e:  # noqa: BLE001 — one bad video never stops the sweep
            outcome = "errors"
            out["rows"].append({"youtube_id": yid, "title": v.get("title"),
                                "outcome": f"error: {type(e).__name__}: {e}"[:200]})
        else:
            out["rows"].append({"youtube_id": yid, "title": v.get("title"),
                                "outcome": outcome})
        out[outcome] += 1
        if apply and sleep_secs:
            time.sleep(sleep_secs)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--apply", action="store_true",
                    help="write to YouTube (default is a dry run that writes nothing)")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args(argv)
    result = run(apply=args.apply, limit=args.limit)
    print(json.dumps(result, indent=1, ensure_ascii=False))
    return 0 if not result.get("refused") and not result.get("errors") else 1


if __name__ == "__main__":   # pragma: no cover
    raise SystemExit(main())
