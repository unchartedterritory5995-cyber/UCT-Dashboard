# Compass `grade_ticker` — Unskippable Verdict — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `grade_ticker` tool that makes Compass commit to a decisive, tool-sourced GO/HOLD/SKIP verdict (regime-first, with entry/stop/size/account-risk) instead of hedging — measured by the report card's Rungs 3–5 clearing their bars.

**Architecture:** A new pure-orchestrator service `api/services/grade_ticker.py` composes the already-shipped tools (`get_regime` → `get_quote` → `find_patterns_on_ticker` → `lookup_playbook` → `brain_service.size_a_trade`) and applies **deterministic hard-gates** to force the verdict — the model can't hedge (the verdict is computed) and can't fabricate (every number is tool-sourced). Registered in BOTH Compass surfaces (voice + chat) via the established brain-tool pattern, behind `BRAIN_TOOLS_ENABLED`. A `§11 Verdict protocol` addendum to `MENTOR_TWO_LANE` (gated by `COMPASS_MENTOR_MODE`) makes routing trade-grade questions through the tool structural.

**Tech Stack:** Python 3 / FastAPI / pytest. No new deps.

## Global Constraints
- **Ships DARK.** Tool behind `BRAIN_TOOLS_ENABLED` (already ON in prod); the §11 protocol behind `COMPASS_MENTOR_MODE` (currently `admin`). No subscriber sees enforced verdicts until the report card clears and the flag moves past `admin`.
- **`grade_ticker` never raises** — returns `{ok: False, reason: ...}` on an un-gradeable state, or a decisive verdict dict otherwise.
- **Every displayed number is tool-sourced** (entry/stop/target from the pattern engine, size from `size_a_trade`, regime from the classifier). Never model-invented.
- **Verdict is never null and never "it depends"** — always `"GO" | "HOLD" | "SKIP"`.
- **Account risk hard-capped at 2%** (inherited from `size_a_trade`).
- Backend tests: `python -m pytest <path> -q` from repo root. `grep -c broker_sync api/main.py` ≥ 7 stays true (this plan doesn't touch main.py).
- Reuse the brain-tool registration pattern verbatim (voice: `voice_tool()` in `voice_tool_impls._register_all` + `voice_agents` union/core; chat: `_BRAIN_TOOLS`-style entry in `coach_chat_tools.py`, gated by `BRAIN_TOOLS_ENABLED`).

**Confirmed sub-tool contracts (from recon):**
- `voice_regime_classifier.get_current_regime() -> {"regime": str, "confidence": float, "narration": str, "label": str, ...}` (regime ∈ bull_trend/bull_correction/distribution/chop/bear_trend). Map to GREEN/YELLOW/ORANGE/RED (mirror `brain_service._current_regime`'s mapping).
- quote: `voice_tool_impls._get_quote(symbol) -> {"symbol", "last": float, "direction", "abs_pct"}`.
- `pattern_engine.memory.get_active_detections(sym, tf, min_conf) -> [ {"pattern_id","confidence","direction","status","levels": {"entry","stop","target_primary"}, ...} ]`.
- `brain_service.lookup_playbook(setup_name) -> {"ok", "name", "max_stop_pct", "winrate": {...}|None, "common_mistakes", ...}`.
- `brain_service.size_a_trade(entry, stop, account, regime="", grade="A", risk_pct=1.0) -> {"ok", "shares", "max_position_pct", "account_risk", "r1_target"/"r2_target", "recommendation", ...}` (exact keys verified in Task 2 recon step).

---

### Task 1: `grade_ticker.py` core — deterministic verdict from injected sub-fns

**Files:**
- Create: `api/services/grade_ticker.py`
- Test: `api/services/test_grade_ticker.py`

**Interfaces:**
- Produces: `grade_ticker(symbol: str, account_size: float | None = None, *, regime_fn=None, quote_fn=None, patterns_fn=None, playbook_fn=None, size_fn=None) -> dict`. Default `*_fn` wire to real services (Task 2); tests inject fakes so this task is pure/no-I/O.
- Return contract (a GO/HOLD/SKIP verdict): `{ok: True, symbol, verdict, regime, regime_note, setup, grade, entry, stop, stop_pct, size_pct, account_risk_pct, first_target, basis, hard_flags: [str], sources: [str]}` OR `{ok: False, reason}` when regime/quote is unavailable (the gate can't run).
- `_grade_from_confidence(conf: float) -> str` ("A"≥80 / "B+"≥65 / "B"≥55 / "C"≥40 / "F"<40).
- `_regime_band(raw_label: str) -> str` (GREEN/YELLOW/ORANGE/RED).

- [ ] **Step 1: Write the failing tests**

```python
# api/services/test_grade_ticker.py
"""grade_ticker: deterministic verdict assembly with injected sub-fns (no I/O)."""
from api.services import grade_ticker as gt


def _regime(band="GREEN", conf=0.8):
    labels = {"GREEN": "bull_trend", "YELLOW": "bull_correction",
              "ORANGE": "distribution", "RED": "bear_trend"}
    return lambda: {"regime": labels[band], "confidence": conf,
                    "narration": f"{band} tape"}


def _quote(last):
    return lambda sym: {"symbol": sym, "last": last, "direction": "up", "abs_pct": 1.0}


def _patterns(entry=None, stop=None, target=None, conf=75, direction="long", name="HTF"):
    if entry is None:
        return lambda sym: []
    return lambda sym: [{
        "pattern_id": "htf", "pattern_name": name, "confidence": conf,
        "direction": direction, "status": "active",
        "levels": {"entry": entry, "stop": stop, "target_primary": target},
    }]


def _playbook(max_stop=8.0, wr=57.0):
    return lambda name: {"ok": True, "name": name, "max_stop_pct": max_stop,
                         "winrate": {"win_rate_pct": wr}, "common_mistakes": ["chasing"]}


def _size(size_pct=15.0, acct_risk=0.7, shares=50):
    return lambda entry, stop, account, regime="", grade="A", risk_pct=1.0: {
        "ok": True, "shares": shares, "max_position_pct": size_pct,
        "account_risk": acct_risk, "r1_target": entry + (entry - stop) * 1.5,
        "recommendation": "ENTER"}


def _call(**over):
    kw = dict(regime_fn=_regime(), quote_fn=_quote(170.0),
              patterns_fn=_patterns(entry=172.4, stop=164.0, target=185.0),
              playbook_fn=_playbook(), size_fn=_size(), account_size=50000.0)
    kw.update(over)
    return gt.grade_ticker("DECK", **kw)


def test_verdict_is_never_null_and_is_go_on_clean_setup():
    out = _call()
    assert out["ok"] is True
    assert out["verdict"] == "GO"
    assert out["regime"] == "GREEN"
    assert out["entry"] == 172.4 and out["stop"] == 164.0
    assert out["size_pct"] == 15.0 and out["account_risk_pct"] == 0.7
    assert out["setup"] == "HTF" and out["grade"] in ("A", "B+")
    assert out["sources"]  # non-empty, traceable


def test_no_setup_forces_skip():
    out = _call(patterns_fn=_patterns())  # empty detections
    assert out["verdict"] == "SKIP"
    assert "no_setup" in out["hard_flags"]
    assert out["entry"] is None


def test_regime_red_forces_skip_regime_first():
    out = _call(regime_fn=_regime("RED"))
    assert out["verdict"] == "SKIP"
    assert "regime_red" in out["hard_flags"]
    # regime-first: the note leads with exposure guidance
    assert out["regime"] == "RED"


def test_low_grade_forces_skip():
    out = _call(patterns_fn=_patterns(entry=172.4, stop=164.0, target=185.0, conf=45))
    assert out["grade"] in ("C", "F")
    assert out["verdict"] == "SKIP"
    assert "grade_below_b" in out["hard_flags"]


def test_orange_regime_downgrades_go_to_hold():
    out = _call(regime_fn=_regime("ORANGE"))
    assert out["verdict"] == "HOLD"


def test_extended_price_downgrades_to_hold():
    # last 178 vs entry 172.4 => >3% past pivot
    out = _call(quote_fn=_quote(178.0))
    assert out["verdict"] == "HOLD"
    assert "extended" in out["hard_flags"]


def test_risk_over_cap_forces_skip():
    out = _call(size_fn=_size(size_pct=40.0, acct_risk=3.1))
    assert out["verdict"] == "SKIP"
    assert "risk_over_cap" in out["hard_flags"]


def test_regime_unavailable_returns_not_ok():
    out = _call(regime_fn=lambda: None)
    assert out["ok"] is False and "regime" in out["reason"].lower()


def test_never_raises_on_subfn_exception():
    def boom(*a, **k):
        raise RuntimeError("x")
    out = _call(patterns_fn=boom)
    assert out["ok"] in (True, False)  # returned a dict, did not raise
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest api/services/test_grade_ticker.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.services.grade_ticker'`.

- [ ] **Step 3: Implement**

```python
# api/services/grade_ticker.py
"""Compass grade_ticker — the unskippable verdict.

Composes the already-shipped Compass tools into a decisive, tool-sourced
GO/HOLD/SKIP verdict for a single ticker. Decisiveness is STRUCTURAL:
deterministic hard-gates force the verdict, so the calling model can neither
hedge (the verdict is computed here) nor fabricate (entry/stop/target come
from the pattern engine, size from brain_service.size_a_trade, regime from the
classifier). Never raises — returns {ok: False, reason} when the gate can't run.

See docs/superpowers/specs/2026-07-02-compass-grade-ticker-verdict-design.md.
"""
from __future__ import annotations

import logging

_log = logging.getLogger("grade_ticker")

_EXTENDED_PCT = 0.03      # >3% past the pivot = "extended" (long)
_RISK_CAP_PCT = 2.0       # account-risk hard cap (mirrors size_a_trade)
_DEFAULT_ACCOUNT = 50000.0

# raw classifier label -> exposure band
_REGIME_BAND = {
    "bull_trend": "GREEN", "bull_correction": "YELLOW",
    "distribution": "ORANGE", "chop": "YELLOW", "bear_trend": "RED",
}


def _regime_band(raw: str) -> str:
    return _REGIME_BAND.get((raw or "").lower(), "YELLOW")


def _grade_from_confidence(conf: float) -> str:
    c = float(conf or 0)
    if c >= 80:
        return "A"
    if c >= 65:
        return "B+"
    if c >= 55:
        return "B"
    if c >= 40:
        return "C"
    return "F"


def _default_regime_fn():
    from api.services.voice_regime_classifier import get_current_regime
    return get_current_regime()


def _default_quote_fn(symbol):
    from api.services.voice_tool_impls import _get_quote
    return _get_quote(symbol)


def _default_patterns_fn(symbol):
    from api.services.pattern_engine import memory as _mem
    try:
        from api.routers import patterns as _p  # noqa: F401 — loads detector registry
    except Exception:  # noqa: BLE001
        pass
    return _mem.get_active_detections(sym=symbol.upper(), tf="D", min_conf=50)


def _default_playbook_fn(setup_name):
    from api.services import brain_service
    return brain_service.lookup_playbook(setup_name)


def _default_size_fn(entry, stop, account, regime="", grade="A", risk_pct=1.0):
    from api.services import brain_service
    return brain_service.size_a_trade(entry=entry, stop=stop, account=account,
                                      regime=regime, grade=grade, risk_pct=risk_pct)


def grade_ticker(symbol, account_size=None, *, regime_fn=None, quote_fn=None,
                 patterns_fn=None, playbook_fn=None, size_fn=None) -> dict:
    sym = (symbol or "").upper().strip()
    if not sym:
        return {"ok": False, "reason": "no symbol"}
    regime_fn = regime_fn or _default_regime_fn
    quote_fn = quote_fn or _default_quote_fn
    patterns_fn = patterns_fn or _default_patterns_fn
    playbook_fn = playbook_fn or _default_playbook_fn
    size_fn = size_fn or _default_size_fn
    account = float(account_size or _DEFAULT_ACCOUNT)

    # ── the gate: regime + quote must be available ──────────────────────────
    try:
        regime = regime_fn() or {}
    except Exception:  # noqa: BLE001
        regime = {}
    if not regime or not (regime.get("regime") or regime.get("label")):
        return {"ok": False, "reason": "regime unavailable — cannot grade without the gate"}
    band = _regime_band(regime.get("regime") or regime.get("label"))
    regime_note = regime.get("narration") or f"Regime {band}."

    try:
        quote = quote_fn(sym) or {}
    except Exception:  # noqa: BLE001
        quote = {}
    last = float(quote.get("last") or 0)

    hard_flags: list[str] = []
    sources: list[str] = [f"regime classifier ({band})"]

    # ── setup identification ────────────────────────────────────────────────
    try:
        detections = patterns_fn(sym) or []
    except Exception:  # noqa: BLE001
        detections = []
    top = max(detections, key=lambda d: (d.get("confidence") or 0), default=None) if detections else None
    levels = (top or {}).get("levels") or {}
    entry = levels.get("entry")
    stop = levels.get("stop")
    target = levels.get("target_primary")

    if not top or entry is None or stop is None:
        return _verdict(ok=True, symbol=sym, verdict="SKIP", regime=band,
                        regime_note=regime_note, setup=None, grade=None,
                        entry=None, stop=None, size_pct=None, account_risk_pct=None,
                        first_target=None,
                        basis=f"No clean, tradable setup on {sym} right now — nothing to grade. Wait for a real pattern to form.",
                        hard_flags=["no_setup"], sources=sources)

    setup = top.get("pattern_name") or "setup"
    grade = _grade_from_confidence(top.get("confidence"))
    sources.append(f"pattern engine: {setup} (conf {int(top.get('confidence') or 0)})")

    # ── playbook (best-effort colour + win-rate) ────────────────────────────
    winrate = None
    try:
        pb = playbook_fn(setup) or {}
        if pb.get("ok"):
            winrate = (pb.get("winrate") or {}).get("win_rate_pct")
            sources.append(f"playbook: {pb.get('name')}")
    except Exception:  # noqa: BLE001
        pass

    # ── sizing (risk-first, tool-sourced) ───────────────────────────────────
    size_pct = account_risk_pct = first_target = None
    try:
        sized = size_fn(entry, stop, account, band, grade, 1.0) or {}
        if sized.get("ok"):
            size_pct = sized.get("max_position_pct")
            account_risk_pct = sized.get("account_risk")
            first_target = sized.get("r1_target")
            sources.append("size_a_trade (regime-scaled, 2% cap)")
    except Exception:  # noqa: BLE001
        pass

    stop_pct = round(abs(entry - stop) / entry * 100, 1) if entry else None
    extended = last > entry * (1 + _EXTENDED_PCT) if (last and entry) else False

    # ── deterministic verdict ───────────────────────────────────────────────
    if band == "RED":
        hard_flags.append("regime_red")
    if grade in ("C", "F"):
        hard_flags.append("grade_below_b")
    if account_risk_pct is not None and account_risk_pct > _RISK_CAP_PCT:
        hard_flags.append("risk_over_cap")
    if extended:
        hard_flags.append("extended")

    if any(f in hard_flags for f in ("regime_red", "no_setup", "grade_below_b", "risk_over_cap")):
        verdict = "SKIP"
    elif "extended" in hard_flags or band == "ORANGE" or (band == "YELLOW" and grade == "B"):
        verdict = "HOLD"
    else:
        verdict = "GO"

    wr_txt = f", historically {winrate:.0f}% over the firm's book" if winrate else ""
    basis = (f"{setup} on {sym}, graded {grade}{wr_txt}. Regime {band} — {regime_note} "
             f"Entry {entry}, stop {stop} ({stop_pct}% risk), size {size_pct}% "
             f"for {account_risk_pct}% account risk.")
    if verdict == "HOLD":
        basis += " Tape or extension is the knock — half size or wait for it to firm up."

    return _verdict(ok=True, symbol=sym, verdict=verdict, regime=band,
                    regime_note=regime_note, setup=setup, grade=grade,
                    entry=entry, stop=stop, size_pct=size_pct,
                    account_risk_pct=account_risk_pct, first_target=first_target,
                    basis=basis, hard_flags=hard_flags, sources=sources,
                    stop_pct=stop_pct)


def _verdict(*, ok, symbol, verdict, regime, regime_note, setup, grade, entry,
             stop, size_pct, account_risk_pct, first_target, basis, hard_flags,
             sources, stop_pct=None):
    return {
        "ok": ok, "symbol": symbol, "verdict": verdict, "regime": regime,
        "regime_note": regime_note, "setup": setup, "grade": grade,
        "entry": entry, "stop": stop,
        "stop_pct": stop_pct if stop_pct is not None else (
            round(abs(entry - stop) / entry * 100, 1) if (entry and stop) else None),
        "size_pct": size_pct, "account_risk_pct": account_risk_pct,
        "first_target": first_target, "basis": basis,
        "hard_flags": hard_flags, "sources": sources,
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest api/services/test_grade_ticker.py -q`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add api/services/grade_ticker.py api/services/test_grade_ticker.py
git commit -m "feat(compass): grade_ticker core — deterministic GO/HOLD/SKIP from injected sub-fns"
```

---

### Task 2: Wire the real default sub-fns (integration, fail-soft)

**Files:**
- Modify: `api/services/grade_ticker.py` (verify the default `*_fn` adapters call the REAL services correctly)
- Test: `api/services/test_grade_ticker_integration.py`

**Interfaces:**
- Consumes: `brain_service.size_a_trade` return keys (`max_position_pct`, `account_risk`, `r1_target`) — verify against `api/services/brain_service.py`; if a key name differs, fix the default `_default_size_fn` mapping AND the fake in Task 1's test to match reality, keeping the behavioral contract.
- Produces: `grade_ticker("AAPL")` with no injected fns returns a dict (never raises) on a machine where the brain pack + pattern engine may be absent → degrades to `{ok: False}` or a `no_setup` SKIP.

- [ ] **Step 1: Recon the real size_a_trade keys**

Run: `python -c "import inspect,api.services.brain_service as b; print([l for l in inspect.getsource(b.size_a_trade).splitlines() if 'return' in l or 'out[' in l or 'max_position' in l or 'account_risk' in l])"`
Adjust `_default_size_fn`'s consumed keys in `grade_ticker.py` if the engine's `calculate_position_size` uses different names (e.g. `dollar_risk`, `r1_target` vs `r1`). Document the real keys in the commit message.

- [ ] **Step 2: Write the failing test**

```python
# api/services/test_grade_ticker_integration.py
"""grade_ticker with REAL default sub-fns — must never raise, degrade gracefully."""
from api.services import grade_ticker as gt


def test_real_defaults_never_raise_and_return_dict(monkeypatch):
    # Force the gate available but everything else absent -> decisive SKIP or ok:False.
    monkeypatch.setattr(gt, "_default_regime_fn",
                        lambda: {"regime": "chop", "confidence": 0.5, "narration": "mixed"})
    monkeypatch.setattr(gt, "_default_quote_fn", lambda s: {"symbol": s, "last": 100.0})
    monkeypatch.setattr(gt, "_default_patterns_fn", lambda s: [])
    out = gt.grade_ticker("AAPL")
    assert isinstance(out, dict)
    assert out["ok"] is True and out["verdict"] == "SKIP" and "no_setup" in out["hard_flags"]


def test_regime_unavailable_degrades_not_raises(monkeypatch):
    monkeypatch.setattr(gt, "_default_regime_fn", lambda: None)
    out = gt.grade_ticker("AAPL")
    assert out["ok"] is False
```

- [ ] **Step 3: Run to verify it passes** (implementation from Task 1 already handles this)

Run: `python -m pytest api/services/test_grade_ticker_integration.py -q`
Expected: 2 passed. (If FAIL because a default fn raised at import, wrap the import in the try/except already present and re-run.)

- [ ] **Step 4: Commit**

```bash
git add api/services/grade_ticker.py api/services/test_grade_ticker_integration.py
git commit -m "feat(compass): grade_ticker real default sub-fns wired + verified fail-soft"
```

---

### Task 3: Register `grade_ticker` in the CHAT registry

**Files:**
- Modify: `api/services/journal_two/coach_chat_tools.py` (add to the `_BRAIN_TOOLS` gated block)
- Test: `api/services/journal_two/test_grade_ticker_chat_tool.py`

**Interfaces:**
- Consumes: the `_BRAIN_TOOLS` dict + `BRAIN_TOOLS_ENABLED` gate + the `(*, user_id, account_id, args, conn=None) -> dict` executor signature (mirror the existing brain-tool entries).
- Produces: `TOOLS["grade_ticker"]` present when `BRAIN_TOOLS_ENABLED=1`.

- [ ] **Step 1: Write the failing test**

```python
# api/services/journal_two/test_grade_ticker_chat_tool.py
import importlib


def _reload(monkeypatch, enabled):
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "1" if enabled else "0")
    import api.services.journal_two.coach_chat_tools as cct
    return importlib.reload(cct)


def test_grade_ticker_absent_when_flag_off(monkeypatch):
    cct = _reload(monkeypatch, False)
    assert "grade_ticker" not in cct.TOOLS
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "0")
    importlib.reload(cct)


def test_grade_ticker_present_and_delegates(monkeypatch):
    cct = _reload(monkeypatch, True)
    assert "grade_ticker" in cct.TOOLS
    spec = cct.TOOLS["grade_ticker"]
    assert spec["requires_confirm"] is False
    from api.services import grade_ticker as gt
    monkeypatch.setattr(gt, "grade_ticker",
                        lambda symbol, account_size=None: {"ok": True, "verdict": "GO", "symbol": symbol})
    out = spec["executor"](user_id="u1", account_id="a1", args={"symbol": "deck"}, conn=None)
    assert out["verdict"] == "GO" and out["symbol"] == "DECK"
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "0")
    importlib.reload(cct)
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest api/services/journal_two/test_grade_ticker_chat_tool.py -q`
Expected: FAIL — `grade_ticker` not in `TOOLS`.

- [ ] **Step 3: Implement** — add to the `_BRAIN_TOOLS` dict in `coach_chat_tools.py` (next to `size_a_trade`):

```python
def _exec_grade_ticker(*, user_id, account_id, args, conn=None) -> dict:
    from api.services import grade_ticker as _gt
    return _gt.grade_ticker(str(args.get("symbol", "")),
                            account_size=args.get("account_size"))
