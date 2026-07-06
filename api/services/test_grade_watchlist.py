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
                                        "Bull Flag": {"verdict": "weak", "muted": True, "note": "4-11 on these"}},
              sector_fn=lambda sym: set())
    kw.update(over)
    return gw.grade_watchlist("u", **kw)


# ── Task 3: core ──────────────────────────────────────────────────────────────

def test_grades_each_name_with_edge_annotation():
    out = _call()
    assert out["ok"] is True
    g = {r["symbol"]: r for r in out["graded"]}
    assert g["DECK"]["verdict"] == "GO" and g["DECK"]["edge_annotation"] == "you're 6-2 on HTF"
    assert g["AMD"]["muted"] is True


def test_failed_name_returned_inline_never_dropped():
    out = _call()
    bad = next(r for r in out["graded"] if r["symbol"] == "BAD")
    assert bad["failed"] is True and bad["verdict"] in (None, "SKIP")
    assert len(out["graded"]) == 3


def test_states_which_set_it_graded():
    out = _call()
    assert "explicit" in out["source_described"]


def test_regime_fail_blocks_go():
    out = _call(regime_fn=lambda: {})
    assert out["ok"] is False or all(r["verdict"] != "GO" for r in out["graded"])


# ── Task 4: list-level synthesis ──────────────────────────────────────────────

def test_red_tape_forces_all_watch_only():
    out = _call(regime_fn=lambda: {"regime": "bear_trend", "exposure_rating": 10})
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
