"""A LAUNCHER-ONLY clock shift for the campaign and walk tooling (ruling W11-R49, lane F-CLOCK-1).

    python tools/notebook_campaign/sandbox_clock.py --clock 2026-11-22T21:00:00-05:00 `
        --data-dir '<a sandbox dir>' --port 8141 --app-root C:\\Users\\Patrick\\uct-worktrees\\nbw-p2-impl

The server has no clock seam, and production gains none: 145 modules read the wall clock. So this
launcher boots the app (`api.main:app`) with uvicorn IN-PROCESS, on loopback only, with the same
sandbox environment the hub sandbox launcher sets (`scripts/hub_sandbox_boot.apply_sandbox_env`:
the census-derived path pins, the kill list, the model-key policy and the shared-root tripwire,
IMPORTED from the app root, never copied), and rebinds the clock the `api.*` modules read to an
offset clock that starts at `--clock` and ticks forward in real time.

What is shifted, for code whose module is `api` or under it:
  * `datetime.now(tz)`, `datetime.now()`, `datetime.utcnow()`, `datetime.today()`, `date.today()`,
    `time.time()`, `time.time_ns()`, and `time.localtime()` / `gmtime()` / `ctime()` / `asctime()` /
    `strftime(fmt)` called without an explicit time.
  * every spelling: `from datetime import datetime` and `import datetime` at module level (the
    module's globals are rebound after import, and a meta-path hook rebinds every `api.*` module
    imported later, before its first caller sees it), function-local imports (sys.modules'
    `datetime` and `time` are replaced by proxies that hand the shifted names to `api.*` frames and
    the real ones to everybody else), and bound methods kept in a global (`_now = datetime.now`).
  * the classes stay the real ones as far as anyone can tell: every value made is a REAL `datetime`
    / `date` instance, `isinstance` answers as for the real class, and pydantic gets the real schema.

What is NOT shifted is printed at boot (`unshiftable_sources`): SQLite's own clock (`CURRENT_TIMESTAMP`
and `'now'` column defaults, and `'now'` inside queries) -- the database never asks Python -- and the
stdlib / third-party code that reads the clock on the app's behalf (uvicorn's Date header, logging,
APScheduler's triggers, `email.utils`), and `time.monotonic()` / `perf_counter()` (durations, never
dates, deliberately real). A campaign step whose verdict depends on one of those reads INCONCLUSIVE
with that reason.

Refusals (exit 2, before anything is imported or served): a `--data-dir` that resolves to C:\\data
or /data or under them; any `--host` that is not loopback (127.0.0.1, localhost, ::1); a `--clock`
without a UTC offset. The port check is the hub launcher's own (`_refuse_port_in_use`).

This module is imported by NOTHING under api/ or app/ (a rail in tests/test_notebook_campaign_clock.py
says so), and it reads no environment variable of its own: the shift exists only in a process this
file started.
"""
from __future__ import annotations

import argparse
import datetime as _dtmod
import importlib.abc
import importlib.machinery
import json
import os
import re
import sqlite3
import sys
import time as _timemod
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]

LOOPBACK = {"127.0.0.1", "localhost", "::1"}
SCOPE = ("api",)
SESSIONS_NAME = "clock-sessions.json"
MANIFEST_NAME = "campaign-manifest.json"

_RD = _dtmod.datetime          # the real classes and functions, captured before anything is swapped
_RDATE = _dtmod.date
_UTC = _dtmod.timezone.utc
_real_time = _timemod.time
_real_time_ns = _timemod.time_ns
_real_localtime = _timemod.localtime
_real_gmtime = _timemod.gmtime
_real_ctime = _timemod.ctime
_real_asctime = _timemod.asctime
_real_strftime = _timemod.strftime


# ── refusals (pure) ────────────────────────────────────────────────────────────────────────────

def refuse_data_dir(data_dir) -> str | None:
    """Why `data_dir` is refused, or None: the seeder's own check (abspath AND realpath, so a relative,
    drive-relative or junctioned spelling cannot slip past a string compare), imported, not copied."""
    if str(HERE) not in sys.path:
        sys.path.insert(0, str(HERE))
    from seed_members import refuse_shared_root
    why = refuse_shared_root(data_dir)
    return f"--data-dir {why}" if why else None


