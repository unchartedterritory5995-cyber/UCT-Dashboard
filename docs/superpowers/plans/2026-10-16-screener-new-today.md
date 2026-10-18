# Screener "New today" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark each row in a Focus screen "New" when it was not in that screen at the previous nightly build, show "N new · M dropped" above the list, and offer a "New only" filter, dark behind `SCREENER_NEW_TODAY_ENABLED`.

**Architecture:** A nightly record (`screen_membership` in screener.db) of every starter's and saved screen's tickers, written right after a complete 03:00 build. A paid route compares the screen's CURRENT results with the previous build's record. The Focus list reads that answer through one hook and draws a pill, a head line and a toggle.

**Tech Stack:** FastAPI + SQLite (screener.db via `snapshot_db.connect`), React + SWR, vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-10-16-screener-focus-next-design.md` §1. This plan is one of three; pre-market (§2) and phones (§3) get their own plans.

## Global Constraints

- Flag `SCREENER_NEW_TODAY_ENABLED`, three-value grammar of `SCREENER_FLAGS` in `api/routers/auth.py` (unset/0 = off, 1 = everyone, admin = owner preview), read PER REQUEST. Off means no job, route answers 404, no UI.
- Branch from `origin/master` AFTER PR #355 merged (it moved the screener route pin to 27). Work in a NEW worktree; write `.uct-session-owner` at its root.
- pytest by NAMED files only; frontend tests by named files only; never the full suite.
- Run tests and `git commit` in SEPARATE tool calls. `git add` named paths only. Commit with `git commit -F - <<'EOF'` (never `-m` with identifiers). End every commit message with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01RPRLNiwbFPhajMfZb7MqQT`.
- `python tools/check_repo_hygiene.py` must say clean before each commit. Preserve each file's existing line endings.
- Never set `ALLOW_LOCAL_VENDOR_SOCKETS`. Never write to `C:\data`. Tests use `SCREENER_DB_PATH` under `tmp_path`.
- Mutation proof for every new guard: break it, show red, restore by re-writing saved bytes (never `git checkout --`).
- Copy (member-visible, exact): pill `New`; head line `{n} new · {m} dropped`; its title `New since {Mon D} close`; live screen note `New markers follow the overnight build; this screen is live`.

## Review Focus

1. **A live-volume screen** (any clause on `rvol_live`, including inside `logic`) must answer `live_screen`, never mark every row New. Test in Task 1.
2. **First-ever record / only one build recorded** must say nothing (`no_history`), never "everything is new". Test in Task 1.
3. **A screen wider than 2,000 matches** must answer `too_wide` and store no ticker list. Test in Task 1.
4. **A spec with a member's watchlist (`list`) filter** must never be recorded (per-member answer) and its diff must answer `unsaved`. Test in Task 1.
5. **Key order and sort/view differences** must not change the hash (the same screen sorted differently is the same screen). Test in Task 1.

---

### Task 1: The membership record and the diff (service)

**Files:**
- Create: `api/services/screener/membership.py`
- Modify: `api/services/screener/saved_screens.py` (add `all_specs()`)
- Test: `tests/test_screener_new_today.py`

**Interfaces:**
- Produces:
  - `spec_hash(spec: dict) -> str`
  - `reads_live_only(spec: dict) -> bool`
  - `has_list_filter(spec: dict) -> bool`
  - `record(spec: dict, *, snapshot_date: str, session_date: str | None) -> str` returning `"ok" | "too_wide" | "skipped_list"`
  - `record_all() -> dict` receipt `{recorded, too_wide, skipped_list, errors, snapshot_date, session_date}`
  - `diff(spec: dict) -> dict` with `state` in `ok | no_history | too_wide | live_screen | unsaved`, plus for `ok`: `as_of`, `prev_as_of`, `prev_session`, `entered: list[str]`, `exited: list[str]`, `new_since_label: str`
  - `saved_screens.all_specs() -> list[dict]`

- [ ] **Step 1: Write the failing tests**

