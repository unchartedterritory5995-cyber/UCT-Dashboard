"""The ONE definition of a Brain KB row's content hash.

Both sides of the KB sync use it: `adapters/brainkb.py` stamps `content_sha256`
on every exported row, and `tools/wisdom/publish_kb_sync.py` recomputes it from
the row already in the ENGINE KB to decide no-op versus UPDATE. Two copies of
this formula would drift, and a drifted hash re-writes (and re-embeds) every
Wisdom row every night.

Standard library only, on purpose: the PC-side sync loads this file by path so
it never imports the `api` package (and so can never capture a `/data` path).
"""
from __future__ import annotations

import hashlib
import json
from typing import Mapping

#: The knowledge_base columns a Wisdom row owns. `active`, `source`,
#: `source_ref`, `created_at` and `updated_at` are bookkeeping, not content.
KB_CONTENT_FIELDS = ("category", "title", "content", "tags", "trader",
                     "knowledge_epoch", "priority", "regime_context")

SOURCE = "wisdom"
SOURCE_REF_PREFIX = "wisdom:"


def _norm(field: str, value: object) -> object:
    if field == "priority":
        try:
            return int(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return 3
    return "" if value is None else str(value)


def kb_row_sha(row: Mapping) -> str:
    canonical = {f: _norm(f, row.get(f) if hasattr(row, "get") else row[f]) for f in KB_CONTENT_FIELDS}
    text = json.dumps(canonical, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def is_wisdom_ref(source_ref: object) -> bool:
    return isinstance(source_ref, str) and source_ref.startswith(SOURCE_REF_PREFIX)
