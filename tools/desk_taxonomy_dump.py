"""Full-library dump: metadata + transcript cues for every prod Desk video.

Produces `tools/taxonomy_out/videos_dump.json` — one JSON array with every
prod video's metadata + transcript cues, the single local input the Desk
taxonomy classification workflow (plan Task 11) reads.

Row shape:
    {id, youtube_id, title, description, category, duration, created_at,
     meeting_uuid, headline, summary, setups, ticker_moments, chapters,
     transcript_cues: [{t, text}, ...]}

`headline`/`summary`/`setups`/`ticker_moments`/`chapters` are carried through
EXACTLY as stored (JSON-encoded TEXT columns, i.e. each is a JSON *string*,
not a parsed list/dict) — same convention as the ad-hoc `videos_meta.json`
this script can consume, and as `education_service.get_video_detail`'s raw
row. Callers `json.loads()` them as needed.

── Metadata source (pick ONE) ───────────────────────────────────────────────

(a) --meta-file <path>
    Reuse an existing metadata dump (a prior `--regen-meta` run, or the
    ad-hoc railway-ssh JSON already captured at
    tools/taxonomy_out/videos_meta.json). No network, no ssh, instant. Extra
    keys in the source file (e.g. `sort_order`, `transcript_len`) are
    ignored; only the columns above are read.

(b) --regen-meta
    Regenerate the metadata list fresh from prod. MUST conceptually run from
    the LINKED MAIN REPO dir (C:\\Users\\Patrick\\uct-dashboard) — `railway`
    is linked there, not in this worktree (`.worktrees\\desk-taxonomy`) — so
    this function `cwd`s there itself before shelling out. It runs:

        railway ssh --service web "echo <b64> | base64 -d | /opt/venv/bin/python"

    where <b64> is a base64-encoded, self-contained Python snippet that
    connects to /data/education.db READ-ONLY (`file:...?mode=ro` URI —
    never risks a write lock against the live app) and prints every row
    (every column EXCEPT the heavyweight `transcript` text) as one JSON
    array to stdout.

    This is shelled out via `subprocess.run(cmd, shell=True, ...)` — the one
    fragile part is Windows cmd.exe's quoting of the embedded `|` pipe
    characters inside the remote command string. In practice `ssh host
    "cmd1 | cmd2"`-style invocations round-trip fine through cmd.exe (the
    pipe chars stay inside the outer double-quoted argument), but if it ever
    breaks, this fails LOUDLY (dumps stdout/stderr, returns None) rather
    than silently truncating — never partially-parses garbled output. Use
    `--print-regen-cmd` to print the exact command and paste it into a shell
    yourself (from the main repo dir) as the manual fallback.

── Transcript cues (always live, always required) ──────────────────────────

HTTP sweep of `GET {BASE}/api/education/videos/{id}/transcript-cues` for
every id in the metadata — `Authorization: Bearer <PUSH_SECRET>` + a real
browser User-Agent (Cloudflare 1010-blocks non-browser UAs on
uctintelligence.com), paced 0.2s apart, retrying transient 5xx / network
errors twice with backoff (mirrors the `_get` idiom in
`tools/desk_transcript_gapfill.py` — a 4xx is NOT retried, it's a permanent
answer). A video with no stored transcript yet returns `cues: []` — that is
NOT a fetch error, it's an expected, reported-not-failed "cueless" row (e.g.
while `tools/desk_transcript_gapfill.py`'s whisper sweep is still finishing
for a handful of videos).

PUSH_SECRET is read from `C:\\Users\\Patrick\\uct-dashboard\\.env` (this
worktree has none) via python-dotenv — same convention as
`tools/desk_transcript_gapfill.py`.

Usage:
    python tools/desk_taxonomy_dump.py --meta-file tools/taxonomy_out/videos_meta.json
    python tools/desk_taxonomy_dump.py --regen-meta
    python tools/desk_taxonomy_dump.py --regen-meta --print-regen-cmd   # print only, don't run
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import time

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
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 desk-taxonomy-dump",
}

_OUT_DIR = os.path.join(_ROOT, "tools", "taxonomy_out")
_DEFAULT_OUT = os.path.join(_OUT_DIR, "videos_dump.json")

# Columns pulled from edu_videos, in output order. `transcript` is
# deliberately excluded (heavyweight; transcript_cues supersedes it for this
# dump's purpose) and `transcript_cues` is appended after the HTTP sweep.
_OUT_FIELDS = (
    "id", "youtube_id", "title", "description", "category", "duration",
    "created_at", "meeting_uuid", "headline", "summary", "setups",
    "ticker_moments", "chapters",
)

_SWEEP_SLEEP = 0.2

# Self-contained — runs on the Railway container's /opt/venv/bin/python,
# stdlib only. Reads the same columns as _OUT_FIELDS, read-only.
_REMOTE_SNIPPET = f"""
import json, sqlite3
con = sqlite3.connect("file:/data/education.db?mode=ro", uri=True, timeout=10)
con.row_factory = sqlite3.Row
cols = {list(_OUT_FIELDS)!r}
rows = con.execute("SELECT " + ", ".join(cols) + " FROM edu_videos ORDER BY id").fetchall()
print(json.dumps([dict(r) for r in rows]))
con.close()
""".strip()


def _regen_command() -> str:
    b64 = base64.b64encode(_REMOTE_SNIPPET.encode("utf-8")).decode("ascii")
    remote = f"echo {b64} | base64 -d | /opt/venv/bin/python"
    return f'railway ssh --service web "{remote}"'


def regen_meta_via_railway() -> list[dict] | None:
    """Best-effort metadata regeneration via `railway ssh` (see module
    docstring). Returns the parsed row list, or None on any failure (already
    printed) — callers should fall back to --meta-file or --print-regen-cmd."""
    if not os.path.isdir(MAIN_REPO_DIR):
        print(f"[regen] main repo dir not found at {MAIN_REPO_DIR} — can't cd there.")
        return None
    cmd = _regen_command()
    print(f"[regen] running from {MAIN_REPO_DIR} (railway is linked there, "
          f"not this worktree):\n  {cmd}\n")
    try:
        proc = subprocess.run(cmd, shell=True, cwd=MAIN_REPO_DIR,
                              capture_output=True, text=True, timeout=240)
    except Exception as e:
        print(f"[regen] subprocess failed to launch: {e}")
        return None
    if proc.returncode != 0:
        print(f"[regen] railway ssh exited {proc.returncode}\n"
              f"--- stderr ---\n{proc.stderr[-3000:]}\n"
              f"--- stdout ---\n{proc.stdout[-1000:]}")
        return None
    out = proc.stdout.strip()
    try:
        start = out.index("[")
        data = json.loads(out[start:])
    except Exception as e:
        print(f"[regen] could not parse JSON from railway ssh stdout ({e}).\n"
              f"--- stdout (last 3000 chars) ---\n{out[-3000:]}")
        return None
    if not isinstance(data, list):
        print(f"[regen] expected a JSON array, got {type(data).__name__}")
        return None
    return data


def load_meta_file(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError(f"{path}: expected a JSON array of video rows, got "
                         f"{type(data).__name__}")
    return data


def _get_cues(video_id: int) -> list[dict]:
    """GET transcript-cues with 2 retries + backoff on 5xx/network errors
    ONLY — a 4xx (auth, or a stale id) is a permanent answer and retrying it
    just burns the sweep's time. Mirrors the retry idiom in
    tools/desk_transcript_gapfill.py::_get, but split so 4xx doesn't retry."""
    url = f"{BASE}/api/education/videos/{video_id}/transcript-cues"
    last_err: Exception | None = None
    for attempt in range(3):  # 1 try + 2 retries
        try:
            r = requests.get(url, headers=HDRS, timeout=30)
        except requests.RequestException as e:
            last_err = e
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
        if r.status_code >= 500:
            last_err = requests.HTTPError(
                f"{r.status_code} server error for id={video_id}", response=r)
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise last_err
        r.raise_for_status()  # remaining 4xx -> raise immediately, no retry
        return r.json().get("cues") or []
    raise last_err  # pragma: no cover — loop always returns or raises above