def refuse_host(host: str | None) -> str | None:
    if (host or "").strip().lower() in LOOPBACK:
        return None
    return f"--host {host!r} is not loopback ({', '.join(sorted(LOOPBACK))}); this launcher binds nothing else"


def parse_clock(text: str) -> _RD:
    """An ISO-8601 instant WITH a UTC offset (a naive one is ambiguous across DST and refused)."""
    try:
        at = _RD.fromisoformat(str(text).strip().replace("Z", "+00:00"))
    except ValueError as e:
        raise ValueError(f"--clock {text!r} is not ISO-8601 ({e})") from None
    if at.tzinfo is None or at.utcoffset() is None:
        raise ValueError(f"--clock {text!r} has no UTC offset (write e.g. 2026-11-22T21:00:00-05:00)")
    return at


# ── the offset clock ───────────────────────────────────────────────────────────────────────────

class OffsetClock:
    """`instant` at construction, then forward in real time: now = real now + offset."""

    def __init__(self, instant: _RD):
        self.instant = instant
        self.offset_s = instant.timestamp() - _real_time()

    def time(self) -> float:
        return _real_time() + self.offset_s

    def time_ns(self) -> int:
        return _real_time_ns() + int(round(self.offset_s * 1e9))

    def utc(self) -> _RD:
        return _RD.fromtimestamp(self.time(), _UTC)

    def now(self, tz=None) -> _RD:
        u = self.utc()
        return u.astimezone(tz) if tz is not None else u.astimezone().replace(tzinfo=None)


def _named_in(name: str, scope) -> bool:
    return any(name == p or name.startswith(p + ".") for p in scope)


def _in_scope(frame, scope) -> bool:
    return frame is not None and _named_in(frame.f_globals.get("__name__") or "", scope)


def _make_classes(clock: OffsetClock):
    """A `datetime` and a `date` whose clock methods read `clock`. Constructing one (directly or
    through any classmethod: fromisoformat, strptime, combine, fromtimestamp...) yields a REAL
    instance, and isinstance/issubclass answer as for the real class, so nothing downstream (sqlite3
    adapters keyed by exact type, pydantic, json encoders) can tell."""

    class _Meta(type):
        def __instancecheck__(cls, obj):
            return isinstance(obj, cls._real)

        def __subclasscheck__(cls, sub):
            return issubclass(sub, cls._real)

    class ShiftedDatetime(_RD, metaclass=_Meta):
        _real = _RD
        _clock = clock

        def __new__(cls, *a, **k):
            return _RD(*a, **k)

        @classmethod
        def now(cls, tz=None):
            return clock.now(tz)

        @classmethod
        def utcnow(cls):
            return clock.utc().replace(tzinfo=None)

        @classmethod
        def today(cls):
            return clock.now()

        @classmethod
        def __get_pydantic_core_schema__(cls, source, handler):
            from pydantic_core import core_schema
            return core_schema.datetime_schema()

    class ShiftedDate(_RDATE, metaclass=_Meta):
        _real = _RDATE
        _clock = clock

        def __new__(cls, *a, **k):
            return _RDATE(*a, **k)

        @classmethod
        def today(cls):
            return clock.now().date()

        @classmethod
        def __get_pydantic_core_schema__(cls, source, handler):
            from pydantic_core import core_schema
            return core_schema.date_schema()

    for c, n in ((ShiftedDatetime, "datetime"), (ShiftedDate, "date")):
        c.__name__ = c.__qualname__ = n
        c.__module__ = "datetime"
    return ShiftedDatetime, ShiftedDate