```python
"""New today: the nightly screen-membership record and the diff the Focus list reads."""
import pytest

from api.services.screener import logic
from api.services.screener import membership as M
from api.services.screener import query as Q
from api.services.screener import snapshot_db as db

SPEC = {"filters": [{"key": "price", "op": "gte", "min": 10}]}


def _row(t, d, **kw):
    return {"ticker": t, "snapshot_date": d, "price": 50.0, **kw}


@pytest.fixture
def snap(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    monkeypatch.setenv(logic.FLAG, "1")
    db.init_db()
    M._CURRENT.clear()
    return tmp_path


def _build(day, tickers, session):
    """One nightly build: replace the snapshot, then record SPEC against it."""
    with db.connect() as c:
        c.execute("DELETE FROM screener_rows")
    db.upsert_rows([_row(t, day) for t in tickers])
    return M.record(SPEC, snapshot_date=day, session_date=session)


def test_the_hash_ignores_key_order_sort_and_view():
    a = {"filters": [{"op": "gte", "key": "price", "min": 10}], "sort": {"key": "x"}, "view": "v"}
    b = {"view": "w", "filters": [{"key": "price", "min": 10, "op": "gte"}]}
    assert M.spec_hash(a) == M.spec_hash(b)
    assert M.spec_hash(a) != M.spec_hash({"filters": [{"key": "price", "op": "gte", "min": 11}]})


def test_a_live_volume_clause_anywhere_makes_it_a_live_screen():
    nested = {"filters": [], "logic": {"any": [{"all": [{"key": "rvol_live", "op": "gte", "min": 2}]}]}}
    assert M.reads_live_only(nested) is True
    assert M.reads_live_only(SPEC) is False
    assert M.diff(nested)["state"] == "live_screen"


def test_new_is_against_the_PREVIOUS_build_and_names_its_session(snap):
    assert _build("2026-10-15", ["AAA", "BBB"], "2026-10-14") == "ok"
    assert _build("2026-10-16", ["AAA", "CCC"], "2026-10-15") == "ok"
    out = M.diff(SPEC)
    assert out["state"] == "ok"
    assert out["entered"] == ["CCC"] and out["exited"] == ["BBB"]
    assert out["prev_session"] == "2026-10-14"
    assert out["new_since_label"] == "New since Oct 14 close"


def test_one_recorded_build_says_nothing(snap):
    _build("2026-10-16", ["AAA"], "2026-10-15")
    assert M.diff(SPEC)["state"] == "no_history"


def test_a_screen_never_recorded_is_unsaved(snap):
    assert M.diff({"filters": [{"key": "price", "op": "gte", "min": 999}]})["state"] == "unsaved"


def test_a_screen_wider_than_the_cap_stores_no_list(snap, monkeypatch):
    monkeypatch.setattr(M, "TOO_WIDE", 1)
    assert _build("2026-10-15", ["AAA", "BBB"], "2026-10-14") == "too_wide"
    assert _build("2026-10-16", ["AAA", "BBB"], "2026-10-15") == "too_wide"
    assert M.diff(SPEC)["state"] == "too_wide"
    with db.connect() as c:
        assert c.execute("SELECT COUNT(*) FROM screen_membership WHERE tickers IS NOT NULL").fetchone()[0] == 0


def test_a_watchlist_filter_is_never_recorded(snap):
    spec = {"filters": [{"key": "list", "op": "in", "values": ["wl:1"]}]}
    assert M.has_list_filter(spec) is True
    assert M.record(spec, snapshot_date="2026-10-16", session_date="2026-10-15") == "skipped_list"
    assert M.diff(spec)["state"] == "unsaved"


def test_only_the_newest_dates_are_kept(snap, monkeypatch):
    monkeypatch.setattr(M, "KEEP_DATES", 2)
    for i, d in enumerate(["2026-10-13", "2026-10-14", "2026-10-15"]):
        _build(d, ["AAA"], f"2026-10-1{i}")
    with db.connect() as c:
        dates = [r[0] for r in c.execute("SELECT snapshot_date FROM screen_membership ORDER BY 1")]
    assert dates == ["2026-10-14", "2026-10-15"]


def test_record_all_covers_starters_and_saved_screens_once_each(snap, monkeypatch):
    from api.services.screener import saved_screens as SS
    dup = {"filters": [{"key": "price", "op": "gte", "min": 10}]}
    monkeypatch.setattr(SS, "starters", lambda: [{"spec": dup}, {"spec": SPEC}])
    monkeypatch.setattr(SS, "all_specs", lambda: [SPEC, {"filters": [{"key": "list", "op": "in", "values": ["x"]}]}])
    monkeypatch.setattr(M, "_build_identity", lambda: ("2026-10-16", "2026-10-15"))
    db.upsert_rows([_row("AAA", "2026-10-16")])
    r = M.record_all()
    assert r["recorded"] == 1 and r["skipped_list"] == 1 and r["errors"] == 0
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest -q -p no:cacheprovider tests/test_screener_new_today.py`
Expected: FAIL at import, `No module named 'api.services.screener.membership'`.

- [ ] **Step 3: Write the service**

`api/services/screener/membership.py`:

