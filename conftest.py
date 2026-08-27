"""Repo-root conftest — AUTH_DB_PATH isolation for EVERY collection root.

`tests/conftest.py` has installed this isolation since `021b4926`, and it works
— but a conftest only reaches the directory it lives in. There are 93 test files
under `api/**` (mixed `*_test.py` and `test_*.py`) with no conftest of their own,
so `pytest api/services/journal_two/test_trades.py` — or any run that does not
also collect `tests/` — got NO isolation at all and wrote straight into the real
store: `C:\\data\\auth.db`, 20,640 users deep and holding the owner's live j2_*
tables. Nothing surfaced that, because those 93 files were never in the suite.

⚠️ THIS MUST RUN AT CONFTEST IMPORT, NOT IN A FIXTURE. `AUTH_DB_PATH` is read
ONCE, at module import, by six product modules (auth_db,
awareness.regime_snapshots, bar_provenance, bar_quarantine, bars_audit,
indicator_alert_service) — `get_connection()` closes over the module global, not
over `os.environ` — so a `monkeypatch.setenv` in a fixture reaches none of them.
The repo-root conftest is imported before any other conftest and before any test
module, so nothing can capture the unisolated path ahead of it.

`tests/conftest.py` READS this value back rather than minting a second temp
store: two isolated stores in one session would split the six import-time
capturers from the seven journal_two modules that re-read per call.
"""
import ast
import os
import sys
import tempfile

import pytest

ISOLATED_AUTH_DB = os.path.join(
    tempfile.mkdtemp(prefix="uct_tests_authdb_"), "auth.db"
)
os.environ["AUTH_DB_PATH"] = ISOLATED_AUTH_DB


# ─────────────────────────────────────────────────────────────────────────────
#  C:\data — THE SHARED PRODUCTION ROOT, AND THE TRIPWIRE THAT KEEPS TESTS OUT
# ─────────────────────────────────────────────────────────────────────────────
#
# `AUTH_DB_PATH` above is ONE env var. It is not one bug — it is one instance of
# a class, and the class is still open:
#
#     `/data` is a real directory on this box, so every product path that
#     resolves to `/data/...` resolves to `C:\data\...` — the SAME files the
#     owner's live services read. A test that reaches one does not fail. It
#     succeeds, silently, into production state.
#
# MEASURED, by AST over `api/**`: 55 distinct `/data…` string literals at the
# time of writing — but READ `len(SHARED_DATA_LITERALS)` rather than trusting
# that number, because it is recomputed every session and this comment is not.
# Two of them have already cost real damage — `C:\data\auth.db` grew
# to 1.01 GB / 20,640 users off ~40 `setenv` calls that isolated nothing, and
# `C:\data\screener.db` took a single row (ticker `A`, `snapshot_date`
# 2026-08-08) from `test_refresh_admin_starts`, which then made the member-facing
# screener label 3,583 month-old rows as "today" (`e86ad6d5`).
#
# 🔴 WHY AN ENV OVERRIDE IS NOT ENOUGH, and this is the whole reason this exists:
#
#     A `monkeypatch` env override lives for the test. A DAEMON THREAD DOES NOT.
#
# `POST /api/screener/refresh` hands the real builder to a `daemon=True` thread
# and returns. The test returned, `monkeypatch` unset `SCREENER_DB_PATH`, and the
# still-running thread resolved `get_db_path()` AFTERWARDS — with the override
# gone. There are 260 thread/task spawn sites in `api/**`; every one of them can
# do this, and none of them is visible to the test that started it, because an
# exception in a daemon thread goes to `threading.excepthook` and disappears.
#
# So this section is TWO things, and the second is the one that matters:
#
#   1. A REDIRECT.  Every env var the census can associate with a `/data`
#      literal is pinned, at conftest import, to a per-session sandbox. This is
#      what keeps the suite green: the ordinary resolution simply never names a
#      real file, and a post-teardown resolution falls back to the sandbox
#      instead of to `C:\data`.
#
#   2. A TRIPWIRE.  ⭐ A redirect alone HIDES THE NEXT OFFENDER — 8 of the 55
#      literals still have no env override at all (`/data/trades.json`,
#      `/data/avatars`, `/data/watchlists.json`, …), so a redirect on its own
#      would quietly leave them pointed at production. Instead, every write
#      primitive (`sqlite3.connect`, `open`, `os.makedirs`/`mkdir`/`remove`/`rename`/
#      `replace`) RAISES when its path lands under the shared root, RECORDS the
#      attempt with the test id, the thread name and a stack, and FAILS THE RUN
#      at session finish. A guard that only redirects is a guard nobody ever
#      sees fire; this one names the file, the test and the thread.
#
# ⚠️ BOTH HALVES MUST RUN AT CONFTEST IMPORT, for the same reason the auth pin
# does: 127 of the 212 env read sites are module-level captures, and a wrapper
# installed after `sqlite3` has been re-exported into a product module is a
# wrapper that guards nothing. The repo-root conftest is imported before any
# other conftest and before any test module.
#
# ⚠️ THE LISTS ARE DERIVED FROM THE AST, NEVER TYPED. `_fetch_naaim`'s no-network
# guard read `inspect.getsource` of one function and went vacuously green the day
# the names moved out of it; the rails in `tests/test_shared_data_root_guard.py`
# derive the same census independently and fail BY LITERAL when the two disagree.

