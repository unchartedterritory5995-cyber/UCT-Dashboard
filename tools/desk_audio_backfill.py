"""One-time LOCAL backfill of background-audio for the existing DESK library.

For every edu_videos row missing audio_url, pull audio from our own YouTube
upload via yt-dlp, transcode to 96k AAC, upload to R2, and stamp set_audio.
Run on the owner's PC (NOT Railway) so YouTube doesn't rate-limit the pod, and
so yt-dlp never becomes a prod dependency.

Prereqs (local only): `pip install yt-dlp`, ffmpeg on PATH, and the DATA_SYNC_*
+ EDUCATION_DB_PATH env vars pointed at prod R2 + a local copy of education.db.

Usage:
  python tools/desk_audio_backfill.py --dry-run          # list what WOULD run
  python tools/desk_audio_backfill.py --limit 10         # do 10 (resumable)
  python tools/desk_audio_backfill.py                    # do all missing
"""
import argparse, os, subprocess, sys, tempfile, time

from api.services import education_service, data_sync, desk_background_audio


def _missing():
    return [v for v in education_service.list_videos() if not v.get("audio_url")]


def _pull_and_store(youtube_id):
    tmp_dir = tempfile.mkdtemp()
    src = os.path.join(tmp_dir, f"{youtube_id}.m4a")
    # yt-dlp: bestaudio -> m4a (our own unlisted/owned upload)
    dl = subprocess.run(
        ["yt-dlp", "-f", "bestaudio", "-x", "--audio-format", "m4a",
         "-o", os.path.join(tmp_dir, f"{youtube_id}.%(ext)s"),
         f"https://www.youtube.com/watch?v={youtube_id}"],
        capture_output=True,
    )
    if dl.returncode != 0 or not os.path.exists(src):
        print(f"  ! yt-dlp failed for {youtube_id}: {dl.stderr.decode()[:200]}")
        return None
    # Re-encode to the exact pipeline format + upload via the shared module.
    return desk_background_audio.extract_and_store(src, youtube_id)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    education_service._init_db()
    todo = _missing()
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(todo)} videos missing audio")
    if args.dry_run:
        for v in todo:
            print(f"  would backfill {v['youtube_id']}  ({v['title']})")
        return 0

    ok = 0
    for i, v in enumerate(todo, 1):
        yid = v["youtube_id"]
        print(f"[{i}/{len(todo)}] {yid} …")
        key = _pull_and_store(yid)
        if key:
            education_service.set_audio(v["id"], key)
            ok += 1
            print(f"  ✓ {key}")
        time.sleep(2)  # be polite to YouTube
    print(f"done: {ok}/{len(todo)} backfilled")
    return 0


if __name__ == "__main__":
    sys.exit(main())