```python
"""Which stocks were in each screen at each nightly build: the record behind "New today".

A row is NEW when it is in the screen's current results and was not in the screen's
results at the PREVIOUS build. The label names the trading session that previous build
ran through (a build's `snapshot_date` is the day it ran, not the session it describes).
Spec: docs/superpowers/specs/2026-10-16-screener-focus-next-design.md section 1.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import logging
import time

from . import snapshot_db

log = logging.getLogger(__name__)

#: Dates kept per screen.
KEEP_DATES = 5
#: Above this many matches a screen stores its count only and shows no markers.
TOO_WIDE = 2000
#: Columns that are blank in every nightly build by design: a nightly comparison of a
#: screen reading one would mark every row New.
LIVE_ONLY_COLUMNS = frozenset({"rvol_live"})
#: Seconds a screen's CURRENT tickers are reused between diff requests.
CURRENT_TTL_S = 60

_CURRENT: dict = {}


def _walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def spec_hash(spec: dict) -> str:
    """The screen's identity: its criteria only (filters, logic, rank), never sort or view."""
    spec = spec or {}
    crit = {"filters": spec.get("filters") or [], "logic": spec.get("logic"), "rank": spec.get("rank")}
    raw = json.dumps(crit, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def reads_live_only(spec: dict) -> bool:
    return any(n.get("key") in LIVE_ONLY_COLUMNS for n in _walk(spec or {}))


def has_list_filter(spec: dict) -> bool:
    return any(n.get("key") == "list" for n in _walk(spec or {}))


def _ensure(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS screen_membership (
        spec_hash TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        session_date TEXT,
        state TEXT NOT NULL,
        n INTEGER NOT NULL,
        tickers TEXT,
        recorded_at REAL NOT NULL,
        PRIMARY KEY (spec_hash, snapshot_date))""")


def _tickers_now(spec: dict, limit: int) -> tuple[list[str], int]:
    """The screen's tickers as the scan answers them right now (live overlay included)."""
    from api.routers.screen_promote import screen_tickers
    tickers, total, _snap = screen_tickers(spec, {}, limit)
    return tickers, total


def record(spec: dict, *, snapshot_date: str, session_date: str | None) -> str:
    if has_list_filter(spec):
        return "skipped_list"
    tickers, total = _tickers_now(spec, TOO_WIDE + 1)
    state = "too_wide" if total > TOO_WIDE else "ok"
    h = spec_hash(spec)
    with snapshot_db.connect() as conn:
        _ensure(conn)
        conn.execute(
            "INSERT OR REPLACE INTO screen_membership "
            "(spec_hash, snapshot_date, session_date, state, n, tickers, recorded_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (h, snapshot_date, session_date, state, int(total),
             json.dumps(sorted(tickers)) if state == "ok" else None, time.time()))
        conn.execute(
            "DELETE FROM screen_membership WHERE spec_hash = ? AND snapshot_date NOT IN "
            "(SELECT snapshot_date FROM screen_membership WHERE spec_hash = ? "
            " ORDER BY snapshot_date DESC LIMIT ?)", (h, h, KEEP_DATES))
    return state


def _build_identity() -> tuple[str | None, str | None]:
    """(snapshot_date, settled session) of the build that just finished."""
    st = snapshot_db.status() or {}
    run = snapshot_db.last_build_run() or {}
    session = (run.get("settled_bars") or {}).get("session")
    return st.get("snapshot_date"), session


def record_all() -> dict:
    from . import saved_screens
    snapshot_date, session_date = _build_identity()
    out = {"recorded": 0, "too_wide": 0, "skipped_list": 0, "errors": 0,
           "snapshot_date": snapshot_date, "session_date": session_date}
    if not snapshot_date:
        out["errors"] = 1
        return out
    specs = [s.get("spec") or {} for s in saved_screens.starters()] + list(saved_screens.all_specs())
    seen = set()
    for spec in specs:
        h = spec_hash(spec)
        if h in seen:
            continue
        seen.add(h)
        try:
            state = record(spec, snapshot_date=snapshot_date, session_date=session_date)
        except Exception as e:                                  # noqa: BLE001
            log.warning("[screener] membership record failed for %s: %s", h[:12], e)
            out["errors"] += 1
            continue
        out["recorded" if state == "ok" else state] += 1
    return out


def _label(session_date: str | None, snapshot_date: str) -> str:
    try:
        d = datetime.date.fromisoformat(session_date)
        return f"New since {d.strftime('%b')} {d.day} close"
    except (TypeError, ValueError):
        return f"New since the {snapshot_date} build"


def diff(spec: dict) -> dict:
    if reads_live_only(spec):
        return {"state": "live_screen"}
    if has_list_filter(spec):
        return {"state": "unsaved"}
    h = spec_hash(spec)
    with snapshot_db.connect() as conn:
        _ensure(conn)
        rows = conn.execute(
            "SELECT snapshot_date, session_date, state, tickers FROM screen_membership "
            "WHERE spec_hash = ? ORDER BY snapshot_date DESC LIMIT 2", (h,)).fetchall()
    if not rows:
        return {"state": "unsaved"}
    if len(rows) < 2:
        return {"state": "no_history"}
    latest, prev = rows[0], rows[1]
    if "too_wide" in (latest["state"], prev["state"]):
        return {"state": "too_wide"}
    hit = _CURRENT.get(h)
    if hit and time.time() - hit[0] < CURRENT_TTL_S:
        current = hit[1]
    else:
        current = set(_tickers_now(spec, TOO_WIDE + 1)[0])
        _CURRENT[h] = (time.time(), current)
    before = set(json.loads(prev["tickers"] or "[]"))
    return {"state": "ok", "as_of": latest["snapshot_date"], "prev_as_of": prev["snapshot_date"],
            "prev_session": prev["session_date"],
            "entered": sorted(current - before), "exited": sorted(before - current),
            "new_since_label": _label(prev["session_date"], prev["snapshot_date"])}
```

