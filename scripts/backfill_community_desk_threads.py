# scripts/backfill_community_desk_threads.py
"""One-shot: seed Mentor Desk threads for recent Desk session videos.

Run ON THE RAILWAY WEB POD (the DBs live on its /data volume):
  railway ssh --service web -- /opt/venv/bin/python scripts/backfill_community_desk_threads.py --days 14
(Plain `python3` on the pod is Nix system python without app deps — always /opt/venv/bin/python.)
"""
import argparse
import sys
import time

sys.path.insert(0, ".")

from api.services import community_seed, community_store, education_service


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    community_store._init_db()
    cutoff = int(time.time()) - args.days * 86400
    videos = [v for v in education_service.list_videos()
              if (v.get("created_at") or 0) >= cutoff and v.get("meeting_uuid")]
    print(f"{len(videos)} session videos in the last {args.days} days")
    for v in videos:
        if args.dry_run:
            print(f"would seed: [{v['id']}] {v['title']}")
            continue
        tid = community_seed.upsert_desk_thread(v["id"])
        print(f"seeded: [{v['id']}] {v['title']} -> thread {tid}")


if __name__ == "__main__":
    main()
