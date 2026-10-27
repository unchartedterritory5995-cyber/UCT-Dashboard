# boot_sandbox.py -- sandbox_clock.main() with run_campaign.campaign_env() applied first (recipe 4b).
# Tools are imported from IMPL's tools/notebook_campaign (the campaign tooling merged into impl, b5d287c43c).
#
# WALK INSTRUMENTATION (harness only, never product code; env SBX_LOCKWATCH=1):
#   * every sqlite3 connection the app opens gets a trace callback; a connection that has opened a write
#     transaction (BEGIN / first DML) is a "holder" until COMMIT / ROLLBACK / close;
#   * a watchdog thread prints "[lockwatch] HOLDER" with the db file, the holder thread's live stack and the
#     in-flight HTTP requests whenever one write transaction is held > LOCKWATCH_S (default 2 s);
#   * any sqlite3.OperationalError 'locked' / 'busy' raised through a cursor prints "[lockwatch] LOCKED" with
#     the same picture (every current holder, its stack, the in-flight requests);
#   * an ASGI wrapper records in-flight requests (method, path, start) for those dumps.
import json, os, sys, threading, time, traceback, weakref, itertools
IMPL = r"C:\Users\Patrick\uct-worktrees\nbw-p2-impl"
sys.path[:0] = [IMPL + r"\tools\notebook_campaign", IMPL + r"\tools", IMPL + r"\scripts"]