Add to `api/services/screener/saved_screens.py`, after `list_for`:

```python
def all_specs():
    """Every member's saved screen spec, for the nightly membership record. Specs only:
    the record is keyed by the screen's criteria, never by who saved it."""
    init()
    with auth_db.get_connection() as c:
        rows = c.execute("SELECT spec_json FROM screener_saved_screens").fetchall()
    out = []
    for r in rows:
        try:
            out.append(json.loads(r["spec_json"]))
        except (TypeError, ValueError):
            continue
    return out
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest -q -p no:cacheprovider tests/test_screener_new_today.py`
Expected: PASS (9 tests). ⚠️ `run_scan` excludes rows whose bars are stale (PR #340): if a fixture row is filtered out, give `_row` a current `bars_asof` (copy what `tests/test_screener_scan_intel.py` does) rather than weakening an assertion. If `screen_tickers` reads its page size from `screen_promote.PAGE`, that is fine. If importing the router module is heavy in the test, keep the import inside `_tickers_now`, as written.

- [ ] **Step 5: Mutation proof**

Each of these, applied one at a time, must turn at least one test red. Restore from saved bytes after each.
- (a) in `diff`, compare against `rows[0]` instead of `rows[1]`;
- (b) delete the `reads_live_only` early return;
- (c) make `record` store tickers for `too_wide`;
- (d) drop the `has_list_filter` check in `record`.

- [ ] **Step 6: Commit**

```bash
python tools/check_repo_hygiene.py
git add api/services/screener/membership.py api/services/screener/saved_screens.py tests/test_screener_new_today.py
git commit -F - <<'EOF'
feat(screener): nightly screen-membership record and the New-today diff (dark)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RPRLNiwbFPhajMfZb7MqQT
EOF
```

---

### Task 2: The flag, the nightly hook and the route

**Files:**
- Modify: `api/routers/auth.py` (`SCREENER_FLAGS`)
- Modify: `api/main.py` (`register_screener_jobs._run`; the router include beside `screen_promote`)
- Create: `api/routers/screener_new_today.py`
- Modify: `docs/feature_flags.json` (ledger entry)
- Modify: `tests/test_screener_focus_flag.py` (the exact-dict assertion at line 16)
- Test: `tests/test_screener_new_today_route.py`

**Interfaces:**
- Consumes: `membership.diff`, `membership.record_all` (Task 1).
- Produces:
  - `POST /api/screener/membership-diff` with body `{"spec": {...}}`, answering `membership.diff(...)`'s dict. It is 404 when the flag is off for this user, and 402 for a free member.
  - `auth._screener_flags(...)` gains key `screener_new_today_enabled`.
  - `membership.job_enabled() -> bool`.

- [ ] **Step 1: Write the failing tests**

`tests/test_screener_new_today_route.py`:

```python
"""The New-today route and its nightly hook, gated by SCREENER_NEW_TODAY_ENABLED."""
import inspect

from api.routers import auth
from api.routers import screener_new_today as R
from api.services.screener import membership as M


def test_the_flag_rides_the_screener_flag_family(monkeypatch):
    monkeypatch.delenv("SCREENER_NEW_TODAY_ENABLED", raising=False)
    assert auth._screener_flags(is_admin=True)["screener_new_today_enabled"] is False
    monkeypatch.setenv("SCREENER_NEW_TODAY_ENABLED", "admin")
    assert auth._screener_flags(is_admin=True)["screener_new_today_enabled"] is True
    assert auth._screener_flags(is_admin=False)["screener_new_today_enabled"] is False


def test_the_job_runs_for_admin_or_everyone_and_not_when_off(monkeypatch):
    for v, want in (("", False), ("0", False), ("admin", True), ("1", True)):
        monkeypatch.setenv("SCREENER_NEW_TODAY_ENABLED", v)
        assert M.job_enabled() is want, v


def test_the_route_is_404_for_a_member_when_only_the_owner_previews(monkeypatch):
    import pytest
    from fastapi import HTTPException
    monkeypatch.setenv("SCREENER_NEW_TODAY_ENABLED", "admin")
    with pytest.raises(HTTPException) as e:
        R.membership_diff(R.DiffIn(spec={}), user={"role": "member"})
    assert e.value.status_code == 404


def test_the_route_answers_the_diff_when_on(monkeypatch):
    monkeypatch.setenv("SCREENER_NEW_TODAY_ENABLED", "1")
    monkeypatch.setattr(M, "diff", lambda spec: {"state": "no_history"})
    assert R.membership_diff(R.DiffIn(spec={"filters": []}), user={"role": "member"}) == {"state": "no_history"}


def test_the_route_carries_the_paid_gate():
    dep = inspect.signature(R.membership_diff).parameters["user"].default
    assert getattr(dep, "dependency", None) is R.require_paid


def test_the_nightly_job_records_membership_only_after_a_complete_build(monkeypatch):
    import api.main as main
    from api.services import chart_health_alerts
    from api.services.screener import distribution, snapshot_builder
    calls = []
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    monkeypatch.setenv("SCREENER_NEW_TODAY_ENABLED", "1")
    monkeypatch.setattr(main, "start_screener_snapshot_warm", lambda: None)
    monkeypatch.setattr(chart_health_alerts, "emit", lambda *a, **k: True)
    monkeypatch.setattr(distribution, "distributions", lambda: None)
    monkeypatch.setattr(M, "record_all", lambda: calls.append(1) or {})
    jobs = {}

    class _S:
        def add_job(self, func, **kw):
            jobs[kw.get("id")] = func
    main.register_screener_jobs(_S())
    monkeypatch.setattr(snapshot_builder, "run_build",
                        lambda *a, **k: {"targets": 5, "built": 2, "skipped": 0, "errors": 0, "populated": {}})
    jobs["screener_snapshot_nightly"]()
    assert calls == []                      # short build: no record
    monkeypatch.setattr(snapshot_builder, "run_build",
                        lambda *a, **k: {"targets": 5, "built": 5, "skipped": 0, "errors": 0, "populated": {}})
    jobs["screener_snapshot_nightly"]()
    assert calls == [1]
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest -q -p no:cacheprovider tests/test_screener_new_today_route.py`
Expected: FAIL at import, `No module named 'api.routers.screener_new_today'`.

- [ ] **Step 3: Implement**

`api/routers/auth.py`, `SCREENER_FLAGS`:

```python
SCREENER_FLAGS = {
    "SCREENER_FOCUS_LAYOUT_ENABLED": False,   # enablement: Focus list + chart layout
    "SCREENER_NEW_TODAY_ENABLED": False,      # enablement: "New today" markers (spec 2026-10-16 s1)
}
```

Append to `api/services/screener/membership.py`:

```python
FLAG = "SCREENER_NEW_TODAY_ENABLED"


def job_enabled() -> bool:
    """The nightly record runs whenever ANYONE can see the markers (owner preview included)."""
    from api.routers import auth
    return auth._breadth_dc_scope(FLAG, False) != auth._SCOPE_OFF
```

`api/routers/screener_new_today.py`:

```python
"""POST /api/screener/membership-diff: the New-today answer for one screen (dark).

404 unless SCREENER_NEW_TODAY_ENABLED reaches this user (owner preview reaches admins
only); 402 for a free member, like every screener read. Spec section 1."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.routers import auth
from api.services.screener import membership

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The screener requires a paid plan")
    return user


class DiffIn(BaseModel):
    spec: dict


@router.post("/api/screener/membership-diff")
def membership_diff(body: DiffIn, user=Depends(require_paid)):
    is_admin = (user or {}).get("role") == "admin"
    if not auth._screener_flags(is_admin=is_admin)["screener_new_today_enabled"]:
        raise HTTPException(status_code=404, detail="Not Found")
    return membership.diff(body.spec or {})
```

Check `api/routers/screen_promote.py:1-30` for the exact import path of `get_current_user_with_plan` / `is_paid_user`, and copy it if it differs from the above.

`api/main.py`:
- Next to the `screen_promote` include (search `screen_promote_router`), add:
  `from api.routers import screener_new_today as screener_new_today_router  # noqa: E402  (dark)` and `app.include_router(screener_new_today_router.router)`.
- In `register_screener_jobs._run`, inside the `else:` branch after the volume-curve try block and BEFORE `_alert_if_nightly_short(stats)`, add:

```python
                # "New today" (dark): record each screen's tickers, but only after a
                # COMPLETE build -- a short build's membership would mark real names
                # as dropped tomorrow.
                try:
                    from api.services.screener import membership
                    if membership.job_enabled() and _nightly_shortfall(stats) is None:
                        mr = membership.record_all()
                        print(f"[scheduler] screener membership: {mr}")
                except Exception as e:  # noqa: BLE001
                    print(f"[scheduler] screener membership error: {e}")
```

`tests/test_screener_focus_flag.py` line 16 becomes:
`assert auth._screener_flags(is_admin=True) == {"screener_focus_layout_enabled": False, "screener_new_today_enabled": False}`.
Make sure that test unsets `SCREENER_NEW_TODAY_ENABLED` first, matching how it handles the focus flag.

`docs/feature_flags.json`: add `SCREENER_NEW_TODAY_ENABLED` beside `SCREENER_FOCUS_LAYOUT_ENABLED`, with `"status": "dark"`, `"where": ["web"]`, `member_facing` `{"label": "New today markers", "where": "Screener"}`, and a note naming the spec, the three values and "read per request; off = no job, route 404, no UI". Edit it as TEXT (insert the entry); never load and re-dump the JSON.

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest -q -p no:cacheprovider tests/test_screener_new_today_route.py tests/test_screener_new_today.py tests/test_screener_focus_flag.py tests/test_screener_nightly_rebuilds_every_row.py tests/test_visibility_flag_ledger.py`
Expected: all pass. Then run every test file whose name contains `flag_ledger` or `route` and `census`, found with `git ls-files tests | grep -E "flag_ledger|route.*census|census.*route"`. A new mounted route or a new flag can trip a census, and that census is the one to fix.

- [ ] **Step 5: Mutation proof**

Each must turn a test red; restore from saved bytes after each.
- (a) remove `and _nightly_shortfall(stats) is None`;
- (b) make the route skip the flag check;
- (c) make `job_enabled` return True when the flag is off.

- [ ] **Step 6: Commit**

```bash
python tools/check_repo_hygiene.py
git add api/routers/auth.py api/main.py api/routers/screener_new_today.py api/services/screener/membership.py docs/feature_flags.json tests/test_screener_focus_flag.py tests/test_screener_new_today_route.py
git commit -F - <<'EOF'
feat(screener): New-today route and nightly record behind SCREENER_NEW_TODAY_ENABLED (dark)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RPRLNiwbFPhajMfZb7MqQT
EOF
```

---

### Task 3: The Focus list (pill, head line, New only)

**Files:**
- Modify: `app/src/context/AuthContext.jsx` (state + payload mapping + provider value)
- Create: `app/src/pages/screener/focus/useNewToday.js`
- Create: `app/src/pages/screener/focus/NewTodayLine.jsx`
- Modify: `app/src/pages/screener/focus/ResultList.jsx` (`isNew` on the row)
- Modify: `app/src/pages/screener/focus/FocusScreener.jsx` (hook, toggle, filter, wiring)
- Modify: `app/src/pages/screener/focus/FocusScreener.module.css`
- Test: `app/src/pages/screener/focus/__tests__/newToday.test.jsx`

**Interfaces:**
- Consumes: `POST /api/screener/membership-diff` (Task 2), and the payload key `screener_new_today_enabled`.
- Produces:
  - `useNewToday(criteria: {filters, logic, rank}, enabled: boolean) -> object | null`
  - `<NewTodayLine nt newOnly onToggleNewOnly />`
  - `ResultList` prop `newSet: Set<string> | null`

- [ ] **Step 1: Write the failing tests**

`app/src/pages/screener/focus/__tests__/newToday.test.jsx`:

```jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi, expect, test } from 'vitest'
import ResultList from '../ResultList'
import NewTodayLine from '../NewTodayLine'