import builtins
import contextlib
import io
import sqlite3
import threading
import traceback


class SharedDataRootWrite(RuntimeError):
    """A test process tried to write inside the real, shared production root."""


def _api_source_files():
    api_root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "api")
    for dirpath, dirnames, filenames in os.walk(api_root):
        dirnames[:] = [d for d in dirnames
                       if d not in ("__pycache__", "node_modules")]
        for name in filenames:
            if not name.endswith(".py"):
                continue
            if name.startswith("test_") or name.endswith("_test.py"):
                continue
            yield os.path.join(dirpath, name)


def _is_shared_literal(value) -> bool:
    """A string constant that names something inside the shared data root."""
    if not isinstance(value, str) or len(value) < 5:
        return False
    head = value.replace("\\", "/").lower()
    return head == "/data" or head.startswith("/data/")


def _env_read_name(node):
    """The env var this expression reads, or None. `os.environ[X]`/`.get(X)`."""
    if isinstance(node, ast.Subscript):
        try:
            base = ast.unparse(node.value)
        except Exception:  # noqa: BLE001
            return None
        if base.endswith("environ") and isinstance(node.slice, ast.Constant) \
                and isinstance(node.slice.value, str):
            return node.slice.value
        return None
    if isinstance(node, ast.Call):
        try:
            fn = ast.unparse(node.func)
        except Exception:  # noqa: BLE001
            return None
        if fn.endswith("environ.get") or fn.endswith("getenv"):
            if node.args and isinstance(node.args[0], ast.Constant) \
                    and isinstance(node.args[0].value, str):
                return node.args[0].value
    return None


def _env_read_default(node):
    """The literal default of an `os.environ.get(X, "/data/y")` read."""
    if isinstance(node, ast.Call) and len(getattr(node, "args", ())) > 1:
        dflt = node.args[1]
        if isinstance(dflt, ast.Constant) and _is_shared_literal(dflt.value):
            return dflt.value
    return None


def _scopes(tree):
    """Every function body, plus the module body with functions excluded.

    A path resolver in this repo is almost always a whole scope:

        p = os.environ.get("COMMUNITY_DB_PATH")
        if p: return p
        if os.path.isdir("/data"): return "/data/community.db"

    — the literal is NOT the `.get()` default, so pairing them needs the scope,
    not the call. 22 of the 55 literals are reached this way.
    """
    fns = [n for n in ast.walk(tree)
           if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    top = [n for n in tree.body
           if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef,
                                 ast.ClassDef))]
    return fns + [top]


#: Words that say "this is a path" and nothing about WHICH path, so they can
#: never be the evidence that an env var and a literal describe the same file.
_GENERIC_PATH_WORDS = {"PATH", "DIR", "DB", "FILE", "ROOT", "MOUNT", "CACHE",
                       "DEFAULT", "DATA", "STORE", "JSON", "SQLITE", "LOCAL"}


def _words(text: str) -> set:
    out = set()
    for chunk in text.replace("-", "_").replace(".", "_").replace("/", "_").split("_"):
        if chunk:
            out.add(chunk.upper())
    return out - _GENERIC_PATH_WORDS


def _names_agree(var: str, literal: str) -> bool:
    """Do this env var and this literal plainly describe the same thing?

    `COT_DB_PATH` / `/data/cot.db` -> yes. `UCT_INTEL_PATH` /
    `/data/wire_data.json` -> no, and that pairing is exactly what an untightened
    scope rule produced.
    """
    base = os.path.basename(literal.rstrip("/"))
    # A `_DIR` var and a `foo.db` literal are the same WORD and different
    # SHAPES: `FLOW_TAPE_SPOOL_DIR` matched `/data/flow.db` on "FLOW" and would
    # have pointed a directory at a file.
    if "DIR" in var.upper().split("_") and "." in base:
        return False
    return bool(_words(var) & _words(base))


def shared_data_root_census():
    """`(literals, env_pins, unpinnable)` for `api/**`. AST, never grep.

    * `literals`   — `{"/data/x.db": ["rel/path.py:12", …]}`, every constant
                     naming something inside the shared root.
    * `env_pins`   — `{"COT_DB_PATH": "/data/cot.db"}`: an env var that, when
                     set, moves that literal. Two derivations, unioned —
                     (A) the literal IS the `.get()` default, and
                     (B) exactly one path-shaped env var and exactly one
                         SPECIFIC literal share a scope AND their names share a
                         word.
                     ⛔ Every clause of (B) is there because a looser version
                     produced a WRONG pin when it was run: without "specific"
                     (dropping the bare `/data`, which is just `DATA_DIR`'s
                     default sitting in the same `if`), `SCREENER_DB_PATH`
                     itself was skipped as ambiguous; without the shared word,
                     `UCT_INTEL_PATH` — a DIRECTORY for the brain pack — was
                     pinned to `/data/wire_data.json`, a file. Ambiguous scopes
                     are skipped on purpose: a wrong pin is worse than no pin,
                     because the tripwire below still catches what a pin misses,
                     while a wrong pin breaks a working test.
    * `unpinnable` — literals no env var reaches. These are the ones the
                     tripwire is the ONLY protection for, and the rail prints
                     them by name so the count can never silently grow.
    """
    root = os.path.dirname(os.path.abspath(__file__))
    literals, pins = {}, {}
    for path in _api_source_files():
        try:
            src = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        if "/data" not in src:                      # cheap pre-filter only
            continue
        try:
            tree = ast.parse(src, path)
        except SyntaxError:
            continue
        rel = os.path.relpath(path, root).replace(os.sep, "/")
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and _is_shared_literal(node.value):
                literals.setdefault(node.value.replace("\\", "/"), []).append(
                    f"{rel}:{node.lineno}")
        for scope in _scopes(tree):
            nodes = []
            for n in (scope if isinstance(scope, list) else [scope]):
                nodes.extend(ast.walk(n))
            here_lits, here_vars = set(), set()
            for n in nodes:
                if isinstance(n, ast.Constant) and _is_shared_literal(n.value):
                    here_lits.add(n.value.replace("\\", "/"))
                var = _env_read_name(n)
                if var is None:
                    continue
                dflt = _env_read_default(n)
                if dflt is not None:                       # (A) direct default
                    pins[var] = dflt.replace("\\", "/")
                elif any(tok in var for tok in
                         ("PATH", "DIR", "_DB", "DB_", "FILE", "ROOT", "MOUNT")):
                    here_vars.add(var)
            specific = {l for l in here_lits if l.strip("/").lower() != "data"}
            if len(specific) == 1 and len(here_vars) == 1:   # (B) one-to-one
                var, lit = here_vars.pop(), specific.pop()
                if _names_agree(var, lit):
                    pins.setdefault(var, lit)
    pinned_literals = set(pins.values())
    unpinnable = sorted(set(literals) - pinned_literals)
    return literals, dict(sorted(pins.items())), unpinnable


