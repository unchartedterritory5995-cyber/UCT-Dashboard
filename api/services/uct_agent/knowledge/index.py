"""Local full-text index over the installed pack's knowledge_base. Zero external calls.

Lives in its own SQLite file (env UCT_AGENT_KNOWLEDGE_INDEX, default <DATA_DIR>/agent_knowledge_index.db), NOT
in brain_index.db (owned by brain_kb_service) and never inside the swapped pack directory.

UPDATE MECHANISM: the index records the pack version (`pack.pack_ts()`) it was built from. `ensure()` rebuilds it
when the installed pack is newer (lazy, on the next read), and `on_pack_install()` — registered with
`brain_sync.on_install` when the kinds register — rebuilds it right after a new pack lands. Builds go to a temp
file and are swapped in with os.replace, so a reader never sees a half index. Every active row is indexed with
its metadata; the source POLICY is applied at query time, so a policy change needs no rebuild.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import sqlite3
import threading
import time
from typing import Optional

from api.services.uct_agent.knowledge import pack

log = logging.getLogger(__name__)
ENV_PATH = "UCT_AGENT_KNOWLEDGE_INDEX"
SCHEMA = 1
_LOCK = threading.Lock()

_STOP = frozenset("""a an and are as at be by can do does for from has have how i in into is it its me my of on or
our so that the their them then there these they this to uct was we what when where which who why will with you
your about tell explain define definition mean means meaning according say says said team teach teaches""".split())
_TOKEN = re.compile(r"[A-Za-z0-9&]+")


def index_path() -> str:
    return os.environ.get(ENV_PATH) or os.path.join(os.environ.get("DATA_DIR", "/data"), "agent_knowledge_index.db")


def _connect(p: Optional[str] = None) -> sqlite3.Connection:
    c = sqlite3.connect(p or index_path(), check_same_thread=False)
    c.row_factory = sqlite3.Row
    return c


def built_info() -> dict:
    """{pack_ts, built_at, rows, schema} of the current index, or {} when there is none."""
    if not os.path.isfile(index_path()):
        return {}
    try:
        c = _connect()
        try:
            return {r["k"]: r["v"] for r in c.execute("SELECT k, v FROM meta")}
        finally:
            c.close()
    except sqlite3.Error:
        return {}


def _norm_title(t: str) -> str:
    return re.sub(r"\s+", " ", str(t or "").strip().lower())


def build() -> dict:
    """(Re)build the index from the installed pack. Returns {ok, rows, duplicates, pack_ts} or {ok: False, reason}."""
    src = pack.connect()
    if src is None:
        return {"ok": False, "reason": "no Brain Pack installed"}
    ts = pack.pack_ts()
    target = index_path()
    tmp = f"{target}.build-{os.getpid()}-{int(time.time() * 1000)}"
    try:
        cols = {r[1] for r in src.execute("PRAGMA table_info(knowledge_base)")}
        if not {"id", "category", "title", "content", "source", "active"} <= cols:
            return {"ok": False, "reason": "pack knowledge_base lacks required columns"}
        opt = [c for c in ("tags", "trader", "source_ref", "knowledge_epoch", "created_at", "updated_at", "regime_context")
               if c in cols]
        sel = ", ".join(["id", "category", "title", "content", "source"] + opt)
        rows = src.execute(f"SELECT {sel} FROM knowledge_base WHERE active = 1").fetchall()
        dst = _connect(tmp)
        dst.executescript("""
            CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);
            CREATE TABLE docs (kb_id INTEGER PRIMARY KEY, category TEXT, source TEXT, trader TEXT, source_ref TEXT,
                               epoch TEXT, created_at TEXT, updated_at TEXT, regime TEXT, title TEXT, content TEXT,
                               content_sha TEXT, dup_of INTEGER);
            CREATE VIRTUAL TABLE fts USING fts5(title, content, tags, content='', tokenize='porter unicode61');
        """)
        seen: dict[str, int] = {}
        dups = 0
        for r in rows:
            d = dict(r)
            title, content = str(d.get("title") or ""), str(d.get("content") or "")
            sha = hashlib.sha256(f"{_norm_title(title)}\n{content.strip()}".encode("utf-8")).hexdigest()
            key = f"{_norm_title(title)}|{str(d.get('trader') or '').strip().lower()}|{d.get('source')}"
            dup_of = seen.get(sha) or seen.get(key)
            if dup_of:
                dups += 1
            else:
                seen[sha] = seen[key] = int(d["id"])
            dst.execute("INSERT INTO docs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (int(d["id"]), str(d.get("category") or "").upper(), d.get("source") or "",
                         d.get("trader") or "", d.get("source_ref") or "", str(d.get("knowledge_epoch") or ""),
                         d.get("created_at") or "", d.get("updated_at") or "", d.get("regime_context") or "",
                         title, content, sha, dup_of))
            dst.execute("INSERT INTO fts(rowid, title, content, tags) VALUES (?,?,?,?)",
                        (int(d["id"]), title, content, str(d.get("tags") or "")))
        meta = {"schema": SCHEMA, "pack_ts": ts, "built_at": int(time.time()), "rows": len(rows), "duplicates": dups}
        dst.executemany("INSERT INTO meta VALUES (?,?)", [(k, str(v)) for k, v in meta.items()])
        dst.commit()
        dst.close()
        os.replace(tmp, target)
        tmp = None
        log.info("[uct-agent knowledge] index built rows=%s duplicates=%s pack_ts=%s", len(rows), dups, ts)
        try:
            from api.services.uct_agent.knowledge import health
            health.write()
        except Exception:  # noqa: BLE001 — the report is advisory; a failure never blocks the index
            log.warning("[uct-agent knowledge] health report failed")
        return {"ok": True, **meta}
    except sqlite3.Error as e:
        log.warning("[uct-agent knowledge] index build failed: %s", type(e).__name__)
        return {"ok": False, "reason": "index build failed"}
    finally:
        src.close()
        if tmp and os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass


def ensure() -> dict:
    """The index is current for the installed pack (rebuilt if not). {ok, ...} or {ok: False, reason}."""
    ts = pack.pack_ts()
    if not ts:
        return {"ok": False, "reason": "no Brain Pack installed"}
    info = built_info()
    if info.get("pack_ts") == str(ts) and info.get("schema") == str(SCHEMA):
        return {"ok": True, **info}
    with _LOCK:
        info = built_info()
        if info.get("pack_ts") == str(ts) and info.get("schema") == str(SCHEMA):
            return {"ok": True, **info}
        return build()


def on_pack_install() -> None:
    """brain_sync.on_install callback: rebuild for the pack that just landed. Never raises."""
    try:
        with _LOCK:
            build()
    except Exception:  # noqa: BLE001
        log.exception("[uct-agent knowledge] rebuild after pack install failed")


def match_expr(question: str) -> str:
    """An FTS5 OR-query of the question's content words (each quoted: no FTS operator can be injected)."""
    toks = [t.lower() for t in _TOKEN.findall(question or "")]
    words = [t for t in toks if t not in _STOP and (len(t) > 1 or t.isdigit())]
    seen, out = set(), []
    for w in words:
        if w not in seen:
            seen.add(w)
            out.append('"' + w.replace('"', "") + '"')
    return " OR ".join(out[:16])


