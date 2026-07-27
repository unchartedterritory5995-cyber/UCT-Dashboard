"""Convert curriculum_final_v2.json into a paths-apply payload of DRAFT courses.

The whole curriculum lands in the product as unpublished (enabled=0) paths —
visible only to admins, populated over time via the PathView editor's
planned-lesson slots — while the six live member paths stay untouched. Gap
lessons (video_id null) become planned_title placeholder rows; recorded
lessons resolve video_id → youtube_id against the prod dump and carry their
chapter_note as the teaching note plus a parsed "Watch from" start_seconds.

Slug rules: every emitted slug must be NEW (no collision with the live seeded
six) — EXCEPT the deliberate rename 'options-flow' → 'options-flow-v2' (the
audit verdict for that path was rebuild-not-merge; the owner enables v2 and
retires the old path whenever it's ready).

Usage (from the worktree root):
    python tools/desk_curriculum_to_paths.py            # build + validate
    python tools/desk_curriculum_to_paths.py --execute  # POST to prod paths-apply
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TOUT = os.path.join(HERE, "taxonomy_out")
CUR = os.path.join(TOUT, "curriculum_final_v2.json")
DUMP = os.path.join(TOUT, "videos_dump.json")
OUT = os.path.join(TOUT, "curriculum_paths_payload.json")

# The live member-facing slugs (education_paths_seed.py) — never overwritten.
LIVE_SLUGS = {"foundations", "risk", "reading-market", "setups-playbook",
              "options-flow", "mental-game-s1"}
SLUG_RENAMES = {"options-flow": "options-flow-v2"}

# First "Watch from H:MM:SS" / "Watch from MM:SS" in a chapter note → seconds.
_WATCH_RE = re.compile(r"[Ww]atch (?:again )?from (\d+):(\d{2})(?::(\d{2}))?")


def _start_seconds(note: str):
    m = _WATCH_RE.search(note or "")
    if not m:
        return None
    a, b, c = m.groups()
    secs = (int(a) * 3600 + int(b) * 60 + int(c)) if c else (int(a) * 60 + int(b))
    return secs if secs > 0 else None


def _short_module(label: str) -> str:
    # "Module 3 — Name…" → "M3 · Name…" (group headers stay scannable).
    m = re.match(r"Module (\d+)\s*[—–-]\s*(.+)", label or "")
    return f"M{m.group(1)} · {m.group(2)}" if m else (label or "")


def _steps_for(modules, yt_by_id, ctx, problems):
    steps = []
    for mod in modules:
        label = _short_module(mod.get("module_label"))
        for les in mod.get("lessons", []):
            vid = les.get("video_id")
            if vid is None:
                if not les.get("gap_key"):
                    problems.append(f"{ctx}: lesson {les.get('title')!r} has neither video_id nor gap_key")
                steps.append({
                    "youtube_id": "",
                    "planned_title": les["title"],
                    "module_label": label or None,
                    "note": les.get("why") or None,
                })
                continue
            yt = yt_by_id.get(vid)
            if not yt:
                problems.append(f"{ctx}: video_id {vid} not in videos_dump")
                continue
            note = les.get("chapter_note") or les.get("why") or None
            steps.append({
                "youtube_id": yt,
                "module_label": label or None,
                "note": note,
                "start_seconds": _start_seconds(note),
            })
    return steps


def build_payload() -> dict:
    cur = json.load(open(CUR, encoding="utf-8"))
    arch = cur["architecture"]
    yt_by_id = {v["id"]: v["youtube_id"] for v in json.load(open(DUMP, encoding="utf-8"))}
    problems: list[str] = []
    paths = []

    flag = arch["flagship"]
    paths.append({
        "slug": flag["slug"],
        "name": flag["name"],
        "blurb": flag.get("blurb"),
        "kind": "course",
        "sort_order": 20,
        "enabled": False,
        "steps": _steps_for(flag["modules"], yt_by_id, f"flagship {flag['slug']}", problems),
    })
    for i, tr in enumerate(arch["tracks"]):
        slug = SLUG_RENAMES.get(tr["slug"], tr["slug"])
        paths.append({
            "slug": slug,
            "name": tr["name"],
            "blurb": tr.get("blurb"),
            "kind": "track",
            "sort_order": 21 + i,
            "enabled": False,
            "steps": _steps_for(tr["modules"], yt_by_id, f"track {slug}", problems),
        })

    # ── Gates: fail loudly before anything could ship ─────────────────────
    for p in paths:
        if p["slug"] in LIVE_SLUGS:
            problems.append(f"slug {p['slug']!r} collides with a LIVE member path")
        if p["enabled"]:
            problems.append(f"path {p['slug']!r} is enabled — drafts only")
    flag_steps = paths[0]["steps"]
    planned_flag = sum(1 for s in flag_steps if s.get("planned_title"))
    if len(flag_steps) != 60 or planned_flag != 19:
        problems.append(f"flagship shape off: {len(flag_steps)} steps / {planned_flag} planned (want 60/19)")
    total_planned = sum(1 for p in paths for s in p["steps"] if s.get("planned_title"))
    if total_planned != 20:
        problems.append(f"total planned {total_planned} != 20")
    if problems:
        raise SystemExit("PAYLOAD INVALID:\n  " + "\n  ".join(problems))
    return {"paths": paths}


def main() -> None:
    payload = build_payload()
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, indent=1, ensure_ascii=False)
    total = sum(len(p["steps"]) for p in payload["paths"])
    seeks = sum(1 for p in payload["paths"] for s in p["steps"] if s.get("start_seconds"))
    print(f"payload OK → {OUT}")
    print(f"paths: {len(payload['paths'])} (all drafts) | steps: {total} | planned: 20 | start_seconds: {seeks}")
    if "--execute" not in sys.argv:
        print("dry build only — pass --execute to POST to prod (AFTER the code deploy is live)")
        return
    import requests
    from dotenv import load_dotenv
    load_dotenv(r"C:\Users\Patrick\uct-dashboard\.env")
    r = requests.post(
        "https://uctintelligence.com/api/education/paths-apply",
        headers={
            "Authorization": f"Bearer {os.environ['PUSH_SECRET']}",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) uct-curriculum-apply",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=120,
    )
    print("HTTP", r.status_code, r.text[:300])
    sys.exit(0 if r.status_code == 200 else 1)


if __name__ == "__main__":
    main()
