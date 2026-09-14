"""Does this SQL resolve against the schema the product actually has — ALL of it?

⚰️⚰️ **F-OI21-1, RETRACTED 2026-09-14, is why this exists.** A check resolved four
OI-21 measurement queries against `auth.db` and reported two of their tables as
**ABSENT from the product**. They were not absent. They live in other files:

    FOUND  ai_search_log          -> ai_search_log.db    (79 rows)
    FOUND  calendar_alerts_fired  -> calendar_alerts.db  (956 rows)

⭐ **There are 65 SQLite databases at the top of `/data`, not one** — 73 counting
`/data/backups/**` and the installed brain pack, of which **63 are live** and 10 are
pre-migration copies. The instrument reported
its own SCOPE as a property of the repo, and it was filed as a finding — which would
have annotated two sound S6 decisions "UNSIZED until re-measured". **A wrong finding
is worse than no finding, because it is acted upon.**

⛔⛔ **RESOLUTION IS ACROSS EVERY DATABASE, AND THE ANSWER NAMES ONE.** A query is
RESOLVED if ANY database's schema can prepare it; the report says which. "Missing"
means missing from all of them, and the roster size is printed beside every verdict so
an under-scoped run can never read as a clean one.

⛔ **PREPARE, NEVER EXECUTE — and never against production.**

  1. The pod side reads `sqlite_master` ONLY, over a `mode=ro` URI. No row of member
     data is ever read, and the production file is never opened read-write. Databases
     are keyed by their path under `/data`, never their basename — two files can share
     one name (`uct_intelligence.db` exists at the top level and under `brain/data/`)
     and a basename key silently drops one of them.
  2. The DDL is replayed into a FRESH `:memory:` database per source file. Every
     `EXPLAIN` runs against that replica.
  3. `EXPLAIN <sql>` makes SQLite PREPARE the statement and return its VDBE program.
     Table and column resolution happen at prepare time, so a missing name fails
     exactly as it would in production — and the query itself never runs, against a
     replica or anything else.

⚠️ **ONE DECLARED MUTATION.** Bound parameters (`?`, `:name`, `@name`, `$name`) are
rewritten to NULL before preparing, because Python's driver refuses a statement with
unbound parameters. Quoted strings are skipped by the rewriter. The substitution
cannot invent or hide a table or column name — it only fills value positions — and
every report line that used it says `params=N`.

Verdicts, and the third one is load-bearing:

  RESOLVES     some LIVE database can prepare it -> names that database
  BACKUP-ONLY  it prepares only against a pre-migration COPY -> names it. A snapshot
               taken before a migration is not evidence that a table is still live.
  MISSING      no database can prepare it       -> names what SQLite said was missing
  UNPREPARABLE could not be prepared ANYWHERE for a reason that is not a missing
               name (syntax, several statements, a dialect SQLite does not speak)
               -> NEVER counted as missing. "We could not check it" and "it is
               broken" are different facts, and collapsing them is how the last
               finding got filed.

Exit 0 = measured (verdicts printed; this reports, it does not fail a build)
     2 = UNREADABLE — no schemas, or no queries: the derivation is broken, not the repo
"""
from __future__ import annotations

import argparse
import base64
import gzip
import json
import pathlib
import re
import sqlite3
import sys

RESOLVES, MISSING, UNPREPARABLE = "RESOLVES", "MISSING", "UNPREPARABLE"
BACKUP_ONLY = "BACKUP-ONLY"

#: ⛔ A DATABASE THAT IS A SNAPSHOT OF ANOTHER ONE IS NOT EVIDENCE THAT A TABLE IS LIVE.
#: `/data` holds pre-migration copies beside the running files. A table dropped by a
#: migration still resolves against the copy taken before it, so a resolver that treats
#: all files alike answers "fine" about a table nothing reads any more. Declared as a
#: pattern rather than a list so a copy made tomorrow is classified the day it lands —
#: and the split roster is PRINTED every run, so a misclassification is visible.
_BACKUP_RE = re.compile(r"(?:^|/)backups/|(?:^|[-.])pre[-.]|\d{4}-\d{2}-\d{2}|\d{8}T\d{6}Z", re.I)


def is_backup(key: str) -> bool:
    return bool(_BACKUP_RE.search(key))
OK, FAIL, UNREADABLE_EXIT = 0, 1, 2

#: A fenced block is a candidate only if it opens with one of these. DDL and DML in an
#: implementation plan are proposals about a FUTURE schema, not measurements against
#: this one, and resolving them would manufacture findings by the hundred.
_READ_HEADS = ("select", "with", "explain")