#: ⛔ PAIRINGS THE CENSUS IS *CORRECT* TO MISS, DECLARED BY HAND.
#:
#: Derivation (B) requires the env var and the literal to share a word, and the
#: census docstring records why: a looser version pinned `UCT_INTEL_PATH` (a
#: directory) to `/data/wire_data.json` (a file). Conservative is right there —
#: *"a wrong pin is worse than no pin"*.
#:
#: But conservative leaves ABBREVIATIONS unpinned, and an unpinned literal is
#: one a test can only be saved from by the tripwire — which fires on a DAEMON
#: THREAD as an invisible raise while the spawning test passes GREEN. That is
#: exactly how `test_user_definition_edit_forget` reached the real
#: `C:\data\single_stock_etfs.db` (X18): it kicks a screener-warm thread.
#:
#: ⛔ So the fix is NOT to loosen the heuristic. It is to declare what a human
#: can see and a name-similarity check cannot — with the `file:line` that proves
#: the pairing, and a rail (below) that FAILS if a declaration stops being true.
#: Shrink this map; never grow it to silence a red.
EXPLICIT_ENV_PINS = {
    # ⭐ EMPTY, AND THAT IS THE GOAL STATE — not a gap.
    #
    # Its one entry was `SSETF_DB_PATH` -> `/data/single_stock_etfs.db`
    # (X18): `api/services/single_stock_etfs.py` read the var in one
    # statement and returned the literal in the next, and "SSETF" shares no
    # word with "single_stock_etfs", so neither derivation could see it.
    #
    # W9j.1 reshaped `_resolve_db_path` so that literal is the env read's
    # DEFAULT. Derivation (A) pairs that shape with no shared word needed,
    # so the census now owns the pairing and the declaration became
    # redundant. ⛔ A redundant declaration is not free: it is a SECOND
    # AUTHORITY over one pairing, and the prose beside it had already
    # stopped being true. Deleted rather than kept.
    #
    # The rails still run against an empty map: they prove
    # `_explicit_pin_is_still_real` can answer YES and NO, so the mechanism
    # is ready the day a pairing genuinely outruns both derivations again.
}


def _explicit_pin_is_still_real(var, literal):
    """Does some file under `api/` still read `var` AND name `literal`?

    ⛔ THE ANTI-ROT CHECK. A declared exception that has quietly stopped being
    true is a lie the next reader inherits — this branch has already paid for a
    stale declared count sitting next to a real rail and reddening it for
    cosmetic reasons. Deliberately loose (same FILE, not same scope): it exists
    to catch a pin that has become fiction, not to re-derive the pairing.
    """
    for path in _api_source_files():
        try:
            src = path.read_text(encoding="utf-8") if hasattr(path, "read_text") \
                else io.open(path, encoding="utf-8").read()
        except (OSError, UnicodeDecodeError):
            continue
        if var in src and literal in src.replace("\\", "/"):
            return True
    return False


SHARED_DATA_LITERALS, SHARED_DATA_ENV_PINS, UNPINNABLE_SHARED_LITERALS = \
    shared_data_root_census()

# ⭐ MERGED, NOT REPLACED — a declared pin never overrides a derived one. If the
# census learns to see a pairing on its own, the derivation wins and the hand
# declaration becomes redundant rather than authoritative.
for _v, _l in EXPLICIT_ENV_PINS.items():
    SHARED_DATA_ENV_PINS.setdefault(_v, _l)
UNPINNABLE_SHARED_LITERALS = sorted(
    set(UNPINNABLE_SHARED_LITERALS) - set(SHARED_DATA_ENV_PINS.values()))


