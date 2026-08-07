# Live Breadth Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the intraday breadth row's cells open the same drill-down modal that recorded days do.

**Architecture:** `compute_metrics` already builds each count as a boolean mask over an aligned ticker array; it gains an optional `members` out-dict filled from those same masks, so a list can never disagree with its count. `compute_live` stashes members + the prices/vols it already fetched in the existing 60s module cache — never in the payload — and a sibling endpoint enriches on request. The frontend drops one guard and routes live cells to it.

**Tech Stack:** FastAPI + numpy (backend), React + Vitest + `@testing-library/react` (frontend), pytest (backend tests).

**Spec:** `docs/superpowers/specs/2026-08-07-live-breadth-drill-design.md`

## Global Constraints

- Work only in the worktree `C:\Users\Patrick\uct-worktrees\live-drill` on branch `feat/live-breadth-drill`. Never `git add -A`; always `git commit -- <paths>`.
- Backend tests: `python -m pytest tests/test_breadth_live.py -q` from the repo root. Frontend: `cd app && npm test`.
- **The live payload must not grow.** No `*_list` key, no new large field. Task 5 asserts this.
- **A drill list is emitted from the SAME mask that produced the count.** Never a second pass. Task 1 is the gate.
- `atr_ext_7` is CARRIED, not live — it must never appear in `members`.
- Existing behaviour that must keep passing unchanged: every test in `tests/test_breadth_live.py`, especially `test_reference_matches_collector_source` (the drift gate against the real collector).
- Style: this codebase's comments explain *why*, often at length, and name the concrete incident. Match it. No decorative comments.

---

### Task 1: `members` out-dict on `compute_metrics`

**Files:**
- Modify: `api/services/breadth_live.py` (`compute_metrics`)
- Test: `tests/test_breadth_live.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `compute_metrics(levels, prices, volumes=None, members=None)`. When `members` is a dict, it is filled `{metric_key: [ticker, ...]}` for count metrics. Tasks 3 and 4 consume it. `DRILLABLE` (a frozenset of the metric keys that get a list) is also exported.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_breadth_live.py`:

```python
# ── drill membership ────────────────────────────────────────────────────────
# A list that disagrees with its own cell is the failure mode this guards: the
# count says 47, the modal lists 45, and nothing reports a problem. The only
# way that cannot happen is for both to come off the SAME mask, so this asserts
# the identity rather than re-deriving the members a second way.

def test_every_drillable_metric_reports_members_matching_its_count():
    cdf, vdf = _frame(seed=5, n_tickers=80, n_dates=300, short_names=6, zero_names=3)
    levels, prices, vols = _split(cdf, vdf)
    members = {}
    m = bl.compute_metrics(levels, prices, vols, members=members)

    assert bl.DRILLABLE, "no metric is declared drillable"
    for key in bl.DRILLABLE:
        if m.get(key) is None:
            continue
        assert key in members, f"{key} is drillable but reported no members"
        assert len(members[key]) == m[key], (
            f"{key}: cell says {m[key]}, list has {len(members[key])}"
        )


def test_members_are_real_universe_tickers_with_no_duplicates():
    cdf, vdf = _frame(seed=6, n_tickers=60, n_dates=300)
    levels, prices, vols = _split(cdf, vdf)
    members = {}
    bl.compute_metrics(levels, prices, vols, members=members)
    universe = set(levels["tickers"])
    for key, names in members.items():
        assert len(set(names)) == len(names), f"{key} lists a ticker twice"
        assert set(names) <= universe, f"{key} lists a ticker outside the universe"


# atr_ext_7 needs intraday high/low, so it is in NOT_LIVE and the payload
# carries the PRIOR day's value. Emitting members for it would put today's
# header over yesterday's names.
def test_carried_metrics_never_report_members():
    cdf, vdf = _frame(seed=7)
    levels, prices, vols = _split(cdf, vdf)
    members = {}
    bl.compute_metrics(levels, prices, vols, members=members)
    for key in bl.NOT_LIVE:
        assert key not in members, f"{key} is NOT_LIVE but reported members"
    assert "atr_ext_7" not in bl.DRILLABLE


def test_members_is_optional_and_costs_nothing_when_omitted():
    cdf, vdf = _frame(seed=8)
    levels, prices, vols = _split(cdf, vdf)
    a = bl.compute_metrics(levels, prices, vols)
    b = bl.compute_metrics(levels, prices, vols, members={})
    assert a == b, "passing members changed the metrics"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_breadth_live.py -q -k drill`