def _make_time_funcs(clock: OffsetClock) -> dict:
    def time():  # noqa: D401 -- the stdlib names
        return clock.time()

    def time_ns():
        return clock.time_ns()

    def localtime(secs=None):
        return _real_localtime(clock.time() if secs is None else secs)

    def gmtime(secs=None):
        return _real_gmtime(clock.time() if secs is None else secs)

    def ctime(secs=None):
        return _real_ctime(clock.time() if secs is None else secs)

    def asctime(t=None):
        return _real_asctime(_real_localtime(clock.time()) if t is None else t)

    def strftime(fmt, t=None):
        return _real_strftime(fmt, _real_localtime(clock.time()) if t is None else t)

    return {"time": time, "time_ns": time_ns, "localtime": localtime, "gmtime": gmtime, "ctime": ctime,
            "asctime": asctime, "strftime": strftime}


class _ScopedProxy(types.ModuleType):
    """Stands in for `datetime` / `time` in sys.modules: an attribute named in `shifted` is the
    shifted one when the CALLER's module is api.*, the real one otherwise; everything else is the
    real module's. A function-local `from datetime import datetime` in api code is served here."""

    def __init__(self, real, shifted: dict, scope=SCOPE):
        super().__init__(real.__name__)
        object.__setattr__(self, "_sc_real", real)
        object.__setattr__(self, "_sc_shifted", shifted)
        object.__setattr__(self, "_sc_scope", tuple(scope))

    def __getattribute__(self, name):
        if name.startswith("_sc_"):
            return object.__getattribute__(self, name)
        shifted = object.__getattribute__(self, "_sc_shifted")
        if name in shifted and _in_scope(sys._getframe(1), object.__getattribute__(self, "_sc_scope")):
            return shifted[name]
        return getattr(object.__getattribute__(self, "_sc_real"), name)

    def __setattr__(self, name, value):
        setattr(object.__getattribute__(self, "_sc_real"), name, value)

    def __dir__(self):
        return dir(object.__getattribute__(self, "_sc_real"))


class _ShiftedModule(types.ModuleType):
    """What an api.* module's own global `datetime` / `time` name is rebound to: the shifted
    attributes unconditionally (only api code reads that global), the real module's otherwise."""

    def __init__(self, real, shifted: dict):
        super().__init__(real.__name__)
        object.__setattr__(self, "_sc_real", real)
        object.__setattr__(self, "_sc_shifted", shifted)

    def __getattribute__(self, name):
        if name.startswith("_sc_"):
            return object.__getattribute__(self, name)
        shifted = object.__getattribute__(self, "_sc_shifted")
        if name in shifted:
            return shifted[name]
        return getattr(object.__getattribute__(self, "_sc_real"), name)

    def __dir__(self):
        return dir(object.__getattribute__(self, "_sc_real"))


class _SweepLoader(importlib.abc.Loader):
    def __init__(self, inner, shift: "ClockShift"):
        self._inner, self._shift = inner, shift

    def create_module(self, spec):
        return self._inner.create_module(spec)

    def exec_module(self, module):
        self._inner.exec_module(module)
        self._shift.sweep(module)

    def __getattr__(self, name):
        return getattr(self._inner, name)


class _SweepFinder(importlib.abc.MetaPathFinder):
    """Every api.* module imported AFTER install is swept the moment its body has run."""

    def __init__(self, shift: "ClockShift"):
        self._shift = shift

    def find_spec(self, name, path=None, target=None):
        if not _named_in(name, self._shift.scope):
            return None
        spec = importlib.machinery.PathFinder.find_spec(name, path)
        if spec is None or spec.loader is None or not hasattr(spec.loader, "exec_module"):
            return spec
        spec.loader = _SweepLoader(spec.loader, self._shift)
        return spec


