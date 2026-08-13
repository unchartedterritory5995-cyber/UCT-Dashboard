"""ONE authority for where Journal-2.0 attachments live on disk.

⛔ THE DEFAULT USED TO BE REPO-RELATIVE (`<repo>/data/j2_attachments`), spelled
three times (notes.py, calendar.py, and j2_attachments_backup.py deriving from
calendar's copy). On Railway that resolves to `/app/data/j2_attachments` — the
CONTAINER filesystem, not the mounted volume — so **every redeploy deleted
every note image**: widget-embed archive PNGs (the Journal Widgets feature's
#1 durability promise), pasted inline images, and hero images alike. The
nightly R2 backup faithfully tarred the same ephemeral tree, so it could only
ever hold what had been written since the last deploy.

Found 2026-08-13 on prod: a shared note's archived chart 404'd through the
OWNER route while authenticated, which rules out every permission explanation
and leaves only "the file is not there".

Resolution order — WRITES always use the primary root; READS fall back to the
legacy location so anything still sitting there keeps serving:
  1. `$J2_ATTACHMENT_ROOT` — explicit override (unchanged contract)
  2. `$DATA_DIR/j2_attachments` — the house convention every other durable
     store already uses (`bars_sqlite`: `os.environ.get("DATA_DIR", "/data")`),
     with `/data` being the Railway volume mount.

⚠️ On the Windows dev box a bare `/data` resolves to the real `C:\\data`
shared root (see the repo-root conftest's tripwire) — local runs should set
`DATA_DIR` (the sandbox runbook already does), exactly as they must for
auth.db.
"""

from __future__ import annotations

import os
from pathlib import Path

# The repo-relative location writes used to land in. READ-ONLY now: kept so a
# box that still has files there keeps serving them after this change.
LEGACY_ATTACHMENT_ROOT = Path(__file__).resolve().parents[3] / "data" / "j2_attachments"


def attachment_root() -> Path:
    """Where attachments are WRITTEN (and read from first)."""
    env = os.environ.get("J2_ATTACHMENT_ROOT")
    if env:
        return Path(env)
    return Path(os.environ.get("DATA_DIR", "/data")) / "j2_attachments"


def read_candidates(rel: Path) -> list[Path]:
    """Absolute paths to try, in order, for a relative attachment path.
    Primary first, then the legacy tree (dedup'd when they coincide)."""
    primary = attachment_root() / rel
    legacy = LEGACY_ATTACHMENT_ROOT / rel
    return [primary] if primary == legacy else [primary, legacy]