Expected: FAIL — `module 'api.services.breadth_live' has no attribute 'DRILLABLE'`.

- [ ] **Step 3: Write minimal implementation**

In `api/services/breadth_live.py`, above `compute_metrics`:

```python
# Metrics whose cell opens a drill list. Mirrors the `drillKey` set the Monitor
# declares, minus anything in NOT_LIVE: a carried number's names belong to the
# session it came from, not to today.
DRILLABLE = frozenset({
    "universe_count",
    "up_4pct_today", "down_4pct_today",
    "up_20pct_5d", "down_20pct_5d",
    "up_25pct_quarter", "down_25pct_quarter",
    "up_25pct_month", "down_25pct_month",
    "up_50pct_month", "down_50pct_month",
    "magna_up", "magna_down",
    "stage2_count", "stage4_count",
    "new_52w_highs", "new_52w_lows",
    "new_20d_highs", "new_20d_lows",
    "new_ath", "hvc_52w",
})
```

Change the signature and add one helper inside `compute_metrics`:

```python
def compute_metrics(levels: dict, prices: dict[str, float],
                    volumes: Optional[dict[str, float]] = None,
                    members: Optional[dict] = None) -> dict:
```

Immediately after `tickers = levels["tickers"]`:

```python
    # A drill list MUST come off the same mask as its count. Deriving it a
    # second way lets the two drift the moment a definition moves, and the
    # drift is silent: the cell says 47 and the modal lists 45.
    _tk = np.asarray(tickers)

    def _keep(key: str, mask) -> None:
        if members is not None and key in DRILLABLE:
            members[key] = _tk[mask].tolist()
```

Then at each drillable count, call `_keep` with the identical mask. For example
`universe_count`:

```python
    m["universe_count"] = int(have.sum())
    _keep("universe_count", have)
```

the period-return pair:

```python
        up_mask = valid & (ret >= thresh)
        dn_mask = valid & (ret <= -thresh)
        m[up_key] = int(up_mask.sum())
        m[dn_key] = int(dn_mask.sum())
        _keep(up_key, up_mask)
        _keep(dn_key, dn_mask)
```

and `_hi` / its low counterpart, which currently return a count — have them
build the mask, call `_keep`, and return `int(mask.sum())`. Apply the same
change to the stage counts, magna pair, and `hvc_52w`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_breadth_live.py -q`
Expected: PASS — the four new tests plus every pre-existing test, including `test_reference_matches_collector_source`.

- [ ] **Step 5: Commit**

```bash
git add api/services/breadth_live.py tests/test_breadth_live.py
git commit -m "breadth live: emit drill membership from the same mask as the count" -- api/services/breadth_live.py tests/test_breadth_live.py
```

---

### Task 2: `vol_avg20` in `build_levels`

**Files:**
- Modify: `api/services/breadth_live.py` (`build_levels`)
- Test: `tests/test_breadth_live.py`

**Interfaces:**
- Consumes: the `volumes` array `build_levels` already receives.
- Produces: `levels["vol_avg20"]` — float64 array, NaN where fewer than 20 sessions. Task 4 uses it for the drill list's volume-ratio column.

- [ ] **Step 1: Write the failing test**

```python
# The drill modal's volume column is today's volume over the prior 20 sessions'
# average — the collector's `volumes.iloc[-21:-1].mean()`. Levels are built from
# COMPLETED sessions only, so its last 20 columns ARE that window; getting the
# slice wrong by one shifts every ratio on screen.
def test_vol_avg20_is_the_prior_twenty_completed_sessions():
    cdf, vdf = _frame(seed=11, n_tickers=12, n_dates=120)
    levels, _, _ = _split(cdf, vdf)
    prior_v = vdf.iloc[:-1]                      # what _split fed build_levels
    expected = prior_v.iloc[-20:].mean().to_numpy(dtype=float)
    got = levels["vol_avg20"]
    assert got.shape == (len(levels["tickers"]),)
    np.testing.assert_allclose(got, expected, rtol=1e-9)