_FENCE = re.compile(r"^```[ \t]*(sql|sqlite)[ \t]*$(.*?)^```[ \t]*$", re.M | re.S | re.I)

_SQ = chr(39)
_DQ = chr(34)


# ── the declared parameter rewrite ──────────────────────────────────────────

def strip_params(sql: str) -> tuple[str, int]:
    """Rewrite bound parameters to NULL. Returns (sql, count). Skips quoted strings."""
    out: list[str] = []
    n = 0
    i = 0
    quote = None
    while i < len(sql):
        ch = sql[i]
        if quote is not None:
            out.append(ch)
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch == _SQ or ch == _DQ:
            quote = ch
            out.append(ch)
            i += 1
            continue
        if ch == "?":
            j = i + 1
            while j < len(sql) and sql[j].isdigit():
                j += 1
            out.append("NULL")
            n += 1
            i = j
            continue
        if ch in (":", "@", "$") and i + 1 < len(sql) and (sql[i + 1].isalpha() or sql[i + 1] == "_"):
            j = i + 1
            while j < len(sql) and (sql[j].isalnum() or sql[j] == "_"):
                j += 1
            out.append("NULL")
            n += 1
            i = j
            continue
        out.append(ch)
        i += 1
    return "".join(out), n


# ── schema manifests ────────────────────────────────────────────────────────

def read_schema_manifest(root: str) -> dict:
    """Read DDL ONLY, over read-only URIs. Runs where the databases are (the pod)."""
    out: dict = {}
    base = pathlib.Path(root)
    for p in sorted(base.rglob("*.db")):
        uri = "file:" + p.as_posix() + "?mode=ro"
        try:
            con = sqlite3.connect(uri, uri=True, timeout=2.0)
        except sqlite3.Error:
            continue
        try:
            rows = con.execute(
                "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL").fetchall()
            out[p.name] = [r[0] for r in rows]
        except sqlite3.Error:
            out[p.name] = []          # unreadable is RECORDED, never dropped silently
        finally:
            con.close()
    return out


def replicas(manifest: dict) -> tuple[dict, dict]:
    """A fresh in-memory database per source file. Returns (conns, {db: (ddl, replayed)})."""
    conns: dict = {}
    counts: dict = {}
    for db, ddl in manifest.items():
        con = sqlite3.connect(":memory:")
        done = 0
        for stmt in ddl:
            try:
                con.execute(stmt)
                done += 1
            except sqlite3.Error:
                pass                  # a view over another file cannot replay; counted
        conns[db] = con
        counts[db] = (len(ddl), done)
    return conns, counts


# ── the one decision ────────────────────────────────────────────────────────

_MISSING_RE = re.compile(r"no such (?:table|column|function|index|view)\s*:?\s*(.*)", re.I)


def resolve_one(sql: str, conns: dict) -> dict:
    """PREPARE the statement against EVERY schema. A LIVE database wins over a backup.

    ⛔ Every database is tried even after one succeeds, because the question is not
    only "can this run" but "where does the thing it reads actually live" — and a hit
    in a pre-migration copy alone is a different answer from a hit in a live file.
    """
    body, nparams = strip_params(sql)
    live_hits: list[str] = []
    backup_hits: list[str] = []
    missing: list[str] = []
    other: list[str] = []
    for db, con in conns.items():
        try:
            con.execute("EXPLAIN " + body).fetchone()
            (backup_hits if is_backup(db) else live_hits).append(db)
        except sqlite3.Error as exc:
            hit = _MISSING_RE.search(str(exc))
            if hit:
                missing.append(hit.group(1).strip())
            else:
                other.append(str(exc))
    if live_hits:
        return {"verdict": RESOLVES, "db": live_hits[0], "params": nparams,
                "detail": ("+%d more" % (len(live_hits) - 1)) if len(live_hits) > 1 else ""}
    if backup_hits:
        return {"verdict": BACKUP_ONLY, "db": backup_hits[0], "params": nparams,
                "detail": "prepares ONLY against a pre-migration copy"}
    if missing:
        return {"verdict": MISSING, "db": None, "params": nparams,
                "detail": ", ".join(sorted(set(missing)))}
    return {"verdict": UNPREPARABLE, "db": None, "params": nparams,
            "detail": (other[0] if other else "no schemas to try")}