class ClockShift:
    """install() / uninstall(); sweep(module) rebinds one module's clock names (recorded, so
    uninstall restores exactly what it changed)."""

    def __init__(self, instant: _RD, scope=SCOPE):
        self.scope = tuple(scope)
        self.clock = OffsetClock(instant)
        self.Datetime, self.Date = _make_classes(self.clock)
        self.tfuncs = _make_time_funcs(self.clock)
        dshift = {"datetime": self.Datetime, "date": self.Date}
        self.dt_module = _ShiftedModule(_dtmod, dshift)
        self.time_module = _ShiftedModule(_timemod, self.tfuncs)
        self.dt_proxy = _ScopedProxy(_dtmod, dshift, self.scope)
        self.time_proxy = _ScopedProxy(_timemod, self.tfuncs, self.scope)
        self.finder = _SweepFinder(self)
        self.changed: list[tuple[types.ModuleType, str, object]] = []
        self._recorded: set = set()
        self.swept: set[str] = set()
        self.installed = False
        self._replacements = None

    def _replacement_for(self, val):
        if self._replacements is None:
            r = {id(_dtmod): self.dt_module, id(_timemod): self.time_module, id(_RD): self.Datetime,
                 id(_RDATE): self.Date, id(_real_time): self.tfuncs["time"],
                 id(_real_time_ns): self.tfuncs["time_ns"]}
            self._replacements = r
        rep = self._replacements.get(id(val))
        if rep is not None:
            return rep
        owner = getattr(val, "__self__", None)
        if owner is _RD and getattr(val, "__name__", "") in ("now", "utcnow", "today"):
            return getattr(self.Datetime, val.__name__)
        if owner is _RDATE and getattr(val, "__name__", "") == "today":
            return self.Date.today
        return None

    def sweep(self, module) -> int:
        name = getattr(module, "__name__", "") or ""
        if not _named_in(name, self.scope):
            return 0
        n = 0
        d = getattr(module, "__dict__", None)
        if not isinstance(d, dict):
            return 0
        real_of = self._real_of()
        for k, v in list(d.items()):
            if id(v) in real_of:
                # Bound to a shifted object at import (the proxy served it): already shifted, but
                # recorded so uninstall() hands the module the real one back.
                if v is self.dt_proxy:
                    d[k] = self.dt_module
                elif v is self.time_proxy:
                    d[k] = self.time_module
                self._record(module, k, real_of[id(v)])
                continue
            owner = getattr(v, "__self__", None)
            if owner is self.Datetime or owner is self.Date:
                # `_now = datetime.now` run while the proxy served the shifted class
                self._record(module, k, getattr(owner._real, v.__name__))
                continue
            rep = self._replacement_for(v)
            if rep is not None and rep is not v:
                self._record(module, k, v)
                d[k] = rep
                n += 1
        self.swept.add(name)
        return n

    def _record(self, module, k, real) -> None:
        key = (id(module), k)
        if key not in self._recorded:
            self._recorded.add(key)
            self.changed.append((module, k, real))

    def _real_of(self) -> dict:
        pairs = [(self.dt_module, _dtmod), (self.dt_proxy, _dtmod), (self.time_module, _timemod),
                 (self.time_proxy, _timemod), (self.Datetime, _RD), (self.Date, _RDATE),
                 (self.tfuncs["time"], _real_time), (self.tfuncs["time_ns"], _real_time_ns),
                 (self.tfuncs["localtime"], _real_localtime), (self.tfuncs["gmtime"], _real_gmtime),
                 (self.tfuncs["ctime"], _real_ctime), (self.tfuncs["asctime"], _real_asctime),
                 (self.tfuncs["strftime"], _real_strftime)]
        return {id(a): b for a, b in pairs}

    def sweep_all(self) -> int:
        return sum(self.sweep(m) for m in list(sys.modules.values()) if m is not None)

    def install(self) -> "ClockShift":
        if self.installed:
            return self
        sys.modules["datetime"] = self.dt_proxy
        sys.modules["time"] = self.time_proxy
        sys.meta_path.insert(0, self.finder)
        self.sweep_all()
        self.installed = True
        return self

    def uninstall(self) -> None:
        if not self.installed:
            return
        if self.finder in sys.meta_path:
            sys.meta_path.remove(self.finder)
        sys.modules["datetime"] = _dtmod
        sys.modules["time"] = _timemod
        for module, k, old in reversed(self.changed):
            module.__dict__[k] = old
        self.changed.clear()
        self._recorded.clear()
        self.installed = False

    def report(self) -> dict:
        et = self.clock.now(_et())
        return {"instant": self.clock.instant.isoformat(), "offset_s": round(self.clock.offset_s, 3),
                "now_et": et.isoformat(timespec="seconds"), "now_et_words": et.strftime("%A %Y-%m-%d %H:%M ET"),
                "modules_swept": len(self.swept), "names_rebound": len(self.changed)}