def test_vol_avg20_is_nan_when_there_is_not_a_full_window():
    cdf, vdf = _frame(seed=12, n_tickers=5, n_dates=8)
    levels, _, _ = _split(cdf, vdf)
    assert np.isnan(levels["vol_avg20"]).all()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_breadth_live.py -q -k vol_avg20`
Expected: FAIL with `KeyError: 'vol_avg20'`.

- [ ] **Step 3: Write minimal implementation**

In `build_levels`, beside `lv["vol_max52"]`:

```python
    # Today's volume over the prior 20 sessions' average — the collector's
    # `volumes.iloc[-21:-1].mean()`. This frame holds COMPLETED sessions only,
    # so its last 20 columns are exactly that window; there is no today column
    # here to exclude.
    if n_dates >= 20:
        win = volumes[:, -20:]
        lv["vol_avg20"] = np.nanmean(win, axis=1)
    else:
        lv["vol_avg20"] = np.full(len(tickers), np.nan)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_breadth_live.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/breadth_live.py tests/test_breadth_live.py
git commit -m "breadth live: carry a 20-session average volume for the drill list" -- api/services/breadth_live.py tests/test_breadth_live.py
```

---

### Task 3: Cache members + inputs beside the payload

**Files:**
- Modify: `api/services/breadth_live.py` (`compute_live`, module cache)
- Test: `tests/test_breadth_live.py`

**Interfaces:**
- Consumes: `DRILLABLE`, `members` (Task 1), `levels["vol_avg20"]` (Task 2).
- Produces: `live_drill(metric_key) -> dict` returning `{"ok": bool, "items": [...], "reason": str|None, "as_of": str|None}`. Task 4 exposes it over HTTP.

- [ ] **Step 1: Write the failing test**

```python
def test_live_drill_enriches_from_the_cached_read(monkeypatch):
    cdf, vdf = _frame(seed=21, n_tickers=40, n_dates=300)
    levels, prices, vols = _split(cdf, vdf)
    members = {}
    m = bl.compute_metrics(levels, prices, vols, members=members)

    bl._live_cache.clear()
    bl._live_cache.update({
        "payload": {"ok": True, "as_of": "2026-08-07T11:00:00-04:00"},
        "at": 1e12, "members": members, "prices": prices, "vols": vols,
        "levels": levels,
    })
    monkeypatch.setattr(bl, "_name_of", lambda t: None)

    out = bl.live_drill("up_4pct_today")
    assert out["ok"] is True
    assert len(out["items"]) == m["up_4pct_today"]
    it = out["items"][0]
    assert set(it) <= {"t", "pct", "c", "vr", "n"}
    assert "atr" not in it and "a50" not in it     # cannot be computed intraday
    assert it["c"] == pytest.approx(prices[it["t"]])


def test_live_drill_sorts_by_day_change_like_the_collector():
    cdf, vdf = _frame(seed=22, n_tickers=40, n_dates=300)
    levels, prices, vols = _split(cdf, vdf)
    members = {}
    bl.compute_metrics(levels, prices, vols, members=members)
    bl._live_cache.clear()
    bl._live_cache.update({"payload": {"ok": True, "as_of": "x"}, "at": 1e12,
                           "members": members, "prices": prices, "vols": vols,
                           "levels": levels})
    pcts = [i["pct"] for i in bl.live_drill("up_4pct_today")["items"]]
    assert pcts == sorted(pcts, reverse=True)


# A dead click must not surface an error page.
def test_live_drill_on_a_cold_cache_returns_empty_with_a_reason():
    bl._live_cache.clear()
    out = bl.live_drill("up_4pct_today")
    assert out["ok"] is False and out["items"] == [] and out["reason"]


def test_live_drill_refuses_a_metric_that_is_not_live_measured():
    bl._live_cache.clear()
    bl._live_cache.update({"payload": {"ok": True, "as_of": "x"}, "at": 1e12,
                           "members": {}, "prices": {}, "vols": {}, "levels": {}})
    out = bl.live_drill("atr_ext_7")
    assert out["ok"] is False and out["items"] == []
    assert "carried" in (out["reason"] or "").lower()


def test_a_zero_average_volume_yields_no_ratio_rather_than_infinity():
    cdf, vdf = _frame(seed=23, n_tickers=10, n_dates=300)
    levels, prices, vols = _split(cdf, vdf)
    levels["vol_avg20"] = np.zeros(len(levels["tickers"]))
    members = {"universe_count": list(levels["tickers"])}
    bl._live_cache.clear()
    bl._live_cache.update({"payload": {"ok": True, "as_of": "x"}, "at": 1e12,
                           "members": members, "prices": prices, "vols": vols,
                           "levels": levels})
    for it in bl.live_drill("universe_count")["items"]:
        assert it.get("vr") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_breadth_live.py -q -k live_drill`
Expected: FAIL — `has no attribute 'live_drill'`.

- [ ] **Step 3: Write minimal implementation**

In `compute_live`, pass `members` into `compute_metrics` and stash the inputs with the payload:

```python
    members: dict = {}
    metrics = compute_metrics(levels, prices, vols, members=members)