if os.environ.get("SBX_LOCKWATCH") == "1":
    import sqlite3
    LIM = float(os.environ.get("LOCKWATCH_S", "2.0"))
    HOLD = {}            # id(conn) -> dict(db, tid, tname, t0, first, stack, reported)
    INFL = {}            # rid -> (method, path, t0, tid)
    _L = threading.Lock()
    _rid = itertools.count(1)
    _orig_connect = sqlite3.connect

    def _out(msg):
        sys.stdout.write(msg + "\n"); sys.stdout.flush()

    def _picture(reason):
        now = time.time()
        frames = sys._current_frames()
        lines = [f"[lockwatch] {reason} at {time.strftime('%H:%M:%S')}"]
        with _L:
            hs = list(HOLD.items()); fl = list(INFL.values())
        for k, h in hs:
            lines.append(f"[lockwatch]   holder db={h['db']} thread={h['tname']}({h['tid']}) held={now - h['t0']:.2f}s first={h['first'][:160]!r}")
            lines.append("[lockwatch]   opened at:\n" + "".join(h["stack"][-14:]))
            fr = frames.get(h["tid"])
            if fr is not None:
                lines.append("[lockwatch]   holder thread NOW:\n" + "".join(traceback.format_stack(fr)[-16:]))
        for tid, r in list(RUN.items()):
            if now - r["t0"] > 0.5:
                lines.append(f"[lockwatch]   running stmt db={r['db']} thread={r['tname']}({tid}) for {now - r['t0']:.2f}s: {r['stmt'][:160]!r}")
                fr = frames.get(tid)
                if fr is not None:
                    lines.append("[lockwatch]   that thread NOW:\n" + "".join(traceback.format_stack(fr)[-12:]))
        lines.append(f"[lockwatch]   in-flight requests ({len(fl)}):")
        for m, p, t0, tid in fl:
            lines.append(f"[lockwatch]     {m} {p} age={now - t0:.2f}s thread={tid}")
        _out("\n".join(lines))

    RUN = {}             # thread id -> dict(db, stmt, t0, tname, reported): a statement executing right now

    def _after(conn, stmt, t0):
        """After a statement on `conn` (same thread): a connection now inside a transaction is a holder from the
        statement that opened it; one outside any transaction is not."""
        k = id(conn)
        try:
            inside = conn.in_transaction
        except Exception:  # noqa: BLE001
            return
        with _L:
            if inside and k not in HOLD:
                t = threading.current_thread()
                HOLD[k] = {"db": getattr(conn, "_lw_db", "?"), "tid": t.ident, "tname": t.name, "t0": t0, "first": stmt,
                           "stack": traceback.format_stack()[:-2], "reported": False, "ref": weakref.ref(conn)}
            elif not inside:
                HOLD.pop(k, None)

    def _run(conn, fn, a, kw, what):
        t = threading.current_thread()
        stmt = str(a[0])[:200] if a else ""
        t0 = time.time()
        RUN[t.ident] = {"db": getattr(conn, "_lw_db", "?"), "stmt": stmt, "t0": t0, "tname": t.name, "reported": False}
        try:
            return fn(*a, **kw)
        except sqlite3.OperationalError as e:
            if ((getattr(e, "sqlite_errorcode", 0) or 0) & 0xFF) in (5, 6):     # SQLITE_BUSY / SQLITE_LOCKED, by code
                _picture(f"LOCKED {e!s} ({what}) db={getattr(conn, '_lw_db', '?')} stmt={stmt[:160]!r} in thread {t.name}")
            raise
        finally:
            r = RUN.pop(t.ident, None)
            if r and time.time() - r["t0"] > LIM:
                _out(f"[lockwatch] SLOW STATEMENT {time.time() - r['t0']:.2f}s db={r['db']} thread={r['tname']} stmt={r['stmt'][:160]!r}")
            _after(conn, stmt, t0)

    class _Cur(sqlite3.Cursor):
        def execute(self, *a, **kw):
            return _run(self.connection, super().execute, a, kw, "execute")

        def executemany(self, *a, **kw):
            return _run(self.connection, super().executemany, a, kw, "executemany")

    class _Mix:
        def cursor(self, factory=_Cur):
            if factory is not _Cur and isinstance(factory, type) and issubclass(factory, sqlite3.Cursor):
                factory = type("LW" + factory.__name__, (factory,), {"execute": _Cur.execute, "executemany": _Cur.executemany})
            return super().cursor(factory)

        def execute(self, *a, **kw):
            return self.cursor().execute(*a, **kw)

        def executemany(self, *a, **kw):
            return self.cursor().executemany(*a, **kw)

        def executescript(self, *a, **kw):
            return _run(self, super().executescript, a, kw, "executescript")

        def commit(self):
            try:
                return _run(self, super().commit, (), {}, "commit")
            finally:
                HOLD.pop(id(self), None)

        def rollback(self):
            try:
                return super().rollback()
            finally:
                HOLD.pop(id(self), None)

        def close(self):
            HOLD.pop(id(self), None)
            return super().close()

    _MIXED = {}

    def _mixed(factory):
        if factory not in _MIXED:
            _MIXED[factory] = type("LW" + factory.__name__, (_Mix, factory), {})
        return _MIXED[factory]

    def _connect(*a, **kw):
        kw["factory"] = _mixed(kw.get("factory") or sqlite3.Connection)
        conn = _orig_connect(*a, **kw)
        try:
            conn._lw_db = os.path.basename(str(a[0] if a else kw.get("database")))
        except Exception:  # noqa: BLE001
            pass
        k = id(conn)
        weakref.finalize(conn, lambda k=k: HOLD.pop(k, None))
        return conn

    sqlite3.connect = _connect

    def _watch():
        while True:
            time.sleep(0.25)
            now = time.time()
            with _L:
                for k, h in list(HOLD.items()):   # `with conn:` commits in C, past any Python method: re-read the truth
                    c = h.get("ref") and h["ref"]()
                    try:
                        live = c is not None and c.in_transaction
                    except Exception:  # noqa: BLE001 -- closed
                        live = False
                    if not live:
                        HOLD.pop(k, None)
                due = [h for h in HOLD.values() if not h["reported"] and now - h["t0"] > LIM]
                for h in due:
                    h["reported"] = True
                rdue = [r for r in RUN.values() if not r["reported"] and now - r["t0"] > LIM]
                for r in rdue:
                    r["reported"] = True
            if due or rdue:
                _picture(f"HOLDER > {LIM}s ({len(due)} transaction(s), {len(rdue)} running statement(s))")
    threading.Thread(target=_watch, name="lockwatch", daemon=True).start()

    import uvicorn
    _orig_run = uvicorn.run

    def _wrap(app):
        async def mw(scope, receive, send):
            if scope.get("type") != "http":
                return await app(scope, receive, send)
            rid = next(_rid)
            with _L:
                INFL[rid] = (scope.get("method"), scope.get("path"), time.time(), threading.get_ident())
            try:
                return await app(scope, receive, send)
            finally:
                with _L:
                    INFL.pop(rid, None)
        return mw

    def _uvrun(app, *a, **kw):
        return _orig_run(_wrap(app), *a, **kw)
    uvicorn.run = _uvrun
    print(f"[sbx] lockwatch armed (holder threshold {LIM}s)", flush=True)

import notebook_fin_walk as fw
import run_campaign as rc
over = json.loads(os.environ.get("SBX_FLAG_OVERRIDES", "{}"))
# campaign_env builds the HERMETIC env (review I6) and never writes this process's environment, so the helper
# swaps it in itself, exactly as ClockSandbox.start passes env= to its child.
env, applied = rc.campaign_env(rc.campaign_flag_sets(fw), over)
os.environ.clear()
os.environ.update(env)
print("[sbx] flags:", " ".join(applied), flush=True)
print("[sbx] env keys:", " ".join(sorted(k for k in env if not k.endswith("_ENABLED"))), flush=True)
import sandbox_clock
sys.exit(sandbox_clock.main(sys.argv[1:]))
