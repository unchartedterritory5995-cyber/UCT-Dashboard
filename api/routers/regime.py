"""
Live market regime endpoint — the voice regime classifier's output.

GET /api/regime             →  {regime, label, confidence, reasons[], signals{},
                                narration, vocabulary_version}
GET /api/regime/vocabulary  →  the CLOSED, VERSIONED regime vocabulary (TERM-041):
                                {version, closed, regimes[{id,label,band}], bands[],
                                 band_default, unknown{id,label,band}}

⚠️ Corrected 2026-09-29 (TERM-041): this docstring said the endpoint was "read by
the Dashboard's regime panel". `app/src` has no reader of `/api/regime` today; its
readers are server-side (voice, grade_ticker, portfolio_heat) through the service.

⛔ Both routes return ONLY words from the authority's published vocabulary — a
failed classifier returns the declared REGIME_UNKNOWN sentinel, never a label this
router types for itself (`tests/test_regime_vocabulary.py`).

🔴 WAS ANONYMOUS (auth/paywall sweep, 2026-08-09), and its own docstring called
itself *"public-ish"* — a description of the accident, not a ruling. The regime
LABEL is the top of the firm's decision stack: `grade_ticker` gates every verdict
on it, `size_a_trade` scales position size by it, and `reasons[]`/`signals{}`
publish the classifier's inputs and its logic. PAID.

⚠️ `?fresh=1` forces a recompute past the 15-minute cache, which is a
caller-controlled cost — a second reason not to leave this open.
"""

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the market-regime classifier.

    ⛔ Defined HERE, not imported from a sibling. Every router that gates on
    `require_paid` defines its own with its OWN 402 sentence, so "which surface
    locked me out" is answerable from the message alone. The rail is
    `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`,
    which walks `api/routers/` by AST and fails on a shared import.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The regime classifier requires a paid plan")
    return user



@router.get("/api/regime")
def regime_get(fresh: bool = False,
               _user: dict = Depends(require_paid)):
    """Return the current market regime classification. 15-min cached
    server-side; pass ?fresh=1 to force a recompute."""
    from api.services import voice_regime_classifier as vrc
    try:
        return vrc.get_current_regime(fresh=fresh)
    except Exception as e:  # noqa: BLE001
        # Graceful fallback so a reader can render an empty/error state — with
        # the authority's DECLARED sentinel, never a label invented here.
        return {
            "regime": vrc.REGIME_UNKNOWN,
            "label": vrc.REGIME_UNKNOWN_LABEL,
            "confidence": 0.0,
            "reasons": [],
            "signals": {},
            "narration": "Regime classifier unavailable.",
            "vocabulary_version": vrc.REGIME_VOCABULARY_VERSION,
            "error": str(e),
        }


@router.get("/api/regime/vocabulary")
def regime_vocabulary_get(_user: dict = Depends(require_paid)):
    """The published regime vocabulary (TERM-041 / FB-A11-02): the closed enum
    of regime ids, in order, with each one's words and sizing band, plus the
    "could not answer" sentinel and a version that changes only deliberately.
    Served straight from the authority — never restated here."""
    from api.services.voice_regime_classifier import regime_vocabulary
    return regime_vocabulary()
