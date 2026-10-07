"""Standalone DARK app for shadow work -- never the production app.

    MCAP_PIT_V1_BUILD=... MCAP_PIT_V1_PRICES=... uvicorn api.services.marketcap.dark_app:app --port 8766 --host 127.0.0.1
"""
from fastapi import FastAPI

from .serve import router


def create_app() -> FastAPI:
    a = FastAPI(title="Market Cap PIT Share State V1 (dark)")
    a.include_router(router())
    return a


app = create_app()