def unguarded_literal_sites():
    """`[(file, line, funcname, literal), …]` a pin can NEVER reach.

    🔴 THIS EXISTS BECAUSE THE PIN MAP LIED BY OMISSION, AND THE SUITE CAUGHT IT.
    `SHARED_DATA_ENV_PINS` records that SOME env var names a literal. It does not
    record that every SITE spelling that literal reads one. Two did not:

        api/flow_db.py:132   def __init__(self, db_path="/data/flow.db")
        api/baselines.py:97  def init_db(db_path="/data/flow.db")

    — DEFAULT ARGUMENTS, in functions with no env read at all, called with no
    argument from `massive_ws_worker`'s consumer thread and from
    `liveflow_worker`'s module body. `FLOW_DB_PATH` was pinned the whole time and
    both wrote to `C:\\data\\flow.db` anyway, because a pin moves an env READ and
    there was none to move.

    So: any FUNCTION that mentions a shared literal and reads NO env var is a
    site the redirect cannot touch and only the tripwire covers. Module-level
    statements are deliberately NOT scanned — the two-statement idiom
    (`_DEFAULT = "/data/cot.db" if isdir(...) else …` then
    `DB_PATH = environ.get("COT_DB_PATH", _DEFAULT)`) would false-positive on
    every one of them, and a rail that cries wolf is a rail that gets deleted.
    """
    found = []
    for path in _api_source_files():
        try:
            src = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        if "/data" not in src:
            continue
        try:
            tree = ast.parse(src, path)
        except SyntaxError:
            continue
        rel = os.path.relpath(
            path, os.path.dirname(os.path.abspath(__file__))
        ).replace(os.sep, "/")
        for fn in ast.walk(tree):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            nodes = list(ast.walk(fn))
            literals = [(n.value.replace("\\", "/"), n.lineno) for n in nodes
                        if isinstance(n, ast.Constant) and _is_shared_literal(n.value)]
            if not literals:
                continue
            if any(_env_read_name(n) is not None for n in nodes):
                continue
            for value, lineno in literals:
                found.append((rel, lineno, fn.name, value))
    return sorted(set(found))


UNGUARDED_SHARED_LITERAL_SITES = unguarded_literal_sites()

#: `C:\data` on this box. DERIVED from the literals the product itself writes —
#: the first path segment of each — so it cannot drift from the code it guards.
SHARED_DATA_ROOTS = sorted({
    os.path.normcase(os.path.abspath("/" + lit.strip("/").split("/")[0]))
    for lit in SHARED_DATA_LITERALS
} or {os.path.normcase(os.path.abspath("/data"))})

#: Where the redirect sends everything instead.
SANDBOX_DATA_ROOT = tempfile.mkdtemp(prefix="uct_tests_datadir_")


def sandbox_for(literal: str) -> str:
    """`/data/cot.db` -> `<sandbox>/cot.db`; `/data` -> `<sandbox>`.

    `/data/auth.db` is special-cased to the ONE isolated auth store minted
    above: `CALENDAR_SEEN_DB_PATH` defaults to that same file, and pointing it
    at a second sandbox copy would split a store that six import-time capturers
    and seven per-call readers are supposed to agree on.
    """
    tail = literal.replace("\\", "/").strip("/")
    tail = tail[len("data"):].strip("/")
    if not tail:
        return SANDBOX_DATA_ROOT
    if tail == "auth.db":
        return ISOLATED_AUTH_DB
    return os.path.join(SANDBOX_DATA_ROOT, *tail.split("/"))


def _norm(path) -> str:
    return os.path.normcase(os.path.abspath(path))


#: Mutable so a rail can point the tripwire at a throwaway PROBE directory and
#: watch it fire without ever going near `C:\data`. See `pretend_shared_root`.
_ACTIVE_SHARED_ROOTS = list(SHARED_DATA_ROOTS)

# ─── the redirect ───────────────────────────────────────────────────────────
# Pinned only when the current value would land inside the shared root (unset
# counts): an env var already pointed somewhere safe — `AUTH_DB_PATH`, or a real
# OS-level override on a developer's box — is left exactly as it is.
def _redirect_shared_root_env_vars():
    applied = {}
    for var, literal in SHARED_DATA_ENV_PINS.items():
        current = os.environ.get(var)
        if current and not any(
                _norm(current) == r or _norm(current).startswith(r + os.sep)
                for r in SHARED_DATA_ROOTS):
            continue
        target = sandbox_for(literal)
        os.environ[var] = target
        applied[var] = target
    return applied


SHARED_ROOT_ENV_REDIRECTS = _redirect_shared_root_env_vars()


# ─── the tripwire ───────────────────────────────────────────────────────────

#: Every attempt, in order. A daemon thread's raise is INVISIBLE — it goes to
#: `threading.excepthook` and the test that started it passes — so raising is
#: only half of this. The record is what fails the run.
SHARED_ROOT_VIOLATIONS = []
#: Reads are not corruption, but they make a test depend on a mutable artifact
#: other processes rewrite. Recorded, never fatal.
SHARED_ROOT_READS = []

#: `enforce` (default) raises, records, and fails the run.
#: `report` records only — the audit mode used to measure what a tree does
#: before the guard is armed, so "nothing reaches C:\data" is a MEASUREMENT and
#: not an assumption.  `off` installs nothing.
_GUARD_MODE = os.environ.get("UCT_TEST_SHARED_ROOT_GUARD", "enforce").lower()
_CURRENT_TEST = [None]


