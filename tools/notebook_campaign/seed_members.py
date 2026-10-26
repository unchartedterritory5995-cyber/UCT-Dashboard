"""The 50 campaign members (plan 2026-10-24-notebook-widgets-p2-w11.md, Task 11.21 Step 4), seeded
deterministically into a SANDBOX data dir through the app's own service functions.

    python tools/notebook_campaign/seed_members.py --data-dir 'C:\\data-nbw-campaign' --seed 20261024 `
        --app-root C:\\Users\\Patrick\\uct-worktrees\\nbw-p2-impl

What it does, in order:
  1. REFUSES a data dir that resolves to C:\\data or /data (or inside either), and one that already
     holds a campaign manifest (a second seed into one dir is not the same 50 members).
  2. Boots the app's own launcher (scripts/hub_sandbox_boot.py, through notebook_perf_harness.Sandbox)
     on that dir until /api/health answers and its +15 s snapshot checkpoint is written, then stops
     it gracefully: the app creates every table itself, so this file never writes DDL. The
     launcher's integrity log is moved beside the manifest.
  3. In THIS process, after `hub_sandbox_boot.apply_sandbox_env(<dir>)` has pinned every census path
     at the dir and armed the shared-root tripwire, seeds each persona of personas.json through the
     service functions the routes call: `auth_service.create_user` (the signup route's function),
     `comp_user_access` (POST /api/auth/admin/comp-access), `create_email_verification` +
     `verify_email_token` (the emailed link), `create_session` (one session per member, reused by
     every run: the sign-in route is limited to 5 a minute per address and a session per run would
     trip the device limit), `accounts.create_account`, `trades.bulk_insert_trades` (the CSV
     import's confirm door, chunked), `options.create_strategy` / `close_strategy`,
     `note_properties.create_property_def`, `notes.create_note`, `routines.create` / `set_tick` /
     `set_skipped` / `archive` / `soft_delete`, `trackers.create` / `set_value` / ..., `journal_styles.
     create_style` / `delete_style` / `set_default`, `widget_definitions.create` (plans read from the
     released shelf files). No raw SQL write anywhere.
  4. Prints one census line per member, READ BACK from the stores (never this file's own tallies),
     and writes <dir>/campaign-manifest.json (emails, ids, session tokens of this throwaway sandbox).

Fixed seed, fixed clock: each persona's numbers come from random.Random(seed * 100 + n) and its dates
from its own `clock` (personas.json); the stores that take `now=` are given that clock. Two runs with
the same seed on empty dirs write the same shapes (ids and created_at stamps differ: the stores mint
them).

Heavy: the large shapes (5,600 trades, 5,000 notes, 500 strategies) run under
C:\\Users\\Patrick\\uct-clips\\tools\\heavy_lock.py when that file exists (`--no-heavy-lock` skips it).
"""
from __future__ import annotations

import argparse
import ast
import contextlib
import json
import os
import random
import shutil
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
PERSONAS = HERE / "personas.json"
MANIFEST_NAME = "campaign-manifest.json"
SHARED_ROOTS = ("C:\\data", "/data")
PASSWORD = "LocalTest2026!"
HEAVY_LOCK = Path(r"C:\Users\Patrick\uct-clips\tools\heavy_lock.py")
SCHEMA_PORT = 8111
# Extra markup on top of the fuzz corpus (P12, P32): "nothing renders raw".
MARKUP = ["<img src=x onerror=alert(1)>", "<script>alert('x')</script>", "{{7*7}}", "${7*7}", "[object Object]"]


# ── refusals (pure) ───────────────────────────────────────────────────────────────────────

def refuse_shared_root(data_dir: str | os.PathLike | None) -> str | None:
    """Why `data_dir` is refused, or None. Resolved first (abspath AND realpath, so a relative,
    drive-relative or junctioned spelling cannot slip past a string compare)."""
    if not data_dir:
        return "no --data-dir"
    spellings = {os.path.normcase(os.path.abspath(str(data_dir))),
                 os.path.normcase(os.path.realpath(str(data_dir)))}
    for root in SHARED_ROOTS:
        r = os.path.normcase(os.path.abspath(root)).rstrip("\\/")
        for s in spellings:
            if s.rstrip("\\/") == r or s.startswith(r + os.sep):
                return f"{data_dir!r} resolves to {s!r}, inside the shared data root {root!r}"
    return None


