from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from api.services import strategy_templates as st
from api.services import bars_sqlite
from api.services import backtest_engine, backtest_stats


router = APIRouter(prefix="/api/backtest", tags=["backtest"])


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
def list_strategies_endpoint():
    return {"strategies": st.list_strategies()}


@router.post("")
def run_backtest(body: BacktestRequest):
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