const row = t => ({ ticker: t, price: 10, chg_pct_1d: 1, base_render: 'Flat Base', vol_ratio: 1 })
const props = rows => ({ rows, index: 0, onSelect: vi.fn(), onKeyDown: vi.fn(), livePrices: {}, radar: new Set(), sortLabel: 'RS rank', total: rows.length, hasMore: false, onLoadMore: vi.fn(), isLoading: false })
const ok = (entered, exited) => ({ state: 'ok', entered, exited, new_since_label: 'New since Oct 14 close' })

test('a row in the new set wears a New pill and the others do not', () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
  render(<ResultList {...props([row('AAA'), row('BBB')])} newSet={new Set(['AAA'])} />)
  expect(screen.getByTestId('focus-row-AAA')).toHaveTextContent('New')
  expect(screen.getByTestId('focus-row-BBB')).not.toHaveTextContent('New')
  vi.unstubAllGlobals()
})

test('the head line counts new and dropped and names the session', () => {
  render(<NewTodayLine nt={ok(['A', 'B', 'C'], ['X', 'Y'])} newOnly={false} onToggleNewOnly={() => {}} />)
  expect(screen.getByRole('button', { name: /3 new/ })).toHaveAttribute('title', 'New since Oct 14 close')
  expect(screen.getByRole('button', { name: /2 dropped/ })).toBeInTheDocument()
})