def load_personas(path: str | os.PathLike = PERSONAS) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def fuzz_corpus(app_root: Path) -> list[str]:
    """The fuzz corpus, read from tests/test_widget_engine_fuzz.py by AST (never retyped here),
    plus MARKUP."""
    src = (app_root / "tests" / "test_widget_engine_fuzz.py").read_text(encoding="utf-8")
    for node in ast.parse(src).body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "CORPUS" for t in node.targets):
            return [_const_str(e) for e in node.value.elts] + MARKUP
    raise SystemExit("REFUSED: CORPUS not found in tests/test_widget_engine_fuzz.py")


def _const_str(e: ast.AST) -> str:
    """A string literal, or `"q" * 200` (the corpus's one computed entry); nothing else is evaluated."""
    if isinstance(e, ast.BinOp) and isinstance(e.op, ast.Mult):
        return ast.literal_eval(e.left) * ast.literal_eval(e.right)
    return ast.literal_eval(e)


def persona_clock(p: dict, defaults: dict) -> datetime:
    return datetime.fromisoformat(p.get("clock") or defaults["clock"])


# ── the recipe: what one persona gets (deterministic) ─────────────────────────────────────

SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMD", "TSLA", "META", "AMZN", "GOOGL", "CRWD", "SPY", "QQQ", "IBM"]


def trade_rows(spec: dict, rng: random.Random, sessions: list[date], corpus: list[str]) -> list[dict]:
    """Closed equity trades in the import door's shape (`symbol, side, shares, entryPrice, entryDate,
    exitPrice, exitDate, originalStop?, setup?, notes?, analyticsExcluded?`)."""
    n = int(spec.get("n", 0))
    out = []
    timed = spec.get("timed", True)
    stops = spec.get("stops", "all")
    setups = spec.get("setups") or ["Breakout", "Pullback", "Gap and go", "Earnings drift"]
    flagged_every = int(spec.get("flagged_every", 0))
    hold = spec.get("hold", "intraday")
    for i in range(n):
        d = sessions[i % len(sessions)] if spec.get("spread", "even") == "even" else rng.choice(sessions)
        sym = rng.choice(SYMBOLS)
        price = round(rng.uniform(20, 400), 2)
        win = rng.random() < float(spec.get("win_rate", 0.52))
        move = rng.uniform(0.004, 0.05)
        side = "Long" if rng.random() < 0.8 else "Short"
        sign = 1 if (win == (side == "Long")) else -1
        exit_price = round(max(1.0, price * (1 + sign * move)), 2)
        shares = rng.choice([10, 25, 50, 100, 200])
        if hold == "swing":
            exit_day = sessions[min(len(sessions) - 1, sessions.index(d) + rng.randint(2, 9))] if d in sessions else d
        else:
            exit_day = d
        if timed:
            h0 = rng.randint(9, 15)
            m0 = rng.randint(30 if h0 == 9 else 0, 59)
            ent = datetime(d.year, d.month, d.day, h0, m0, tzinfo=_ET())
            ext = ent + timedelta(minutes=rng.randint(3, 180)) if hold != "swing" else \
                datetime(exit_day.year, exit_day.month, exit_day.day, 15, 30, tzinfo=_ET())
            if ext.date() != ent.date() and hold != "swing":
                ext = datetime(d.year, d.month, d.day, 15, 59, tzinfo=_ET())
            entry_date, exit_date = ent.astimezone(timezone.utc).isoformat(), ext.astimezone(timezone.utc).isoformat()
        else:
            entry_date, exit_date = d.isoformat(), exit_day.isoformat()
        row = {"symbol": sym, "side": side, "shares": shares, "entryPrice": price, "entryDate": entry_date,
               "exitPrice": exit_price, "exitDate": exit_date, "setup": setups[i % len(setups)]}
        risk = round(price * rng.uniform(0.01, 0.03), 2)
        stop = round(price - risk, 2) if side == "Long" else round(price + risk, 2)
        if stops == "all" or (stops == "half" and i % 2 == 0):
            row["originalStop"] = stop
        if spec.get("hostile"):
            row["setup"] = corpus[i % len(corpus)]
            row["notes"] = corpus[(i + 3) % len(corpus)]
        if flagged_every and i % flagged_every == 0:
            row["analyticsExcluded"] = True
        out.append(row)
    if spec.get("tilt_day") and sessions:
        d = sessions[-1]
        for k in range(8):
            ent = datetime(d.year, d.month, d.day, 10, 5 + k * 4, tzinfo=_ET())
            out.append({"symbol": "TSLA", "side": "Long", "shares": 100, "entryPrice": 250.0,
                        "entryDate": ent.astimezone(timezone.utc).isoformat(), "exitPrice": 248.5,
                        "exitDate": (ent + timedelta(minutes=3)).astimezone(timezone.utc).isoformat(),
                        "originalStop": 248.0, "setup": "Revenge"})
    if spec.get("breach_day") and sessions:
        d = sessions[-2] if len(sessions) > 1 else sessions[-1]
        ent = datetime(d.year, d.month, d.day, 9, 45, tzinfo=_ET())
        out.append({"symbol": "NVDA", "side": "Long", "shares": 500, "entryPrice": 120.0,
                    "entryDate": ent.astimezone(timezone.utc).isoformat(), "exitPrice": 112.0,
                    "exitDate": (ent + timedelta(minutes=50)).astimezone(timezone.utc).isoformat(),
                    "originalStop": 118.0, "setup": "Breakout"})
    return out