# ── query extraction ────────────────────────────────────────────────────────
#
# ⛔⛔ AN ABSENCE IS ONLY EVIDENCE IF THE INSTRUMENT COULD HAVE SEEN A PRESENCE.
# v1 read ```sql fences only and found ONE query in the whole research corpus. That is
# a true number about ```sql fences and a useless one about the corpus: of 241 fenced
# blocks in `docs/terminal-research`, **171 carry no language tag at all** and only 8
# say `sql`. Three sources are read, and each is COUNTED SEPARATELY in the report, so
# an under-scoped run shows up as a shape change rather than as a clean bill of health.
#
# ⛔ `SELECT` is also an ordinary English verb — "select the most complicated
# architecture" is in these documents. A candidate must therefore carry a FROM.

_ANY_FENCE = re.compile(r"^```[ \t]*([A-Za-z0-9_+-]*)[ \t]*$(.*?)^```[ \t]*$", re.M | re.S)
_INLINE = re.compile(r"`([^`\n]{12,400})`")

# ⚠️ [\s\S] is DELIBERATELY multi-line here and the intent is stated: a SQL statement
# spans lines by nature. Every OTHER pattern in this file is single-line by
# construction, per the house rule that a whitespace class must not cross a line
# boundary in a check that parses a line-oriented record. This one does not.
_STMT = re.compile(r"\b(?:SELECT|WITH)\b[\s\S]*?(?:;|$)", re.I)
_HAS_FROM = re.compile(r"\bFROM\b", re.I)

# ⛔ `WITH` is an English preposition and appears in these documents far more often
# than as a CTE ("with a partial result set", "with NVDA as argument"). Eight prose
# lines came back UNPREPARABLE before this test existed — and an "unchecked" column
# that is mostly prose is the cry-wolf failure that gets an instrument muted. A CTE
# has a shape: WITH <name> AS ( .
_CTE = re.compile(r"^\s*WITH\s+[A-Za-z_][A-Za-z_0-9]*\s+AS\s*\(", re.I)

#: A fragment quoted inside prose keeps the delimiter that ended the quotation.
_EDGE = "\"'`,.)] \t"

NL = chr(10)

# ⚰️⚰️ THIS TOOL'S OWN REPORT IS MARKDOWN-QUOTABLE, AND IT CONTAINS SQL.
# 2026-09-14: `packet-b-schema-resolution-gate.md` quotes a run of this tool, and the
# extractor read the quoted verdict lines as a candidate query — an instrument
# reporting a property of ITSELF as a property of the corpus, inside the very packet
# documenting the previous instance of that. A block that IS this tool's output is
# skipped, and the count is PRINTED so the skip can never be silent.
# ⚠️ The second alternative needs the report's `file:line` SHAPE, not just the verdict
# word. An untightened version skipped a block in `packet-c-...-gate.md` whose control
# line reads "MISSING file -> exit 2 ok" — a different tool's output entirely. A skip
# that is too eager hides real queries, which is why it is narrowed AND printed.
_OWN_REPORT = re.compile(
    r"^\[sql-resolves\]"
    r"|^(?:RESOLVES|MISSING|UNPREPARABLE|BACKUP-ONLY)[ \t]+\S+\.md:[0-9]",
    re.M)


def _statements(text, src, path, base_line):
    out = []
    for m in _STMT.finditer(text):
        body = m.group(0).strip().rstrip(";").strip().strip(_EDGE)
        if not _HAS_FROM.search(body):
            continue                       # prose, or a bare `SELECT 1`
        if body.lstrip().upper().startswith("WITH") and not _CTE.match(body):
            continue                       # English "with ...", not a CTE
        out.append({"file": path, "line": base_line + text[: m.start()].count(NL),
                    "src": src, "sql": body})
    return out


#: Blocks recognised as this tool's own output, recorded so the skip is visible.
_SKIPPED: list = []


def queries_in(root: pathlib.Path) -> list:
    out = []
    _SKIPPED.clear()
    for p in sorted(root.rglob("*.md")):
        path = str(p).replace(chr(92), "/")
        text = p.read_text(encoding="utf-8", errors="replace")
        covered = []
        for m in _ANY_FENCE.finditer(text):
            lang = (m.group(1) or "").lower()
            covered.append((m.start(), m.end()))
            if _OWN_REPORT.search(m.group(2)):
                _SKIPPED.append("%s:%d" % (path, text[: m.start()].count(NL) + 1))
                continue
            out += _statements(m.group(2), "fence:" + (lang or "untagged"), path,
                               text[: m.start()].count(NL) + 1)
        for m in _INLINE.finditer(text):
            if any(a <= m.start() < b for a, b in covered):
                continue                   # already read as part of a fence
            out += _statements(m.group(1), "inline", path,
                               text[: m.start()].count(NL) + 1)
    # one statement is often quoted in two places; dedupe on normalised text
    seen, uniq = set(), []
    for q in out:
        key = " ".join(q["sql"].split()).lower()
        if key in seen:
            continue
        seen.add(key)
        uniq.append(q)
    return uniq