def sweep_transcripts(meta: list[dict]) -> tuple[dict[int, list[dict]], list[int]]:
    """Fetch transcript-cues for every row's id. Returns (cues_by_id,
    probe_failed_ids) — a probe failure (never got a clean answer even after
    retries) is recorded separately from a genuine cueless video (clean
    empty-cues response) so the coverage summary can tell them apart."""
    cues_by_id: dict[int, list[dict]] = {}
    failed: list[int] = []
    total = len(meta)
    for i, row in enumerate(meta):
        vid = int(row["id"])
        try:
            cues_by_id[vid] = _get_cues(vid)
        except Exception as e:
            print(f"  ! id={vid}: transcript-cues fetch failed after retries "
                  f"({type(e).__name__}: {str(e)[:160]}) — treating as cueless, "
                  f"re-run to retry")
            cues_by_id[vid] = []
            failed.append(vid)
        if (i + 1) % 50 == 0 or i + 1 == total:
            print(f"  …{i + 1}/{total} swept", flush=True)
        time.sleep(_SWEEP_SLEEP)
    return cues_by_id, failed


def merge(meta: list[dict], cues_by_id: dict[int, list[dict]]) -> list[dict]:
    out = []
    for row in meta:
        vid = int(row["id"])
        rec = {k: row.get(k) for k in _OUT_FIELDS}
        rec["id"] = vid
        rec["transcript_cues"] = cues_by_id.get(vid, [])
        out.append(rec)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--meta-file", default="",
                    help="Reuse an existing metadata JSON (array of video rows) "
                         "instead of regenerating via railway ssh.")
    ap.add_argument("--regen-meta", action="store_true",
                    help="Regenerate metadata fresh via railway ssh (see module "
                         "docstring for the exact command + caveats).")
    ap.add_argument("--print-regen-cmd", action="store_true",
                    help="Print the railway ssh regen command and exit "
                         "without running anything.")
    ap.add_argument("--out", default=_DEFAULT_OUT,
                    help=f"Output path (default: {_DEFAULT_OUT}).")
    ap.add_argument("--limit", type=int, default=0,
                    help="Debug only: sweep transcripts for just the first N rows.")
    args = ap.parse_args()

    if args.print_regen_cmd:
        print(_regen_command())
        return 0

    if bool(args.meta_file) == bool(args.regen_meta):
        print("Specify exactly ONE metadata source: --meta-file <path> OR --regen-meta.")
        return 1

    if args.meta_file:
        print(f"[meta] reusing existing metadata file: {args.meta_file}")
        meta = load_meta_file(args.meta_file)
    else:
        meta = regen_meta_via_railway()
        if meta is None:
            print("[regen] failed — see above. Fall back to --meta-file <path>, "
                  "or --print-regen-cmd to get the command and paste it into a "
                  f"shell yourself from {MAIN_REPO_DIR}.")
            return 1

    print(f"[meta] {len(meta)} video rows")

    if not os.environ.get("PUSH_SECRET"):
        print(f"PUSH_SECRET not set (checked env + {MAIN_REPO_DIR}\\.env)")
        return 1

    targets = meta[: args.limit] if args.limit else meta
    print(f"[cues] sweeping transcript-cues for {len(targets)} videos "
          f"(paced {_SWEEP_SLEEP}s apart) …")
    cues_by_id, failed_probe = sweep_transcripts(targets)

    merged = merge(targets, cues_by_id)

    out_dir = os.path.dirname(args.out) or "."
    os.makedirs(out_dir, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)

    with_cues = sum(1 for r in merged if r["transcript_cues"])
    cueless_ids = [r["id"] for r in merged if not r["transcript_cues"]]

    print(f"\nWrote {args.out}")
    print(f"rows={len(merged)} with_cues={with_cues} cueless={len(cueless_ids)}")
    if cueless_ids:
        print(f"cueless ids: {cueless_ids}")
    if failed_probe:
        print(f"probe failures (fetch never succeeded, counted in cueless above, "
              f"re-run to retry): {failed_probe}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