def _ET():
    from zoneinfo import ZoneInfo
    return ZoneInfo("America/New_York")


# ── in-process seeding (only after apply_sandbox_env) ─────────────────────────────────────

class Services:
    """The app's service modules, imported only after the sandbox env is applied."""

    def __init__(self):
        from api.services import auth_service, auth_db
        from api.services.journal_two import (accounts, journal_styles, note_properties, notes, options,
                                              routines, trackers, trades, trading_days, widget_definitions)
        self.auth, self.auth_db = auth_service, auth_db
        self.accounts, self.styles, self.props, self.notes = accounts, journal_styles, note_properties, notes
        self.options, self.routines, self.trackers, self.trades = options, routines, trackers, trades
        self.days, self.defs = trading_days, widget_definitions


def sessions_before(svc: Services, clock: datetime, n: int) -> list[date]:
    """The n trading sessions ending on the clock's ET day (or the last one before it), oldest first."""
    d = svc.days.session_on_or_before(clock.astimezone(_ET()).date())
    out = [d]
    while len(out) < n:
        d = svc.days.nth_session_before(d, 1)
        out.append(d)
    return sorted(out)


def shelf_plan(app_root: Path, slug: str) -> dict:
    manifest = json.loads((app_root / "api/services/journal_two/widget_engine/shelf/MANIFEST.json").read_text(encoding="utf-8"))
    files = sorted((app_root / "api/services/journal_two/widget_engine/shelf").glob(f"{slug}.r*.json"))
    if not files:
        raise SystemExit(f"REFUSED: no shelf file for {slug!r} (MANIFEST has {len(manifest)} entries)")
    return json.loads(files[0].read_text(encoding="utf-8"))["plan"]


def _id(obj) -> str | None:
    if not isinstance(obj, dict):
        return None
    for k in ("routine", "tracker", "definition", "account", "note", "style"):
        if isinstance(obj.get(k), dict) and obj[k].get("id"):
            return obj[k]["id"]
    return obj.get("id")


