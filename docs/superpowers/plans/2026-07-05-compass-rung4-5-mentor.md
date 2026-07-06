# Compass Rung-4/5 Mentor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Compass commit to decisive, tool-sourced verdicts on multi-name and portfolio questions (Rungs 4-5) instead of hedging — via `portfolio_heat` + `grade_watchlist` + a `personal_edge` substrate + a discipline-gated add-verdict composition.

**Architecture:** Thin orchestrators in `api/services/` composing already-shipped services (`grade_ticker`, `voice_position_sizing`, `coach_data_assembler`, `brain_service`), mirroring how `grade_ticker` composed its sub-tools. Two structural tools (`portfolio_heat` no-GO-path state read; `grade_watchlist` verdict grid), one shared substrate (`personal_edge`), and the add-verdict as a persona composition with mechanical discipline gates in `validate_trade`. All behind `BRAIN_TOOLS_ENABLED`; registered in both voice + chat like `grade_ticker`.

**Tech Stack:** Python 3 / FastAPI / pytest. No new deps.

## Global Constraints (verbatim from spec)
- **Ships DARK** behind `BRAIN_TOOLS_ENABLED` (tools) + `COMPASS_MENTOR_MODE` (§11 routing). No subscriber sees enforced behavior until the report card clears and the flag moves past `admin`.
- **Tools never raise** — fail-soft to `{ok: False, reason}` or a decisive SKIP.
- **Two firm caps:** per-trade account risk **≤ 2%**; aggregate open-heat **≤ 10%** = `Σ(entry−stop)·shares / capital` (Desjardins). Read the cap from the brain at runtime; fail-soft default **10%** with a note. **NEVER hardcode a different number or derive as `N× per-trade`.**
- **Placeholder-stop rule (SAFETY):** `stop_price == entry_price` (or null) → excluded from the confident heat number, counted + surfaced; any placeholder present → the add-path may NOT return GO.
- **`portfolio_heat` has NO GO-path** (state read only). The GO/HOLD/SKIP add-verdict is a persona composition (Task 9) whose refuse-gates are mechanical in `validate_trade`.
- **`grade_watchlist` regime-first + fail-soft:** failed names returned inline (`failed:true`), never dropped/fabricated; if `get_regime` fails, no GO possible.
- **Edge = expectancy/R-multiple (`avg_r`/`total_r`), NOT raw win-count.** SOFT filter: never hard-mute below n≥~25 AND negative expectancy; below meaningful sample → fall back to firm `setup_winrate` with a note; always name a muted setup with its stat + reason; always honor "show me anyway"; edge is a tertiary sort that never demotes a genuine A-setup.
- **Report card is a floor:** harden it alongside the tools (Task 11) so a shallow grid can't raise the score.
- Backend tests: `python -m pytest <path> -q` from repo root. `grep -c broker_sync api/main.py` ≥ 7 stays true (this plan doesn't touch main.py's broker block).

**Confirmed reuse points (from recon + de-risk spikes):**
- `voice_position_sizing.get_risk_dashboard(user_id, account_id)` → `{account_size, max_risk_per_trade_pct, total_risk_dollars, portfolio_heat_pct, open_position_count, by_symbol:[{symbol,risk_dollars,risk_pct}], by_sector:[...], recent_refusals}`. **Its `portfolio_heat_cap_pct = max_risk_pct*3.0` is WRONG per spec — ignore it; use the brain's 10%.** Its `_current_portfolio_risk` computes `risk = shares×|entry−stop|` (a placeholder `stop==entry` silently contributes 0).
- `voice_position_sizing._get_account_settings(user_id, account_id)`, `._current_portfolio_risk(user_id, account_id)`, `.validate_trade(...)`.
- `api.services.journal_two.positions.list_open_positions(user_id, account_id=None)` → position dicts with `symbol, side, entry_price, stop_price, shares`.
- `coach_data_assembler._setup_performance(trades)` → `[{setup, trade_count, win_rate, avg_r, total_r}]`; `_exec_get_aggregates(dimension="setup")` in `coach_chat_tools.py`.
- `brain_service.setup_winrate(setup, regime)` (firm-level); the engine's `uct.resolve_setup_name(name)` (alias→canonical), reachable as `brain_service` already calls `uct.resolve_setup_name`.
- `grade_ticker.grade_ticker(symbol, account_size=None, *, ...injectable fns)` → typed verdict (Task consumes as-is).
- `voice_regime_classifier.get_current_regime()` → `{regime, confidence, narration, ...}`; exposure rating 0-150 → band.
- Tool registration: chat `_BRAIN_TOOLS` in `coach_chat_tools.py` (gated `BRAIN_TOOLS_ENABLED`); voice `voice_tool()` in `voice_tool_impls._register_all` + `voice_agents` union/core.
- `MENTOR_TWO_LANE` in `coach_prompts.py` (has `§11 Verdict protocol` from grade_ticker).

---

### Task 0: De-risk spike (b) regression lock — journal setup → template-key normalizer

**Files:**
- Create: `api/services/personal_edge.py` (just the normalizer for now)
- Test: `api/services/test_personal_edge.py`

**Interfaces:**
- Produces: `normalize_setup(name: str) -> str | None` — journal setup tag → canonical template key via the engine's `resolve_setup_name`; returns None for unjoinable tags (so the caller SKIPS annotation rather than mis-attributes).

- [ ] **Step 1: Write the failing test**

```python
# api/services/test_personal_edge.py
from api.services import personal_edge as pe


def test_normalize_setup_resolves_via_engine(monkeypatch):
    # engine alias resolver maps a journal display name to a canonical key
    monkeypatch.setattr(pe, "_resolve", lambda n: "HTF" if "high tight" in n.lower() else None)
    assert pe.normalize_setup("High Tight Flag (Powerplay)") == "HTF"


def test_normalize_setup_none_for_unjoinable(monkeypatch):
    monkeypatch.setattr(pe, "_resolve", lambda n: None)
    assert pe.normalize_setup("random freetext tag") is None


def test_normalize_setup_never_raises(monkeypatch):
    def boom(n): raise RuntimeError("x")
    monkeypatch.setattr(pe, "_resolve", boom)
    assert pe.normalize_setup("anything") is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest api/services/test_personal_edge.py -q`
Expected: FAIL — `ModuleNotFoundError: api.services.personal_edge`.

- [ ] **Step 3: Implement**

```python
# api/services/personal_edge.py
"""Compass personal-edge substrate — the trader's OWN per-setup expectancy.

Distinct from the firm-level brain_service.setup_winrate: this is what THIS
user is good/bad at, from their journal (coach_data_assembler setup_performance),
normalized onto the canonical setup taxonomy so "you're 4-11 on bull flags"
joins to the right playbook template. SOFT by design (see edge_for_setups)."""
from __future__ import annotations

import logging

_log = logging.getLogger("personal_edge")


def _resolve(name: str) -> str | None:
    """Engine alias resolver (journal display name -> canonical key)."""
    try:
        from api.services import brain_service
        uct = brain_service._engine()  # returns the installed engine or None
        if uct is None:
            return None
        return uct.resolve_setup_name(name)
    except Exception:  # noqa: BLE001
        return None


def normalize_setup(name: str) -> str | None:
    if not name:
        return None
    try:
        return _resolve(name)
    except Exception:  # noqa: BLE001
        return None
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest api/services/test_personal_edge.py -q`
Expected: 3 passed.