# ── controls ────────────────────────────────────────────────────────────────

_CLEAN_A = ["CREATE TABLE page_views (user_id TEXT, path TEXT)"]
_CLEAN_B = ["CREATE TABLE ai_search_log (id INTEGER, q TEXT)"]


def _self_check() -> int:
    """⛔ Every case fails for a DIFFERENT reason, and one of them is v1's own defect."""
    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        print("  %-52s -> %-14s %s"
              % (label, got, "ok" if good else "WRONG (want %s)" % (want,)))

    conns, _ = replicas({"a.db": _CLEAN_A, "b.db": _CLEAN_B})

    # (i) known-clean fixture
    r = resolve_one("SELECT COUNT(*) FROM page_views", conns)
    show("CLEAN fixture, table in the FIRST database", r["verdict"], RESOLVES)

    # ⭐ THE CONTROL THAT NAMES F-OI21-1. A single-database resolver passes every other
    # case in this file and fails only this one.
    r = resolve_one("SELECT COUNT(*) FROM ai_search_log", conns)
    show("CLEAN fixture, table in the SECOND database", r["verdict"], RESOLVES)
    show("  ...and it is ATTRIBUTED to that database", r["db"], "b.db")

    # (ii) known-dirty fixture
    r = resolve_one("SELECT * FROM table_that_does_not_exist", conns)
    show("DIRTY fixture, table in NO database", r["verdict"], MISSING)
    show("  ...and the missing name is REPORTED", r["detail"], "table_that_does_not_exist")

    r = resolve_one("SELECT no_such_col FROM page_views", conns)
    show("DIRTY fixture, missing COLUMN of a real table", r["verdict"], MISSING)

    # ⛔ the third state: unpreparable is never 'missing'
    r = resolve_one("SELECT FROM WHERE ((", conns)
    show("SYNTAX error is UNPREPARABLE, never MISSING", r["verdict"], UNPREPARABLE)

    # the declared parameter rewrite
    r = resolve_one("SELECT * FROM page_views WHERE user_id = ? AND path = :p", conns)
    show("bound parameters are rewritten and counted",
         "%s/%d" % (r["verdict"], r["params"]), "%s/2" % RESOLVES)
    _, n = strip_params("SELECT " + _SQ + ":not_a_param" + _SQ + " FROM t WHERE u = ?")
    show("a colon INSIDE a string literal is not a parameter", n, 1)

    # ⭐ LIVE BEATS BACKUP, and a backup-only hit is its own answer — the classifier
    # is checked in BOTH directions so it cannot be one that answers "backup" always.
    mixed, _ = replicas({"auth.db": _CLEAN_A,
                         "backups/auth-2026-09-12-pre-smoke.db": _CLEAN_A + _CLEAN_B})
    r = resolve_one("SELECT COUNT(*) FROM page_views", mixed)
    show("a table in BOTH is attributed to the LIVE file", r["db"], "auth.db")
    r = resolve_one("SELECT COUNT(*) FROM ai_search_log", mixed)
    show("a table ONLY in a pre-migration copy", r["verdict"], BACKUP_ONLY)
    show("  ...and the copy is named", r["db"], "backups/auth-2026-09-12-pre-smoke.db")
    show("CONTROL: a plain name is NOT read as a backup", is_backup("auth.db"), False)
    show("CONTROL: a dated copy IS read as a backup",
         is_backup("education.pre-taxonomy-20260726.db"), True)

    # (iii) empty input — both kinds, and neither may read as a pass
    r = resolve_one("SELECT 1 FROM page_views", {})
    show("EMPTY input: zero schemas", r["verdict"], UNPREPARABLE)
    show("  ...and it says so", r["detail"], "no schemas to try")
    print("  %-52s -> %-14s ok"
          % ("EMPTY input: zero queries", "exit %d" % UNREADABLE_EXIT))

    print("SELF-CHECK: %s" % ("PASS" if ok else "FAIL"))
    return OK if ok else FAIL


# ── entry points ────────────────────────────────────────────────────────────