def seed_member(svc: Services, p: dict, idx: int, seed: int, defaults: dict, corpus: list[str],
                app_root: Path) -> dict:
    rng = random.Random(seed * 100 + idx)
    clock = persona_clock(p, defaults)
    data = p.get("data") or {}
    email = p["email"]
    rec: dict = {"persona": p["id"], "email": email, "password": PASSWORD, "clock": clock.isoformat()}
    user = svc.auth.create_user(email, PASSWORD, p.get("display_name") or f"Campaign {p['id']}")
    uid = user["id"]
    rec["user_id"] = uid
    if data.get("paid", True):
        svc.auth.comp_user_access(email, grant=True)
    if data.get("verified", True):
        uid_back = svc.auth.verify_email_token(svc.auth.create_email_verification(uid))
        if uid_back != uid:
            raise SystemExit(f"REFUSED: the verification link for {email} did not verify it")
    if data.get("session", True):
        rec["session"] = svc.auth.create_session(uid, user_agent="notebook-campaign seed", ip_address="127.0.0.1")

    # accounts
    acct_spec = data.get("accounts", 1)
    names = acct_spec if isinstance(acct_spec, list) else ["Main book", "Swing book", "Retirement", "Prop eval",
                                                            "Options book"][:int(acct_spec)]
    accounts = []
    if not data.get("account_size", True):
        # The accounts door refuses a new account with no starting balance, so the member with "no account
        # size" keeps the account the app makes on its own (the same call the trades route makes).
        names = []
        accounts.append(_id(svc.accounts.get_or_migrate_default_account(uid)))
    for i, nm in enumerate(names):
        payload = {"name": nm if not data.get("hostile_names") else f"{nm} {corpus[i % len(corpus)][:30]}",
                   "color": ["blue", "teal", "amber", "purple", "emerald"][i % 5]}
        if data.get("account_size", True):
            payload["startingBalance"] = [100000, 25000, 50000, 150000, 10000][i % 5]
        accounts.append(_id(svc.accounts.create_account(uid, payload)))
    rec["accounts"] = accounts

    # trades (the CSV import confirm door's service, chunked like a member's large imports)
    tspec = data.get("trades") or {}
    if tspec.get("n") or tspec.get("tilt_day") or tspec.get("breach_day"):
        sess = sessions_before(svc, clock, int(tspec.get("sessions", 60)))
        rows = trade_rows(tspec, rng, sess, corpus)
        by_acct: dict[str, list] = {}
        for i, r in enumerate(rows):
            a = accounts[i % len(accounts)] if tspec.get("split_accounts", True) else accounts[0]
            by_acct.setdefault(a, []).append(r)
        for a, rs in by_acct.items():
            settings = svc.accounts.get_account_settings(uid, a)
            for k in range(0, len(rs), 1000):
                chunk = rs[k:k + 1000]
                svc.trades.assign_csv_external_ids(chunk)
                svc.trades.bulk_insert_trades(uid, chunk, settings, account_id=a, source="csv")

    # options
    ospec = data.get("options") or {}
    for i in range(int(ospec.get("n", 0))):
        und = rng.choice(["SPY", "QQQ", "IWM", "NVDA", "TSLA"])
        call = rng.random() < 0.6
        entry = sessions_before(svc, clock, 40)[i % 40]
        ep = round(rng.uniform(0.8, 6.0), 2)
        st = svc.options.create_strategy(uid, {
            "underlying": und, "strategy_type": "long_call" if call else "long_put",
            "direction": "bullish" if call else "bearish", "entry_date": entry.isoformat(),
            "legs": [{"side": "buy", "contract_type": "call" if call else "put", "strike": 100 + i % 50,
                      "expiration": ospec.get("expiration", "2026-12-18"), "qty": rng.choice([1, 2, 5]),
                      "entry_price": ep}]}, account_id=accounts[i % len(accounts)])
        sid = _id(st)
        if ospec.get("closed", True) and sid:
            xp = round(max(0.05, ep * rng.uniform(0.3, 2.2)), 2)
            svc.options.close_strategy(uid, sid, {"exitPrices": {"0": xp}, "exitDate": entry.isoformat()})

    # property definitions, then notes
    nspec = data.get("notes") or {}
    prop_ids = []
    for k in range(int(nspec.get("properties", 0))):
        typ = ["number", "select", "text", "date", "checkbox"][k % 5]
        opts = [{"id": f"opt{j}", "label": f"Opt {j}"} for j in range(3)] if typ == "select" else None
        try:
            prop_ids.append((_id(svc.props.create_property_def(uid, f"Prop {k + 1}", typ, opts)), typ))
        except Exception as e:  # noqa: BLE001 -- a type this build refuses is recorded, never invented
            rec.setdefault("refused", []).append(f"property {typ}: {e}")
    note_ids = []
    for k in range(int(nspec.get("n", 0))):
        title = f"{nspec.get('title', 'Note')} {k + 1}"
        if nspec.get("hostile"):
            title = f"{corpus[k % len(corpus)][:120]}"
        body = {"type": "doc", "content": [{"type": "paragraph", "content": [
            {"type": "text", "text": (corpus[k % len(corpus)] if nspec.get("hostile") else f"Seeded note {k + 1}.")}]}]}
        props = {}
        for pid, typ in prop_ids:
            if not pid:
                continue
            props[pid] = {"number": rng.randint(1, 10), "select": f"opt{rng.randint(0, 2)}", "text": "seeded",
                          "date": sessions_before(svc, clock, 5)[0].isoformat(), "checkbox": rng.random() < 0.5}[typ]
        payload = {"title": title, "bodyJson": body, "tags": nspec.get("tags") or []}
        try:
            note = svc.notes.create_note(uid, payload, properties=props or None)
        except Exception as e:  # noqa: BLE001
            rec.setdefault("refused", []).append(f"note {k}: {type(e).__name__}: {str(e)[:120]}")
            continue
        note_ids.append(_id(note))
    rec["notes"] = note_ids[:25]

    # routines
    rec["routines"] = []
    for r in data.get("routines") or []:
        created = datetime.fromisoformat(r["created"]) if r.get("created") else clock - timedelta(days=21)
        got = svc.routines.create(uid, name=r["name"], items=[{"text": t} for t in r["items"]],
                                  schedule=r.get("schedule") or {"kind": "every"}, settings=r.get("settings"),
                                  now=created)
        rid = _id(got)
        full = svc.routines.get(uid, rid, now=created) or {}
        items = [i["id"] for i in full.get("items") or []]
        for day, pattern in (r.get("ticks") or {}).items():
            d = date.fromisoformat(day)
            at = datetime(d.year, d.month, d.day, 20, 0, tzinfo=_ET())
            if pattern == "skip":
                svc.routines.set_skipped(uid, rid, day, True, now=at)
                continue
            picks = items if pattern == "all" else items[: max(1, len(items) // 2)] if pattern == "half" else items[:1]
            for it in picks:
                svc.routines.set_tick(uid, rid, day, it, True, now=at)
        if r.get("state") == "archived":
            svc.routines.archive(uid, rid, now=clock)
        elif r.get("state") == "deleted":           # the store asks for an archive first, as My tools does
            svc.routines.archive(uid, rid, now=clock)
            svc.routines.soft_delete(uid, rid, typed_name=r["name"], now=clock)
        rec["routines"].append({"id": rid, "name": r["name"], "items": items, "state": r.get("state", "live")})

    # trackers
    rec["trackers"] = []
    for t in data.get("trackers") or []:
        got = svc.trackers.create(uid, name=t["name"], kind=t["kind"], unit=t.get("unit"), settings=t.get("settings"),
                                  now=clock - timedelta(days=21))
        tid = _id(got)
        for day, value in (t.get("values") or {}).items():
            d = date.fromisoformat(day)
            try:
                svc.trackers.set_value(uid, tid, day, value, now=datetime(d.year, d.month, d.day, 20, 0, tzinfo=_ET()))
            except Exception as e:  # noqa: BLE001 -- an edge value the store refuses: recorded, it is the point
                rec.setdefault("refused", []).append(f"tracker {t['name']} {day}={value!r}: {str(e)[:120]}")
        if t.get("state") == "archived":
            svc.trackers.archive(uid, tid, now=clock)
        elif t.get("state") == "deleted":
            svc.trackers.archive(uid, tid, now=clock)
            svc.trackers.soft_delete(uid, tid, typed_name=t["name"], now=clock)
        rec["trackers"].append({"id": tid, "name": t["name"], "state": t.get("state", "live")})

    # templates (journal styles)
    rec["styles"] = []
    for s in data.get("styles") or []:
        outline = {"type": "doc", "content": [
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": h}]} for h in s.get("headings", ["Plan", "Review"])]}
        st = svc.styles.create_style(uid, {"name": s["name"], "kindId": s.get("kind", "daily_prep"), "outlineBodyJson": outline})
        sid = _id(st)
        if s.get("state") == "default":
            svc.styles.set_default(uid, sid)
        elif s.get("state") == "deleted":
            svc.styles.delete_style(uid, sid)
        rec["styles"].append({"id": sid, "name": s["name"], "state": s.get("state", "live")})

    # widgets (definitions from the released shelf plans)
    wspec = data.get("widgets") or {}
    rec["widgets"] = []
    for k in range(int(wspec.get("n", 0))):
        slug = (wspec.get("from") or ["daily-pnl-bars"])[k % len(wspec.get("from") or ["daily-pnl-bars"])]
        d = svc.defs.create(uid, f"{wspec.get('name', 'Seeded widget')} {k + 1}", shelf_plan(app_root, slug), now=clock)
        rec["widgets"].append(_id(d))
    for k, state in enumerate(wspec.get("states") or []):
        if k >= len(rec["widgets"]):
            break
        if state == "archived":
            svc.defs.archive(uid, rec["widgets"][k], now=clock)
    rec["widgets"] = rec["widgets"][:25]
    return rec


def census(svc: Services, uid: str) -> dict:
    """Counts READ BACK from the stores (read-only SELECTs on the j2 tables; never a write)."""
    conn = svc.auth_db.get_connection()
    try:
        def one(sql):
            try:
                return conn.execute(sql, (uid,)).fetchone()[0]
            except Exception:  # noqa: BLE001 -- a table this build does not have
                return None
        return {"trades": one("SELECT COUNT(*) FROM j2_trades WHERE user_id = ?"),
                "strategies": one("SELECT COUNT(*) FROM j2_option_strategies WHERE user_id = ?"),
                "notes": one("SELECT COUNT(*) FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL"),
                "routines": one("SELECT COUNT(*) FROM j2_routines WHERE user_id = ?"),
                "trackers": one("SELECT COUNT(*) FROM j2_trackers WHERE user_id = ?"),
                "ticks": one("SELECT COUNT(*) FROM j2_routine_ticks WHERE user_id = ?"),
                "tracker_values": one("SELECT COUNT(*) FROM j2_tracker_values WHERE user_id = ?"),
                "styles": one("SELECT COUNT(*) FROM j2_journal_styles WHERE user_id = ?"),
                "accounts": one("SELECT COUNT(*) FROM j2_accounts WHERE user_id = ?"),
                "widgets": one("SELECT COUNT(*) FROM j2_widget_definitions WHERE user_id = ?")}
    finally:
        conn.close()


def census_line(pid: str, email: str, c: dict) -> str:
    return (f"CENSUS {pid} {email}: trades={c['trades']} strategies={c['strategies']} notes={c['notes']} "
            f"routines={c['routines']} (ticks={c['ticks']}) trackers={c['trackers']} (values={c['tracker_values']}) styles={c['styles']} accounts={c['accounts']} "
            f"widgets={c['widgets']}")


@contextlib.contextmanager
def heavy_lock(label: str, enabled: bool):
    if not enabled or not HEAVY_LOCK.is_file():
        yield
        return
    sys.path.insert(0, str(HEAVY_LOCK.parent))
    from heavy_lock import heavy  # noqa: E402
    with heavy(label):
        yield


def boot_schema(app_root: Path, data_dir: Path, port: int, out_dir: Path) -> str:
    """Start the app's launcher on `data_dir` until it is healthy and its +15 s checkpoint is
    written, then stop it gracefully. Returns the stop description. The launcher's integrity log
    is moved into `out_dir`."""
    sys.path.insert(0, str(app_root / "tools"))
    import notebook_perf_harness as h  # noqa: E402
    if h.port_busy(port):
        raise SystemExit(f"REFUSED: port {port} already has a listener (never killed); pass --schema-port")
    log = out_dir / "seed-schema-boot.log"
    sb = h.Sandbox(str(data_dir), port, log)
    sb.start()
    try:
        if not sb.wait_healthy(f"http://127.0.0.1:{port}", 400):
            raise SystemExit(f"REFUSED: the schema boot never answered /api/health (log {log})")
        sb.wait_checkpoint(h.POST_BOOT, h.POST_BOOT_WAIT_S)
    finally:
        how = sb.stop()
    ipath = sb.integrity_path()
    if ipath and Path(ipath).is_file():
        shutil.move(ipath, out_dir / "seed-schema-boot.integrity.md")
    integ = h.read_integrity(out_dir / "seed-schema-boot.integrity.md", [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
    print(h.integrity_line(integ, f"schema boot; stop: {how}"), flush=True)
    if not integ.get("clean"):
        raise SystemExit("REFUSED: the schema boot's integrity did not close CLEAN; nothing was seeded")
    return how


def boot_schema_clock(app_root: Path, data_dir: Path, port: int, out_dir: Path) -> str:
    """The schema boot through sandbox_clock.py at the real now (no shift that matters: the tables are the
    app's own either way). For a caller that must not open C:\\data at all: the hub launcher hashes the
    shared data root read-only; this launcher hashes nothing (its guard is the census tripwire, which
    raises on any write there and reports it). The clock launcher's output is kept in `out_dir`."""
    import signal
    import subprocess
    import urllib.request
    sys.path.insert(0, str(app_root / "tools"))
    import notebook_perf_harness as h  # noqa: E402
    if h.port_busy(port):
        raise SystemExit(f"REFUSED: port {port} already has a listener (never killed); pass --schema-port")
    log = out_dir / "seed-schema-boot.log"
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    cmd = [sys.executable, "-u", "-c", h._SHIM, str(HERE / "sandbox_clock.py"), "--clock", now,
           "--data-dir", str(data_dir), "--port", str(port), "--app-root", str(app_root), "--no-remint"]
    kw = ({"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True})
    with open(log, "w", encoding="utf-8") as fh:
        proc = subprocess.Popen(cmd, cwd=str(app_root), stdout=fh, stderr=subprocess.STDOUT, **kw)
    try:
        end, ok = time.time() + 400, False
        while time.time() < end and proc.poll() is None and not ok:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=3) as r:
                    ok = r.status == 200
            except Exception:  # noqa: BLE001 -- not up yet
                time.sleep(0.5)
        if not ok:
            raise SystemExit(f"REFUSED: the schema boot never answered /api/health (log {log})")
        time.sleep(15)                      # the boot's own background table work, as the +15 s checkpoint
    finally:
        how = "exited on its own"
        if proc.poll() is None:
            try:
                proc.send_signal(signal.CTRL_BREAK_EVENT if os.name == "nt" else signal.SIGINT)
                proc.wait(timeout=60)
                how = f"graceful (rc {proc.returncode})"
            except Exception:  # noqa: BLE001
                proc.kill()
                proc.wait()
                how = f"killed by PID {proc.pid}"
    text = log.read_text(encoding="utf-8", errors="replace")
    blocked = [ln for ln in text.splitlines() if "SHARED-ROOT WRITE BLOCKED" in ln]
    print(f"schema boot (clock launcher, pid {proc.pid}): {how}; shared-root writes blocked: {len(blocked)}", flush=True)
    if blocked:
        raise SystemExit("REFUSED: the schema boot tried to write the shared data root; nothing was seeded")
    return how


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--seed", type=int, default=20261024)
    ap.add_argument("--app-root", default=str(REPO), help="the checkout whose api/ and launcher are used")
    ap.add_argument("--personas", default=str(PERSONAS))
    ap.add_argument("--only", default="", help="comma-separated persona ids (default: all 50)")
    ap.add_argument("--schema-port", type=int, default=SCHEMA_PORT)
    ap.add_argument("--no-heavy-lock", action="store_true")
    ap.add_argument("--schema-via-clock-launcher", action="store_true",
                    help="boot the schema through sandbox_clock.py (hashes nothing under C:\\data) instead of "
                         "the hub launcher (which hashes it read-only)")
    args = ap.parse_args(argv)

    why = refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    data_dir = Path(os.path.abspath(args.data_dir))
    if (data_dir / MANIFEST_NAME).exists():
        print(f"REFUSED: {data_dir} already holds a campaign manifest; seed into an empty dir")
        return 3
    created = not data_dir.exists()
    if data_dir.exists() and any(data_dir.iterdir()):
        print(f"REFUSED: {data_dir} is not empty (the seed is for a fresh sandbox)")
        return 3
    data_dir.mkdir(parents=True, exist_ok=True)
    app_root = Path(args.app_root).resolve()
    spec = load_personas(args.personas)
    only = {x.strip() for x in args.only.split(",") if x.strip()}
    people = [p for p in spec["personas"] if not only or p["id"] in only]

    (boot_schema_clock if args.schema_via_clock_launcher else boot_schema)(app_root, data_dir, args.schema_port, data_dir)

    sys.path.insert(0, str(app_root))
    sys.path.insert(0, str(app_root / "scripts"))
    os.chdir(app_root)
    import hub_sandbox_boot  # noqa: E402
    hub_sandbox_boot.apply_sandbox_env(str(data_dir), test_email=spec["defaults"]["admin_email"],
                                       reclaim_conftest_temp=True)
    import conftest  # noqa: E402 -- already armed by apply_sandbox_env; read for its violation record
    svc = Services()
    corpus = fuzz_corpus(app_root)
    manifest = {"seed": args.seed, "data_dir": str(data_dir), "app_root": str(app_root), "created_data_dir": created,
                "personas_file": str(Path(args.personas).resolve()), "members": {}, "census": {}}
    t0 = time.time()
    big = any(((p.get("data") or {}).get("trades") or {}).get("n", 0) >= 1000
              or ((p.get("data") or {}).get("notes") or {}).get("n", 0) >= 1000 for p in people)
    with heavy_lock("notebook-campaign seed", enabled=big and not args.no_heavy_lock):
        for p in people:
            idx = int(p["id"][1:])
            t1 = time.time()
            rec = seed_member(svc, p, idx, args.seed, spec["defaults"], corpus, app_root)
            c = census(svc, rec["user_id"])
            rec["seconds"] = round(time.time() - t1, 1)
            manifest["members"][p["id"]] = rec
            manifest["census"][p["id"]] = c
            print(census_line(p["id"], p["email"], c) + f" ({rec['seconds']} s)", flush=True)
            if rec.get("refused"):
                print(f"  refused by the stores (recorded): {rec['refused'][:4]}", flush=True)
    if conftest.SHARED_ROOT_VIOLATIONS:
        print(f"REFUSED: {len(conftest.SHARED_ROOT_VIOLATIONS)} shared-root writes were blocked; see the record")
        manifest["shared_root_violations"] = [{"op": v["op"], "path": v["path"]} for v in conftest.SHARED_ROOT_VIOLATIONS]
    manifest["seconds"] = round(time.time() - t0, 1)
    tmp = data_dir / (MANIFEST_NAME + ".tmp")
    tmp.write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding="utf-8", newline="\n")
    os.replace(tmp, data_dir / MANIFEST_NAME)
    print(f"SEEDED {len(people)} members in {manifest['seconds']} s; manifest: {data_dir / MANIFEST_NAME}")
    return 2 if manifest.get("shared_root_violations") else 0


if __name__ == "__main__":
    sys.exit(main())