```

and the `_BRAIN_TOOLS` entry:

```python
    "grade_ticker": {
        "name": "grade_ticker",
        "description": "Grade a ticker as a trade RIGHT NOW: returns a decisive "
                       "GO/HOLD/SKIP verdict with regime, setup + grade, entry, stop, "
                       "size %, and account-risk % — all tool-sourced. Use this for any "
                       "'call this trade' / 'should I buy/short X' / 'grade X' question.",
        "requires_confirm": False,
        "executor": _exec_grade_ticker,
        "input_schema": {"type": "object", "properties": {
            "symbol": {"type": "string"},
            "account_size": {"type": "number"}}, "required": ["symbol"]},
    },
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest api/services/journal_two/test_grade_ticker_chat_tool.py api/services/journal_two/test_coach_chat_brain_tools.py -q`
Expected: new tests pass; existing brain-tool tests stay green.

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/coach_chat_tools.py api/services/journal_two/test_grade_ticker_chat_tool.py
git commit -m "feat(compass): grade_ticker chat-registry tool (flag-gated)"
```

---

### Task 4: Register `grade_ticker` in the VOICE registry

**Files:**
- Modify: `api/services/voice_tool_impls.py` (impl + registration in `_register_all` inside the `BRAIN_TOOLS_ENABLED` block)
- Modify: `api/services/voice_agents.py` (`_compass_tool_union()` + `_COMPASS_CORE_TOOLS`)
- Test: `tests/test_grade_ticker_voice_tool.py`

