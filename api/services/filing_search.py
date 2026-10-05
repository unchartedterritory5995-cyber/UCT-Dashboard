"""FT-058 / FT-059 / FT-060 -- boolean, proximity, synonym and section-scoped
search over SEC filing text. The Research > Depth "Filing search" panel.

What is indexed. For each tracked symbol, the newest original 10-K and the
newest original 10-Q, read from SEC EDGAR through `fundamentals_pit.sec_client`
(the one SEC transport; its declared User-Agent and fair-access pacing apply).
Each document is cut into sections by the COV-04 extractor
(`filing_blackline.locate_section`: Item 1A Risk Factors and Item 7 MD&A of a
10-K; Part I Item 2 MD&A and Part II Item 1A of a 10-Q) and every paragraph is
stored in an SQLite FTS5 table with its section, form, accession and filing
date. A section the extractor could not locate is recorded with its reason and
is simply not searchable; it is never guessed at.

The query language (the panel prints this):
  word            matches the word and its stems ("margin" finds "margins"),
                  plus its synonyms when the curated table has any (FT-059)
  =word           the word exactly: no synonyms, no stemming
  "a phrase"      the words in that order, exactly (no stemming)
  word*           prefix
  a AND b, a b    both;  a OR b  either;  NOT a / -a  exclude
  a NEAR/n b      a and b within n words of each other, either order (FT-058)
  ( ... )         grouping
  section:risk | section:mdna      restrict to one section (FT-060)
  form:10-K | form:10-Q            restrict to one form

Honesty rules, railed in tests/test_filing_search.py:
  * every hit names its filing (symbol, form, accession, filing date, URL) and
    its section, so a reader can open the source paragraph;
  * a symbol that is not indexed answers `not_indexed`/`pending` with the
    reason, never an empty hit list presented as "no matches";
  * the synonym expansion actually used is returned, so a hit that came from a
    synonym is never mistaken for the word typed;
  * exactness (`=word`, quoted phrases) is enforced on the paragraph text after
    the index match for top-level terms; inside OR / NEAR the index's stemmed
    match is used, and the response says so.

Request path: reads the local FTS5 store only. A symbol not yet indexed is
queued on this module's own one-thread worker (the same shape as
`filing_blackline._schedule`); the request never waits on SEC.
DARK behind FILING_SEARCH_ENABLED: unset, the route 404s and nothing is queued.
"""
from __future__ import annotations

import contextlib
import json
import logging
import os
import re
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from itertools import product
from typing import Any, Optional

_logger = logging.getLogger(__name__)

ENABLED_ENV = "FILING_SEARCH_ENABLED"
SOURCE = ("SEC EDGAR primary documents (newest original 10-K and 10-Q), read via "
          "fundamentals_pit.sec_client; sections located by the COV-04 extractor")
FORMS = ("10-K", "10-Q")
DEFAULT_LIMIT = 40
MAX_LIMIT = 200
MAX_NEAR_EXPANSION = 25          # cartesian product of synonym alternatives inside one NEAR
MAX_QUERY_CHARS = 400
_MAX_QUEUED = 8
_MAX_TRACKED_PER_RUN = int(os.environ.get("FILING_SEARCH_MAX_PER_RUN", "40"))
_REINDEX_AFTER_S = 7 * 24 * 3600   # a weekly re-read picks up a newer 10-Q / 10-K
SNIP_OPEN, SNIP_CLOSE = "\u0001", "\u0002"

SECTION_LABELS = {
    "risk_factors": "Risk Factors (10-K Item 1A / 10-Q Part II Item 1A)",
    "mdna": "MD&A (10-K Item 7 / 10-Q Part I Item 2)",
}
_SECTION_ALIASES = {
    "risk": "risk_factors", "risks": "risk_factors", "risk_factors": "risk_factors",
    "riskfactors": "risk_factors", "1a": "risk_factors", "item1a": "risk_factors",
    "mdna": "mdna", "md&a": "mdna", "mda": "mdna", "7": "mdna", "item7": "mdna",
    "2": "mdna", "item2": "mdna",
}

