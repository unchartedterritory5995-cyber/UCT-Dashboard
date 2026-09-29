"""TERM-041 (FB-A11-02) — a fixed, published regime vocabulary, permanently.

TERM-071 named the ONE regime authority (`api/services/voice_regime_classifier.py`,
DEC-13) and railed that nobody else computes or restates a regime. This file
makes that authority's vocabulary a CLOSED, VERSIONED PUBLICATION:

  * "a closed enum of regime names"
      -> `test_every_classifier_output_is_a_member_of_the_enum` and
         `test_label_of_is_closed_a_non_member_renders_the_sentinel`.
  * "published"
      -> `GET /api/regime/vocabulary` serves `regime_vocabulary()`, and the
         served body is the authority's values (moving the source moves it).
  * "permanently"
      -> `test_the_vocabulary_matches_its_pinned_version`: the vocabulary may
         only change together with REGIME_VOCABULARY_VERSION and an APPENDED
         entry in `_PUBLISHED` below. A silent rename, reorder, re-band or new
         label goes red here with the instructions.
  * "every surface renders a member of the enum (railed on the enum, not on a
    list of strings)"
      -> the display rails below read the enum FROM the authority (by AST) and
         prove the member surfaces (`/api/regime`, Portfolio Risk, the Awareness
         R4 headline) render `label_of()` by MOVING the authority's display.

⛔ HOW TO CHANGE THE VOCABULARY DELIBERATELY (the only way this file goes green
after a change):
  1. edit REGIMES / REGIME_DISPLAY / REGIME_BAND / BAND_DEFAULT / REGIME_UNKNOWN
     in the authority;
  2. bump REGIME_VOCABULARY_VERSION there by exactly 1;
  3. APPEND the new version to `_PUBLISHED` here — never edit an old entry, a
     published version is a record of what members were told;
  4. update the declared S7 copies TERM-071 counts (`alert_taxonomy/regime_change.py`
     REGIME_LABELS, `voice_proactive_service.py` path B's scan tuple,
     `voice_causal_model.py` _REGIME_TO_STAGE) — their own rails go red until
     you do;
  5. record the change in docs/terminal-research/10-roadmap/evidence/
     2026-09-29-term041/results.md.
"""
from __future__ import annotations

import ast
import pathlib
import re

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[1]
_AUTHORITY = _REPO / "api/services/voice_regime_classifier.py"

#: Every vocabulary version ever published, APPEND-ONLY. Key = version.
_PUBLISHED = {
    1: {
        "regimes": ("bull_trend", "bull_correction", "distribution", "chop", "bear_trend"),
        "display": {
            "bull_trend": "Bull trend",
            "bull_correction": "Bull correction",
            "distribution": "Distribution",
            "chop": "Chop",
            "bear_trend": "Bear trend",
        },
        "band": {
            "bull_trend": "GREEN",
            "bull_correction": "YELLOW",
            "chop": "YELLOW",
            "distribution": "ORANGE",
            "bear_trend": "RED",
        },
        "bands": ("GREEN", "YELLOW", "ORANGE", "RED"),
        "band_default": "YELLOW",
        "unknown": ("unknown", "Unknown"),
    },
}


def _module_literal(name: str):
    for node in ast.parse(_AUTHORITY.read_text(encoding="utf-8")).body:
        targets = []
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, ast.AnnAssign):
            targets = [node.target]
        for tgt in targets:
            if isinstance(tgt, ast.Name) and tgt.id == name:
                return ast.literal_eval(node.value)
    raise AssertionError(f"{name} is not a module-level literal in {_AUTHORITY.name}")


_HOW = ("change the vocabulary DELIBERATELY: bump REGIME_VOCABULARY_VERSION and "
        "APPEND the new version to _PUBLISHED in tests/test_regime_vocabulary.py "
        "(see its docstring) — never edit a published version")


# ── permanently: the pin ─────────────────────────────────────────────────────