def query(question: str, *, sources: list[str], exclude_categories: set[str], category: Optional[str] = None,
          limit: int = 40) -> list[dict]:
    """Ranked candidate rows from ADMITTED sources only (policy applied in SQL, before ranking)."""
    expr = match_expr(question)
    if not expr or not sources:
        return []
    where = [f"d.source IN ({','.join('?' * len(sources))})", "d.dup_of IS NULL"]
    args: list = list(sources)
    if exclude_categories:
        where.append(f"d.category NOT IN ({','.join('?' * len(exclude_categories))})")
        args.extend(sorted(exclude_categories))
    if category:
        where.append("d.category = ?")
        args.append(category.upper())
    sql = (f"SELECT d.*, bm25(fts, 6.0, 1.0, 2.0) AS rank FROM fts JOIN docs d ON d.kb_id = fts.rowid "
           f"WHERE fts MATCH ? AND {' AND '.join(where)} ORDER BY rank LIMIT ?")
    c = _connect()
    try:
        return [dict(r) for r in c.execute(sql, [expr, *args, int(limit)])]
    except sqlite3.Error:
        return []
    finally:
        c.close()


def coverage() -> dict:
    """Row counts by source and category from the index (for the health report)."""
    if not os.path.isfile(index_path()):
        return {}
    c = _connect()
    try:
        by_source = {r[0]: r[1] for r in c.execute("SELECT source, COUNT(*) FROM docs GROUP BY source")}
        by_cat = {r[0]: r[1] for r in c.execute("SELECT category, COUNT(*) FROM docs GROUP BY category")}
        dups = c.execute("SELECT COUNT(*) FROM docs WHERE dup_of IS NOT NULL").fetchone()[0]
        no_ref = c.execute("SELECT COUNT(*) FROM docs WHERE source_ref = ''").fetchone()[0]
        return {"by_source": by_source, "by_category": by_cat, "duplicates": dups, "without_source_ref": no_ref}
    finally:
        c.close()