```

```python
    with _live_lock:
        _live_cache["payload"] = payload
        _live_cache["at"] = now
        # Beside the payload, never IN it: this endpoint is polled every 60s by
        # every user on the Dashboard against a single-process pod, and the
        # lists are only wanted on a click.
        _live_cache["members"] = members
        _live_cache["prices"] = prices
        _live_cache["vols"] = vols
        _live_cache["levels"] = levels
```

Then add, below `compute_live`:

```python
def _name_of(ticker: str) -> Optional[str]:
    """Company name, or None. The modal renders `item.n ?? ''`, so an unknown
    name is a blank cell rather than a missing row."""
    try:
        from api.routers.ticker_search import _name_from_cache
        return _name_from_cache(ticker)
    except Exception:
        return None


def live_drill(metric_key: str) -> dict:
    """The names behind one live cell, in the recorded drill's item shape.

    `atr`/`a50` are absent by construction — they need intraday high/low the
    market snapshot does not carry, which is why `atr_ext_7` is in NOT_LIVE.
    The modal already renders a missing one as an em dash.
    """
    with _live_lock:
        cached = dict(_live_cache)
    payload = cached.get("payload")
    members = cached.get("members")
    if not payload or members is None:
        return {"ok": False, "items": [], "reason": "no live read cached", "as_of": None}
    if metric_key not in DRILLABLE:
        return {"ok": False, "items": [],
                "reason": f"{metric_key} is carried from a prior session, not measured live",
                "as_of": payload.get("as_of")}

    names = members.get(metric_key) or []
    levels = cached.get("levels") or {}
    prices = cached.get("prices") or {}
    vols = cached.get("vols") or {}
    idx = {t: i for i, t in enumerate(levels.get("tickers") or [])}
    prev = levels.get("prev_close")
    avg20 = levels.get("vol_avg20")

    items = []
    for t in names:
        c = prices.get(t)
        if c is None:
            continue
        item = {"t": t, "c": round(float(c), 2)}
        i = idx.get(t)
        if i is not None and prev is not None:
            p = float(prev[i])
            if p and not np.isnan(p):
                item["pct"] = round((float(c) - p) / p * 100, 1)
        v = vols.get(t)
        if i is not None and avg20 is not None and v:
            a = float(avg20[i])
            item["vr"] = round(float(v) / a, 1) if a and not np.isnan(a) else None
        n = _name_of(t)
        if n:
            item["n"] = n
        items.append(item)

    items.sort(key=lambda x: x.get("pct") if x.get("pct") is not None else -1e9, reverse=True)
    return {"ok": True, "items": items, "reason": None, "as_of": payload.get("as_of")}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_breadth_live.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/breadth_live.py tests/test_breadth_live.py
git commit -m "breadth live: serve a drill list from the cached read" -- api/services/breadth_live.py tests/test_breadth_live.py
```

---

### Task 4: The endpoint, and a guard that the payload stays small

**Files:**
- Modify: `api/routers/breadth_monitor.py`
- Test: `tests/test_breadth_live_router.py`

**Interfaces:**
- Consumes: `live_drill` (Task 3).
- Produces: `GET /api/breadth-monitor/live/drill/{metric_key}` → `{items, ok, reason, as_of}`. Task 5 calls it.

- [ ] **Step 1: Write the failing test**

Follow the existing style in `tests/test_breadth_live_router.py`:

```python
def test_live_drill_endpoint_returns_the_recorded_item_envelope(client, monkeypatch):
    monkeypatch.setattr(
        "api.services.breadth_live.live_drill",
        lambda k: {"ok": True, "items": [{"t": "AAA", "pct": 5.1, "c": 10.0}],
                   "reason": None, "as_of": "2026-08-07T11:00:00-04:00"},
    )
    r = client.get("/api/breadth-monitor/live/drill/up_4pct_today")
    assert r.status_code == 200
    body = r.json()
    assert body["items"][0]["t"] == "AAA"
    assert body["as_of"]