def _shared_root_hit_against(path, roots):
    """The normalised path when it is inside one of `roots`, else None."""
    if not roots:
        return None
    try:
        raw = os.fspath(path)
    except TypeError:
        return None
    if isinstance(raw, bytes):
        try:
            raw = raw.decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            return None
    if not isinstance(raw, str):
        return None
    lowered = raw.lower()
    # Cheap reject first: `open()` is on every hot path in the interpreter and
    # `abspath` costs a `getcwd`. A path that does not even mention the root's
    # own directory name cannot be inside it.
    if not any(os.path.basename(r).lower() in lowered for r in roots):
        return None
    try:
        full = _norm(raw)
    except (ValueError, OSError):
        return None
    for root in roots:
        if full == root or full.startswith(root + os.sep):
            return full
    return None


def _shared_root_hit(path):
    """The normalised path when it is inside an ACTIVE shared root, else None."""
    return _shared_root_hit_against(path, _ACTIVE_SHARED_ROOTS)


def _record(kind, op, path):
    rec = {
        "op": op,
        "path": path,
        "test": _CURRENT_TEST[0],
        "thread": threading.current_thread().name,
        "stack": [f"{f.filename}:{f.lineno} {f.name}"
                  for f in traceback.extract_stack()[-14:-2]],
    }
    (SHARED_ROOT_READS if kind == "read" else SHARED_ROOT_VIOLATIONS).append(rec)
    return rec


def _refuse(op, path):
    rec = _record("write", op, path)
    if _GUARD_MODE == "enforce":
        raise SharedDataRootWrite(
            f"{op} -> {path}\n"
            f"    That is the SHARED PRODUCTION data root. A test must never "
            f"write there.\n"
            f"    test={rec['test']}  thread={rec['thread']}\n"
            f"    If this fired from a non-main thread, the write is escaping "
            f"AFTER teardown:\n"
            f"    the handler handed work to a background thread and "
            f"monkeypatch has already unwound.\n"
            f"    Fix the test (stub the worker / join the thread), or teach "
            f"conftest.py to pin\n"
            f"    the env var that names this file."
        )


_real_sqlite_connect = sqlite3.connect
_real_open = builtins.open
_real_io_open = io.open
_real_makedirs = os.makedirs
_real_mkdir = os.mkdir
_real_remove = os.remove
_real_unlink = os.unlink
_real_rename = os.rename
_real_replace = os.replace


def _sqlite_target(database, kwargs):
    """`(filesystem path, is_read_only)` for a `connect()` argument.

    ⚠️ A URI form has to be UNWRAPPED before the root check, not string-matched
    after it: `abspath("file:C:/data/x.db?mode=ro")` is a relative path under
    the CWD, so a naive check reports "outside the root" for a connection that
    is very much inside it.
    """
    try:
        raw = os.fspath(database)
    except TypeError:
        return None, False
    if not isinstance(raw, str):
        return None, False
    if kwargs.get("uri") and raw.startswith("file:"):
        from urllib.parse import parse_qs, unquote, urlsplit
        parts = urlsplit(raw)
        path = unquote(parts.path) or unquote(parts.netloc)
        query = parse_qs(parts.query)
        # `mode=ro` opens nothing and creates nothing — E-1 read the live
        # screener DB exactly that way, on purpose.
        readonly = (query.get("mode", [""])[0] == "ro"
                    or query.get("immutable", ["0"])[0] in ("1", "true"))
        return path, readonly
    return raw, False


def _guarded_sqlite_connect(database=":memory:", *args, **kwargs):
    target, readonly = _sqlite_target(database, kwargs)
    hit = _shared_root_hit(target) if target else None
    if hit is not None:
        if readonly:
            _record("read", "sqlite3.connect(mode=ro)", hit)
        else:
            _refuse("sqlite3.connect", hit)
    return _real_sqlite_connect(database, *args, **kwargs)


_WRITE_MODE_CHARS = ("w", "a", "x", "+")


def _guarded_open(file, mode="r", *args, **kwargs):
    hit = _shared_root_hit(file)
    if hit is not None:
        m = mode if isinstance(mode, str) else "r"
        if any(c in m for c in _WRITE_MODE_CHARS):
            _refuse(f"open(mode={m!r})", hit)
        else:
            _record("read", f"open(mode={m!r})", hit)
    return _real_open(file, mode, *args, **kwargs)


def _guard_one_arg(real, label):
    def _wrapped(path, *args, **kwargs):
        hit = _shared_root_hit(path)
        if hit is not None:
            _refuse(label, hit)
        return real(path, *args, **kwargs)
    _wrapped.__name__ = getattr(real, "__name__", label)
    return _wrapped


def _guard_two_arg(real, label):
    def _wrapped(src, dst, *args, **kwargs):
        for candidate in (src, dst):
            hit = _shared_root_hit(candidate)
            if hit is not None:
                _refuse(label, hit)
        return real(src, dst, *args, **kwargs)
    _wrapped.__name__ = getattr(real, "__name__", label)
    return _wrapped