test('dropped opens a list capped at 12 with a remainder', () => {
  const exited = Array.from({ length: 15 }, (_, i) => `T${i}`)
  render(<NewTodayLine nt={ok([], exited)} newOnly={false} onToggleNewOnly={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /15 dropped/ }))
  expect(screen.getByText('T0')).toBeInTheDocument()
  expect(screen.queryByText('T12')).toBeNull()
  expect(screen.getByText('+3 more')).toBeInTheDocument()
})

test('New only is a pressed toggle', () => {
  const onToggle = vi.fn()
  render(<NewTodayLine nt={ok(['A'], [])} newOnly onToggleNewOnly={onToggle} />)
  const b = screen.getByRole('button', { name: /1 new/ })
  expect(b).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(b)
  expect(onToggle).toHaveBeenCalledTimes(1)
})

test('a live screen says so and draws no counts', () => {
  render(<NewTodayLine nt={{ state: 'live_screen' }} newOnly={false} onToggleNewOnly={() => {}} />)
  expect(screen.getByText('New markers follow the overnight build; this screen is live')).toBeInTheDocument()
  expect(screen.queryByRole('button')).toBeNull()
})

test.each(['no_history', 'unsaved', 'too_wide'])('%s renders nothing', state => {
  const { container } = render(<NewTodayLine nt={{ state }} newOnly={false} onToggleNewOnly={() => {}} />)
  expect(container).toBeEmptyDOMElement()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx vitest run src/pages/screener/focus/__tests__/newToday.test.jsx`
Expected: FAIL, `Failed to resolve import "../NewTodayLine"`.

- [ ] **Step 3: Implement**

`app/src/pages/screener/focus/useNewToday.js`:

```js
import useSWR from 'swr'

// The New-today answer for the screen on display. Keyed by its criteria only, so a
// re-sort does not ask again. `enabled` is the payload flag; off asks nothing.
const post = ([, body]) => fetch('/api/screener/membership-diff', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
}).then(r => (r.ok ? r.json() : null))

export default function useNewToday({ filters, logic, rank }, enabled) {
  const body = JSON.stringify({ spec: { filters: filters || [], logic: logic || null, rank: rank || null } })
  const { data } = useSWR(enabled ? ['new-today', body] : null, post, { revalidateOnFocus: false, dedupingInterval: 60000 })
  return data || null
}
```

`app/src/pages/screener/focus/NewTodayLine.jsx`:

```jsx
import { useState } from 'react'
import styles from './FocusScreener.module.css'

const MAX_NAMED = 12

// "3 new · 2 dropped" above the list. "new" toggles New only; "dropped" names who left.
// Only an `ok` answer draws counts; a live screen gets one sentence; everything else is silent.
export default function NewTodayLine({ nt, newOnly, onToggleNewOnly }) {
  const [open, setOpen] = useState(false)
  if (!nt) return null
  if (nt.state === 'live_screen') {
    return <span className={styles.ntNote}>New markers follow the overnight build; this screen is live</span>
  }
  if (nt.state !== 'ok') return null
  const entered = nt.entered || []
  const exited = nt.exited || []
  return (
    <span className={styles.ntLine}>
      <button type="button" className={styles.ntBtn} aria-pressed={newOnly} title={nt.new_since_label}
        onClick={onToggleNewOnly}>{entered.length} new</button>
      <span aria-hidden="true">·</span>
      <button type="button" className={styles.ntBtn} aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {exited.length} dropped
      </button>
      {open && (
        <span className={styles.ntPop} role="list">
          {exited.slice(0, MAX_NAMED).map(t => <span key={t} role="listitem">{t}</span>)}
          {exited.length > MAX_NAMED && <span role="listitem">+{exited.length - MAX_NAMED} more</span>}
        </span>
      )}
    </span>
  )
}
```

`ResultList.jsx`:
- `ResultRow` gains prop `isNew` and renders `{isNew && <span className={styles.newPill}>New</span>}` right after `<span className={styles.ticker}>{r.ticker}</span>`.
- `ResultList` gains prop `newSet = null` and passes `isNew={!!newSet && newSet.has(r.ticker)}` to each row.

`FocusScreener.jsx`, in the list-mode component where `s` and `displayRows` are defined:
- import `useNewToday` and `NewTodayLine`;
- read `const ntOn = useContext(AuthContext)?.screenerNewTodayEnabled === true` (AuthContext is already imported in this area; if not, import it the way `Screener.jsx` does);
- `const nt = useNewToday({ filters: s.filters, logic: s.logic, rank: s.rank }, ntOn)`;
- `const newSet = useMemo(() => (nt?.state === 'ok' ? new Set(nt.entered) : null), [nt])`;
- `const [newOnly, setNewOnly] = useState(false)`, plus an effect resetting it to false when `screenSig` changes;
- define `listRows = newOnly && newSet ? displayRows.filter(r => newSet.has(r.ticker)) : displayRows` and pass `rows={listRows}` instead of `rows={displayRows}`;
- pass `newSet={newSet}`;
- set `headExtra={<><NewTodayLine nt={nt} newOnly={newOnly} onToggleNewOnly={() => setNewOnly(v => !v)} /><FlaggedActions /></>}`.

⚠️ `useFocusSelection` receives the rows. Pass `listRows` there too, so the selection steps through what is shown.

`AuthContext.jsx`:
- add `const [screenerNewTodayEnabled, setScreenerNewTodayEnabled] = useState(false)`;
- add the mapping row `['screener_new_today_enabled', (d) => d.screener_new_today_enabled === true, setScreenerNewTodayEnabled]` beside the focus-layout one (line ~164);
- add `screenerNewTodayEnabled` to the provider value.

`FocusScreener.module.css` (append; tokens only, no new literals):

```css
/* New today (spec 2026-10-16 s1) */
.newPill { margin-left: 6px; padding: 0 6px; border-radius: 999px; font-size: var(--text-xs); font-weight: 700; color: var(--success-ink); border: 1px solid var(--success-ink); line-height: 16px; }
.ntLine { position: relative; display: inline-flex; align-items: center; gap: 6px; margin-right: 10px; font-size: var(--text-sm); }
.ntBtn { background: none; border: 0; padding: 0; color: var(--text-muted); cursor: pointer; font: inherit; }
.ntBtn[aria-pressed="true"] { color: var(--success-ink); font-weight: 700; }
.ntPop { position: absolute; top: 100%; right: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 6px; max-width: 260px; padding: 8px; background: var(--surface-2, var(--surface)); border: 1px solid var(--border); border-radius: 8px; }
.ntNote { margin-right: 10px; font-size: var(--text-sm); color: var(--text-muted); }
```

Check `--text-xs`, `--surface` and `--surface-2` exist in `app/src/styles/tokens.css`. An undefined CSS variable is a silent no-op, and `styles/tokens.reachable.test.js` fails on one. Use tokens that exist.

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/pages/screener/focus/ src/context/`
Expected: all pass, including the 6 new tests and every existing Focus test (412 before this task).

- [ ] **Step 5: Mutation proof**

Each must turn a test red; restore from saved bytes after each.
- (a) render the pill unconditionally;
- (b) drop the `MAX_NAMED` slice;
- (c) render counts for `no_history`.

- [ ] **Step 6: Commit**

```bash
python tools/check_repo_hygiene.py
git add app/src/context/AuthContext.jsx app/src/pages/screener/focus/useNewToday.js app/src/pages/screener/focus/NewTodayLine.jsx app/src/pages/screener/focus/ResultList.jsx app/src/pages/screener/focus/FocusScreener.jsx app/src/pages/screener/focus/FocusScreener.module.css app/src/pages/screener/focus/__tests__/newToday.test.jsx
git commit -F - <<'EOF'
feat(screener): New pill, new/dropped line and New only in the Focus list (dark)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RPRLNiwbFPhajMfZb7MqQT
EOF
```

---

## Rollout (controller, after the three tasks)

1. Open the PR, wait for checks, merge (one master merge at a time; wait for web SUCCESS).
2. Set `SCREENER_NEW_TODAY_ENABLED=admin` on web. Verify a new boot, and read the value in-process.
3. The first marker appears after TWO recorded builds (two 03:00 nightlies, or one nightly plus one admin refresh on a later day).
4. Walk as smoke@ (Playwright) on a starter: the pill, the head line, dropped, and New only. Send screenshots.
5. On the owner's go, set the flag to `1` and update `docs/feature_flags.json` (status armed, value, timestamp) in the same docs push.