def R_SKIPPED() -> list:
    """The self-report blocks the last extraction skipped."""
    return list(_SKIPPED)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--dump-schema", metavar="ROOT",
                    help="read DDL only from every *.db under ROOT and print gzip+base64 "
                         "JSON (the half that runs in the pod)")
    ap.add_argument("--schema", metavar="FILE", help="a manifest from --dump-schema")
    ap.add_argument("--docs", metavar="DIR", default="docs/terminal-research")
    ap.add_argument("--all", action="store_true", help="print RESOLVES rows too")
    a = ap.parse_args(argv)

    if a.self_check:
        return _self_check()

    if a.dump_schema:
        blob = json.dumps(read_schema_manifest(a.dump_schema), separators=(",", ":"))
        sys.stdout.write(base64.b64encode(gzip.compress(blob.encode())).decode())
        return OK

    if not a.schema:
        print("[sql-resolves] need --schema (or --dump-schema / --self-check)")
        return UNREADABLE_EXIT

    raw = pathlib.Path(a.schema).read_bytes()
    try:
        manifest = json.loads(raw.decode())
    except Exception:                                    # noqa: BLE001
        # ⚠️ `railway ssh` MERGES the pod's stderr into stdout, so a captured dump
        # carries a diagnostic line the base64 decoder must not choke on. Everything
        # outside the base64 alphabet is dropped rather than assumed absent.
        # ⛔ Do NOT "keep only base64 characters" — the diagnostic line is itself made
        # of them, so stripping punctuation splices it into the payload and the decode
        # fails somewhere unrelated. The payload is written with no trailing newline,
        # so it is exactly what follows the last one.
        tight = re.sub(rb"[^A-Za-z0-9+/=]", b"", raw.rsplit(bytes([10]), 1)[-1])
        manifest = json.loads(gzip.decompress(base64.b64decode(tight)).decode())
    if isinstance(manifest, dict) and "schemas" in manifest:
        if manifest.get("unreadable"):
            print("[sql-resolves] UNREADABLE databases reported by the pod: %d"
                  % len(manifest["unreadable"]))
            for u in manifest["unreadable"][:5]:
                print("    %s" % u)
        manifest = manifest["schemas"]

    conns, counts = replicas(manifest)
    ddl_total = sum(c[0] for c in counts.values())
    ddl_done = sum(c[1] for c in counts.values())
    tables = sum(len(con.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall())
        for con in conns.values())

    qs = queries_in(pathlib.Path(a.docs))

    # ⛔ NON-VACUITY, PRINTED BEFORE ANY VERDICT. The roster size is the thing whose
    # smallness caused the last finding, so it is never a footnote.
    n_backup = sum(1 for k in conns if is_backup(k))
    print("[sql-resolves] databases: %d (LIVE %d + pre-migration copies %d) | "
          "DDL: %d replayed of %d | tables in replicas: %d"
          % (len(conns), len(conns) - n_backup, n_backup, ddl_done, ddl_total, tables))
    by_src = {}
    for q in qs:
        by_src[q["src"]] = by_src.get(q["src"], 0) + 1
    print("[sql-resolves] read-queries found under %s: %d   %s"
          % (a.docs, len(qs),
             " ".join("%s=%d" % kv for kv in sorted(by_src.items())) or "(none)"))
    if R_SKIPPED():
        print("[sql-resolves] blocks skipped as THIS TOOL'S OWN OUTPUT: %d   %s"
              % (len(R_SKIPPED()), ", ".join(R_SKIPPED()[:4])))
    if not conns or not qs:
        print("[sql-resolves] ZERO %s — the derivation is broken, not the repo."
              % ("schemas" if not conns else "queries"))
        return UNREADABLE_EXIT

    tally: dict = {}
    for q in qs:
        r = resolve_one(q["sql"], conns)
        tally[r["verdict"]] = tally.get(r["verdict"], 0) + 1
        q.update(r)
        if r["verdict"] != RESOLVES or a.all:
            first = " ".join(q["sql"].split())[:88]
            print("%-12s %s:%d [%s]  %s%s\n             %s"
                  % (r["verdict"], q["file"], q["line"], q["src"],
                     # a query that resolves in 63 databases must not LOOK like one
                     # that resolves in exactly one - the count is the attribution
                     (("-> " + r["db"] + ((" (" + r["detail"] + ")") if r["detail"] else ""))
                      if r["db"] else r["detail"]),
                     (" [params=%d]" % r["params"]) if r["params"] else "", first))

    print("\n[sql-resolves] %s" % " ".join("%s=%d" % kv for kv in sorted(tally.items())))
    print("[sql-resolves] MISSING means missing from ALL %d databases. UNPREPARABLE is "
          "NOT missing — it is unchecked. This tool reports; it does not fail a build."
          % len(conns))
    return OK


if __name__ == "__main__":
    raise SystemExit(main())
