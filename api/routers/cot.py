"""api/routers/cot.py — COT Data API endpoints.

Routes (read the router, not this list — the count here has been wrong before):
    GET  /api/cot/symbols         → grouped symbol list            — PAID
    GET  /api/cot/status          → last_updated, next refresh, record count — PAID
    POST /api/cot/refresh         → manual refresh (background task) — ADMIN
    POST /api/cot/reseed          → FULL 10-year CFTC re-download    — ADMIN
    GET  /api/cot/{symbol}        → weekly records for a symbol     — PAID

🔴 `/refresh` AND `/reseed` WERE ANONYMOUS. `reseed` downloads and re-parses TEN
YEARS of CFTC zips into `/data/cot.db`; `refresh` re-downloads the current year.
Both were reachable by anybody with a POST and no credential (auth/paywall sweep,
2026-08-09), which is an unbounded-cost DoS with a one-line curl — and `reseed`
rewrites the table the COT tab reads while it is being read. They are ADMIN now,
matching every other "spend real money on the firm's behalf" operation.

The reads are PAID rather than open. The underlying CFTC data is public record,
so "we merely relay it" is a real argument — but what we serve is not the zip: it
is a decade of it parsed, symbol-mapped through `SYMBOL_MAP` + `_CFTC_ALIASES`
(the contract-rename work that makes 10 years line up at all), stored, and kept
fresh by three independent refresh layers we pay for. Its only consumer is
`CotData.jsx` inside the paid Breadth page, so gating costs no member anything.
Owner ruling 2026-08-06: *"everything is paid, almost nothing is accessible for
free."*
"""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from api.middleware.auth_middleware import (
    get_current_user_with_plan,
    is_paid_user,
    require_admin,
)
from api.services import cot_service

router = APIRouter(prefix="/api/cot", tags=["cot"])


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the COT surface.

    ⛔ Defined HERE, not imported. Every router that gates on `require_paid`
    defines its own with its OWN 402 sentence, so "which surface locked me out"
    is readable off the message — the rail on that is
    `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`,
    which fails on an `from … import require_paid` anywhere under `api/routers/`.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="COT data requires a paid plan")
    return user


@router.get("/symbols")
def get_symbols(_user: dict = Depends(require_paid)):
    """Return full grouped symbol list with display names."""
    return {
        "groups": {
            group: [
                {"symbol": s, "name": cot_service.SYMBOL_NAMES.get(s, s)}
                for s in syms
            ]
            for group, syms in cot_service.SYMBOL_GROUPS.items()
        }
    }


@router.get("/status")
def get_status(_user: dict = Depends(require_paid)):
    """Return last refresh timestamp, next scheduled Friday, and total record count."""
    return cot_service.get_status()


@router.post("/refresh")
def manual_refresh(background_tasks: BackgroundTasks,
                   _admin: dict = Depends(require_admin)):
    """Trigger a COT data refresh in the background. Returns immediately."""
    background_tasks.add_task(cot_service.refresh_from_current)
    return {"status": "refresh started"}


@router.post("/reseed")
def force_reseed(background_tasks: BackgroundTasks,
                 _admin: dict = Depends(require_admin)):
    """Force a full historical reseed regardless of current record count."""
    background_tasks.add_task(cot_service.seed_from_historical)
    return {"status": "historical reseed started"}


@router.get("/{symbol}")
def get_cot(symbol: str, weeks: int = 52,
            _user: dict = Depends(require_paid)):
    """Return the last `weeks` weekly COT records for `symbol`, ascending by date."""
    sym = symbol.upper()
    if sym not in cot_service.SYMBOL_MAP:
        raise HTTPException(status_code=404, detail=f"Unknown COT symbol: {sym}")
    if not 1 <= weeks <= 520:
        raise HTTPException(status_code=400, detail="weeks must be between 1 and 520")
    return cot_service.get_cot_data(sym, weeks)
