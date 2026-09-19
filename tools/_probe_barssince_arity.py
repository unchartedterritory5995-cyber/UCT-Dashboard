"""3.2 pre-check — count shipped definitions using a 2-argument `ta.barssince`.

⛔ READ-ONLY. Opens the store with `mode=ro` and never writes. Run it on the web pod:

    B=$(base64 -w0 tools/_probe_barssince_arity.py)
    railway ssh --service web "echo $B | base64 -d > /tmp/p.py && /opt/venv/bin/python /tmp/p.py"

⚠️ `/opt/venv/bin/python`, not bare `python3` — the Nix system python has no app deps.

Ruling 3.2 is gated on the output: zero hits and the declaration drops to one argument;
any hits and they are listed by owner and REFUSED rather than silently broken.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3

PATH = os.environ.get("USER_DEFINITIONS_DB_PATH", "/data/user_definitions.db")


def arg_count_at(blob: str, start: int) -> int:
    """Count top-level arguments of the call whose `"args":[` begins at `start`."""
    i = blob.index("[", start)
    depth = 0
    commas = 0
    for j, ch in enumerate(blob[i:], start=i):
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                break
        elif ch == "," and depth == 1:
            commas += 1
    return commas + 1


def main() -> None:
    if not os.path.exists(PATH):
        print("ABSENT", PATH)
        return
    con = sqlite3.connect(f"file:{PATH}?mode=ro", uri=True)
    total = con.execute("SELECT COUNT(*) FROM user_definitions").fetchone()[0]
    live = con.execute(
        "SELECT COUNT(*) FROM user_definitions WHERE deleted_at IS NULL").fetchone()[0]

    hits = []
    rows = con.execute(
        "SELECT user_id, def_id, version, definition FROM user_definitions "
        "WHERE deleted_at IS NULL")
    for uid, did, ver, definition in rows:
        if not definition or '"barssince"' not in definition:
            continue
        try:
            tree = json.loads(definition)
        except Exception:
            continue
        blob = json.dumps(tree, separators=(",", ":"))
        for m in re.finditer(r'"name":"barssince","args":', blob):
            n = arg_count_at(blob, m.start())
            if n >= 2:
                hits.append((uid, did, ver, n))

    print("PROD_TOTAL", total, "LIVE", live, "TWO_ARG_HITS", len(hits))
    for h in hits:
        print("   HIT", h)
    con.close()


if __name__ == "__main__":
    main()