def _arm_shared_root_tripwire():
    """Install the wrappers. Idempotent; a no-op when the guard is `off`."""
    if _GUARD_MODE == "off" or getattr(sqlite3.connect, "_uct_guarded", False):
        return
    _guarded_sqlite_connect._uct_guarded = True
    _guarded_open._uct_guarded = True
    sqlite3.connect = _guarded_sqlite_connect
    sqlite3.dbapi2.connect = _guarded_sqlite_connect
    # `pathlib.Path.open` reaches `io.open`, which is a SEPARATE name binding
    # from `builtins.open` even though they start as the same object. Rebinding
    # one and not the other is a guard with a hole in it.
    builtins.open = _guarded_open
    io.open = _guarded_open
    os.makedirs = _guard_one_arg(_real_makedirs, "os.makedirs")
    os.mkdir = _guard_one_arg(_real_mkdir, "os.mkdir")
    os.remove = _guard_one_arg(_real_remove, "os.remove")
    os.unlink = _guard_one_arg(_real_unlink, "os.unlink")
    os.rename = _guard_two_arg(_real_rename, "os.rename")
    os.replace = _guard_two_arg(_real_replace, "os.replace")


_arm_shared_root_tripwire()


@contextlib.contextmanager
def pretend_shared_root(*paths):
    """Point the tripwire at throwaway PROBE directories for the duration.

    ⭐ This is how a rail watches the guard FIRE without going anywhere near
    `C:\\data` — writes to a real production file are classifier-blocked here
    and would be unforgivable anyway. The real roots are swapped OUT, not added
    to, so the probe run cannot mask them and cannot be masked by them.
    """
    previous = list(_ACTIVE_SHARED_ROOTS)
    _ACTIVE_SHARED_ROOTS[:] = [_norm(p) for p in paths]
    try:
        yield
    finally:
        _ACTIVE_SHARED_ROOTS[:] = previous


@contextlib.contextmanager
def captured_shared_root_attempts():
    """Take ownership of everything the tripwire records inside this block.

    A rail that WATCHES the guard fire produces violations on purpose, and
    `pytest_sessionfinish` would then fail the run on the proof that the run is
    clean. So the records are moved out of the session tally and handed to the
    caller instead of being left in it.
    """
    w0, r0 = len(SHARED_ROOT_VIOLATIONS), len(SHARED_ROOT_READS)
    taken = {"writes": [], "reads": []}
    try:
        yield taken
    finally:
        taken["writes"].extend(SHARED_ROOT_VIOLATIONS[w0:])
        taken["reads"].extend(SHARED_ROOT_READS[r0:])
        del SHARED_ROOT_VIOLATIONS[w0:]
        del SHARED_ROOT_READS[r0:]


def pytest_runtest_logstart(nodeid, location):
    """Attribute every violation to the test that was running when it happened.

    Recorded at violation time rather than read back afterwards, because the
    interesting ones arrive from a thread that outlived its test — the whole
    point — and by then `nodeid` has already moved on.
    """
    _CURRENT_TEST[0] = nodeid


@pytest.fixture(autouse=True)
def _no_write_reached_the_shared_data_root():
    """Fail the offending test immediately when the write is on its own thread.

    A write from a BACKGROUND thread can land after this fixture has finished,
    so it is not the whole gate — `pytest_sessionfinish` below is. This half
    exists so the common case names the test in its own failure rather than in a
    summary 11,000 tests later.
    """
    start = len(SHARED_ROOT_VIOLATIONS)
    yield
    mine = [v for v in SHARED_ROOT_VIOLATIONS[start:]
            if v["thread"] == "MainThread"]
    if mine and _GUARD_MODE == "enforce":
        raise AssertionError(
            "this test wrote inside the shared production data root:\n"
            + "\n".join(f"  {v['op']} -> {v['path']}" for v in mine)
        )


def pytest_sessionfinish(session, exitstatus):
    """The real gate: ANY violation, from ANY thread, at ANY time, fails the run.

    ⚠️ This is the half that catches the daemon thread, and it is the reason
    this is not just a redirect. `threading.excepthook` swallows the raise, the
    test that spawned the thread passes, and without a session-level tally the
    escape is invisible — which is exactly how ticker `A` reached
    `C:\\data\\screener.db` under 11,000 green tests.
    """
    out = sys.stderr
    if SHARED_ROOT_READS:
        # Not fatal — a read corrupts nothing. It does make the test depend on a
        # mutable artifact three other processes rewrite, so it is named.
        out.write(f"\nNOTE: {len(SHARED_ROOT_READS)} read(s) of the shared "
                  f"production data root:\n")
        for v in SHARED_ROOT_READS:
            out.write(f"  {v['op']} -> {v['path']}   [{v['test']}]\n")
    if not SHARED_ROOT_VIOLATIONS:
        out.flush()
        return
    out.write("\n" + "=" * 78 + "\n")
    out.write(f"SHARED PRODUCTION DATA ROOT WRITTEN TO BY THE TEST SUITE — "
              f"{len(SHARED_ROOT_VIOLATIONS)} attempt(s)\n")
    out.write("=" * 78 + "\n")
    for v in SHARED_ROOT_VIOLATIONS:
        out.write(f"  {v['op']} -> {v['path']}\n")
        out.write(f"      test   : {v['test']}\n")
        out.write(f"      thread : {v['thread']}\n")
        for frame in v["stack"][-6:]:
            out.write(f"      at     : {frame}\n")
    out.flush()
    if _GUARD_MODE == "enforce" and session.exitstatus == 0:
        session.exitstatus = 1


