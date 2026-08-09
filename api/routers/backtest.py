"""The backtest engine.

🔴 BOTH ROUTES WERE ANONYMOUS (auth/paywall sweep, 2026-08-09). `GET /strategies`
publishes the firm's strategy template library — the rules themselves — and
`POST ""` RUNS the engine over up to 5,000 bars on the single web pod, once per
request, for a caller who supplied no credential. That is a compute surface with
no owner, and the sharpest thing on this router.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import strategy_templates as st
from api.services import bars_sqlite
from api.services import backtest_engine, backtest_stats


router = APIRouter(prefix="/api/backtest", tags=["backtest"])


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the backtest engine.

    ⛔ Defined HERE, not imported from a sibling. Every router that gates on
    `require_paid` defines its own with its OWN 402 sentence, so "which surface
    locked me out" is answerable from the message alone. The rail is
    `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`,
    which walks `api/routers/` by AST and fails on a shared import.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Backtesting requires a paid plan")
    return user



class BacktestRequest(BaseModel):
    strategy_id: str
    sym: str
    tf: str
    bars: int = 500
    capital: float = 10000
    position_pct: float = 100
    fees_bps: float = 10
    params: dict | None = None


@router.get("/strategies")
def list_strategies_endpoint(_user: dict = Depends(require_paid)):
    return {"strategies": st.list_strategies()}


@router.post("")
def run_backtest(body: BacktestRequest,
                 _user: dict = Depends(require_paid)):
    # Bound inputs
    if body.bars < 30 or body.bars > 5000:
        raise HTTPException(400, "bars must be between 30 and 5000")
    if body.capital <= 0:
        raise HTTPException(400, "capital must be positive")
    if not (0 < body.position_pct <= 100):
        raise HTTPException(400, "position_pct must be in (0, 100]")
    if body.fees_bps < 0:
        raise HTTPException(400, "fees_bps must be non-negative")

    rows = bars_sqlite.get_bars(body.sym.upper(), body.tf, body.bars)
    if not rows:
        raise HTTPException(404, f"No bars for {body.sym.upper()} {body.tf}")
    bars = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]

    params = body.params or {}
    if body.strategy_id == "rsi_mean_reversion":
        signals = st.generate_rsi_mean_reversion_signals(bars, period=int(params.get("period", 14)))
    elif body.strategy_id == "macd_crossover":
        signals = st.generate_macd_crossover_signals(
            bars,
            fast=int(params.get("fast", 12)),
            slow=int(params.get("slow", 26)),
            signal=int(params.get("signal", 9)),
        )
    elif body.strategy_id == "bb_breakout":
        signals = st.generate_bb_breakout_signals(
            bars,
            period=int(params.get("period", 20)),
            stddev=float(params.get("stddev", 2.0)),
        )
    elif body.strategy_id == "ma_crossover":
        signals = st.generate_ma_crossover_signals(
            bars,
            fast=int(params.get("fast", 50)),
            slow=int(params.get("slow", 200)),
        )
    else:
        raise HTTPException(400, f"Unknown strategy: {body.strategy_id}")

    result = backtest_engine.simulate(bars, signals, body.capital, body.position_pct, body.fees_bps)
    stats = backtest_stats.compute_stats(result["trades"], result["equity_curve"])

    return {
        **result,
        "stats": stats,
        "n_signals": len(signals),
        "strategy": body.strategy_id,
        "sym": body.sym.upper(),
        "tf": body.tf,
    }