- [ ] **Step 5: Verify `brain_service._engine` exists** (the normalizer depends on it)

Run: `python -c "from api.services import brain_service; print(hasattr(brain_service, '_engine'))"`
Expected: `True`. (If False, adjust `_resolve` to `brain_service`'s actual engine accessor — grep `def _engine` / `uct.resolve_setup_name` in brain_service.py and match it.)

- [ ] **Step 6: Commit**

```bash
git add api/services/personal_edge.py api/services/test_personal_edge.py
git commit -m "feat(compass): personal_edge setup-name normalizer (spike-b lock)"
```

---

### Task 1: `portfolio_heat` — core (heat, placeholder detection, per-position, caps)

**Files:**
- Create: `api/services/portfolio_heat.py`
- Test: `api/services/test_portfolio_heat.py`

**Interfaces:**
- Produces: `portfolio_heat(user_id, account_id=None, account_size=None, *, positions_fn=None, regime_fn=None, cap_fn=None) -> dict` →
  `{ok, risk_heat_pct, notional_exposure_pct, per_position:[{symbol, side, dist_to_stop_pct, r_multiple, risk_pct, placeholder_stop}], by_symbol, by_sector, placeholder_stops:[sym], caps:{per_trade_pct, aggregate_pct, regime_ceiling_pct}, room_to_add_pct, regime, sources}`. Injectable `*_fn` for tests; defaults wire to the real services.
- `_aggregate_cap_pct(cap_fn=None) -> float` — reads the aggregate heat cap from the brain; fail-soft **10.0**.

- [ ] **Step 1: Write the failing tests**

```python
# api/services/test_portfolio_heat.py
from api.services import portfolio_heat as ph


def _pos(sym, entry, stop, shares, side="long"):
    return {"symbol": sym, "entry_price": entry, "stop_price": stop, "shares": shares, "side": side}


def _fns(positions, last_prices=None, regime="bull_trend", exposure=120, cap=10.0):
    return dict(
        positions_fn=lambda uid, aid: positions,
        regime_fn=lambda: {"regime": regime, "exposure_rating": exposure, "narration": "n"},
        cap_fn=lambda: cap,
        account_size=100000.0,
    )


def test_risk_heat_and_room():
    # two clean positions: DECK risk 500 (100sh*(105-100)), NVDA risk 300 => 800/100k = 0.8%
    out = ph.portfolio_heat("u", **_fns([_pos("DECK", 105, 100, 100), _pos("NVDA", 130, 127, 100)]))
    assert out["ok"] is True
    assert out["risk_heat_pct"] == 0.8
    assert out["caps"]["aggregate_pct"] == 10.0
    assert out["room_to_add_pct"] == 9.2  # 10 - 0.8


def test_placeholder_stop_excluded_and_surfaced():
    # broker placeholder: stop == entry -> risk 0, MUST be excluded + surfaced
    out = ph.portfolio_heat("u", **_fns([_pos("DECK", 105, 100, 100), _pos("BRKR", 50, 50, 200)]))
    assert "BRKR" in out["placeholder_stops"]
    # heat number counts only the real-stop position (500/100k = 0.5%)
    assert out["risk_heat_pct"] == 0.5
    br = next(p for p in out["per_position"] if p["symbol"] == "BRKR")
    assert br["placeholder_stop"] is True


def test_per_position_at_risk_fields():
    out = ph.portfolio_heat("u", **_fns([_pos("DECK", 105, 100, 100)]))
    p = out["per_position"][0]
    assert p["risk_pct"] == 0.5
    assert round(p["dist_to_stop_pct"], 1) == 4.8  # (105-100)/105


def test_cap_failsoft_default_10():
    out = ph.portfolio_heat("u", **_fns([_pos("DECK", 105, 100, 100)], cap=None))
    assert out["caps"]["aggregate_pct"] == 10.0  # brain read failed -> default 10


def test_never_raises():
    def boom(*a, **k): raise RuntimeError("x")
    out = ph.portfolio_heat("u", positions_fn=boom, regime_fn=boom, cap_fn=boom, account_size=100000.0)
    assert out["ok"] in (True, False)  # dict, no raise
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest api/services/test_portfolio_heat.py -q`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```python
# api/services/portfolio_heat.py
"""Compass portfolio_heat — structural portfolio-state read (NO GO-path).

Answers "what's my heat / am I too exposed / most at risk" with two metrics
that are NEVER blended: risk-heat (Sigma(entry-stop)*shares / capital vs the
10% Desjardins aggregate cap) and notional exposure (Sigma position% vs the
regime ceiling). SAFETY: broker placeholder stops (stop==entry) are excluded
from the confident heat number and surfaced, because counting them as 0-risk
under-reports heat and would green-light an over-cap add. Never raises."""
from __future__ import annotations

import logging

_log = logging.getLogger("portfolio_heat")

_DEFAULT_ACCOUNT = 50000.0
_PER_TRADE_CAP_PCT = 2.0
_DEFAULT_AGG_CAP_PCT = 10.0

# UCT exposure rating (0-150) -> notional ceiling %. Mirrors the regime bands.
def _regime_ceiling_pct(exposure_rating) -> float:
    try:
        e = float(exposure_rating)
    except (TypeError, ValueError):
        return 60.0
    if e >= 100:
        return 100.0
    if e >= 70:
        return 80.0
    if e >= 40:
        return 60.0
    if e >= 15:
        return 40.0
    return 20.0


def _aggregate_cap_pct(cap_fn=None) -> float:
    if cap_fn is not None:
        try:
            v = cap_fn()
            return float(v) if v is not None else _DEFAULT_AGG_CAP_PCT
        except Exception:  # noqa: BLE001
            return _DEFAULT_AGG_CAP_PCT
    try:
        from api.services import brain_service
        v = brain_service.aggregate_heat_cap_pct()  # Task 1b adds this; fail-soft below
        return float(v) if v else _DEFAULT_AGG_CAP_PCT
    except Exception:  # noqa: BLE001
        return _DEFAULT_AGG_CAP_PCT


def _default_positions_fn(user_id, account_id):
    from api.services.journal_two import positions as j2
    return j2.list_open_positions(user_id, account_id=account_id) or []


def _default_regime_fn():
    from api.services.voice_regime_classifier import get_current_regime
    r = get_current_regime() or {}
    return {"regime": r.get("regime"), "exposure_rating": r.get("uct_exposure_rating") or
            (r.get("signals") or {}).get("uct_exposure_rating"), "narration": r.get("narration")}


def portfolio_heat(user_id, account_id=None, account_size=None, *,
                   positions_fn=None, regime_fn=None, cap_fn=None) -> dict:
    positions_fn = positions_fn or _default_positions_fn
    regime_fn = regime_fn or _default_regime_fn
    try:
        account = float(account_size) if account_size else None
    except (TypeError, ValueError):
        account = None
    try:
        positions = positions_fn(user_id, account_id) or []
    except Exception:  # noqa: BLE001
        return {"ok": False, "reason": "could not read open positions"}
    if account is None:
        # default from account settings, then fallback
        try:
            from api.services.voice_position_sizing import _get_account_settings
            account = float((_get_account_settings(user_id, account_id) or {}).get("account_size") or 0) or None
        except Exception:  # noqa: BLE001
            account = None
    account = account or _DEFAULT_ACCOUNT

    try:
        regime = regime_fn() or {}
    except Exception:  # noqa: BLE001
        regime = {}
    ceiling = _regime_ceiling_pct(regime.get("exposure_rating"))
    agg_cap = _aggregate_cap_pct(cap_fn)

    per_position, by_symbol, by_sector = [], {}, {}
    placeholder_stops, real_risk, notional = [], 0.0, 0.0
    for p in positions:
        sym = (p.get("symbol") or "").upper()
        if not sym:
            continue
        try:
            entry = float(p.get("entry_price"))
            stop = float(p.get("stop_price"))
            shares = float(p.get("shares"))
        except (TypeError, ValueError):
            continue
        is_placeholder = (stop == entry) or stop <= 0
        risk = shares * abs(entry - stop)
        notional += shares * entry
        rec = {"symbol": sym, "side": p.get("side") or "long",
               "dist_to_stop_pct": round(abs(entry - stop) / entry * 100, 2) if entry else None,
               "r_multiple": None,
               "risk_pct": round(risk / account * 100, 2) if account else None,
               "placeholder_stop": is_placeholder}
        per_position.append(rec)
        if is_placeholder:
            placeholder_stops.append(sym)
            rec["risk_pct"] = None  # not a confident number
            continue
        real_risk += risk
        by_symbol[sym] = by_symbol.get(sym, 0.0) + risk

    risk_heat_pct = round(real_risk / account * 100, 2) if account else 0.0
    notional_pct = round(notional / account * 100, 2) if account else 0.0
    room = round(max(0.0, agg_cap - risk_heat_pct), 2)

    return {
        "ok": True,
        "risk_heat_pct": risk_heat_pct,
        "notional_exposure_pct": notional_pct,
        "per_position": per_position,
        "by_symbol": [{"symbol": s, "risk_pct": round(r / account * 100, 2)}
                      for s, r in sorted(by_symbol.items(), key=lambda kv: kv[1], reverse=True)],
        "by_sector": [],  # filled in Task 2
        "placeholder_stops": placeholder_stops,
        "caps": {"per_trade_pct": _PER_TRADE_CAP_PCT, "aggregate_pct": round(agg_cap, 2),
                 "regime_ceiling_pct": ceiling},
        "room_to_add_pct": room,
        "regime": regime.get("regime"),
        "sources": [f"open positions ({len(positions)})", "risk-heat vs 10% Desjardins cap",
                    f"regime {regime.get('regime')}"],
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest api/services/test_portfolio_heat.py -q`
Expected: 5 passed. (`_aggregate_cap_pct` swallows the missing `brain_service.aggregate_heat_cap_pct` and returns 10.0 — Task 1b adds the real reader.)

- [ ] **Step 5: Commit**

```bash
git add api/services/portfolio_heat.py api/services/test_portfolio_heat.py
git commit -m "feat(compass): portfolio_heat core — risk-heat + placeholder-stop safety + per-position at-risk"
```

---

### Task 1b: brain-sourced aggregate heat cap + by_sector concentration

**Files:**
- Modify: `api/services/brain_service.py` (add `aggregate_heat_cap_pct()`)
- Modify: `api/services/portfolio_heat.py` (fill `by_sector` + 40% concentration flag)
- Test: `api/services/test_portfolio_heat.py` (add sector-concentration test), `api/services/test_brain_service.py` (cap reader)

**Interfaces:**
- Produces: `brain_service.aggregate_heat_cap_pct() -> float` — reads the firm's total open-heat cap from the installed brain (uct_identity / File 3 §1); fail-soft **10.0**. Never raises.
- Extends `portfolio_heat` return: `by_sector:[{sector, risk_pct}]` + `concentration_flags:[{sector, risk_pct}]` for any sector > 40% of total risk.

- [ ] **Step 1: Write the failing tests**

```python
# add to api/services/test_portfolio_heat.py
def test_by_sector_concentration_flag(monkeypatch):
    from api.services import portfolio_heat as ph
    # force both names into one sector so it exceeds 40% of total risk
    monkeypatch.setattr(ph, "_sectors_for", lambda sym: {"Semiconductors"})
    out = ph.portfolio_heat("u", positions_fn=lambda uid, aid: [
        {"symbol": "NVDA", "entry_price": 130, "stop_price": 127, "shares": 100, "side": "long"},
        {"symbol": "AMD", "entry_price": 100, "stop_price": 97, "shares": 100, "side": "long"}],
        regime_fn=lambda: {"regime": "bull_trend", "exposure_rating": 120}, cap_fn=lambda: 10.0,
        account_size=100000.0)
    assert any(f["sector"] == "Semiconductors" for f in out["concentration_flags"])
```

```python
# api/services/test_brain_service.py — append
def test_aggregate_heat_cap_failsoft():
    from api.services import brain_service
    v = brain_service.aggregate_heat_cap_pct()
    assert isinstance(v, float) and 1.0 <= v <= 50.0  # a sane cap, default 10 when brain absent
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest api/services/test_portfolio_heat.py::test_by_sector_concentration_flag api/services/test_brain_service.py::test_aggregate_heat_cap_failsoft -q`
Expected: FAIL (no `_sectors_for`, no `aggregate_heat_cap_pct`).

- [ ] **Step 3: Implement `aggregate_heat_cap_pct` in brain_service.py** (near the other engine wrappers):

```python
def aggregate_heat_cap_pct() -> float:
    """Firm total open-heat cap (Desjardins File 3 §1). Fail-soft 10.0."""
    uct = _engine()
    if uct is None:
        return 10.0
    try:
        # engine exposes the sizing/heat rules; prefer an explicit accessor,
        # else the documented default. NEVER derive as N× per-trade.
        val = getattr(uct, "aggregate_heat_cap_pct", None)
        if callable(val):
            v = val()
            return float(v) if v else 10.0
    except Exception:  # noqa: BLE001
        pass
    return 10.0
```

- [ ] **Step 4: Add sector fill to portfolio_heat.py** — add a `_sectors_for` helper (reuse `voice_position_sizing._sectors_for_symbol`) and, in the loop, accumulate `by_sector[sector] += risk` for non-placeholder positions; after the loop compute `concentration_flags` for any sector whose risk / real_risk > 0.40:

```python
def _sectors_for(sym: str) -> set:
    try:
        from api.services.voice_position_sizing import _sectors_for_symbol
        return _sectors_for_symbol(sym) or set()
    except Exception:  # noqa: BLE001
        return set()
```

In the non-placeholder branch, after `by_symbol[...] += risk`:

```python
        for sec in _sectors_for(sym):
            by_sector[sec] = by_sector.get(sec, 0.0) + risk
```

Replace the return's `by_sector` + add `concentration_flags`:

```python
        "by_sector": [{"sector": s, "risk_pct": round(r / account * 100, 2)}
                      for s, r in sorted(by_sector.items(), key=lambda kv: kv[1], reverse=True)],
        "concentration_flags": [{"sector": s, "risk_pct": round(r / account * 100, 2)}
                                for s, r in by_sector.items()
                                if real_risk > 0 and r / real_risk > 0.40],
```

- [ ] **Step 5: Run to verify passes**

Run: `python -m pytest api/services/test_portfolio_heat.py api/services/test_brain_service.py -q`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add api/services/portfolio_heat.py api/services/brain_service.py api/services/test_portfolio_heat.py api/services/test_brain_service.py
git commit -m "feat(compass): portfolio_heat brain-sourced 10% cap + by-sector 40% concentration flag"
```

---

### Task 2: `personal_edge.edge_for_setups` — expectancy-based, SOFT, sample-gated

**Files:**
- Modify: `api/services/personal_edge.py`
- Test: `api/services/test_personal_edge.py`

**Interfaces:**
- Produces: `edge_for_setups(user_id, account_id=None, *, setup_perf_fn=None, firm_fn=None) -> dict[str, dict]` keyed by canonical setup → `{n, avg_r, total_r, win_rate, verdict: 'edge'|'weak'|'thin'|'unknown', muted: bool, note}`. SOFT: `muted=True` ONLY when `n >= _MUTE_MIN_N (25)` AND `avg_r < 0`; `thin` when `1 <= n < 25` (never muted, note carries uncertainty); `unknown` (n==0) → firm fallback note. Never raises.
- `_MUTE_MIN_N = 25`.

- [ ] **Step 1: Write the failing tests**

```python
# add to api/services/test_personal_edge.py
def test_edge_soft_mutes_only_on_size_and_negative(monkeypatch):
    monkeypatch.setattr(pe, "normalize_setup", lambda s: s)  # identity for the test
    perf = [
        {"setup": "HTF", "trade_count": 30, "win_rate": 0.7, "avg_r": 0.9, "total_r": 27},   # edge
        {"setup": "Bull Flag", "trade_count": 30, "win_rate": 0.2, "avg_r": -0.4, "total_r": -12},  # muted
        {"setup": "VCP", "trade_count": 8, "win_rate": 0.25, "avg_r": -0.3, "total_r": -2.4},  # thin, NOT muted
    ]
    out = pe.edge_for_setups("u", setup_perf_fn=lambda uid, aid: perf)
    assert out["HTF"]["verdict"] == "edge" and out["HTF"]["muted"] is False
    assert out["Bull Flag"]["muted"] is True and out["Bull Flag"]["verdict"] == "weak"
    assert out["VCP"]["muted"] is False and out["VCP"]["verdict"] == "thin"
    assert "small sample" in out["VCP"]["note"].lower()


def test_edge_never_raises(monkeypatch):
    out = pe.edge_for_setups("u", setup_perf_fn=lambda uid, aid: (_ for _ in ()).throw(RuntimeError()))
    assert out == {}
```

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest api/services/test_personal_edge.py -q`
Expected: FAIL — no `edge_for_setups`.

- [ ] **Step 3: Implement** — append to `personal_edge.py`:

```python
_MUTE_MIN_N = 25


def _default_setup_perf_fn(user_id, account_id):
    from api.services.journal_two import coach_chat_tools as cct
    out = cct._exec_get_aggregates(user_id=user_id, account_id=account_id,
                                   args={"dimension": "setup"})
    return out.get("by_setup") or out.get("setup_performance") or []


def edge_for_setups(user_id, account_id=None, *, setup_perf_fn=None, firm_fn=None) -> dict:
    setup_perf_fn = setup_perf_fn or _default_setup_perf_fn
    try:
        rows = setup_perf_fn(user_id, account_id) or []
    except Exception:  # noqa: BLE001
        return {}
    edge: dict[str, dict] = {}
    for r in rows:
        raw = r.get("setup") or ""
        key = normalize_setup(raw) or raw
        if not key or key == "(no setup)":
            continue
        try:
            n = int(r.get("trade_count") or 0)
            avg_r = r.get("avg_r")
            avg_r = float(avg_r) if avg_r is not None else None
        except (TypeError, ValueError):
            continue
        if n == 0 or avg_r is None:
            verdict, muted, note = "unknown", False, "no personal history — using the firm's win-rate"
        elif n < _MUTE_MIN_N:
            verdict, muted = "thin", False
            note = f"small sample (n={n}, avg {avg_r:+.2f}R) — not conclusive"
        elif avg_r < 0:
            verdict, muted = "weak", True
            note = f"you're net-negative here (n={n}, avg {avg_r:+.2f}R)"
        else:
            verdict, muted = "edge", False
            note = f"you're net-positive here (n={n}, avg {avg_r:+.2f}R)"
        edge[key] = {"n": n, "avg_r": avg_r, "total_r": r.get("total_r"),
                     "win_rate": r.get("win_rate"), "verdict": verdict,
                     "muted": muted, "note": note}
    return edge
```

- [ ] **Step 4: Run to verify passes** — `python -m pytest api/services/test_personal_edge.py -q` → all pass. (Adjust `_default_setup_perf_fn`'s result-key if `_exec_get_aggregates` uses a different key — the test injects, so this only matters for the real path; verify with `python -c "from api.services.journal_two import coach_chat_tools as c; print(c._exec_get_aggregates.__doc__)"` and match.)

- [ ] **Step 5: Commit**

```bash
git add api/services/personal_edge.py api/services/test_personal_edge.py
git commit -m "feat(compass): personal_edge expectancy-based SOFT filter (sample-gated, never silent-mute)"
```

---

### Task 3: `grade_watchlist` — list resolution + funnel + fan-out (no synthesis yet)

**Files:**
- Create: `api/services/grade_watchlist.py`
- Test: `api/services/test_grade_watchlist.py`

**Interfaces:**
- Produces: `grade_watchlist(user_id, account_id=None, symbols=None, source="watchlist", account_size=None, *, resolve_fn=None, grade_fn=None, regime_fn=None, edge_fn=None) -> dict` →
  `{ok, regime, source_described, graded:[{symbol, verdict, grade, entry, stop, size_pct, account_risk_pct, edge_annotation, muted, failed}], ...}` (list_verdict/correlated_blocks/behavioral_note added in Task 4). Injectable fns for tests.
- Consumes: `grade_ticker.grade_ticker` (Task-external), `personal_edge.edge_for_setups` (Task 2), `portfolio_heat`'s regime helper.

- [ ] **Step 1: Write the failing tests**

```python
# api/services/test_grade_watchlist.py
from api.services import grade_watchlist as gw


def _grade(sym):
    setups = {"DECK": ("HTF", "GO", "A"), "AMD": ("Bull Flag", "SKIP", "C"), "BAD": None}
    s = setups.get(sym)
    if s is None:
        return {"ok": False, "reason": "no data"}
    setup, verdict, grade = s
    return {"ok": True, "symbol": sym, "verdict": verdict, "grade": grade, "setup": setup,
            "entry": 100, "stop": 95, "size_pct": 15, "account_risk_pct": 0.7}


def _call(**over):
    kw = dict(symbols=["DECK", "AMD", "BAD"], source="explicit",
              resolve_fn=lambda uid, aid, src, syms: (syms, f"{len(syms)} explicit"),
              grade_fn=lambda sym, account_size=None: _grade(sym),
              regime_fn=lambda: {"regime": "bull_trend", "exposure_rating": 120},
              edge_fn=lambda uid, aid: {"HTF": {"verdict": "edge", "muted": False, "note": "you're 6-2 on HTF"},
                                        "Bull Flag": {"verdict": "weak", "muted": True, "note": "4-11 on these"}})
    kw.update(over)
    return gw.grade_watchlist("u", **kw)


def test_grades_each_name_with_edge_annotation():
    out = _call()
    assert out["ok"] is True
    g = {r["symbol"]: r for r in out["graded"]}
    assert g["DECK"]["verdict"] == "GO" and g["DECK"]["edge_annotation"] == "you're 6-2 on HTF"
    assert g["AMD"]["muted"] is True  # weak-edge setup annotated as muted (SOFT: still shown)


def test_failed_name_returned_inline_never_dropped():
    out = _call()
    bad = next(r for r in out["graded"] if r["symbol"] == "BAD")
    assert bad["failed"] is True and bad["verdict"] in (None, "SKIP")
    assert len(out["graded"]) == 3  # nothing dropped


def test_states_which_set_it_graded():
    out = _call()
    assert "explicit" in out["source_described"]


def test_regime_fail_blocks_go():
    out = _call(regime_fn=lambda: {})
    assert all(r["verdict"] != "GO" for r in out["graded"]) or out["ok"] is False
```

- [ ] **Step 2: Run to verify fail** — `python -m pytest api/services/test_grade_watchlist.py -q` → FAIL (module missing).

- [ ] **Step 3: Implement**

```python
# api/services/grade_watchlist.py
"""Compass grade_watchlist — grade a RESOLVED list of names through the firm's
verdict engine AND the trader's own edge. The Rung-4 moat. A funnel (cheap
filter -> grade_ticker on survivors) with compute-once market context; a failed
name is returned inline, never dropped or fabricated. Regime-first: no regime,
no GO. Never raises. (List-level synthesis = Task 4.)"""
from __future__ import annotations

import logging

_log = logging.getLogger("grade_watchlist")
_MAX_NAMES = 20


def _default_resolve(user_id, account_id, source, symbols):
    from api.services import watchlist_source as wsrc  # Task 8 adds 'scan'; base sources here
    return wsrc.resolve(user_id, account_id, source, symbols)


def _default_grade(symbol, account_size=None):
    from api.services.grade_ticker import grade_ticker
    return grade_ticker(symbol, account_size=account_size)


def _default_regime():
    from api.services.portfolio_heat import _default_regime_fn
    return _default_regime_fn()


def _default_edge(user_id, account_id):
    from api.services.personal_edge import edge_for_setups
    return edge_for_setups(user_id, account_id)


def grade_watchlist(user_id, account_id=None, symbols=None, source="watchlist",
                    account_size=None, *, resolve_fn=None, grade_fn=None,
                    regime_fn=None, edge_fn=None) -> dict:
    resolve_fn = resolve_fn or _default_resolve
    grade_fn = grade_fn or _default_grade
    regime_fn = regime_fn or _default_regime
    edge_fn = edge_fn or _default_edge

    try:
        regime = regime_fn() or {}
    except Exception:  # noqa: BLE001
        regime = {}
    if not regime.get("regime"):
        return {"ok": False, "reason": "regime unavailable — cannot grade a list without the gate"}

    try:
        names, described = resolve_fn(user_id, account_id, source, symbols)
    except Exception:  # noqa: BLE001
        return {"ok": False, "reason": f"could not resolve list for source={source}"}
    names = [n.upper() for n in (names or [])][:_MAX_NAMES]
    if not names:
        return {"ok": True, "regime": regime.get("regime"), "source_described": described or source,
                "graded": [], "note": "no names to grade"}

    try:
        edge = edge_fn(user_id, account_id) or {}
    except Exception:  # noqa: BLE001
        edge = {}

    graded = []
    for sym in names:
        try:
            v = grade_fn(sym, account_size=account_size) or {}
        except Exception as e:  # noqa: BLE001
            v = {"ok": False, "reason": str(e)}
        if not v.get("ok"):
            graded.append({"symbol": sym, "failed": True, "verdict": "SKIP", "grade": None,
                           "entry": None, "stop": None, "size_pct": None,
                           "account_risk_pct": None, "edge_annotation": None, "muted": False,
                           "reason": v.get("reason") or "couldn't grade"})
            continue
        e = edge.get(v.get("setup") or "", {})
        graded.append({"symbol": sym, "failed": False, "verdict": v.get("verdict"),
                       "grade": v.get("grade"), "entry": v.get("entry"), "stop": v.get("stop"),
                       "size_pct": v.get("size_pct"), "account_risk_pct": v.get("account_risk_pct"),
                       "setup": v.get("setup"), "edge_annotation": e.get("note"),
                       "muted": bool(e.get("muted"))})

    return {"ok": True, "regime": regime.get("regime"),
            "source_described": described or source, "graded": graded,
            "sources": ["grade_ticker per name", "personal edge", f"regime {regime.get('regime')}"]}
```

- [ ] **Step 4: Run to verify passes** — `python -m pytest api/services/test_grade_watchlist.py -q` → all pass (tests inject all fns, so the missing `watchlist_source` import in the default path doesn't execute).

- [ ] **Step 5: Commit**

```bash
git add api/services/grade_watchlist.py api/services/test_grade_watchlist.py
git commit -m "feat(compass): grade_watchlist core — edge-annotated per-name grid, fail-soft inline"
```

---

### Task 4: `grade_watchlist` MANDATORY list-level synthesis

**Files:**
- Modify: `api/services/grade_watchlist.py`
- Test: `api/services/test_grade_watchlist.py`

**Interfaces:**
- Extends the return with `list_verdict` ("0-GO / N-GO"), `correlated_blocks` (via `portfolio_heat` sectoring — or an injected `sector_fn`), `behavioral_note` (from edge). The synthesis is what makes it a mentor, not a grid (spec §4.B, §9).

- [ ] **Step 1: Write the failing tests**

```python
# add to api/services/test_grade_watchlist.py
def test_red_tape_forces_all_watch_only():
    out = _call(regime_fn=lambda: {"regime": "bear_trend", "exposure_rating": 10})
    # RED tape: list_verdict is 0-GO regardless of individual setups
    assert out["list_verdict"].startswith("0-GO") or "watch" in out["list_verdict"].lower()
    assert all(r["verdict"] != "GO" for r in out["graded"])


def test_correlated_block_flags_same_sector():
    out = _call(symbols=["NVDA", "AMD"], source="explicit",
                resolve_fn=lambda uid, aid, s, sy: (["NVDA", "AMD"], "2 explicit"),
                grade_fn=lambda sym, account_size=None: {"ok": True, "symbol": sym, "verdict": "GO",
                    "grade": "A", "setup": "HTF", "entry": 100, "stop": 95, "size_pct": 15,
                    "account_risk_pct": 0.7},
                sector_fn=lambda sym: {"Semiconductors"})
    assert any("Semiconductors" in (b.get("sector") or "") for b in out["correlated_blocks"])


def test_behavioral_note_present():
    out = _call()
    assert isinstance(out["behavioral_note"], str)
```

- [ ] **Step 2: Run to verify fail** — the three new tests fail (`list_verdict`/`correlated_blocks`/`behavioral_note` absent; `sector_fn` param unknown).

- [ ] **Step 3: Implement** — add a `sector_fn` param (default `portfolio_heat._sectors_for`), and before the final return compute:

```python
    # RED-tape mute: a hostile regime forces the whole book to watch-only.
    band = (regime.get("regime") or "").lower()
    red = band in ("bear_trend", "distribution") or _regime_ceiling(regime) <= 20
    go = [r for r in graded if r["verdict"] == "GO"]
    if red:
        for r in graded:
            if r["verdict"] == "GO":
                r["verdict"], r["downgraded_by_regime"] = "HOLD", True
        go = []
    list_verdict = (f"{len(go)}-GO" if go else "0-GO — regime says watch-only, sit on your hands"
                    if red else "0-GO — nothing clean enough to buy")

    # correlated blocks: same-sector GO/HOLD names clustered
    blocks = {}
    for r in graded:
        if r.get("failed"):
            continue
        for sec in (sector_fn(r["symbol"]) or set()):
            blocks.setdefault(sec, []).append(r["symbol"])
    correlated_blocks = [{"sector": s, "symbols": syms}
                         for s, syms in blocks.items() if len(syms) >= 2]

    strengths = [k for k, e in (edge or {}).items() if e.get("verdict") == "edge"]
    weak = [k for k, e in (edge or {}).items() if e.get("muted")]
    behavioral_note = ""
    if strengths:
        behavioral_note += f"You're strongest on {', '.join(strengths[:3])}. "
    if weak:
        behavioral_note += f"Be careful with {', '.join(weak[:3])} — your stats there are red."
    behavioral_note = behavioral_note.strip() or "Not enough journal history yet to weight by your edge."
```

Add a small `_regime_ceiling(regime)` helper reusing `portfolio_heat._regime_ceiling_pct(regime.get("exposure_rating"))`. Add to the return dict: `"list_verdict": list_verdict, "correlated_blocks": correlated_blocks, "behavioral_note": behavioral_note`. Default `sector_fn`:

```python
def _default_sector(sym):
    from api.services.portfolio_heat import _sectors_for
    return _sectors_for(sym)
```

- [ ] **Step 4: Run to verify passes** — `python -m pytest api/services/test_grade_watchlist.py -q` → all green.

- [ ] **Step 5: Commit**

```bash
git add api/services/grade_watchlist.py api/services/test_grade_watchlist.py
git commit -m "feat(compass): grade_watchlist list-level synthesis (RED-tape 0-GO, correlation-collapse, behavioral note)"
```

---

### Task 5: `watchlist_source.resolve` — deterministic list resolution (no scan yet)

**Files:**
- Create: `api/services/watchlist_source.py`
- Test: `api/services/test_watchlist_source.py`

**Interfaces:**
- Produces: `resolve(user_id, account_id, source, symbols=None) -> (list[str], str_description)`. Sources: `explicit` (use `symbols`), `watchlist`+`flagged` (via `watchlist_service`), `positions` (via `list_open_positions`). `scan` → Task 8. Unknown/empty → `([], "…")`. Never raises.

- [ ] **Step 1: Write the failing test**

```python
# api/services/test_watchlist_source.py
from api.services import watchlist_source as ws


def test_explicit_passthrough():
    names, desc = ws.resolve("u", None, "explicit", ["deck", "nvda"])
    assert names == ["DECK", "NVDA"] and "explicit" in desc


def test_positions_source(monkeypatch):
    monkeypatch.setattr(ws, "_open_positions", lambda uid, aid: [{"symbol": "AAPL"}, {"symbol": "msft"}])
    names, desc = ws.resolve("u", None, "positions")
    assert set(names) == {"AAPL", "MSFT"} and "position" in desc.lower()


def test_unknown_source_empty():
    names, desc = ws.resolve("u", None, "nonsense")
    assert names == []


def test_never_raises(monkeypatch):
    monkeypatch.setattr(ws, "_watchlist_syms", lambda uid, aid: (_ for _ in ()).throw(RuntimeError()))
    names, desc = ws.resolve("u", None, "watchlist")
    assert names == []
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement** — resolve `explicit`/`positions`/`watchlist`/`flagged` with the real services (`watchlist_service` list + items; `journal_two.positions.list_open_positions`), each in try/except returning `[]` on failure, uppercasing + de-duping symbols, returning a human description ("your 5 flagged + 8 watchlist"). Provide seam functions `_open_positions`, `_watchlist_syms`, `_flagged_syms` so tests can monkeypatch. `scan` raises `NotImplementedError` here (wired in Task 8) — caught by `grade_watchlist`'s resolve try/except until then.

- [ ] **Step 4: Run to verify passes.**

- [ ] **Step 5: Commit** `feat(compass): watchlist_source deterministic list resolution (explicit/watchlist/flagged/positions)`

---

### Task 6: Register `portfolio_heat` + `grade_watchlist` in the CHAT registry

**Files:**
- Modify: `api/services/journal_two/coach_chat_tools.py` (add to `_BRAIN_TOOLS`)
- Test: `api/services/journal_two/test_rung45_chat_tools.py`

**Interfaces:** mirror the `grade_ticker` chat entry — executors `(*, user_id, account_id, args, conn=None) -> dict`, `requires_confirm: False`, gated by `BRAIN_TOOLS_ENABLED`.

- [ ] **Step 1: Write the failing test** (both tools present when flag on; executor delegates + passes `user_id`/`account_id`). *(Mirror `test_grade_ticker_chat_tool.py`.)*

```python
# api/services/journal_two/test_rung45_chat_tools.py
import importlib


def _reload(monkeypatch, on):
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "1" if on else "0")
    import api.services.journal_two.coach_chat_tools as cct
    return importlib.reload(cct)


def test_tools_present_and_delegate(monkeypatch):
    cct = _reload(monkeypatch, True)
    assert "portfolio_heat" in cct.TOOLS and "grade_watchlist" in cct.TOOLS
    from api.services import portfolio_heat as ph, grade_watchlist as gw
    monkeypatch.setattr(ph, "portfolio_heat", lambda user_id, account_id=None, account_size=None: {"ok": True, "risk_heat_pct": 1.0})
    monkeypatch.setattr(gw, "grade_watchlist", lambda user_id, account_id=None, symbols=None, source="watchlist", account_size=None: {"ok": True, "graded": []})
    assert cct.TOOLS["portfolio_heat"]["executor"](user_id="u", account_id="a", args={}, conn=None)["risk_heat_pct"] == 1.0
    assert cct.TOOLS["grade_watchlist"]["executor"](user_id="u", account_id="a", args={"source": "flagged"}, conn=None)["ok"] is True
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "0"); importlib.reload(cct)
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — add executors + `_BRAIN_TOOLS` entries:

```python
def _exec_portfolio_heat(*, user_id, account_id, args, conn=None) -> dict:
    from api.services import portfolio_heat as _ph
    return _ph.portfolio_heat(user_id, account_id=account_id, account_size=args.get("account_size"))


def _exec_grade_watchlist(*, user_id, account_id, args, conn=None) -> dict:
    from api.services import grade_watchlist as _gw
    return _gw.grade_watchlist(user_id, account_id=account_id, symbols=args.get("symbols"),
                               source=str(args.get("source") or "watchlist"),
                               account_size=args.get("account_size"))
```

```python
    "portfolio_heat": {
        "name": "portfolio_heat", "requires_confirm": False, "executor": _exec_portfolio_heat,
        "description": "Read the trader's current portfolio heat: open risk-heat vs the 10% "
                       "aggregate cap, notional exposure vs the regime ceiling, per-position "
                       "at-risk, sector concentration, and any positions with no real stop. "
                       "Use for 'what's my heat / am I too exposed / most at risk'. State-read only.",
        "input_schema": {"type": "object", "properties": {"account_size": {"type": "number"}}},
    },
    "grade_watchlist": {
        "name": "grade_watchlist", "requires_confirm": False, "executor": _exec_grade_watchlist,
        "description": "Grade a LIST of names to a per-name GO/HOLD/SKIP grid, ranked through the "
                       "trader's own per-setup edge, with a list-level verdict (0-GO on a hostile "
                       "regime), sector-correlation flags, and a behavioral note. source = "
                       "watchlist|flagged|positions|scan, or pass explicit symbols. Use for "
                       "'grade my watchlist / rank these / what's in play'.",
        "input_schema": {"type": "object", "properties": {
            "symbols": {"type": "array", "items": {"type": "string"}},
            "source": {"type": "string"}, "account_size": {"type": "number"}}},
    },
```

- [ ] **Step 4: Run → pass** (+ `test_coach_chat_brain_tools.py` stays green).
- [ ] **Step 5: Commit** `feat(compass): portfolio_heat + grade_watchlist chat-registry tools (flag-gated)`

---

### Task 7: Register both in the VOICE registry + compass union/core

**Files:** Modify `api/services/voice_tool_impls.py` (+ `voice_agents.py`); Test `tests/test_rung45_voice_tools.py`. Mirror Task 4 of the grade_ticker plan exactly (impl wrappers `_portfolio_heat`/`_grade_watchlist`, `voice_tool(...)` registrations inside the `BRAIN_TOOLS_ENABLED` block, `out.add(...)` in `_compass_tool_union` + names in `_COMPASS_CORE_TOOLS`). Test: registered when flag on + in union/core.

- [ ] Steps mirror the grade_ticker voice-registration task (RED test → impl → GREEN + `test_voice_brain_tools.py` regression → commit `feat(compass): portfolio_heat + grade_watchlist voice tools + compass core`).

---

### Task 8: `source='scan'` — one bounded deterministic scan (owner-approved IN)

**Files:** Modify `api/services/watchlist_source.py`; Test `api/services/test_watchlist_source.py`.

**Interfaces:** `resolve(..., 'scan')` → ONE `scan_active_patterns` call (via its chat executor / `pattern_engine`) filtered to leading sectors (via `sector_strength`/leading-sectors), capped at N (≤_MAX_NAMES), returns `(symbols, "scan: N fresh setups in leading sectors")`. Deterministic single query — NOT an LLM DAG. Never raises → `([], ...)` on failure.

- [ ] **Step 1: RED test** — `scan` source returns the scanned symbols (inject a fake scan fn); on scan failure returns `[]`.
- [ ] **Step 2-4:** implement with an injectable `_scan_fn` seam (default composes `scan_active_patterns` + leading-sector filter), bounded + try/except; verify.
- [ ] **Step 5: Commit** `feat(compass): grade_watchlist source=scan — one bounded leading-sector pattern scan`

---

### Task 9: Add-verdict discipline gates (mechanical in validate_trade) + §11 router

**Files:**
- Modify: `api/services/voice_position_sizing.py` (`validate_trade` — ensure the six mechanical gates: ≤2% per-trade, ≤10% aggregate, never-average-down (add below entry), never-widen-stop, RED-blocks-new-longs, active-intervention-blocks-entry; several already exist — add the missing ones + return structured `refusal_basis`)
- Modify: `api/services/journal_two/coach_prompts.py` (`MENTOR_TWO_LANE` §11 — extend the verdict protocol to route list/heat/add questions and forbid the priority-order / "what's your account size?" dodge)
- Test: `api/services/test_add_verdict_gates.py`, `api/services/journal_two/test_verdict_protocol_prompt.py` (extend)

- [ ] **Step 1: RED tests** — (a) `validate_trade` refuses an add that pushes aggregate heat >10% even when per-trade ≤2%; refuses add-below-entry (average-down); refuses widen-stop; refuses new long in RED; refuses under active intervention — each with a `refusal_basis`. (b) prompt contains the Rung-4/5 routing ("grade my watchlist"→grade_watchlist, "what's my heat/can I add"→portfolio_heat, add-to-winner needs a fresh trigger) + forbids "what's your account size?".
- [ ] **Step 2: Run → fail** (missing gates / prompt text).
- [ ] **Step 3: Implement** — read `validate_trade` (line 280) first; add only the gates not already present, each a hard mechanical check appending to `refusal_basis` and forcing `ok=False`; use `portfolio_heat` for the aggregate figure and `get_current_regime` for RED. Append the §11 routing addendum to `MENTOR_TWO_LANE` (after the existing verdict-protocol block).
- [ ] **Step 4: Run → pass** (+ `test_coach_chat_mentor_mode.py` regression green).
- [ ] **Step 5: Commit** `feat(compass): add-verdict discipline gates in validate_trade + §11 list/heat/add routing`

---

### Task 10: Golden-set tool-gates — credit the new tools on Rung-4/5

**Files:** Modify `api/services/compass_eval/golden_set.json`; Test `api/services/compass_eval/test_golden_set.py` (stays green).

- [ ] **Step 1:** For each Rung-4/5 question, add `grade_watchlist` to the OR-group that requires a list/scan tool (`scan_active_patterns`/`find_patterns_on_ticker`/multiple-name gates) and `portfolio_heat` to the OR-group requiring positions/heat (`get_open_positions`/`get_aggregates`) — but ONLY where the tool genuinely covers that gate (per spec §5, do NOT credit portfolio_heat for a stress-scenario it doesn't compute). Script it deterministically like the grade_ticker golden edit; do not touch Rung 1-3.
- [ ] **Step 2:** `python -m pytest api/services/compass_eval/test_golden_set.py -q` → green.
- [ ] **Step 3: Commit** `eval: credit portfolio_heat + grade_watchlist on Rung-4/5 tool-gates`

---

### Task 11: Report-card HARDENING — the anti-gaming checks (spec §7, §9)

**Files:** Modify `api/services/compass_eval/checks.py` (new mechanical checks) + `golden_set.json` (new fixtures + forbidden claims); Test `api/services/compass_eval/test_checks.py`.

**Interfaces:** new mechanical `forbidden`/required tokens the golden questions can arm:
- `edge_not_applied` — a Rung-4 "grade my list" answer where `grade_watchlist`/`get_aggregates` fired but the answer names no personal-edge stat (no "you're N-M on …" / "small sample"). 
- `heat_without_cap` — an add/heat answer where `portfolio_heat` fired but the answer doesn't state heat vs the 10% cap.
- `muted_on_thin_sample` — the answer hard-drops/mutes a setup while citing n < 25 (forbidden — SOFT rule).
- `go_with_placeholder_stop` — the answer returns GO on an add while `portfolio_heat` reported a placeholder stop (safety).

- [ ] **Step 1: RED tests** — each new check fires on a crafted transcript and does NOT fire on the safe counterpart (TDD, mirror the existing `test_checks.py` style + the `armed`/`forbidden` gating).
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** the four checks in `run_mechanical_checks` (answer-text + `fired_tools` aware, mirroring existing checks; each conservative — only fires with clear evidence). Add fixtures to `golden_set.json`: a RED-tape "0-GO / sit on hands" Rung-4 question, a placeholder-stop add question (must not GO), a correlation-collapse question — each arming the relevant `forbidden` tokens.
- [ ] **Step 4: Run → pass** (`test_checks.py` + `test_golden_set.py` green).
- [ ] **Step 5: Commit** `eval: report-card hardening — edge/heat/placeholder/thin-sample anti-gaming checks + Rung-4/5 fixtures`

---

### Task 12: Full verification + docs

**Files:** Modify `CLAUDE.md` (extend the Brain Bridge / grade_ticker section with a Rung-4/5 subsection). No code.

- [ ] **Step 1:** Full suite — `python -m pytest api/services/test_portfolio_heat.py api/services/test_personal_edge.py api/services/test_grade_watchlist.py api/services/test_watchlist_source.py api/services/test_add_verdict_gates.py api/services/journal_two/test_rung45_chat_tools.py tests/test_rung45_voice_tools.py api/services/compass_eval -q` → all green.
- [ ] **Step 2:** Regression — `python -m pytest api/services/journal_two/test_coach_chat.py api/services/journal_two/test_verdict_protocol_prompt.py tests/test_voice_brain_tools.py -q` → green. `grep -c broker_sync api/main.py` ≥ 7. `python -c "import api.services.portfolio_heat, api.services.grade_watchlist, api.services.personal_edge, api.services.watchlist_source"` clean.
- [ ] **Step 3:** Document in `CLAUDE.md`: the four artifacts, the two-caps model (2%/10% from the brain), the placeholder-stop safety rule, the SOFT edge filter, the scope boundary (T3-deferred), and the deploy gate (Rungs 4-5 climb honestly before `COMPASS_MENTOR_MODE` past `admin`).
- [ ] **Step 4: Commit** `docs: Compass Rung-4/5 mentor (architecture, caps, safety, scope, deploy gate)`

---

### Task 13: Measure — re-run the report card (the real gate)

- [ ] **Step 1:** Online run Rungs 4,5 with the seeded sandbox (positions + watchlist + journal setups seeded), flags on: `python scripts/run_report_card.py --db %TEMP%\rc_r45.db --rungs 4,5 --notes "rung45 build"`.
- [ ] **Step 2:** Confirm Rungs 4-5 climb off the baseline (R4 0/7, R5 2/13) AND — critically — that they climb via the hardened checks (edge applied, heat vs cap stated, no placeholder-GO), not gate-gaming. Record deltas.
- [ ] **Step 3:** Report before/after; merge dark. `COMPASS_MENTOR_MODE` advances past `admin` only once Rungs 4-5 clear their bars honestly.

---

## Self-Review

**Spec coverage:** §3 caps → Task 1/1b (10% from brain) + Global Constraints; §4.A portfolio_heat (2 metrics, placeholder safety, per-position, no-GO) → Tasks 1+1b; §4.B grade_watchlist (funnel, source, list-synthesis, fail-soft) → Tasks 3+4+5+8; §4.C personal_edge (expectancy, SOFT, sample-gate, normalize, shared store) → Tasks 0+2 (store-sharing noted; awareness_preferences reuse is a follow-up seam, flagged in Task 2 commit); §4.D add-verdict persona composition + gates → Task 9; §11 routing → Task 9; §5 scope-out (no portfolio_stress, T3, refusal-traps) → honored (no tasks build them); §6 owner defaults → baked into Tasks 2 (SOFT) + 8 (scan IN) + 1b (10%); §7 report-card hardening → Task 11; §8 sequencing → task order; §9 biggest-risk guardrails → Tasks 4 (synthesis) + 1 (placeholder) + 11 (hardening). ✓

**Placeholder scan:** two seams are intentionally "read the real fn and match" (Task 2 Step 4 aggregates key; Task 9 Step 3 validate_trade existing gates) — each gives the exact verify command + what to match, not vague TODOs. No "TBD/handle-edge-cases". ✓

**Type consistency:** `portfolio_heat(...)`, `grade_watchlist(...)`, `edge_for_setups(...)`, `normalize_setup(...)`, `resolve(...)` signatures identical across their defining task, their tests, and their chat/voice executors; return keys (`risk_heat_pct`/`caps.aggregate_pct`/`graded[].edge_annotation`/`list_verdict`/`placeholder_stops`) consistent between producer, synthesis extension, and the report-card checks. ✓