# ─── the SPLIT SESSION: a reload rebinds an import-time capture FOREVER ──────
#
# The block above pins the env var, and that is enough for the SEVEN
# `journal_two/*` modules that re-read `os.environ` on every call. It is NOT
# enough for the SIX modules that read it once at import, because ~45 fixtures
# in this repo do:
#
#     monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
#     importlib.reload(auth_db)          # ← re-executes `_DB_PATH = environ...`
#
# `monkeypatch` unwinds the ENV VAR at teardown. Nothing unwinds the RELOAD.
# `auth_db._DB_PATH` keeps pointing at that fixture's scratch file for the rest
# of the session, so from the next test onwards the process is running SPLIT:
# the import-time readers open one file, the per-call readers open another.
#
# MEASURED, and this is the whole defect:
#
#     pytest tests/theme_engine/test_store.py tests/test_compass_voice_bridge.py
#       → 4 failed  ·  sqlite3.OperationalError: no such table: j2_chat_messages
#     pytest tests/test_compass_voice_bridge.py
#       → 6 passed
#
# The victim calls `auth_db.init_db()` — which builds the j2_* schema in the
# STALE scratch file — then reads it back through
# `coach_chat._conn()`, which re-reads the env var and opens the ISOLATED store,
# where nothing ever created that table. Neither half is wrong on its own; they
# are simply looking at two different files. Any ordering that puts a reloading
# fixture before a mixed reader reproduces it, which is why the suite failed
# order-dependently and named a different victim each time.
#
# So the invariant this restores, before EVERY test, is:
#
#     every import-time AUTH_DB_PATH capturer agrees with os.environ["AUTH_DB_PATH"]
#
# ⚠️ SETUP, not teardown. A repair at teardown would have to run before the
# test's own `monkeypatch` unwound, and fixture finalisation order is not ours
# to rely on. Repairing at setup needs no ordering guarantee at all: a test that
# wants its own store still reloads afterwards and still wins.
#
# ⚠️ The module list is DERIVED BY AST, never typed. A seventh import-time
# reader added tomorrow is picked up for free, and
# `tests/test_order_dependence_rails.py` fails BY MODULE NAME if this census
# ever stops finding one that exists.

_REPO_ROOT = os.path.dirname(os.path.abspath(__file__))


