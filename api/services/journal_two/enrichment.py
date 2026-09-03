"""Post-migration ticker enrichment (spec §8.1 — the highest-leverage item in
the notebook migration program).

After an import lands, a member is looking at a library of notes their old
app could never do anything live with. This module answers exactly one
question, honestly: which of THEIR notes mention a real ticker, so the
Notebook can offer -- opt-in, one click, reversible -- the live chart their
old app structurally could not.

⛔⛔ The matcher is NOT reinvented here. `RS`, `EMA`, `MA`, `GAP` and `PEG` are
all real, actively-traded symbols, and a naive uppercase-token match drags in
ordinary words (`AM`, `ON`, `IT`, `YOU`...). That exact problem was already
solved, under real production pressure, by the Discord `/buzz` board
(`api/services/buzz_extract.py` + `buzz_universe.py`): a four-tier match
(cashtag > alias > exact > contextual) with a curated
`TICKER_DESPITE_LOWERCASE` set and a derived ambiguous-collision list. This
module calls that extractor directly against each note's own `body_plain`
(already computed and stored by `import_confirm`/`create_note`/`update_note`
-- nothing here re-derives note text). A precision failure here is worse than
shipping nothing, so: reuse, don't rebuild.
"""
from __future__ import annotations

import sqlite3
from typing import Any

from api.services import buzz_extract
from api.services.auth_db import get_connection

# Genuine resource bound on one scan request, mirroring `import_check`'s
# `_IMPORT_CHECK_MAX_KEYS` (notes.py) -- not a silent truncation. A real
# personal library (even a multi-thousand-note migration) is scanned in full;
# a caller that somehow exceeds this is told so honestly via `truncated`
# rather than having the tail silently disappear from the offer.
_SCAN_MAX_NOTES = 20_000


def scan_notes_for_tickers(
    user_id: str,
    note_ids: list[str],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Scan the given notes (must belong to `user_id`) for ticker mentions.

    Returns: {"candidates": [{"id", "title", "tickers": [...]}], "scanned": int,
              "truncated": bool}

    A note is a candidate only when it mentions at least one ticker the note
    does NOT already carry a live/snapshot chart embed for -- re-running the
    scan (e.g. a second import into the same library) never re-offers a
    ticker the member already accepted. `tickers` is sorted for a stable,
    diffable UI.
    """
    ids = [i for i in (note_ids or []) if isinstance(i, str) and i]
    total = len(ids)
    truncated = total > _SCAN_MAX_NOTES
    if truncated:
        ids = ids[:_SCAN_MAX_NOTES]

    owned = conn is None
    conn = conn or get_connection()
    try:
        rows: list[sqlite3.Row] = []
        for i in range(0, len(ids), 500):  # SQLite variable-count limit safety
            chunk = ids[i:i + 500]
            q = ",".join("?" * len(chunk))
            rows.extend(conn.execute(
                f"SELECT id, title, body_plain FROM j2_notes "
                f"WHERE user_id = ? AND id IN ({q})", (user_id, *chunk)
            ).fetchall())

        # Existing chart-embed symbols, per note -- one query, not N. A note
        # can carry more than one chart embed (different tickers), so this is
        # a note_id -> set(symbol) map.
        already: dict[str, set[str]] = {}
        if rows:
            note_id_list = [r["id"] for r in rows]
            for i in range(0, len(note_id_list), 500):
                chunk = note_id_list[i:i + 500]
                q = ",".join("?" * len(chunk))
                for r in conn.execute(
                    f"SELECT note_id, symbol FROM j2_note_embeds "
                    f"WHERE user_id = ? AND widget_id = 'chart' AND note_id IN ({q}) "
                    f"AND symbol IS NOT NULL", (user_id, *chunk)
                ).fetchall():
                    already.setdefault(r["note_id"], set()).add(r["symbol"])

        candidates = []
        for row in rows:
            mentioned = [sym for sym, _tier in buzz_extract.extract(row["body_plain"])]
            offerable = sorted(s for s in mentioned if s not in already.get(row["id"], ()))
            if offerable:
                candidates.append({
                    "id": row["id"],
                    "title": row["title"] or "Untitled",
                    "tickers": offerable,
                })

        return {"candidates": candidates, "scanned": len(rows), "truncated": truncated}
    finally:
        if owned:
            conn.close()
