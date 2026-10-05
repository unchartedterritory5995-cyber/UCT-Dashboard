"""Entity Master UC-2: a saved watchlist row survives a rename without corruption.

`entity-master-prd.md` UC-2 / `product-architecture.md` §3.2 rule 2: every stored row
is keyed by ENTITY id (S3), never by ticker string; the ticker is a display alias with
a date. A member has NVDA on a list; the company is later renamed, or delisted and its
ticker reissued. Keyed by string, the row silently follows the STRING (a rename shows
a dead ticker; a reissue points the row at a stranger). Keyed by entity, it follows
the COMPANY and shows its most recent valid alias with a renamed / delisted marker,
never a blank row.

HOW, without touching `auth.db`'s schema (§5-B.8: no new tables in auth.db):
  * a side store `watchlist_entity_keys.db` holds `item_id -> entity_id`, written ONCE
    when the row is added (resolved against the Entity Master as of that day) and
    never re-keyed. That once-only write IS the guarantee: a later rename cannot move
    the key, because nothing re-resolves the string.
  * `annotate()` decorates the rows a read returns with `entity_id`, `display_sym`
    and `entity_marker` ('renamed' | 'delisted' | None). `sym` is never changed; the
    versioned snapshot (COV-06) and every other reader of `watchlist_items` see the
    exact rows they saw before.

⛔ DARK: `WATCHLIST_ENTITY_KEYS_ENABLED` unset => `key_items` and `annotate` return
before ANY I/O; reads are byte-identical and no file is created. Read per call.
⛔ THE KILL SWITCH IS NEVER A DELETE: unsetting it stops keying and decorating; every
key row stays. The store is declared in `store_retention` (member data, never swept).
⛔ NO GUESSING: an ambiguous or unknown ticker is keyed to NULL with its status, and
its row renders exactly as before.
"""
from __future__ import annotations

import contextlib
import datetime
import logging
import os
import sqlite3
import threading

logger = logging.getLogger(__name__)

FLAG = "WATCHLIST_ENTITY_KEYS_ENABLED"
TABLE = "watchlist_entity_keys"
#: A read decorates at most this many rows per call; past it the rest render as
#: before (the prebuilt index lists are never decorated at all).
MAX_ANNOTATE = 500

_WRITE_LOCK = threading.Lock()


def is_enabled() -> bool:
    return os.environ.get(FLAG, "").strip().lower() in ("1", "true", "yes", "on")


def db_path() -> str:
    return (os.environ.get("WATCHLIST_ENTITY_KEYS_DB_PATH")
            or os.path.join(os.environ.get("DATA_DIR", "/data"), "watchlist_entity_keys.db"))


def _connect() -> sqlite3.Connection:
    c = sqlite3.connect(db_path(), timeout=2.0)
    c.row_factory = sqlite3.Row
    c.execute(f"CREATE TABLE IF NOT EXISTS {TABLE} ("
              " item_id TEXT PRIMARY KEY, entity_id TEXT, status TEXT NOT NULL,"
              " keyed_sym TEXT NOT NULL, keyed_on TEXT NOT NULL)")
    return c


def _today() -> str:
    return datetime.datetime.now(datetime.UTC).date().isoformat()


def key_items(pairs, *, em_db_path: str | None = None, today: str | None = None) -> int:
    """Key `(item_id, sym)` rows to their entity as of `today`. ONCE: an item that
    already has a key is never re-keyed. Returns rows keyed. Never raises."""
    if not is_enabled():
        return 0
    try:
        from api.services.entity_master import api as em
        day = today or _today()
        n = 0
        with _WRITE_LOCK, contextlib.closing(_connect()) as c:
            for item_id, sym in pairs:
                if not item_id or c.execute(f"SELECT 1 FROM {TABLE} WHERE item_id=?",
                                            (item_id,)).fetchone():
                    continue
                r = em.resolve(sym or "", as_of=day, db_path=em_db_path)
                eid = r.entity.entity_id if (r.status == "resolved" and r.entity) else None
                c.execute(f"INSERT OR IGNORE INTO {TABLE} (item_id, entity_id, status, keyed_sym,"
                          " keyed_on) VALUES (?,?,?,?,?)",
                          (item_id, eid, r.status, (sym or "").strip().upper(), day))
                n += 1
            c.commit()
        return n
    except Exception as e:                               # noqa: BLE001 -- a list save must not fail
        logger.warning("[watchlist_entity_keys] key_items failed: %s", e)
        return 0


def _display(entity_id: str, sym: str, *, em_db_path, today) -> tuple[str, str | None]:
    """(display alias, marker) for one keyed row."""
    from api.services.entity_master import api as em
    ent = em._load_entity(entity_id, em_db_path)
    current = em.aliases(entity_id, as_of=today, db_path=em_db_path)
    if current and not (ent and ent.lifecycle_state == "delisted"):
        alias = current[-1].alias
        return alias, (None if alias == (sym or "").strip().upper() else "renamed")
    history = em.aliases(entity_id, db_path=em_db_path)
    alias = history[-1].alias if history else (sym or "").strip().upper()
    return alias, "delisted"


def annotate(items: list, *, em_db_path: str | None = None, today: str | None = None) -> list:
    """Decorate read rows in place with `entity_id` / `display_sym` / `entity_marker`.
    Dark => untouched (no keys added at all). Never raises: on any failure the rows
    come back exactly as they went in."""
    if not is_enabled() or not items:
        return items
    try:
        day = today or _today()
        rows = [it for it in items if isinstance(it, dict) and it.get("id")][:MAX_ANNOTATE]
        if not rows or not os.path.exists(db_path()):
            return items
        ids = [r["id"] for r in rows]
        keys: dict = {}
        with contextlib.closing(_connect()) as c:
            for i in range(0, len(ids), 400):
                chunk = ids[i:i + 400]
                q = ",".join("?" * len(chunk))
                for k in c.execute(f"SELECT item_id, entity_id FROM {TABLE} WHERE item_id IN ({q})",
                                   tuple(chunk)):
                    keys[k["item_id"]] = k["entity_id"]
        cache: dict = {}
        decor = []
        for it in rows:
            eid = keys.get(it["id"])
            if eid is None:
                decor.append((it, None, it.get("sym"), None))
                continue
            if eid not in cache:
                cache[eid] = _display(eid, it.get("sym"), em_db_path=em_db_path, today=day)
            alias, marker = cache[eid]
            # A rename is relative to the row's own string; recompute per row.
            if marker != "delisted":
                marker = None if alias == (it.get("sym") or "").strip().upper() else "renamed"
            decor.append((it, eid, alias, marker))
        # Applied only once every row was computed, so a failure part-way leaves the
        # rows exactly as they went in.
        for it, eid, alias, marker in decor:
            it["entity_id"], it["display_sym"], it["entity_marker"] = eid, alias, marker
        return items
    except Exception as e:                               # noqa: BLE001 -- a read must keep answering
        logger.warning("[watchlist_entity_keys] annotate failed: %s", e)
        return items