# A dead click must not surface an error page.
def test_live_drill_endpoint_is_200_with_an_empty_list_when_unavailable(client, monkeypatch):
    monkeypatch.setattr(
        "api.services.breadth_live.live_drill",
        lambda k: {"ok": False, "items": [], "reason": "no live read cached", "as_of": None},
    )
    r = client.get("/api/breadth-monitor/live/drill/up_4pct_today")
    assert r.status_code == 200
    assert r.json()["items"] == []


# ⛔ The 60s poll is the Dashboard's busiest request on a single-process pod.
# Inlining the lists would multiply it by the universe. Assert on the KEY SET so
# a future author cannot quietly re-bloat it.
def test_the_live_payload_never_carries_drill_lists(client, monkeypatch):
    monkeypatch.setattr("api.services.breadth_live.enabled", lambda: True)
    r = client.get("/api/breadth-monitor/live")
    body = r.json()
    row = body.get("row") or {}
    assert not [k for k in row if k.endswith("_list")]
    assert not [k for k in body if k.endswith("_list")]
    assert "members" not in body
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_breadth_live_router.py -q -k drill`
Expected: FAIL with 404 — the route does not exist.

- [ ] **Step 3: Write minimal implementation**

In `api/routers/breadth_monitor.py`, beside the dated drill route. **Register it BEFORE `/api/breadth-monitor/{date_str}/drill/{metric_key}`** — otherwise `live` binds as a `date_str` and this route is unreachable:

```python
@router.get("/api/breadth-monitor/live/drill/{metric_key}")
def get_live_drill(metric_key: str):
    """The names behind one cell of the intraday row.

    Declared BEFORE the dated drill route: `{date_str}` would otherwise match
    the literal "live" and shadow this one.
    """
    from api.services import breadth_live as bl
    return bl.live_drill(metric_key)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_breadth_live_router.py tests/test_breadth_live.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/routers/breadth_monitor.py tests/test_breadth_live_router.py