def auth_db_path_capturers():
    """Every `api/**` module that binds a module-level global from AUTH_DB_PATH.

    Returns `[(dotted_module_name, attribute_name), ...]`, read off the AST of
    each file rather than grepped, so a mention inside a docstring, a comment or
    a function body cannot be mistaken for an import-time capture. Depth is
    implicit: only `tree.body` is walked, which is module level by definition.
    """
    found = []
    api_root = os.path.join(_REPO_ROOT, "api")
    for dirpath, dirnames, filenames in os.walk(api_root):
        dirnames[:] = [d for d in dirnames
                       if d not in ("__pycache__", "node_modules")]
        for name in filenames:
            if not name.endswith(".py"):
                continue
            if name.startswith("test_") or name.endswith("_test.py"):
                continue
            path = os.path.join(dirpath, name)
            try:
                src = open(path, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            if "AUTH_DB_PATH" not in src:          # cheap pre-filter only
                continue
            try:
                tree = ast.parse(src, path)
            except SyntaxError:
                continue
            for node in tree.body:
                if isinstance(node, ast.Assign):
                    targets, value = node.targets, node.value
                elif isinstance(node, ast.AnnAssign) and node.value is not None:
                    targets, value = [node.target], node.value
                else:
                    continue
                if not _reads_auth_db_path(value):
                    continue
                rel = os.path.relpath(path, _REPO_ROOT)
                dotted = rel[:-3].replace(os.sep, ".").replace("/", ".")
                for target in targets:
                    if isinstance(target, ast.Name):
                        found.append((dotted, target.id))
    return sorted(set(found))


def _reads_auth_db_path(value: ast.AST) -> bool:
    """True when this expression reads `os.environ` for `AUTH_DB_PATH`."""
    for sub in ast.walk(value):
        if isinstance(sub, ast.Call) and ast.unparse(sub.func).endswith("environ.get"):
            if sub.args and isinstance(sub.args[0], ast.Constant) \
                    and sub.args[0].value == "AUTH_DB_PATH":
                return True
        if isinstance(sub, ast.Subscript) and ast.unparse(sub.value).endswith("environ"):
            if isinstance(sub.slice, ast.Constant) and sub.slice.value == "AUTH_DB_PATH":
                return True
    return False


AUTH_DB_PATH_CAPTURERS = auth_db_path_capturers()


def repair_auth_db_capturers(path: str) -> list:
    """Re-pin every ALREADY-IMPORTED capturer to `path`. Returns what it moved.

    A module absent from `sys.modules` needs nothing — it will read the env var
    correctly whenever it is first imported.
    """
    moved = []
    for dotted, attr in AUTH_DB_PATH_CAPTURERS:
        mod = sys.modules.get(dotted)
        if mod is None:
            continue
        current = getattr(mod, attr, None)
        if current != path:
            setattr(mod, attr, path)
            moved.append((dotted, attr, current))
    return moved


@pytest.fixture(autouse=True)
def _auth_db_capturers_agree_with_the_env_var():
    """Undo, before every test, whatever the previous test's reload rebound.

    Lives in the ROOT conftest rather than `tests/conftest.py` because the 93
    test files under `api/**` reload `auth_db` more often than anything else in
    the repo and have no conftest of their own.
    """
    os.environ["AUTH_DB_PATH"] = ISOLATED_AUTH_DB
    repair_auth_db_capturers(ISOLATED_AUTH_DB)
    yield


# ─── the same wound, other env vars: put back what a reload moved ───────────
#
# `AUTH_DB_PATH` is the loudest instance, not the only one. Two more were
# MEASURED, each found only because the suite was run in a SECOND file order:
#
#   pytest tests/test_catalyst_tuning.py tests/test_catalyst_filters.py
#     -> EXIT 1 · 3 failed · assert '$3' in 'price $2.40 below $4 floor'
#   pytest tests/test_catalyst_filters.py tests/test_catalyst_tuning.py
#     -> EXIT 0 · 55 passed
#
# `catalyst/tuning.py:72` computes `_OVERRIDES_PATH` at import from
# `CATALYST_TUNING_OVERRIDES_PATH`, falling back to a directory derived from
# `store._DB_PATH`. `tests/test_catalyst_tuning.py` reloads both modules against
# a tmp dir and writes `{"CATALYST_MIN_PRICE": 4.5}` there. The reload is never
# undone, so every later test reads that leftover overrides file and the price
# floor is 4.5 instead of the 3.0 default.
#
# ⚠️ A RE-PIN CANNOT FIX THIS ONE, which is why it needs its own fixture rather
# than another entry in the census above. `_OVERRIDES_PATH`'s default is
# COMPUTED from another module's state, so there is no env var to read it back
# from. The only value that is certainly right is the one the global held
# BEFORE the test — so this snapshots and restores, where AUTH_DB_PATH re-pins.
#
# ⚠️ TEARDOWN here, SETUP there — deliberately. Restoring a snapshot must happen
# after the test; a root-conftest fixture is set up FIRST and therefore torn
# down LAST, so a test's own `monkeypatch` has already unwound by the time this
# runs and the comparison below sees no change. Only an UNDONE rebinding (a
# reload) is still standing, and only that gets put back.
#
# Scoped to PATH-SHAPED strings on purpose: those are the ones that silently
# redirect a store. Derived from the runtime value (does it contain a path
# separator), never from a typed list of names.


def env_derived_module_globals():
    """`[(dotted_module, attr), …]` for every `api/**` module-level global whose
    value is computed from `os.environ` at import. AST, never grep."""
    found = []
    api_root = os.path.join(_REPO_ROOT, "api")
    for dirpath, dirnames, filenames in os.walk(api_root):
        dirnames[:] = [d for d in dirnames
                       if d not in ("__pycache__", "node_modules")]
        for name in filenames:
            if not name.endswith(".py"):
                continue
            if name.startswith("test_") or name.endswith("_test.py"):
                continue
            path = os.path.join(dirpath, name)
            try:
                src = open(path, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            if "environ" not in src:              # cheap pre-filter only
                continue
            try:
                tree = ast.parse(src, path)
            except SyntaxError:
                continue
            rel = os.path.relpath(path, _REPO_ROOT)
            dotted = rel[:-3].replace(os.sep, ".").replace("/", ".")
            for node in tree.body:
                if isinstance(node, ast.Assign):
                    targets, value = node.targets, node.value
                elif isinstance(node, ast.AnnAssign) and node.value is not None:
                    targets, value = [node.target], node.value
                else:
                    continue
                if not any(isinstance(sub, (ast.Attribute, ast.Subscript, ast.Call))
                           and "environ" in ast.unparse(sub)
                           for sub in ast.walk(value)):
                    continue
                for target in targets:
                    if isinstance(target, ast.Name):
                        found.append((dotted, target.id))
    return sorted(set(found))


ENV_DERIVED_MODULE_GLOBALS = env_derived_module_globals()


def _looks_like_a_path(value) -> bool:
    return isinstance(value, str) and ("/" in value or os.sep in value)


def snapshot_env_derived_paths():
    """Every env-derived global that currently holds a path, with its value."""
    snap = []
    for dotted, attr in ENV_DERIVED_MODULE_GLOBALS:
        mod = sys.modules.get(dotted)
        if mod is None:
            continue
        value = getattr(mod, attr, None)
        if _looks_like_a_path(value):
            snap.append((mod, attr, value))
    return snap


def restore_env_derived_paths(snap) -> list:
    """Put back only what actually moved. Returns what it restored."""
    restored = []
    for mod, attr, old in snap:
        if getattr(mod, attr, None) != old:
            setattr(mod, attr, old)
            restored.append((mod.__name__, attr))
    return restored


@pytest.fixture(autouse=True)
def _env_derived_paths_survive_a_reload():
    snap = snapshot_env_derived_paths()
    yield
    restore_env_derived_paths(snap)


# ─── screener boot self-warm: OFF under pytest ─────────────────────────────
#
# `register_screener_jobs()` starts a `screener-warm` daemon thread that sleeps
# ~120s and then runs `snapshot_builder.run_build()` — real SQLite writes to the
# real `screener.db` and one UNCACHED Massive REST call per ticker, on whatever
# API key the developer's environment happens to hold.
#
# `tests/test_screener_schedule.py` calls that registration directly, and a full
# suite run lasts ~7 minutes — comfortably longer than the delay. So the thread
# WOULD wake mid-run and start hammering a live provider from a test process,
# with the writes landing outside any fixture's teardown. Setting the flag here
# (at conftest import, before any test module) makes the warm opt-IN: the tests
# that exercise it re-enable it explicitly with a stubbed builder and zero delay.
os.environ.setdefault("SCREENER_SNAPSHOT_WARM_ENABLED", "0")
