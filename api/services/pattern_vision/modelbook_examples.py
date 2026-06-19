"""Few-shot reference charts: render a couple of hand-labeled Model Book examples
per setup so the vision judge benchmarks against the firm's own gold standards,
not just a written definition.

Everything is fail-open: any missing data → that example (or the whole set) is
skipped, and judging falls back to rubric-only. Rendered PNGs are cached in
memory (examples are static), gated by PATTERN_VISION_FEWSHOT_ENABLED.
"""
import logging
import os

from . import chart_render
from .eval import _norm  # Model Book display-name -> engine setup id
from .rubrics import FOCUSED_SETUPS

log = logging.getLogger(__name__)

_GRADE_RANK = {"A+": 0, "A": 1, "B": 2, "C": 3, "F": 4}
_EXAMPLES_BY_SETUP = None        # {setup_id: [example dict, ...]}  (lazy, cached)
_PNG_CACHE: dict[str, list] = {}  # {setup_id: [png bytes, ...]}


def _enabled() -> bool:
    return os.environ.get("PATTERN_VISION_FEWSHOT_ENABLED", "1") == "1"


def _n() -> int:
    try:
        return max(0, int(os.environ.get("PATTERN_VISION_FEWSHOT_N", "2")))
    except ValueError:
        return 2


def _collect_examples() -> dict:
    """Build {setup_id: [{symbol,label_date,timeframe,entry_price,grade}]} from the
    Model Book, best grades first. Cached after first build."""
    global _EXAMPLES_BY_SETUP
    if _EXAMPLES_BY_SETUP is not None:
        return _EXAMPLES_BY_SETUP
    out: dict[str, list] = {s: [] for s in FOCUSED_SETUPS}
    try:
        from api.services import modelbook_service as mb
        for yr in mb.list_years():
            for stk in (mb.get_stocks_for_year(yr) or []):
                detail = mb.get_stock_detail(stk["id"]) or {}
                sym = detail.get("symbol")
                if not sym:
                    continue
                for su in detail.get("setups", []):
                    sid = _norm(su.get("setup_type"))
                    if sid and sid in out and su.get("label_date"):
                        out[sid].append({
                            "symbol": sym, "label_date": su.get("label_date"),
                            "timeframe": su.get("timeframe") or "D",
                            "entry_price": su.get("entry_price"),
                            "grade": su.get("grade") or "B",
                        })
    except Exception as e:
        log.warning("[pv-examples] collect failed: %s", e)
    for sid in out:
        out[sid].sort(key=lambda e: _GRADE_RANK.get(e.get("grade"), 5))
    _EXAMPLES_BY_SETUP = out
    return out


def _date_to_int(label_date: str):
    try:
        return int(str(label_date).replace("-", "")[:8])
    except (TypeError, ValueError):
        return None


def _render_example(ex: dict, window: int) -> bytes:
    """Fetch deep history, frame the window ending at the label date, render it."""
    from api.services import bars_sqlite
    target = _date_to_int(ex["label_date"])
    if target is None:
        return b""
    bars = bars_sqlite.get_bars(ex["symbol"], ex.get("timeframe") or "D", 4000) or []
    if len(bars) < 30:
        return b""
    # last bar at/just before the label date
    idx = None
    for i, r in enumerate(bars):
        if int(r[0]) <= target:
            idx = i
        else:
            break
    if idx is None or idx < 25:
        return b""
    sl = bars[max(0, idx - window + 1): idx + 1]
    return chart_render.render_chart(sl, window=len(sl), key_level=ex.get("entry_price"))


def example_pngs(setup: str, window: int = 140) -> list:
    if not _enabled() or _n() == 0 or setup not in FOCUSED_SETUPS:
        return []
    if setup in _PNG_CACHE:
        return _PNG_CACHE[setup]
    pngs = []
    for ex in _collect_examples().get(setup, []):
        if len(pngs) >= _n():
            break
        try:
            png = _render_example(ex, window)
        except Exception as e:
            log.debug("[pv-examples] render %s/%s failed: %s", setup, ex.get("symbol"), e)
            continue
        if png:
            pngs.append(png)
    _PNG_CACHE[setup] = pngs
    return pngs


def reset_cache() -> None:
    """Drop caches (tests / after Model Book edits)."""
    global _EXAMPLES_BY_SETUP
    _EXAMPLES_BY_SETUP = None
    _PNG_CACHE.clear()