git commit -m "breadth live: expose the drill list, and pin the payload's key set" -- api/routers/breadth_monitor.py tests/test_breadth_live_router.py
```

---

### Task 5: Make the live cells clickable

**Files:**
- Modify: `app/src/pages/Breadth.jsx`
- Test: `app/src/pages/Breadth.test.jsx` (or the existing Breadth test file)

**Interfaces:**
- Consumes: the endpoint from Task 4, and `carried_from` / `not_live` from the live payload.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

```jsx
// The guard being removed is `!row._live` on line 1273. These pin what replaces
// it: live cells drill live, carried cells drill the day they came from, and a
// non-drillable cell stays inert.
describe('live row drill-down', () => {
  it('opens the LIVE endpoint for a metric measured live', async () => {
    renderBreadthWithLiveRow()
    fireEvent.click(await screen.findByTestId('cell-live-up_4pct_today'))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/breadth-monitor/live/drill/up_4pct_today_list'),
    ))
  })

  // atr_ext_7's live value IS the prior session's. Pointing today's header at
  // it would caption yesterday's names as today's.
  it('routes a carried metric to the date it was carried from', async () => {
    renderBreadthWithLiveRow({ carried_from: '2026-08-06' })
    fireEvent.click(await screen.findByTestId('cell-live-atr_ext_7'))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/breadth-monitor/2026-08-06/drill/atr_ext_7_list'),
    ))
  })

  it('marks a live list as provisional rather than dating it', async () => {
    renderBreadthWithLiveRow()
    fireEvent.click(await screen.findByTestId('cell-live-up_4pct_today'))
    expect(await screen.findByText(/LIVE|provisional/i)).toBeTruthy()
  })

  it('leaves a cell with no drillKey inert on the live row', async () => {
    renderBreadthWithLiveRow()
    expect(screen.queryByTestId('cell-live-breadth_score')).not.toHaveAttribute('role', 'button')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- src/pages/Breadth.test.jsx`
Expected: FAIL — live cells are not clickable.

- [ ] **Step 3: Write minimal implementation**

Replace the guard at `Breadth.jsx:1273`:

```js
                      // A live cell drills what was MEASURED live. A carried
                      // metric's number came from a past session, so its names
                      // do too — route it there rather than leaving it inert.
                      const carriedFrom = row._live ? liveBreadth.meta?.carried_from : null
                      const isCarried = row._live && !!liveBreadth.meta?.carried?.[col.key]
                      const isDrillable = !!col.drillKey && (!row._live || !isCarried || !!carriedFrom)
```

Extend `openDrill` to take the row:

```js
  const openDrill = useCallback((date, col, opts = {}) => {
    const { live = false, carriedFrom = null } = opts
    // A carried metric is not a live reading — drill the session it came from.
    const url = carriedFrom
      ? `/api/breadth-monitor/${carriedFrom}/drill/${col.drillKey}`
      : live
        ? `/api/breadth-monitor/live/drill/${col.drillKey}`
        : `/api/breadth-monitor/${date}/drill/${col.drillKey}`
    setDrill({ date: carriedFrom || date, label: col.label, live: live && !carriedFrom, items: null })
    fetch(url)
      .then(r => r.json())
      .then(data => setDrill(prev => prev ? { ...prev, items: data.items ?? [] } : null))
      .catch(() => setDrill(prev => prev ? { ...prev, items: [] } : null))
  }, [])
```

At the call site pass the flags, and in `DrillModal` render the live clock in place of the date when `drill.live` is set, using `formatLiveClock` from `useLiveBreadth` so the modal and the row can't drift.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npm test -- src/pages/Breadth.test.jsx`
Then the whole suite: `cd app && npm test`
Then `cd app && npm run lint` — expect no NEW findings (`Breadth.jsx` carries 16 pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/Breadth.jsx app/src/pages/Breadth.test.jsx
git commit -m "Breadth: the live row's cells drill like a recorded day" -- app/src/pages/Breadth.jsx app/src/pages/Breadth.test.jsx
```

---

### Task 6: Live-surface verification

**Files:** none committed.

Both defects in the presets work survived thousands of green tests and only showed in a browser. This is not optional.

- [ ] **Step 1: Confirm the window**

The live row exists only while the market is open and before the 4:15 ET collector writes the day — after that the backend marks the read `superseded` and the row disappears by design. Check `GET /api/breadth-monitor/live` returns `ok: true, superseded: false` before starting.

- [ ] **Step 2: Drive it**

Serve real rows from a stub on `:8000` (vite proxies `/api` there) plus a `preview-breadth` entry that skips `AuthGuard`, as in `2026-08-06-breadth-chart-presets-v2.md` Task 11. **Read the actual port from the vite log** — several instances commonly hold 5173-5176.

- [ ] **Step 3: Check the five things tests cannot see**

1. A live cell is clickable and the modal opens with a non-empty list.
2. **The list length equals the number in the cell.** This is the invariant made visible.
3. The ATR and A50 columns read `—`; volume ratio and company name are populated.
4. The header says LIVE with the session clock, not a date.
5. Clicking `atr_ext_7` opens a list headed `2026-08-06`, not today.

- [ ] **Step 4: Delete the scaffold and push**

```bash
rm app/preview-breadth.html app/src/preview-breadth.jsx
git status --short     # must show nothing but intended changes
git push -u origin feat/live-breadth-drill
```

Do **not** push to master. Shipping is a separate, explicitly approved step, and the deploy window is ≥4:20 PM ET or <9:15 AM ET.

---

## Self-Review

**Spec coverage.** Invariant → Task 1. `vol_avg20` → Task 2. Cache-beside-payload + item shape + cold cache → Task 3. Endpoint + payload-size guard → Task 4. Frontend guard, carried routing, provisional header → Task 5. Live-surface pass → Task 6. ATR omission is covered by assertions in Tasks 3 and 6.

**Placeholders.** None: every code step carries its code, every test step its assertions.

**Type consistency.** `DRILLABLE` and `members` (Task 1) are consumed in Task 3. `levels["vol_avg20"]` (Task 2) is read in Task 3's enrichment. `live_drill(metric_key) -> {ok, items, reason, as_of}` (Task 3) is what Task 4 returns verbatim and Task 5 parses as `data.items`. `formatLiveClock` already exists in `useLiveBreadth.js`.

**Known risk, called out rather than designed around.** Task 5's test helper `renderBreadthWithLiveRow` and the `data-testid="cell-live-*"` attributes do not exist yet. Add both in Task 5 Step 3: the testids on the monitor's `<td>` render, keyed `cell-${row._live ? 'live' : row.date}-${col.key}`. If the existing Breadth test file has no live-row harness at all, building one is part of that task, not a separate one.
