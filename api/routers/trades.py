import json
import os
import uuid
from datetime import date as date_type
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

# Resolves to <worktree>/data/trades.json — "data/" is gitignored (runtime data)
TRADES_FILE = os.path.join(
    os.path.dirname(__file__), "..", "..", "data", "trades.json"
)


def _load() -> list:
    if not os.path.exists(TRADES_FILE):
        return []
    with open(TRADES_FILE) as f:
        return json.load(f)


def _save(trades: list) -> None:
    os.makedirs(os.path.dirname(TRADES_FILE), exist_ok=True)
    with open(TRADES_FILE, "w") as f:
        json.dump(trades, f, indent=2)


class Trade(BaseModel):
    sym: str
    entry: float
    stop: float
    target: float
    size_pct: float
    notes: Optional[str] = ""
    setup: Optional[str] = ""
    date: Optional[str] = ""  # ISO date string e.g. "2026-03-19"


@router.get("/api/trades")
def get_trades():
    return _load()


@router.post("/api/trades")
def add_trade(trade: Trade):
    trades = _load()
    new_trade = {
        **trade.model_dump(),
        "id": str(uuid.uuid4())[:8],
        "status": "open",
        "date": trade.date or str(date_type.today()),
    }
    trades.append(new_trade)
    _save(trades)
    return new_trade