# FT-059. Curated, filing-vocabulary synonyms. Keys are lower-case single words;
# values may be multi-word (searched as phrases). Deliberately small and
# reviewable: every expansion is returned to the caller.
SYNONYMS: dict[str, tuple[str, ...]] = {
    "guidance": ("outlook", "forecast", "expectations"),
    "headwind": ("headwinds", "adverse impact", "pressure"),
    "tariff": ("tariffs", "duties", "trade restrictions"),
    "layoff": ("layoffs", "workforce reduction", "headcount reduction", "restructuring"),
    "inflation": ("inflationary", "rising costs", "cost increases"),
    "recession": ("downturn", "economic slowdown", "contraction"),
    "competition": ("competitors", "competitive", "rivals"),
    "lawsuit": ("litigation", "legal proceedings", "lawsuits"),
    "cybersecurity": ("cyber attack", "cyberattack", "security breach", "security incident"),
    "demand": ("orders", "bookings", "backlog"),
    "shortage": ("shortages", "supply constraints", "supply chain disruption"),
    "ai": ("artificial intelligence", "machine learning", "generative ai"),
    "debt": ("borrowings", "indebtedness", "credit facility", "senior notes"),
    "buyback": ("repurchase", "repurchases", "share repurchase"),
    "acquisition": ("acquisitions", "merger", "business combination"),
    "china": ("prc", "greater china"),
    "rates": ("interest rates", "rate increases"),
    "currency": ("foreign exchange", "exchange rates", "fx"),
    "regulation": ("regulatory", "regulations", "legislation"),
    "pricing": ("prices", "price increases", "average selling price"),
}


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def db_path() -> str:
    return os.environ.get("FILING_SEARCH_DB_PATH", "/data/filing_search.db")


_write_lock = threading.Lock()
_SCHEMA = """
CREATE TABLE IF NOT EXISTS fs_doc (
  sym TEXT NOT NULL, form TEXT NOT NULL, accession TEXT NOT NULL, cik TEXT,
  filed TEXT, report_date TEXT, url TEXT, indexed_at INTEGER NOT NULL,
  sections_json TEXT NOT NULL,
  PRIMARY KEY (sym, form)
);
CREATE VIRTUAL TABLE IF NOT EXISTS fs_para USING fts5(
  text, sym UNINDEXED, form UNINDEXED, accession UNINDEXED, section UNINDEXED,
  para_no UNINDEXED, tokenize='porter unicode61'
);
CREATE TABLE IF NOT EXISTS fs_tracked (
  sym TEXT PRIMARY KEY, added_at INTEGER NOT NULL, last_try INTEGER,
  last_state TEXT, last_reason TEXT
);
"""


@contextlib.contextmanager
def _conn():
    path = db_path()
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    c = sqlite3.connect(path, timeout=2.0)
    try:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(_SCHEMA)
        yield c
    finally:
        c.close()


# ── query language ──────────────────────────────────────────────────────────

class QueryError(ValueError):
    """A query the language cannot express. The message is shown to the member."""


_TOKEN_RX = re.compile(r'\s*(?:(\()|(\))|"([^"]*)"|(NEAR(?:/(\d+))?)(?![\w/])|([^\s()"]+))')
_WORD_RX = re.compile(r"^[\w&'.\-]+\*?$", re.UNICODE)


def _tokens(q: str) -> list[tuple[str, Any]]:
    out: list[tuple[str, Any]] = []
    pos = 0
    q = q.strip()
    while pos < len(q):
        m = _TOKEN_RX.match(q, pos)
        if not m or m.end() == pos:
            raise QueryError(f"could not read the query at: {q[pos:pos + 20]!r}")
        pos = m.end()
        lp, rp, phrase, near, near_n, word = m.groups()
        if lp:
            out.append(("(", None))
        elif rp:
            out.append((")", None))
        elif phrase is not None:
            words = phrase.split()
            if not words:
                raise QueryError("an empty quoted phrase")
            out.append(("phrase", " ".join(words)))
        elif near:
            out.append(("near", int(near_n) if near_n else 10))
        else:
            up = word.upper()
            if up in ("AND", "OR", "NOT"):
                out.append((up.lower(), None))
            elif ":" in word and word.split(":", 1)[0].lower() in ("section", "form"):
                k, v = word.split(":", 1)
                out.append((k.lower(), v))
            else:
                out.append(("word", word))
    return out