**Interfaces:**
- Consumes: the voice `voice_tool()` registration pattern + `_compass_tool_union`/`_COMPASS_CORE_TOOLS` (mirror the 5 brain tools).
- Produces: `grade_ticker` in `voice_tools._REGISTRY` when `BRAIN_TOOLS_ENABLED=1`, and in the compass union + core set.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_grade_ticker_voice_tool.py
import importlib


def test_registered_when_flag_on(monkeypatch):
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "1")
    from api.services import voice_tools, voice_tool_impls
    voice_tools._REGISTRY.clear()
    importlib.reload(voice_tool_impls)
    assert "grade_ticker" in voice_tools._REGISTRY


def test_in_compass_union_and_core(monkeypatch):
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "1")
    from api.services import voice_agents
    assert "grade_ticker" in voice_agents._COMPASS_CORE_TOOLS
    assert "grade_ticker" in voice_agents._compass_tool_union()
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_grade_ticker_voice_tool.py -q`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `voice_tool_impls.py`, add the impl near the other brain wrappers:

```python
def _grade_ticker(symbol: str, account_size: float = 0) -> dict:
    from api.services import grade_ticker as _gt
    return _gt.grade_ticker(symbol, account_size=(account_size or None))
```

and inside the `if os.environ.get("BRAIN_TOOLS_ENABLED", "0") == "1":` block in `_register_all()`:

```python
        _vt.voice_tool(
            name="grade_ticker",
            description="Grade a ticker as a trade right now: decisive GO/HOLD/SKIP with"
                        " regime, setup grade, entry, stop, size %, account-risk % —"
                        " all tool-sourced. Use for any 'call this trade' / 'grade X' ask.",
            parameters={"symbol": {"type": "string"},
                        "account_size": {"type": "number"}},
            contexts=["global"],
        )(_grade_ticker)
