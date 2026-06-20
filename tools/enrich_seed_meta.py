"""Backfill `duration` (and channel-video `description`) into the seed files from
tools/_video_meta.json. Re-emits each file preserving its module docstring header.

Run:  python tools/enrich_seed_meta.py
"""
from __future__ import annotations

import json

TARGETS = [
    ("api/services/education_seed.py", "SEED_VIDEOS", False),
    ("api/services/education_channel_seed.py", "SEED_VIDEOS_CHANNEL", True),
    ("api/services/education_extra_seed.py", "SEED_VIDEOS_EXTRA", False),
]


def load_list(path: str, var: str) -> list[dict]:
    ns: dict = {}
    with open(path, encoding="utf-8") as f:
        exec(compile(f.read(), path, "exec"), ns)  # seed files are pure data
    return ns[var]


def header(path: str, var: str) -> str:
    with open(path, encoding="utf-8") as f:
        text = f.read()
    marker = f"{var}: list[dict] = ["
    idx = text.index(marker)
    return text[:idx]


def emit(path: str, var: str, head: str, videos: list[dict]) -> None:
    lines = [head.rstrip("\n"), "", f"{var}: list[dict] = ["]
    for v in videos:
        lines.append("    {")
        lines.append(f"        \"youtube_id\": {v['youtube_id']!r},")
        lines.append(f"        \"title\": {v['title']!r},")
        lines.append(f"        \"description\": {v.get('description', '') !r},")
        lines.append(f"        \"category\": {v['category']!r},")
        lines.append(f"        \"duration\": {v.get('duration', '') !r},")
        lines.append(f"        \"sort_order\": {v.get('sort_order', 0)},")
        lines.append("    },")
    lines.append("]")
    lines.append("")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def main():
    with open("tools/_video_meta.json", encoding="utf-8") as f:
        meta = json.load(f)

    import os
    for path, var, allow_desc in TARGETS:
        if not os.path.exists(path):
            continue
        videos = load_list(path, var)
        filled_dur = filled_desc = 0
        for v in videos:
            m = meta.get(v["youtube_id"])
            if not m:
                continue
            if m.get("duration") and not v.get("duration"):
                v["duration"] = m["duration"]
                filled_dur += 1
            if allow_desc and m.get("description") and not (v.get("description") or "").strip():
                v["description"] = m["description"]
                filled_desc += 1
        emit(path, var, header(path, var), videos)
        print(f"{path}: +{filled_dur} durations, +{filled_desc} descriptions ({len(videos)} videos)")


if __name__ == "__main__":
    main()