class _Parser:
    """or_expr := and_expr (OR and_expr)*
    and_expr := unary ((AND)? unary)*
    unary    := (NOT | -) unary | near
    near     := primary (NEAR/n primary)*
    primary  := word | "phrase" | ( or_expr )"""

    def __init__(self, toks):
        self.t, self.i = toks, 0
        self.section: Optional[str] = None
        self.form: Optional[str] = None

    def peek(self):
        return self.t[self.i][0] if self.i < len(self.t) else None

    def take(self):
        tok = self.t[self.i]
        self.i += 1
        return tok

    def parse(self):
        # scope tokens may sit anywhere; pull them out first
        rest = []
        for kind, val in self.t:
            if kind == "section":
                key = _SECTION_ALIASES.get(val.lower())
                if not key:
                    raise QueryError(f"unknown section {val!r}: use section:risk or section:mdna")
                self.section = key
            elif kind == "form":
                v = val.upper()
                if v not in FORMS:
                    raise QueryError(f"unknown form {val!r}: use form:10-K or form:10-Q")
                self.form = v
            else:
                rest.append((kind, val))
        self.t = rest
        if not self.t:
            raise QueryError("nothing to search for")
        node = self.or_expr()
        if self.i != len(self.t):
            raise QueryError(f"unexpected {self.t[self.i][0]!r} in the query")
        return node

    def or_expr(self):
        parts = [self.and_expr()]
        while self.peek() == "or":
            self.take()
            parts.append(self.and_expr())
        return parts[0] if len(parts) == 1 else ("or", parts)

    def and_expr(self):
        items = [self.unary()]
        while self.peek() not in (None, "or", ")"):
            if self.peek() == "and":
                self.take()
            items.append(self.unary())
        return items[0] if len(items) == 1 else ("and", items)

    def unary(self):
        if self.peek() == "not":
            self.take()
            return ("not", self.unary())
        if self.peek() == "word" and self.t[self.i][1].startswith("-") and len(self.t[self.i][1]) > 1:
            _, w = self.take()
            self.t.insert(self.i, ("word", w[1:]))
            return ("not", self.unary())
        return self.near()

    def near(self):
        first = self.primary()
        operands, dist = [first], None
        while self.peek() == "near":
            _, n = self.take()
            if dist is not None and n != dist:
                raise QueryError("a chain of NEAR operators must use one distance")
            dist = n
            operands.append(self.primary())
        if dist is None:
            return first
        for op in operands:
            if op[0] not in ("term", "phrase"):
                raise QueryError("NEAR joins words or quoted phrases, not groups")
        return ("near", operands, dist)

    def primary(self):
        kind = self.peek()
        if kind == "(":
            self.take()
            node = self.or_expr()
            if self.peek() != ")":
                raise QueryError("a '(' is never closed")
            self.take()
            return node
        if kind == "phrase":
            return ("phrase", self.take()[1])
        if kind == "word":
            w = self.take()[1]
            exact = w.startswith("=")
            if exact:
                w = w[1:]
            prefix = w.endswith("*")
            if prefix:
                w = w[:-1]
            if not w or not _WORD_RX.match(w + ("*" if prefix else "")):
                raise QueryError(f"cannot search for {w!r}")
            return ("term", w, exact, prefix)
        raise QueryError(f"expected a word or phrase, found {kind!r}")


def _q(s: str) -> str:
    return '"' + s.replace('"', '""') + '"'


def _alternatives(node, expanded: dict) -> list[str]:
    """FTS5 phrase strings this operand can match."""
    if node[0] == "phrase":
        return [_q(node[1])]
    _, w, exact, prefix = node
    if prefix:
        return [_q(w) + "*"]
    alts = [_q(w)]
    if not exact:
        syn = SYNONYMS.get(w.lower())
        if syn:
            expanded[w.lower()] = list(syn)
            alts += [_q(s) for s in syn]
    return alts