```

In `voice_agents.py`: add `out.add("grade_ticker")` in `_compass_tool_union()` and `"grade_ticker"` to `_COMPASS_CORE_TOOLS`.

- [ ] **Step 4: Run to verify it passes + voice regression**

Run: `python -m pytest tests/test_grade_ticker_voice_tool.py tests/test_voice_brain_tools.py -q`
Expected: new pass; brain-tool voice tests stay green (exactly the known baseline failures elsewhere, nothing new).

- [ ] **Step 5: Commit**

```bash
git add api/services/voice_tool_impls.py api/services/voice_agents.py tests/test_grade_ticker_voice_tool.py
git commit -m "feat(compass): grade_ticker voice-registry tool + compass union/core (flag-gated)"
```

---

### Task 5: `§11 Verdict protocol` — the unskippable prompt scaffold

**Files:**
- Modify: `api/services/journal_two/coach_prompts.py` (append `§11` to `MENTOR_TWO_LANE`)
- Test: `api/services/journal_two/test_verdict_protocol_prompt.py`

**Interfaces:**
- Consumes: `MENTOR_TWO_LANE` (the string constant), re-exported to voice via `voice_prompts/compass.py`, gated by `COMPASS_MENTOR_MODE`.
- Produces: the new `§11` text is part of `MENTOR_TWO_LANE`, so it reaches BOTH surfaces under the flag with zero new wiring.

- [ ] **Step 1: Write the failing test**

```python
# api/services/journal_two/test_verdict_protocol_prompt.py
def test_verdict_protocol_in_mentor_two_lane():
    from api.services.journal_two import coach_prompts as cp
    t = cp.MENTOR_TWO_LANE
    assert "Verdict protocol" in t
    assert "grade_ticker" in t
    assert "GO/HOLD/SKIP" in t or "GO / HOLD / SKIP" in t
    # regime-first + no free-form trade call are mandated
    assert "regime" in t.lower() and "never" in t.lower()


