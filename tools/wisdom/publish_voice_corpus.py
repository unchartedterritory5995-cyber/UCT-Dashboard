"""PC-side TSDR voice corpus export (D18/D19; W1 Part 5 "Morning Wire voice profile").

Writes %LOCALAPPDATA%\\uct\\wisdom\\voice_corpus_<date>.txt in the Substack archive format
morning-wire's scripts/build_voice_profile.py already parses, from TSDR-attributed wisdom.db
segments only. It is NOT a morning-wire commit: data/voice/*.json are git-tracked there and
the next 6:35 AM wire reads them, so the profile rebuild stays with the MW owner (D19). The
export is the input that rebuild would consume (a `--corpus PATH` option is the MW owner's
change to make).

- --db is explicit and opened READ-ONLY (sqlite `mode=ro`): a copy of wisdom.db, never C:\\data.
- Dry run by default: prints counts. --write writes the file atomically (temp + os.replace).
- Refuses an output directory inside this repository (public) or under C:\\data.
- Prints counts and a sha256, never text.

The query and format are loaded BY PATH from api/services/wisdom/publish/adapters/voicefmt.py
(standard library only), so this script never imports the `api` package.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import importlib.util
import json
import os
import pathlib
import sqlite3
import sys
import tempfile
from typing import Optional

REPO = pathlib.Path(__file__).resolve().parents[2]


def _load_voicefmt():
    path = REPO / "api" / "services" / "wisdom" / "publish" / "adapters" / "voicefmt.py"
    spec = importlib.util.spec_from_file_location("wisdom_voicefmt_standalone", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


voicefmt = _load_voicefmt()


class ExportRefused(RuntimeError):
    pass


def default_out_dir() -> pathlib.Path:
    base = os.environ.get("LOCALAPPDATA") or str(pathlib.Path.home() / "AppData" / "Local")
    return pathlib.Path(base) / "uct" / "wisdom"


def check_out_dir(out_dir: pathlib.Path) -> pathlib.Path:
    resolved = out_dir.resolve()
    if resolved == REPO or REPO in resolved.parents:
        raise ExportRefused("the voice corpus must not be written inside the (public) repository")
    parts = [p.lower() for p in resolved.parts]
    if len(parts) >= 2 and parts[0] in ("c:\\", "/") and parts[1] == "data":
        raise ExportRefused("the voice corpus must not be written under the shared data root")
    return resolved


def export(db_path: str, out_dir: pathlib.Path, *, date: str, include_spoken: bool = False,
           since: Optional[str] = None, write: bool = False) -> dict:
    uri = f"file:{pathlib.Path(db_path).resolve().as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=30)
    try:
        docs = voicefmt.corpus_documents(conn, include_spoken=include_spoken, since=since)
    finally:
        conn.close()
    text = voicefmt.format_archive(docs)
    summary = {
        "documents": len(docs), "lines": sum(len(d["lines"]) for d in docs), "chars": len(text),
        "by_stream": dict(collections.Counter(d["stream"] for d in docs)),
        "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(), "written": False, "path": None,
    }
    if write:
        target_dir = check_out_dir(out_dir)
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"voice_corpus_{date}.txt"
        fd, tmp = tempfile.mkstemp(prefix=".voice_corpus_", dir=str(target_dir))
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        os.replace(tmp, target)
        summary.update(written=True, path=str(target))
    return summary


def main(argv: Optional[list] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", required=True, help="a wisdom.db copy (explicit; opened read-only)")
    ap.add_argument("--out-dir", default=str(default_out_dir()))
    ap.add_argument("--date", default=dt.date.today().isoformat())
    ap.add_argument("--since", help="ISO timestamp: only sources published on or after it")
    ap.add_argument("--include-spoken", action="store_true", help="add session transcripts as [ARTICLE] documents")
    ap.add_argument("--write", action="store_true", help="write the file (default: dry run, counts only)")
    args = ap.parse_args(argv)
    try:
        summary = export(args.db, pathlib.Path(args.out_dir), date=args.date, include_spoken=args.include_spoken,
                         since=args.since, write=args.write)
    except ExportRefused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 3
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