def _compile(node, expanded: dict, nested: list) -> str:
    kind = node[0]
    if kind in ("term", "phrase"):
        alts = _alternatives(node, expanded)
        return alts[0] if len(alts) == 1 else "(" + " OR ".join(alts) + ")"
    if kind == "near":
        nested.append("near")
        _, ops, dist = node
        choices = [_alternatives(o, expanded) for o in ops]
        combos = list(product(*choices))
        if len(combos) > MAX_NEAR_EXPANSION:
            combos = [tuple(c[0] for c in choices)]
            nested.append("near_synonyms_dropped")
        parts = [f"NEAR({' '.join(c)}, {dist})" for c in combos]
        return parts[0] if len(parts) == 1 else "(" + " OR ".join(parts) + ")"
    if kind == "or":
        nested.append("or")
        return "(" + " OR ".join(_compile(p, expanded, nested) for p in node[1]) + ")"
    if kind == "not":
        raise QueryError("NOT needs something to exclude from: write 'a NOT b'")
    if kind == "and":
        pos = [p for p in node[1] if p[0] != "not"]
        neg = [p[1] for p in node[1] if p[0] == "not"]
        if not pos:
            raise QueryError("NOT needs something to exclude from: write 'a NOT b'")
        s = " AND ".join(_compile(p, expanded, nested) for p in pos)
        if len(pos) > 1:
            s = "(" + s + ")"
        for n in neg:
            s = f"{s} NOT {_compile(n, expanded, nested)}"
        return "(" + s + ")" if neg else s
    raise QueryError(f"unsupported query node {kind!r}")


def _exact_filters(node) -> list[tuple[str, str]]:
    """Top-level positive exact terms and phrases: (kind, text). Only these are
    enforced on the paragraph text; anything nested is matched stemmed."""
    items = node[1] if node[0] == "and" else [node]
    out = []
    for it in items:
        if it[0] == "phrase":
            out.append(("phrase", it[1]))
        elif it[0] == "term" and it[2] and not it[3]:
            out.append(("word", it[1]))
    return out


def _passes(text: str, filters) -> bool:
    low = " ".join((text or "").lower().split())
    for kind, val in filters:
        v = " ".join(val.lower().split())
        if kind == "phrase":
            if not re.search(r"(?<!\w)" + re.escape(v) + r"(?!\w)", low):
                return False
        elif not re.search(r"(?<!\w)" + re.escape(v) + r"(?!\w)", low):
            return False
    return True


def compile_query(q: str) -> dict:
    """{'fts', 'section', 'form', 'expanded', 'exact', 'notes'} or QueryError."""
    q = (q or "").strip()
    if not q:
        raise QueryError("nothing to search for")
    if len(q) > MAX_QUERY_CHARS:
        raise QueryError(f"a query is at most {MAX_QUERY_CHARS} characters")
    p = _Parser(_tokens(q))
    node = p.parse()
    expanded: dict = {}
    nested: list = []
    fts = _compile(node, expanded, nested)
    notes = []
    if "near" in nested or "or" in nested:
        notes.append("Exact words and quoted phrases inside OR or NEAR match their stemmed forms; "
                     "exactness is enforced only for top-level terms.")
    if "near_synonyms_dropped" in nested:
        notes.append(f"A NEAR with more than {MAX_NEAR_EXPANSION} synonym combinations was searched "
                     "with the words as typed, without synonyms.")
    return {"fts": fts, "section": p.section, "form": p.form, "expanded": expanded,
            "exact": _exact_filters(node), "notes": notes}


# ── indexing (OFF the request path) ─────────────────────────────────────────

def index_document(sym: str, form: str, meta: dict, doc: bytes | str) -> dict:
    """Cut one filing into sections with the COV-04 extractor and replace this
    (sym, form)'s indexed document. Returns the per-section record."""
    from api.services import filing_blackline as fb
    sym = sym.upper()
    blocks = fb.html_blocks(doc)
    sections, rows = [], []
    for spec in fb.FORM_SECTIONS[form]:
        loc = fb.locate_section(blocks, spec)
        if loc.get("found"):
            paras = loc["paragraphs"]
            state = "reference_only" if loc.get("reference_only") else "ok"
            sections.append({"key": spec["key"], "label": spec["label"], "state": state,
                             "paragraphs": len(paras)})
            for i, para in enumerate(paras):
                rows.append((para, sym, form, meta["accession"], spec["key"], i))
        else:
            sections.append({"key": spec["key"], "label": spec["label"],
                             "state": "omitted" if loc.get("omitted") else "not_found",
                             "reason": loc.get("reason"), "paragraphs": 0})
    with _write_lock, _conn() as c:
        c.execute("DELETE FROM fs_para WHERE sym=? AND form=?", (sym, form))
        c.executemany("INSERT INTO fs_para (text, sym, form, accession, section, para_no) "
                      "VALUES (?,?,?,?,?,?)", rows)
        c.execute("INSERT OR REPLACE INTO fs_doc (sym, form, accession, cik, filed, report_date, url, "
                  "indexed_at, sections_json) VALUES (?,?,?,?,?,?,?,?,?)",
                  (sym, form, meta["accession"], meta.get("cik"), meta.get("filing_date"),
                   meta.get("report_date"), meta.get("url"), int(time.time()), json.dumps(sections)))
        c.commit()
    return {"sym": sym, "form": form, "accession": meta["accession"], "sections": sections,
            "paragraphs": len(rows)}


