"""MD-1 kind `market.regime` (owner: terminal-data, data wave 7) — UCT's market regime read, as held.

The rules-based market regime classification the server last computed: the regime, its confidence, the sizing band
UCT's own GRADE verdicts read, and the breadth figures behind it: the Agent half of the REGM terminal function, over
the answer of `GET /api/regime` (`api/services/voice_regime_classifier.py`).

⛔ ONLY THE CLASSIFICATION THE SERVER ALREADY HOLDS, NEVER A COMPUTE (MD-1 §5). The route's
`voice_regime_classifier.get_current_regime` RECOMPUTES when nothing is held: it reads breadth (which can go on to a
live fetch) and asks the market-data vendor for a VIX snapshot. A turn must not, so this adapter never calls it. It
reads through `voice_regime_held.held_regime()`, which returns the classification the classifier last stored with
the time it was stored, or None, and never computes. provider_calls is always 0. A rail shows `get_current_regime`
reaching the vendor in the same state.

NOTHING HELD IS SAID, NEVER A GUESSED REGIME: no held classification is `unavailable`; so is the classifier's own
"could not answer" sentinel, and so is a held classification whose inputs were all missing (the classifier still
names a regime then, with nothing behind it).

WHAT IS STATED: the regime id, its member words and its sizing band are the classifier's own vocabulary
(`label_of`, `band_of`); the confidence and the breadth figures are the held ones. A figure the classifier did not
have is null, never 0. The band is relayed as held: it is what UCT's rules read, not advice.

WHAT IS LEFT OUT, AND SAID: the UCT Exposure Rating (the 0 to 150 composite) and the VIX level are in the held
classification and are NOT carried, and a reason line that states either is dropped. `data.left_out` names them and
a note says so.

TIME (MD-1 §3): `as_of` = the time the classifier computed the held classification (never the time of the read).
The breadth figures behind it carry no date of their own in the held classification, and a note says so. The server
recomputes at most every 15 minutes and drops the classification after that, so a held one is never older; every
read is `periodic`, as the kind is declared.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the licensing register
(docs/terminal-research/09-security-licensing-cost/licensing-register.md) row T-11 covers breadth and the other
derived analytics as restricted, row T-12 says of the composites (the Exposure Rating among them) "do not add new
composite publications until answered", and row T-14 is the vendor's numbers into a model, restricted. None of the
three clears a regime read built on those figures for a model provider, and no other row does. Shown to the member
only; the capability is local-only.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _num

KIND = "market.regime"
SOURCE = "uct-regime-classifier"
#: the breadth figures carried, by the classifier's own signal names (a rail pins them to the REGM panel's fields)
SIGNALS = ("pct_above_50ma", "pct_above_200ma", "new_highs", "new_lows", "distribution_days")
#: held by the classifier and NOT carried (see the module docstring)
LEFT_OUT = ("uct_exposure_rating", "vix")
#: every number the classifier votes on: when all of them are missing its regime has nothing behind it
INPUTS = ("pct_above_50ma", "pct_above_200ma", "new_highs", "new_lows", "distribution_days", "breadth_score",
          "uct_exposure_rating", "vix")
#: a reason line that states a left-out figure starts with one of these (the classifier's own wording)
LEFT_OUT_REASONS = ("UCT exposure ", "VIX ")
MAX_REASONS = 6             # the classifier keeps six at most; a ceiling, so a malformed answer cannot be unbounded
MAX_REASON_CHARS = 120

NOTE_WHAT = ("UCT's market regime read, as the server last computed it: a rules-based classification from market "
             "breadth and VIX, with the sizing band UCT's own GRADE verdicts read. It is what UCT's rules read, not "
             "advice and not a forecast")
NOTE_AS_OF = ("`as_of` is the time the server computed this read ({at}); it is never the time of this read. The "
              "breadth figures behind it carry no date of their own in the held read. The server recomputes at most "
              "every 15 minutes, and this read never recomputes")
NOTE_LEFT_OUT = ("the UCT Exposure Rating and the VIX level are part of the held read and are left out of this "
                 "answer, with the {n} reason lines that state them. The Market regime panel (REGM) in UCT shows "
                 "them")
NOTE_MISSING = ("{n} breadth figures were not available to the classifier and are null, never 0: {list}")
NOTE_NOT_HELD = ("no regime read is held on this server at the moment, and this read never computes one. That is "
                 "not the same as no regime. Open the Market regime panel (REGM) in UCT, then ask again")
NOTE_UNKNOWN = ("the classifier could not read its inputs, so the held read names no regime and no band; nothing is "
                "stated")
NOTE_FAILED = "the regime read failed; nothing is stated. That is not the same as no regime"

SIGNAL_WORDS = {"pct_above_50ma": "percent of stocks above the 50-day average",
                "pct_above_200ma": "percent of stocks above the 200-day average", "new_highs": "new highs",
                "new_lows": "new lows", "distribution_days": "distribution days"}


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission. The regime read takes no argument."""
    if not isinstance(params, dict):
        return "the request must be an object"
    return None


