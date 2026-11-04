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
import json
import logging
import os
import re
import sqlite3
import threading
import unicodedata
import time
from typing import Optional

from api.services.uct_agent.knowledge import pack

log = logging.getLogger(__name__)
ENV_PATH = "UCT_AGENT_KNOWLEDGE_INDEX"
SCHEMA = 5
_LOCK = threading.Lock()
FAIL_COOLDOWN_S = 60
_FAILED: dict = {"at": 0.0, "ts": None}

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


def build_id(info: dict):
    """The identity of one index build (review #751 nit 1): a nanosecond stamp + process id written at build time, so
    two builds in the same second never compare equal; an index from before SCHEMA 5 falls back to built_at."""
    info = info or {}
    return info.get("build_id") or info.get("built_at")


def _norm_title(t: str) -> str:
    return re.sub(r"\s+", " ", str(t or "").strip().lower())


def build() -> dict:
    """(Re)build the index from the installed pack. Returns {ok, rows, duplicates, pack_ts} or {ok: False, reason}."""
    ts = pack.pack_ts()                      # the version FIRST: a swap after this read is caught by the next ensure()
    src = pack.connect()
    if src is None:
        return {"ok": False, "reason": "no Brain Pack installed"}
    target = index_path()
    tmp = f"{target}.build-{os.getpid()}-{int(time.time() * 1000)}"
    dst = None
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
                               content_sha TEXT, dup_of INTEGER, setup_templates TEXT,
                               mention_templates TEXT, definitional_templates TEXT, mention_error INTEGER);
            CREATE VIRTUAL TABLE fts USING fts5(title, content, tags, content='', tokenize='porter unicode61');
        """)
        seen: dict[str, int] = {}
        dups = 0
        alias_to_templates = _template_aliases(src)
        mention_index = _mention_index(src)
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
            linked = _linked_templates(d, alias_to_templates)
            mentioned, definitional, m_err = _mentions(content, mention_index)
            dst.execute("INSERT INTO docs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (int(d["id"]), str(d.get("category") or "").upper(), d.get("source") or "",
                         d.get("trader") or "", d.get("source_ref") or "", str(d.get("knowledge_epoch") or ""),
                         d.get("created_at") or "", d.get("updated_at") or "", d.get("regime_context") or "",
                         title, content, sha, dup_of, "|".join(linked), "|".join(mentioned), "|".join(definitional),
                         1 if m_err else 0))
            dst.execute("INSERT INTO fts(rowid, title, content, tags) VALUES (?,?,?,?)",
                        (int(d["id"]), title, content, str(d.get("tags") or "")))
        meta = {"schema": SCHEMA, "pack_ts": ts, "built_at": int(time.time()), "rows": len(rows), "duplicates": dups,
                "build_id": f"{time.time_ns()}-{os.getpid()}"}
        dst.executemany("INSERT INTO meta VALUES (?,?)", [(k, str(v)) for k, v in meta.items()])
        dst.commit()
        dst.close()
        dst = None
        with open(tmp, "rb+") as fh:                 # review #751 delta 5: durable before it becomes the index
            os.fsync(fh.fileno())
        os.replace(tmp, target)
        tmp = None
        log.info("[uct-agent knowledge] index built rows=%s duplicates=%s pack_ts=%s", len(rows), dups, ts)
        try:
            from api.services.uct_agent.knowledge import health
            health.write()
        except Exception:  # noqa: BLE001 — the report is advisory; a failure never blocks the index
            log.warning("[uct-agent knowledge] health report failed")
        return {"ok": True, **meta}
    except (sqlite3.Error, OSError, ValueError, TypeError) as e:
        log.warning("[uct-agent knowledge] index build failed: %s", type(e).__name__)
        _FAILED.update(at=time.time(), ts=ts)
        return {"ok": False, "reason": "index build failed"}
    finally:
        if dst is not None:
            try:
                dst.close()
            except sqlite3.Error:
                pass
        src.close()
        if tmp and os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass


def _norm_alias(s: str) -> str:
    return " ".join(_TOKEN.findall(str(s or "").lower()))


def _template_aliases(src) -> dict:
    """normalised template name/alias -> {template names} (from the pack's own setup_templates)."""
    out: dict = {}
    try:
        for r in src.execute("SELECT name, aliases FROM setup_templates"):
            name = str(r["name"] or "")
            try:
                al = json.loads(r["aliases"] or "[]")
            except ValueError:
                al = [a for a in str(r["aliases"] or "").split(",")]
            for t in [name, *(al if isinstance(al, list) else [])]:
                k = _norm_alias(t)
                if k:
                    out.setdefault(k, set()).add(name)
    except sqlite3.Error:
        return {}
    return out


# The definitional cue: a template name/alias as a whole term, then one of these words within 80 characters (across
# sentence ends). Owner decision 2026-11-03 point 3 withheld the reviewed 40-char cue's 71 rows; owner directive
# 2026-11-04 widens it to the review's looser cue (+122 served rows): an uncertain definition-like row is WITHHELD
# until a complete provenance + rights-review entry clears it (policy.cleared_rows); a commentary label never admits it.
# review #751 delta 2: definitional wording AFTER the term (+ refers to / known as / consists of / must / should /
# called), or BEFORE it ("definition of a X", "we call this a X", "known as X"): either withholds the row.
DEFINITIONAL_CUE = (r"[\s\S]{0,80}?\b(is|are|means|defined|definition|rules?|entry|stop|criteria|trigger|pivot|"
                    r"buy point|setup|refers? to|known as|consists? of|must|should|called|characteri[sz]ed by|"
                    r"forms? when|looks? like|requires?|needs?|wants?)\b")
DEFINITIONAL_CUE_BEFORE = (r"\b(definition of|defines?|defined|defining|we call (?:this|it|that)|called|known as|"
                           r"characteri[sz]ed by|criteria for|rules for|forms? when|looks? like|"
                           r"refers? to|means|what (?:is|are) (?:an?|the))\b[\s\S]{0,40}?")
MIN_TERM = 3
# review #751 note 1: a whole term is bounded by NON-word characters (`\b` never fires after a term ending in ")")
_WB, _WE = r"(?<!\w)", r"(?!\w)"
_PLURAL = r"(?:e?s)?"


def fold(s) -> str:
    """review #751 delta 1: the one spelling every term and every row is compared in: NFKC (NBSP, full-width forms),
    case-folded, "&" read as "and", and every run of punctuation / underscores / whitespace collapsed to one space,
    so "Cup-and-Handle", "cup  and handle", "cup & handle" and "CUP AND HANDLE" are the same text."""
    s = unicodedata.normalize("NFKC", str(s or "")).casefold().replace("&", " and ")
    return re.sub(r"[\W_]+", " ", s).strip()


def _variants(term: str) -> list:
    """The folded term and, for a multi-word term, its unspaced form ("cupandhandle"); longest first."""
    out = [term]
    squashed = term.replace(" ", "")
    if " " in term and len(squashed) >= 6:
        out.append(squashed)
    return out


def _mention_index(src) -> Optional[dict]:
    """{term: {template names}} for every template name/alias of >= 3 characters (folded: see fold()), plus one
    combined whole-term regex as a prefilter. Each term also matches its plural and its unspaced form. None when
    unreadable."""
    terms: dict = {}
    try:
        for r in src.execute("SELECT name, aliases FROM setup_templates"):
            name = str(r["name"] or "")
            try:
                al = json.loads(r["aliases"] or "[]")
            except ValueError:
                al = str(r["aliases"] or "").split(",")
            for t in [name, *(al if isinstance(al, list) else [])]:
                t = fold(t)
                if len(t) >= MIN_TERM:
                    terms.setdefault(t, set()).add(name)
    except sqlite3.Error:
        return None
    if not terms:
        return {"terms": {}, "any": None, "per": {}}
    ordered = sorted(terms, key=len, reverse=True)
    alt = lambda t: "(?:" + "|".join(re.escape(v) for v in _variants(t)) + ")"   # noqa: E731
    anyre = re.compile(_WB + "(?:" + "|".join(alt(t) for t in ordered) + ")" + _PLURAL + _WE)
    per = {}
    for t in ordered:
        e = _WB + alt(t) + _PLURAL + _WE
        per[t] = (_variants(t), re.compile(e), re.compile(e + DEFINITIONAL_CUE), re.compile(DEFINITIONAL_CUE_BEFORE + e))
    return {"terms": terms, "any": anyre, "per": per}


def _mentions(content: str, mi: Optional[dict]) -> tuple:
    """(templates mentioned, templates mentioned with definitional wording, error?) for one row's content, compared
    in the folded spelling. Each term is tested on its own, so one term can never hide another's match. Any failure
    is reported as an error (the caller withholds the row: fail closed)."""
    if mi is None:
        return [], [], True
    try:
        low = fold(content)
        if not mi["any"] or not mi["any"].search(low):
            return [], [], False
        mentioned, definitional = set(), set()
        for t, (variants, m_re, d_after, d_before) in mi["per"].items():
            # review #751 perf: only a term present as a substring is scanned (same result, far fewer regex scans)
            if any(v in low for v in variants) and m_re.search(low):
                mentioned |= mi["terms"][t]
                if d_after.search(low) or d_before.search(low):
                    definitional |= mi["terms"][t]
        return sorted(mentioned), sorted(definitional), False
    except Exception:  # noqa: BLE001 — unparseable row: withheld by the caller
        return [], [], True


def mention_rows() -> Optional[list]:
    """[(kb_id, source, category, mention_templates, definitional_templates, mention_error)] for every row that
    mentions a template or failed to parse; None when the index cannot be read (the caller fails closed)."""
    if not os.path.isfile(index_path()):
        return None
    try:
        c = _connect()
    except sqlite3.Error:
        return None
    try:
        return [tuple(r) for r in c.execute(
            "SELECT kb_id, source, category, mention_templates, definitional_templates, mention_error FROM docs "
            "WHERE mention_templates != '' OR mention_error = 1")]
    except sqlite3.Error:
        return None
    finally:
        c.close()


def content_shas(kb_ids) -> Optional[dict]:
    """{kb_id: content_sha} for these rows (review #751 delta 3: a clearance is bound to the text it cleared);
    None when the index cannot be read."""
    ids = sorted({int(k) for k in kb_ids or []})
    if not ids:
        return {}
    try:
        c = _connect()
    except sqlite3.Error:
        return None
    try:
        out = {}
        for i in range(0, len(ids), 500):
            chunk = ids[i:i + 500]
            out.update({int(k): str(s or "") for k, s in c.execute(
                f"SELECT kb_id, content_sha FROM docs WHERE kb_id IN ({','.join('?' * len(chunk))})", chunk)})
        return out
    except sqlite3.Error:
        return None
    finally:
        c.close()


def _linked_templates(d: dict, alias_to_templates: dict) -> list:
    """The setup templates a setup_knowledge row describes: its setup id and aliases are the leading tags (the sync
    writes setup id + aliases + family + 'setup_knowledge'); the last two tags are never used for linking."""
    if d.get("source") != "setup_knowledge" or str(d.get("category") or "").upper() != "SETUP":
        return []
    tags = [t.strip() for t in str(d.get("tags") or "").split(",") if t.strip()]
    if len(tags) < 3:
        return []
    names: set = set()
    for t in tags[:-2]:
        names |= alias_to_templates.get(_norm_alias(t), set())
    return sorted(names)


def excluded_by_template(template_admitted) -> list:
    """kb_ids of setup_knowledge SETUP rows that may describe a blocked setup (N-7b, N-15), fail closed:
      - linked templates ALL not admitted -> excluded;
      - a SETUP row whose tags resolve to NO template -> excluded (presence is not approval: a row we cannot tie to an
        admitted template may describe a blocked setup).
    Non-SETUP rows (principles, market reads, frameworks) are never excluded here."""
    if not os.path.isfile(index_path()):
        return None
    try:
        c = _connect()
    except sqlite3.Error:
        return None
    try:
        rows = c.execute("SELECT kb_id, setup_templates FROM docs WHERE source = 'setup_knowledge' "
                         "AND category = 'SETUP'").fetchall()
    except sqlite3.Error:
        return None                                  # r4 R4-6: cannot tell -> the caller withholds them all
    finally:
        c.close()
    out = []
    for kb_id, linked in rows:
        names = [n for n in str(linked or "").split("|") if n]
        if not names or not any(template_admitted(n) for n in names):
            out.append(int(kb_id))
    return out


REBUILDING = "the knowledge index is being rebuilt; try again shortly"


def ensure() -> dict:
    """The index is current for the installed pack (rebuilt if not). {ok, ...} or {ok: False, reason}.
    Review #751 (perf): a request never WAITS for another thread's (re)build (a schema change, a pack install): it is
    answered "being rebuilt" at once, and nothing is served from the old index meanwhile (fail closed)."""
    ts = pack.pack_ts()
    if not ts:
        return {"ok": False, "reason": "no Brain Pack installed"}
    info = built_info()
    if info.get("pack_ts") == str(ts) and info.get("schema") == str(SCHEMA):
        return {"ok": True, **info}
    if not _LOCK.acquire(blocking=False):
        return {"ok": False, "reason": REBUILDING}
    try:
        info = built_info()
        if info.get("pack_ts") == str(ts) and info.get("schema") == str(SCHEMA):
            return {"ok": True, **info}
        if _FAILED.get("ts") == ts and time.time() - _FAILED["at"] < FAIL_COOLDOWN_S:   # a NEW pack is tried at once
            return {"ok": False, "reason": REBUILDING}
        return build()
    finally:
        _LOCK.release()


def on_pack_install() -> None:
    """brain_sync.on_install callback: rebuild for the pack that just landed. Never raises.
    Dark: a no-op unless UCT_AGENT_KNOWLEDGE is on (read now, not at registration), so registering the kinds
    changes nothing on a server where the feature is off — no file is written, no CPU spent."""
    if str(os.environ.get("UCT_AGENT_KNOWLEDGE") or "").strip().lower() not in ("1", "true", "on", "yes"):
        return
    try:
        with _LOCK:
            build()
    except Exception:  # noqa: BLE001
        log.exception("[uct-agent knowledge] rebuild after pack install failed")


def content_words(question: str) -> list:
    toks = [t.lower() for t in _TOKEN.findall(question or "")]
    return [t for t in toks if t not in _STOP and (len(t) > 1 or t.isdigit())]


def _phrase(p: str) -> str:
    toks = _TOKEN.findall(str(p or "").lower())
    return ('"' + " ".join(toks) + '"') if toks else ""


def match_expr(question: str, phrases=None) -> str:
    """An FTS5 OR-query: the question's content words, its adjacent word pairs as phrases ("stage 2", "20 ema"), and
    any expansion phrases. Every term is quoted and built only from [A-Za-z0-9&] tokens, so no FTS operator can be
    injected. A phrase match scores on top of its words, so passages that say the exact thing rank first."""
    words = content_words(question)
    terms, seen = [], set()

    def add(t):
        if t and t not in seen:
            seen.add(t)
            terms.append(t)
    for w in words:
        add('"' + w + '"')
    for x, y in zip(words, words[1:]):
        add(_phrase(f"{x} {y}"))
    for p in phrases or []:
        add(_phrase(p))
    return " OR ".join(terms[:28])


def query(question: str, *, sources: list[str], exclude_categories: set[str], category: Optional[str] = None,
          limit: int = 40, phrases=None, exclude_ids=None, withhold_setup_knowledge_setups: bool = False) -> list[dict]:
    """Ranked candidate rows from ADMITTED sources only (policy applied in SQL, before ranking)."""
    expr = match_expr(question, phrases)
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
    if exclude_ids:
        where.append(f"d.kb_id NOT IN ({','.join('?' * len(exclude_ids))})")
        args.extend(int(i) for i in exclude_ids)
    if withhold_setup_knowledge_setups:
        where.append("NOT (d.source = 'setup_knowledge' AND d.category = 'SETUP')")
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