def test_voice_reexport_still_resolves():
    from api.services.journal_two import coach_prompts as cp
    from api.services.voice_prompts import compass as vp
    assert vp._MENTOR_TWO_LANE is cp.MENTOR_TWO_LANE
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest api/services/journal_two/test_verdict_protocol_prompt.py -q`
Expected: FAIL — "Verdict protocol" not present.

- [ ] **Step 3: Implement** — append to the `MENTOR_TWO_LANE` string in `coach_prompts.py`:

```
§11 — Verdict protocol (trade-grade questions).
For ANY "call this trade" / "should I buy or short X" / "grade X" / "is X a buy here"
question, you MUST call grade_ticker and deliver ITS verdict — you do not free-form a
trade call. Lead with the regime, then state the GO/HOLD/SKIP with entry, stop, size %,
and account-risk % exactly as grade_ticker returned them. Never state a price or size
grade_ticker did not return, never answer "it depends", never hedge. If a hard flag fired
(regime_red, no_setup, risk_over_cap, extended), lead with it — the verdict is SKIP or
HOLD and you say plainly why. This overrides any instinct to soften; a decisive, sized,
regime-first answer IS the mentor. (Rungs 1-2 fact/craft questions never trigger this —
answer those normally.)
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest api/services/journal_two/test_verdict_protocol_prompt.py -q`
Expected: 2 passed.

- [ ] **Step 5: Verify voice prompt byte-identity except the new section**

Run (before/after diff for `COMPASS_MENTOR_MODE=1` — the ONLY change must be the §11 addition):
`python -c "import os; os.environ['COMPASS_MENTOR_MODE']='1'; from api.services.voice_prompts.compass import build_compass_voice_prompt as b; print('Verdict protocol' in b())"`
Expected: `True`.

- [ ] **Step 6: Commit**

```bash
git add api/services/journal_two/coach_prompts.py api/services/journal_two/test_verdict_protocol_prompt.py
git commit -m "feat(compass): §11 verdict protocol — route trade-grade questions through grade_ticker (flag-gated)"
```

---

### Task 6: Credit `grade_ticker` in the report-card golden set

**Files:**
- Modify: `api/services/compass_eval/golden_set.json` (add `grade_ticker` to the `must_call_tools` OR-groups of the Rung-3+ trade-grade questions)
- Test: `api/services/compass_eval/test_golden_set.py` (existing — must stay green after the edit)

**Interfaces:**
- Consumes: the golden-set schema (OR-groups of real tool names).
- Produces: Rung-3+ "grade / call this trade" questions accept `grade_ticker` as satisfying their sizing/verdict tool-gate.

- [ ] **Step 1: Identify the affected questions**

Run: `python -c "import json; d=json.load(open(r'api/services/compass_eval/golden_set.json')); [print(q['id'], q['must_call_tools']) for q in d['questions'] if q['rung']>=3 and any('size' in t or 'verdict' in t or 'calc' in t for g in q['must_call_tools'] for t in g)]"`
For each printed question, `grade_ticker` should be added to the OR-group that currently lists `size_a_trade`/`calc_position_size`/`pre_trade_verdict` — since calling `grade_ticker` now legitimately satisfies "the mentor ran the sizing/verdict path."

- [ ] **Step 2: Edit `golden_set.json`** — for every Rung ≥ 3 question whose `must_call_tools` contains a group with `size_a_trade` or `calc_position_size` or `pre_trade_verdict`, append `"grade_ticker"` to that group (it becomes an acceptable alternative). Do NOT remove existing names. Do NOT touch Rung 1–2 questions.

- [ ] **Step 3: Run the golden-set validator**

Run: `python -m pytest api/services/compass_eval/test_golden_set.py -q`
Expected: all pass (the schema check tolerates the added real tool name; count unchanged).

- [ ] **Step 4: Commit**

```bash
git add api/services/compass_eval/golden_set.json
git commit -m "eval: credit grade_ticker as a sizing/verdict tool for Rung 3+ questions"
```

---

### Task 7: Full verification + docs

**Files:**
- Modify: `CLAUDE.md` (extend the Compass Brain Bridge section with a `grade_ticker` subsection)
- No code.

- [ ] **Step 1: Full grade_ticker + registry + prompt suite**

Run: `python -m pytest api/services/test_grade_ticker.py api/services/test_grade_ticker_integration.py api/services/journal_two/test_grade_ticker_chat_tool.py tests/test_grade_ticker_voice_tool.py api/services/journal_two/test_verdict_protocol_prompt.py api/services/compass_eval -q`
Expected: all green.

- [ ] **Step 2: Regression — chat + voice brain tools unchanged**

Run: `python -m pytest api/services/journal_two/test_coach_chat.py api/services/journal_two/test_coach_chat_brain_tools.py tests/test_voice_brain_tools.py -q`
Expected: green (grade_ticker is additive, flag-gated).

- [ ] **Step 3: Invariant + import**

Run: `grep -c broker_sync api/main.py` (≥7 — untouched) and `python -c "import api.services.grade_ticker"` (clean).

- [ ] **Step 4: Document** — add a `### grade_ticker — the unskippable verdict` block under the Brain Bridge section of `CLAUDE.md`: what it composes, the deterministic gates, both-registry wiring, the §11 protocol behind `COMPASS_MENTOR_MODE`, and the deploy gate (Rungs 3–5 of the report card must clear before `COMPASS_MENTOR_MODE` moves past `admin`).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: grade_ticker — the unskippable verdict (architecture, gates, deploy gate)"
```

---

### Task 8: Measure — re-run the report card (the real gate)

**Files:** none (validation).

- [ ] **Step 1: Online report-card run, Rungs 3–5**, with the flags on, against a throwaway DB (needs `ANTHROPIC_API_KEY` + a local semantic index; mirror the baseline-run setup):

Run: `python scripts/run_report_card.py --db %TEMP%\rc_grade.db --rungs 3,4,5 --notes "post grade_ticker"`
Expected: exit code may still be 1 (not all pass on the first try), but the per-rung table must show **Rungs 3–5 climbing off 0** — Opinion axis rising, tool-gate misses dropping (grade_ticker now fires). Record the scores.

- [ ] **Step 2: Compare to baseline** (Rungs 3–5 were 0/10, 0/7, 0/13). Capture the delta in the run notes + memory. If a rung still misses its bar, read the failed questions' judge rationales — the fix is prompt/gate tuning on `grade_ticker`, not a new architecture.

- [ ] **Step 3: Report** the before/after to the owner; the branch merges dark, and `COMPASS_MENTOR_MODE` only advances past `admin` once Rungs 3–5 clear.

---

## Self-Review

**Spec coverage:** §3.1 orchestration → Tasks 1–2; §3.2 typed contract → Task 1 `_verdict`; §3.3 deterministic gates → Task 1; §3.4 §11 protocol → Task 5; §4 flags → Tasks 3/4/5 (BRAIN_TOOLS_ENABLED + COMPASS_MENTOR_MODE); §5 testing → every task + Task 8; both-registry wiring → Tasks 3/4. Success criterion (Rungs 3–5) → Tasks 6+8. ✓ All covered.

**Placeholder scan:** no TBD/TODO; every code step has complete code; the two recon steps (Task 2 Step 1, Task 6 Step 1) are `run this command and adjust` with the exact command + what to change, not vague. ✓

**Type consistency:** `grade_ticker(symbol, account_size=None, *, ...fn)` identical across Tasks 1–4; the return keys (`verdict`, `entry`, `stop`, `size_pct`, `account_risk_pct`, `hard_flags`, `sources`) match between Task 1's impl, its tests, and the chat/voice executors; `_BRAIN_TOOLS` entry shape matches the existing brain-tool convention. ✓