def _sec_get(url: str) -> bytes:
    """The one SEC transport. Indirection so tests replace it by name."""
    from api.services.fundamentals_pit import sec_client
    return sec_client.get_bytes(url, retries=1, timeout=30)


def index_symbol(sym: str) -> dict:
    """OFF THE REQUEST PATH ONLY. Reads the submissions index and the newest
    original 10-K and 10-Q, and indexes each. Never raises; the outcome is
    recorded on fs_tracked."""
    from api.services import filing_blackline as fb
    sym = (sym or "").upper().strip()
    out: dict = {"sym": sym, "forms": {}}
    state, reason = "ok", None
    try:
        cik = fb._resolve_cik(sym)
        if not cik:
            raise LookupError(f"no SEC filer matched {sym}")
        cik = str(cik).zfill(10)
        submissions = json.loads(_sec_get(f"https://data.sec.gov/submissions/CIK{cik}.json"))
        for form in FORMS:
            listing = fb.find_filings(submissions, form, _sec_get, n=1)
            if not listing["filings"]:
                out["forms"][form] = {"state": "none_on_file"}
                continue
            f = listing["filings"][0]
            url = fb.document_url(cik, f["accession"], f["primary_document"])
            meta = {**f, "cik": cik, "url": url}
            out["forms"][form] = index_document(sym, form, meta, _sec_get(url))
        if not any(v.get("paragraphs") for v in out["forms"].values()):
            state, reason = "empty", "no locatable section text in the newest 10-K or 10-Q"
    except LookupError as exc:
        state, reason = "not_found", str(exc)
    except Exception as exc:  # noqa: BLE001 -- recorded as a state, never swallowed silently
        _logger.warning("filing search index failed for %s: %s", sym, exc)
        state, reason = "unavailable", f"{type(exc).__name__}: {exc}"[:300]
    with _write_lock, _conn() as c:
        c.execute("INSERT INTO fs_tracked (sym, added_at, last_try, last_state, last_reason) "
                  "VALUES (?,?,?,?,?) ON CONFLICT(sym) DO UPDATE SET last_try=excluded.last_try, "
                  "last_state=excluded.last_state, last_reason=excluded.last_reason",
                  (sym, int(time.time()), int(time.time()), state, reason))
        c.commit()
    out.update(state=state, reason=reason)
    return out


_qlock = threading.Lock()
_queued: set[str] = set()
_executor: Optional[ThreadPoolExecutor] = None


def _run(sym: str) -> None:
    try:
        index_symbol(sym)
    finally:
        with _qlock:
            _queued.discard(sym)


def schedule_index(sym: str) -> bool:
    """Queue one symbol on this module's own worker. Refuses when the flag is
    off, when it is already queued, or when the queue is full."""
    global _executor
    if not is_enabled():
        return False
    with _qlock:
        if sym in _queued or len(_queued) >= _MAX_QUEUED:
            return False
        _queued.add(sym)
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="filing-search")
        ex = _executor
    ex.submit(_run, sym)
    return True


def run_reindex() -> dict:
    """Scheduled job: re-read tracked symbols whose index is older than a week,
    oldest first, bounded per run. A no-op while the flag is off."""
    if not is_enabled():
        return {"skipped": "flag off"}
    cutoff = int(time.time()) - _REINDEX_AFTER_S
    with _conn() as c:
        rows = c.execute("SELECT sym FROM fs_tracked WHERE COALESCE(last_try, 0) < ? "
                         "ORDER BY COALESCE(last_try, 0) LIMIT ?", (cutoff, _MAX_TRACKED_PER_RUN)).fetchall()
    done = [index_symbol(r[0])["state"] for r in rows]
    return {"symbols": len(done), "ok": done.count("ok")}


