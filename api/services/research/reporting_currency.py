"""The currency a company REPORTS in, for labelling figures that are not dollars.

A US-listed ADR trades in US dollars, but its statements and the analyst
consensus on them are in the company's own currency: FMP returns TSMC's FY2026
consensus EPS as 535.87 and revenue as 5.40T — Taiwan dollars — and the EE
panel printed them as "$535.87" and "$5.40T" (seen live 2026-10-06). TM is in
yen, BABA in yuan, NVO in kroner, ASML in euros.

FMP's analyst-estimates rows carry no currency field. Its income statements do
(`reportedCurrency`), and the consensus is on the same basis as the statements
(TSM's 5.40T consensus revenue sits beside 4.44T of reported TWD revenue), so the
newest annual income statement is the source. Nothing here converts: a per-share
figure would also need the ADR ratio (one TSM ADR = 5 ordinary shares), which
nothing in this codebase holds, so the honest move is to SAY which currency a
figure is in rather than print a converted guess.

`read()` returns ("ok", "TWD") / ("ok", None) when FMP answered without saying /
("error", None) when it did not answer. Cached per symbol; never raises.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services import fmp_client

SOURCE = "FMP /stable/income-statement reportedCurrency"
_TTL_OK = 24 * 3_600        # a company's reporting currency changes almost never
_TTL_ERROR = 600


def _cache():
    from api.services.cache import cache
    return cache


def normalize(code: Any) -> Optional[str]:
    """'twd ' -> 'TWD'; anything that is not a 3-letter code -> None."""
    if not isinstance(code, str):
        return None
    c = code.strip().upper()
    return c if len(c) == 3 and c.isalpha() else None


def is_foreign(code: Any) -> bool:
    """True when figures in `code` are known NOT to be US dollars."""
    c = normalize(code)
    return c is not None and c != "USD"


def from_statement_rows(rows: Any) -> Optional[str]:
    """`reportedCurrency` of the newest dated row that states one."""
    if not isinstance(rows, list):
        return None
    dated = [r for r in rows if isinstance(r, dict)]
    dated.sort(key=lambda r: str(r.get("date") or ""), reverse=True)
    for r in dated:
        c = normalize(r.get("reportedCurrency"))
        if c:
            return c
    return None


def read(sym: str, timeout: int = 10) -> tuple[str, Optional[str]]:
    sym = (sym or "").upper().strip()
    if not sym:
        return "ok", None
    ck = f"reporting_currency::v1::{sym}"
    hit = _cache().get(ck)
    if hit is not None:
        return tuple(hit)  # type: ignore[return-value]
    try:
        res = fmp_client.get_income_statement(sym, period="annual", limit=1, timeout=timeout)
        out = ("error", None) if res.degraded is not None else ("ok", from_statement_rows(res.value))
    except fmp_client.FMPNotFound:
        out = ("ok", None)
    except Exception:  # noqa: BLE001 -- an unread currency is "unknown", never a guess
        out = ("error", None)
    _cache().set(ck, list(out), _TTL_OK if out[0] == "ok" else _TTL_ERROR)
    return out