def _et():
    from zoneinfo import ZoneInfo
    return ZoneInfo("America/New_York")


# ── what cannot be shifted from outside ────────────────────────────────────────────────────────

_NOW_DEFAULT = re.compile(r"\bDEFAULT\s*\(?\s*(CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|"
                          r"(?:datetime|date|time|strftime|julianday|unixepoch)\s*\([^()]*'now'[^()]*\))",
                          re.IGNORECASE)
_SQL_NOW = re.compile(r"CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|'now'", re.IGNORECASE)
_CREATE = re.compile(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[\"`\[]?(\{?[A-Za-z_][\w{}]*\}?)", re.IGNORECASE)
_ALTER = re.compile(r"ALTER\s+TABLE\s+[\"`\[]?([A-Za-z_]\w*)[\"`\]]?\s+ADD\s+(?:COLUMN\s+)?[\"`\[]?([A-Za-z_]\w*)",
                    re.IGNORECASE)


def _balanced(text: str, start: int) -> str:
    depth, i = 0, start
    while i < len(text):
        c = text[i]
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return text[start + 1:i]
        i += 1
    return text[start + 1:]


def _split_top(body: str) -> list[str]:
    out, depth, cur = [], 0, []
    for c in body:
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
        if c == "," and depth == 0:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(c)
    out.append("".join(cur))
    return out


_CONSTRAINTS = {"PRIMARY", "UNIQUE", "CHECK", "FOREIGN", "CONSTRAINT"}


def now_defaults_in_create(sql: str) -> list[tuple[str, str, str]]:
    """`(table, column, default)` for every column of every CREATE TABLE in `sql` whose DEFAULT
    is SQLite's own clock, plus `ALTER TABLE t ADD COLUMN c ... DEFAULT <clock>`."""
    found = []
    for m in _CREATE.finditer(sql):
        paren = sql.find("(", m.end())
        if paren < 0:
            continue
        body = re.sub(r"--[^\n]*", "", _balanced(sql, paren))      # a comment may hold a comma
        for col in _split_top(body):
            d = _NOW_DEFAULT.search(col)
            if d:
                words = col.strip().split()
                name = words[0].strip("\"`[]") if words else ""
                if re.fullmatch(r"[A-Za-z_]\w*", name) and name.upper() not in _CONSTRAINTS:
                    found.append((m.group(1), name, d.group(1)))
    for m in _ALTER.finditer(sql):
        tail = sql[m.end():m.end() + 300].split(";")[0].split('"')[0].split("\n")[0]
        d = _NOW_DEFAULT.search(tail)
        if d:
            found.append((m.group(1), m.group(2), d.group(1)))
    return found


def static_unshiftable(app_root: Path) -> dict:
    """Read from the app root's api/** source: the tables whose columns default to SQLite's clock,
    and the files whose SQL reads SQLite's clock in a query (outside a DEFAULT)."""
    tables: dict[str, dict] = {}
    queries: dict[str, int] = {}
    api = Path(app_root) / "api"
    for py in sorted(api.rglob("*.py")):
        try:
            text = py.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if not _SQL_NOW.search(text):
            continue
        rel = py.relative_to(app_root).as_posix()
        for table, col, dflt in now_defaults_in_create(text):
            t = tables.setdefault(table, {"columns": [], "files": []})
            if col not in t["columns"]:
                t["columns"].append(col)
            if rel not in t["files"]:
                t["files"].append(rel)
        n_default = len(_NOW_DEFAULT.findall(text))
        n_all = len(_SQL_NOW.findall(text))
        if n_all - n_default > 0:
            queries[rel] = n_all - n_default
    return {"tables": tables, "query_files": queries}


def live_unshiftable(data_dir: Path) -> dict:
    """The same, read from the sandbox's own SQLite files (sqlite_master, read-only URI)."""
    out: dict[str, dict] = {}
    for db in sorted(Path(data_dir).rglob("*.db")):
        try:
            conn = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True, timeout=2)
            try:
                rows = conn.execute("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL").fetchall()
            finally:
                conn.close()
        except sqlite3.Error:
            continue
        for name, sql in rows:
            cols = [c for (_, c, _) in now_defaults_in_create(sql)]
            if cols:
                out[f"{db.name}:{name}"] = {"columns": cols}
    return out


