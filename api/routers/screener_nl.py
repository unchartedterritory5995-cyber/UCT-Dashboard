"""POST /api/screener/compile -- plain English to a finished screen (FT-024/030).

404 unless BOTH `SCREENER_NL_COMPILE_ENABLED` and `SCREENER_LOGIC_ENABLED` are
on: the compile's output is a `logic` tree, which the screener refuses while
the logic surface is dark, so a compile door without it would hand the member
a screen they cannot run. Paid (402). Metered per member and per population.
Plain `def`: it blocks on the model, so FastAPI runs it in the threadpool,
bounded by the shared client's timeout with zero SDK retries.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The screener requires a paid plan")
    return user


def _armed() -> None:
    from api.services.screener import logic, nl_compile
    if not (nl_compile.is_enabled() and logic.is_enabled()):
        raise HTTPException(status_code=404, detail="Not Found")


class CompileIn(BaseModel):
    text: str


@router.get("/api/screener/compile", dependencies=[Depends(_armed)])
def compile_available(user: dict = Depends(require_paid)):
    from api.services import daily_counters
    from api.services.screener import nl_compile
    used = int(daily_counters.value(nl_compile._et_day(), nl_compile.SCOPE, str(user["id"])))
    return {"available": True, "used": used, "cap": nl_compile.daily_cap()}


@router.post("/api/screener/compile", dependencies=[Depends(_armed)])
def compile_screen(body: CompileIn, user: dict = Depends(require_paid)):
    from api.services import ai_population_cap
    from api.services.screener import nl_compile
    uid = user["id"]
    if not nl_compile.take(uid):
        raise HTTPException(status_code=429, detail=nl_compile.CAP_SENTENCE)
    refusal = ai_population_cap.admit("screener_nl")
    if refusal:
        nl_compile.give_back(uid)
        raise HTTPException(status_code=429, detail=refusal)
    try:
        return nl_compile.compile_english(body.text)
    except nl_compile.CompileError as e:
        nl_compile.give_back(uid)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001 -- a provider failure is a sentence, not a 500
        nl_compile.give_back(uid)
        raise HTTPException(status_code=503,
                            detail=f"Plain-English screens are unavailable right now ({type(e).__name__}).")