def test_the_version_is_the_latest_published_and_published_versions_are_contiguous():
    version = _module_literal("REGIME_VOCABULARY_VERSION")
    assert sorted(_PUBLISHED) == list(range(1, max(_PUBLISHED) + 1)), \
        "published versions must be 1..N with no gap (append-only)"
    assert version == max(_PUBLISHED), (
        f"authority says v{version}, latest published is v{max(_PUBLISHED)}: {_HOW}")


def test_the_vocabulary_matches_its_pinned_version():
    """Read by AST — the SOURCE is what is pinned, not whatever a test run
    happened to monkeypatch."""
    pinned = _PUBLISHED[_module_literal("REGIME_VOCABULARY_VERSION")]
    actual = {
        "regimes": tuple(_module_literal("REGIMES")),
        "display": _module_literal("REGIME_DISPLAY"),
        "band": _module_literal("REGIME_BAND"),
        "bands": tuple(_module_literal("REGIME_BANDS")),
        "band_default": _module_literal("BAND_DEFAULT"),
        "unknown": (_module_literal("REGIME_UNKNOWN"), _module_literal("REGIME_UNKNOWN_LABEL")),
    }
    for key in pinned:
        assert actual[key] == pinned[key], (
            f"the regime vocabulary's {key!r} changed without a version bump "
            f"({actual[key]!r} != pinned {pinned[key]!r}): {_HOW}")


def test_the_vocabulary_is_internally_closed():
    from api.services import voice_regime_classifier as vrc
    assert len(set(vrc.REGIMES)) == len(vrc.REGIMES)
    assert set(vrc.REGIME_DISPLAY) == set(vrc.REGIMES), "every regime needs exactly one display"
    assert set(vrc.REGIME_BAND) == set(vrc.REGIMES), "every regime needs exactly one band"
    assert set(vrc.REGIME_BAND.values()) <= set(vrc.REGIME_BANDS)
    assert vrc.BAND_DEFAULT in vrc.REGIME_BANDS
    assert vrc.REGIME_UNKNOWN not in vrc.REGIMES, "the sentinel must not be a regime"
    displays = list(vrc.REGIME_DISPLAY.values()) + [vrc.REGIME_UNKNOWN_LABEL]
    assert len(set(displays)) == len(displays), "two ids render the same words"


# ── closed: nothing outside the enum reaches a member ────────────────────────

_SIGNAL_FIXTURES = [
    {},
    {"pct_above_50ma": 80, "pct_above_200ma": 75, "new_highs": 200, "new_lows": 10,
     "vix": 12, "distribution_days": 1, "uct_exposure_rating": 120, "breadth_score": 75},
    {"pct_above_50ma": 20, "pct_above_200ma": 25, "new_highs": 5, "new_lows": 300,
     "vix": 38, "distribution_days": 7, "uct_exposure_rating": 5, "breadth_score": 10},
    {"pct_above_50ma": 50, "pct_above_200ma": 55, "vix": 22},
    {"pct_above_50ma": 65, "pct_above_200ma": 70, "vix": 16, "distribution_days": 6},
]


@pytest.mark.parametrize("signals", _SIGNAL_FIXTURES)
def test_every_classifier_output_is_a_member_of_the_enum(monkeypatch, signals):
    from api.services import voice_regime_classifier as vrc
    monkeypatch.setattr(vrc, "_fetch_signals", lambda: dict(signals))
    out = vrc.get_current_regime(fresh=True)
    assert out["regime"] in vrc.REGIMES
    assert out["label"] == vrc.label_of(out["regime"])
    assert out["vocabulary_version"] == vrc.REGIME_VOCABULARY_VERSION


def test_label_of_is_closed_a_non_member_renders_the_sentinel():
    from api.services import voice_regime_classifier as vrc
    for rid in vrc.REGIMES:
        assert vrc.label_of(rid) == vrc.REGIME_DISPLAY[rid]
    for junk in (None, "", "unknown", "Bull trend", "bull trend", "sideways", 7):
        assert vrc.label_of(junk) == vrc.REGIME_UNKNOWN_LABEL, junk