ALWAYS_UNSHIFTABLE = (
    "SQLite's own clock: CURRENT_TIMESTAMP / CURRENT_DATE / datetime('now') column defaults and 'now' "
    "inside queries are evaluated by the database, which never asks Python (tables and files listed below)",
    "stdlib and third-party code reading the clock on the app's behalf: uvicorn's Date header and access "
    "log, logging timestamps, APScheduler triggers (they fire on the REAL clock; the kill list keeps most "
    "jobs off), email.utils.formatdate, http.cookies expiry strings, the SQLite driver",
    "time.monotonic() / perf_counter() / process_time(): durations, deliberately real (TTL caches and "
    "rate limiters keyed on them run in real time)",
    "values captured before the shift was installed: anything conftest or hub_sandbox_boot imported "
    "from api before `install()` is swept for module globals only (a class attribute or a dataclass "
    "default_factory captured then keeps the real function)",
    "the browser: its clock is the runner's job (Playwright context.clock), never this process's",
)


def print_unshiftable(app_root: Path, data_dir: Path) -> dict:
    st = static_unshiftable(app_root)
    live = live_unshiftable(data_dir)
    print("  CLOCK SOURCES THIS LAUNCHER CANNOT SHIFT (a step depending on one is INCONCLUSIVE):", flush=True)
    for line in ALWAYS_UNSHIFTABLE:
        print(f"    - {line}")
    names = sorted(st["tables"])
    print(f"    - SQLite clock column defaults in api/** source: {len(names)} tables")
    for t in names:
        print(f"        {t}: {', '.join(st['tables'][t]['columns'])}  ({', '.join(st['tables'][t]['files'])})")
    if live:
        print(f"    - ... and in this sandbox's own schema: {len(live)} tables")
        for k in sorted(live):
            print(f"        {k}: {', '.join(live[k]['columns'])}")
    print(f"    - SQLite clock read inside queries (outside a DEFAULT), by file: {len(st['query_files'])} files")
    for f in sorted(st["query_files"]):
        print(f"        {f} ({st['query_files'][f]})")
    print("", flush=True)
    return {"static": st, "live": live, "always": list(ALWAYS_UNSHIFTABLE)}


# ── sessions that the shifted clock would read as expired ──────────────────────────────────────

def remint_sessions(data_dir: Path, clock: OffsetClock, out_name: str = SESSIONS_NAME) -> dict:
    """The seeder mints one session per member with the REAL clock (30-day life); a member read at a
    later instant would be signed out. Under the shift, every manifest member whose stored session no
    longer validates gets a fresh one from the app's own `create_session` (so its expiry is the
    shifted now + 30 days), written to `<data-dir>/clock-sessions.json` for the runner. The manifest
    itself is never rewritten."""
    mpath = Path(data_dir) / MANIFEST_NAME
    if not mpath.is_file():
        return {"skipped": f"no {MANIFEST_NAME} in the data dir"}
    from api.services import auth_service
    manifest = json.loads(mpath.read_text(encoding="utf-8"))
    out, kept, minted = {}, 0, 0
    for pid, rec in (manifest.get("members") or {}).items():
        tok, uid = rec.get("session"), rec.get("user_id")
        if not tok or not uid:
            continue
        if auth_service.validate_session(tok):
            out[pid] = tok
            kept += 1
            continue
        out[pid] = auth_service.create_session(uid, user_agent="notebook-campaign clock", ip_address="127.0.0.1")
        minted += 1
    body = {"clock": clock.instant.isoformat(), "members": out}
    tmp = Path(data_dir) / (out_name + ".tmp")
    tmp.write_text(json.dumps(body, indent=1), encoding="utf-8", newline="\n")
    os.replace(tmp, Path(data_dir) / out_name)
    return {"kept": kept, "minted": minted, "file": str(Path(data_dir) / out_name)}