# ── search (REQUEST PATH: the local store only) ─────────────────────────────

def _doc_state(c, sym: str) -> dict:
    docs = c.execute("SELECT form, accession, filed, url, indexed_at, sections_json FROM fs_doc "
                     "WHERE sym=? ORDER BY form", (sym,)).fetchall()
    tr = c.execute("SELECT last_state, last_reason, last_try FROM fs_tracked WHERE sym=?",
                   (sym,)).fetchone()
    return {"documents": [{"form": d[0], "accession": d[1], "filed": d[2], "url": d[3],
                           "indexed_at": d[4], "sections": json.loads(d[5])} for d in docs],
            "tracked": None if tr is None else {"state": tr[0], "reason": tr[1], "last_try": tr[2]}}


def search(q: str, sym: Optional[str] = None, form: Optional[str] = None,
           section: Optional[str] = None, limit: int = DEFAULT_LIMIT) -> dict:
    compiled = compile_query(q)
    sym = (sym or "").upper().strip() or None
    form = (form or "").upper().strip() or compiled["form"]
    if form and form not in FORMS:
        raise QueryError(f"unknown form {form!r}")
    if section:
        key = _SECTION_ALIASES.get(section.lower())
        if not key:
            raise QueryError(f"unknown section {section!r}: use risk or mdna")
        section = key
    section = section or compiled["section"]
    limit = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))

    base = {"query": q, "fts": compiled["fts"], "expanded": compiled["expanded"],
            "notes": compiled["notes"], "scope": {"sym": sym, "form": form, "section": section},
            "source": SOURCE, "section_labels": SECTION_LABELS}
    with _conn() as c:
        if sym:
            st = _doc_state(c, sym)
            base["documents"] = st["documents"]
            if not st["documents"]:
                tracked = st["tracked"]
                if tracked and tracked["state"] in ("not_found", "empty", "unavailable"):
                    base.update(index_state=tracked["state"], reason=tracked["reason"], hits=[], count=None)
                    return base
                queued = schedule_index(sym)
                base.update(index_state="pending", queued=queued, hits=[], count=None,
                            reason=f"{sym}'s filings are not indexed yet; they were queued for indexing"
                                   if queued else f"{sym}'s filings are not indexed yet")
                return base
        where, params = ["fs_para MATCH ?"], [compiled["fts"]]
        for col, val in (("sym", sym), ("form", form), ("section", section)):
            if val:
                where.append(f"{col} = ?")
                params.append(val)
        sql = ("SELECT sym, form, accession, section, para_no, text, "
               f"snippet(fs_para, 0, '{SNIP_OPEN}', '{SNIP_CLOSE}', ' ... ', 32) "
               "FROM fs_para WHERE " + " AND ".join(where) + " ORDER BY bm25(fs_para) LIMIT ?")
        try:
            rows = c.execute(sql, [*params, limit * 4 if compiled["exact"] else limit + 1]).fetchall()
        except sqlite3.OperationalError as exc:
            raise QueryError(f"the index could not run this query ({exc})") from exc
        docs = {(d[0], d[1]): d for d in c.execute(
            "SELECT sym, form, accession, filed, url, indexed_at FROM fs_doc").fetchall()}
        n_docs = len(docs)
    hits = []
    for s, f, acc, sec, para_no, text, snip in rows:
        if compiled["exact"] and not _passes(text, compiled["exact"]):
            continue
        d = docs.get((s, f))
        hits.append({"sym": s, "form": f, "accession": acc, "filed": d[3] if d else None,
                     "url": d[4] if d else None, "section": sec,
                     "section_label": SECTION_LABELS.get(sec, sec), "para_no": para_no, "snippet": snip})
    truncated = len(hits) > limit
    hits = hits[:limit]
    as_of = max((d[5] for d in docs.values()), default=None)
    base.update(index_state="indexed" if sym else "corpus", hits=hits, count=len(hits),
                truncated=truncated, corpus_documents=n_docs, as_of=as_of,
                snippet_marks=[SNIP_OPEN, SNIP_CLOSE])
    return base