def held_answer() -> Optional[tuple[dict, float]]:
    """(the classification the classifier already holds, when it was computed) or None, WITHOUT computing one."""
    from api.services import voice_regime_held as svc
    return svc.held_regime()


def vocabulary() -> tuple[tuple, Any, Any, int]:
    """The classifier's own closed vocabulary: (the regime ids, label_of, band_of, the version)."""
    from api.services import voice_regime_classifier as vrc
    return tuple(vrc.REGIMES), vrc.label_of, vrc.band_of, vrc.REGIME_VOCABULARY_VERSION


def read_regime(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    try:
        got = held_answer()                                    # the held classification only: never a compute
        regimes, label_of, band_of, version = vocabulary()
    except Exception:  # noqa: BLE001 — a failing read is an honest unavailable, never "no regime"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if got is None:
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    try:
        held, computed_at = got
        at = env.utc_iso(datetime.fromtimestamp(float(computed_at), tz=timezone.utc))
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if not isinstance(held, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    regime = held.get("regime")
    signals = held.get("signals") if isinstance(held.get("signals"), dict) else {}
    confidence = _num(held.get("confidence"))
    if regime not in regimes or held.get("error") or confidence is None \
            or all(_num(signals.get(k)) is None for k in INPUTS):
        return env.unavailable(KIND, params, SOURCE, NOTE_UNKNOWN)

    carried = {k: _num(signals.get(k)) for k in SIGNALS}       # not available to the classifier: null, never 0
    phase = signals.get("market_phase")
    all_reasons = [r for r in (held.get("reasons") or []) if isinstance(r, str) and r.strip()] \
        if isinstance(held.get("reasons"), list) else []
    reasons = [r.strip()[:MAX_REASON_CHARS] for r in all_reasons if not r.startswith(LEFT_OUT_REASONS)][:MAX_REASONS]
    dropped = sum(1 for r in all_reasons if r.startswith(LEFT_OUT_REASONS))
    missing = [SIGNAL_WORDS[k] for k in SIGNALS if carried[k] is None]

    notes = [NOTE_WHAT, NOTE_AS_OF.format(at=at), NOTE_LEFT_OUT.format(n=dropped)]
    if missing:
        notes.append(NOTE_MISSING.format(n=len(missing), list=", ".join(missing)))

    # `regime` / `label` / `confidence` / `signals` / `reasons` / `vocabulary_version` keep the route's own names
    data = {"regime": regime, "label": label_of(regime), "band": band_of(regime), "confidence": confidence,
            "signals": {**carried, "market_phase": phase.strip() if isinstance(phase, str) and phase.strip() else None},
            "reasons": reasons, "reasons_left_out": dropped, "left_out": list(LEFT_OUT),
            "vocabulary_version": version, "computed_at": at}
    answered = len(SIGNALS) - len(missing)
    coverage = {"evaluated": len(SIGNALS), "answered": answered, "dropped": 0, "not_computable": len(missing)}
    return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=at, source=SOURCE, data=data,
                             stale=False, coverage=coverage, notes=notes, provider_calls=0)