# ── the launcher ───────────────────────────────────────────────────────────────────────────────

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--clock", required=True, help="ISO-8601 instant with offset, e.g. 2026-11-22T21:00:00-05:00")
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8141)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--app-root", default=str(REPO), help="the checkout whose api/, launcher and app/dist are served")
    ap.add_argument("--test-email", default="hubtest@local.dev")
    ap.add_argument("--no-remint", action="store_true", help="do not re-mint expired campaign sessions")
    args = ap.parse_args(argv)

    for why in (refuse_data_dir(args.data_dir), refuse_host(args.host)):
        if why:
            print(f"REFUSED: {why}", flush=True)
            return 2
    try:
        instant = parse_clock(args.clock)
    except ValueError as e:
        print(f"REFUSED: {e}", flush=True)
        return 2
    app_root = Path(args.app_root).resolve()
    sandbox = os.path.abspath(args.data_dir)
    for p in (str(app_root / "scripts"), str(app_root)):
        if p not in sys.path:
            sys.path.insert(0, p)
    os.chdir(app_root)
    import hub_sandbox_boot as hsb  # noqa: E402 -- the app root's launcher: its rules, not a copy
    import sandbox_identity as sid  # noqa: E402
    hsb._refuse_port_in_use(args.port)

    nonce = sid.mint()
    pins = hsb.apply_sandbox_env(sandbox, args.test_email,
                                 allow_model_keys=hsb.model_keys_opted_in(False))
    import conftest  # noqa: E402 -- armed by apply_sandbox_env
    fixture = app_root / "scripts" / "fixtures" / "wire_data.sample.json"
    target = Path(sandbox) / "wire_data.json"
    if fixture.is_file() and not target.exists():
        target.write_bytes(fixture.read_bytes())
    hsb._start_violation_reporter(conftest)

    shift = ClockShift(instant).install()
    from api.main import app as _app  # noqa: E402
    shift.sweep_all()
    rep = shift.report()
    print("")
    print("  " + "-" * 68)
    print("  CLOCK SANDBOX (launcher-only clock shift, ruling W11-R49)")
    print("  " + "-" * 68)
    print(f"  Data dir     : {sandbox}")
    print(f"  App root     : {app_root}")
    print(f"  URL          : http://{args.host}:{args.port}")
    print(f"  Path pins    : {len(pins)} env vars (hub_sandbox_boot.apply_sandbox_env)")
    print(f"  Shared roots : {', '.join(conftest.SHARED_DATA_ROOTS)} (writes RAISE; this launcher hashes none)")
    print(f"  Clock        : {rep['instant']} (offset {rep['offset_s']} s, ticking)")
    print(f"  SHIFTED NOW  : {rep['now_et_words']}  ({rep['now_et']})")
    print(f"  Swept        : {rep['modules_swept']} api.* modules, {rep['names_rebound']} names rebound;"
          " late imports swept by a meta-path hook")
    print("  " + "-" * 68, flush=True)
    unshift = print_unshiftable(app_root, Path(sandbox))
    if not args.no_remint:
        try:
            print(f"  Sessions     : {remint_sessions(Path(sandbox), shift.clock)}", flush=True)
        except Exception as e:  # noqa: BLE001 -- a fresh dir has no tables yet; said, not hidden
            print(f"  Sessions     : not re-minted ({type(e).__name__}: {e})", flush=True)

    body = sid.payload(nonce, data_dir=sandbox, integrity_log="", pid=os.getpid(),
                       started_at=_RD.now(_UTC).isoformat(timespec="seconds"))
    body["clock_shift"] = {**shift.report(), "unshiftable_tables": sorted(unshift["static"]["tables"])}
    import uvicorn  # noqa: E402
    try:
        uvicorn.run(sid.wrap_app(_app, body), host=args.host, port=args.port, log_level="warning")
    finally:
        n = len(conftest.SHARED_ROOT_VIOLATIONS)
        print(f"  [shutdown] shared-root writes blocked during this run: {n}", flush=True)
    return 2 if conftest.SHARED_ROOT_VIOLATIONS else 0


if __name__ == "__main__":
    sys.exit(main())