def test_the_label_is_the_authoritys_display_moving_the_source_moves_it(monkeypatch):
    from api.services import voice_regime_classifier as vrc
    rid = vrc.REGIMES[0]
    monkeypatch.setattr(vrc, "_classify", lambda s: (rid, 0.9, []))
    monkeypatch.setitem(vrc.REGIME_DISPLAY, rid, "MOVED-DISPLAY")
    out = vrc.get_current_regime(fresh=True)
    assert out["label"] == "MOVED-DISPLAY"
    assert "MOVED-DISPLAY" in out["narration"]


# ── published: /api/regime and /api/regime/vocabulary ───────────────────────

PAID = {"id": "u-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
FREE = {"id": "u-free", "email": "free@example.test", "role": "member", "plan": "free"}


def _client(user=None):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    import api.routers.regime as rr
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    app = FastAPI()
    app.include_router(rr.router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app)


def test_the_vocabulary_route_is_paid_like_the_regime_route():
    assert _client().get("/api/regime/vocabulary").status_code in (401, 403)
    assert _client(FREE).get("/api/regime/vocabulary").status_code == 402


def test_the_published_vocabulary_IS_the_authoritys(monkeypatch):
    from api.services import voice_regime_classifier as vrc
    body = _client(PAID).get("/api/regime/vocabulary").json()
    assert body == vrc.regime_vocabulary()
    assert body["version"] == vrc.REGIME_VOCABULARY_VERSION
    assert [r["id"] for r in body["regimes"]] == list(vrc.REGIMES), "ORDER is published too"
    assert body["closed"] is True
    # moving the source moves the publication
    monkeypatch.setitem(vrc.REGIME_DISPLAY, vrc.REGIMES[-1], "MOVED")
    monkeypatch.setitem(vrc.REGIME_BAND, vrc.REGIMES[-1], "GREEN")
    moved = _client(PAID).get("/api/regime/vocabulary").json()
    last = moved["regimes"][-1]
    assert (last["label"], last["band"]) == ("MOVED", "GREEN")


def test_a_failed_classifier_publishes_the_SENTINEL_not_an_invented_label(monkeypatch):
    """The fallback used to type its own "unknown"/"Unknown" — a sixth word
    outside the enum that nobody declared. It now reads the authority's
    declared sentinel; moving the sentinel moves the fallback."""
    from api.services import voice_regime_classifier as vrc

    def _boom(**_k):
        raise RuntimeError("classifier down")

    monkeypatch.setattr(vrc, "get_current_regime", _boom)
    body = _client(PAID).get("/api/regime").json()
    assert (body["regime"], body["label"]) == (vrc.REGIME_UNKNOWN, vrc.REGIME_UNKNOWN_LABEL)
    assert body["vocabulary_version"] == vrc.REGIME_VOCABULARY_VERSION
    monkeypatch.setattr(vrc, "REGIME_UNKNOWN", "moved_sentinel")
    monkeypatch.setattr(vrc, "REGIME_UNKNOWN_LABEL", "Moved sentinel")
    body = _client(PAID).get("/api/regime").json()
    assert (body["regime"], body["label"]) == ("moved_sentinel", "Moved sentinel")


# ── rendered: member surfaces render label_of, proved by moving the display ──

def test_portfolio_risk_renders_the_authoritys_display(monkeypatch):
    from api.services import voice_regime_classifier as vrc
    from api.services import portfolio_heat as ph
    rid = vrc.REGIMES[0]
    fn = lambda: {"regime": rid, "exposure_rating": 100}  # noqa: E731
    out = ph.portfolio_heat("u", "a", account_size=100_000.0,
                            positions_fn=lambda *a: [], regime_fn=fn)
    assert out["regime"] == rid
    assert out["regime_label"] == vrc.REGIME_DISPLAY[rid]
    monkeypatch.setitem(vrc.REGIME_DISPLAY, rid, "MOVED")
    out = ph.portfolio_heat("u", "a", account_size=100_000.0,
                            positions_fn=lambda *a: [], regime_fn=fn)
    assert out["regime_label"] == "MOVED"


def test_portfolio_risk_page_renders_the_label_field():
    """The page renders the server's `regime_label` (the enum's display), not
    the raw id. Source-level: the render reads `regime_label` first."""
    jsx = (_REPO / "app/src/pages/PortfolioHeat.jsx").read_text(encoding="utf-8")
    assert "regime_label" in jsx
    assert re.search(r"\{\s*regime_label\s*\?\?\s*regime\s*\}", jsx), \
        "Portfolio Risk must render regime_label (falling back to the id only for an old server)"


def test_the_awareness_flip_headline_renders_the_authoritys_display(monkeypatch):
    from api.services import voice_regime_classifier as vrc
    from api.services.awareness import rules
    prev, new = vrc.REGIMES[0], vrc.REGIMES[-1]
    ctx = {"regime": {"label": new, "prev_label": prev, "confidence": 0.8}}
    user = {"positions": [{"symbol": "X"}], "watch_syms": []}
    [cand] = rules.rule_regime_flip(ctx, user)
    assert vrc.REGIME_DISPLAY[prev] in cand.headline
    assert vrc.REGIME_DISPLAY[new] in cand.headline
    assert cand.dedup_key == f"REGIME:{new}", "dedup stays keyed on the ID, never the words"
    monkeypatch.setitem(vrc.REGIME_DISPLAY, new, "MOVED")
    [cand] = rules.rule_regime_flip(ctx, user)
    assert "MOVED" in cand.headline


# ── no surface restates the vocabulary's WORDS ───────────────────────────────

def _code_strings(source: str) -> list[str]:
    tree = ast.parse(source)
    doc = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            b = node.body
            if b and isinstance(b[0], ast.Expr) and isinstance(b[0].value, ast.Constant):
                doc.add(id(b[0].value))
    return [n.value for n in ast.walk(tree)
            if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in doc]


def test_no_api_module_restates_a_display_word():
    """TERM-071's scan covers the IDS; this covers the WORDS members read. A
    display string typed outside the authority is a second vocabulary."""
    words = set(_module_literal("REGIME_DISPLAY").values()) | {_module_literal("REGIME_UNKNOWN_LABEL")}
    # a lone word that is also ordinary English is only evidence as an exact
    # string; the compound ("Bull trend") is evidence anywhere.
    offenders = {}
    for path in sorted((_REPO / "api").rglob("*.py")):
        if path.name.startswith("test_") or "tests" in path.parts or path == _AUTHORITY:
            continue
        hits = [s for s in _code_strings(path.read_text(encoding="utf-8"))
                if s in words and " " in s]
        if hits:
            offenders[path.relative_to(_REPO).as_posix()] = hits
    assert not offenders, f"read the words from label_of() in the authority: {offenders}"


def test_no_frontend_module_restates_a_regime_id_or_word():
    """The frontend renders what the server sends (`label`, `regime_label`). A
    quoted regime id or compound display word in app/src is a second copy."""
    ids = [r for r in _module_literal("REGIMES") if "_" in r]
    words = [w for w in _module_literal("REGIME_DISPLAY").values() if " " in w]
    pat = re.compile(r"""['"`](%s)['"`]""" % "|".join(re.escape(x) for x in ids + words))
    offenders = []
    for path in sorted((_REPO / "app/src").rglob("*")):
        if path.suffix not in (".js", ".jsx", ".ts", ".tsx") or ".test." in path.name:
            continue
        if pat.search(path.read_text(encoding="utf-8", errors="replace")):
            offenders.append(path.relative_to(_REPO).as_posix())
    assert not offenders, offenders
    # non-vacuity: the pattern does match a restatement
    assert pat.search("const X = '%s'" % ids[0]) and pat.search('"%s"' % words[0])
