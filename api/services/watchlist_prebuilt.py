"""Seed the admin-curated PREBUILT watchlists shown in the Watchlist picker's Prebuilt tab.

Currently one list: 'Liquid Major ETFs' — the ~200 most liquid US ETFs by dollar volume
(SPY, QQQ, SOXL, TLT, IWM…), from tools/rank_prebuilt_etfs. Idempotent + self-healing:
on every boot it (1) deletes any retired lists (e.g. the removed 'Delisted Legends', so it
can never linger or reappear) and (2) ensures the ETF list exists and is topped up.

Runs on a startup background thread (needs the admin user to exist)."""
import json
import logging
import os

from api.services import auth_service
from api.services import watchlist_service as wl

_log = logging.getLogger(__name__)

_ETF_LIST_NAME = "Liquid Major ETFs"
_ETF_LIST_DESC = (
    "The most liquid US ETFs by dollar volume — broad market, sectors, factors, "
    "leveraged/inverse, thematic, bonds and commodities."
)
_ETF_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "prebuilt_etfs.json")

# Prebuilt lists that were removed — deleted on every seed pass so a stale row can't reappear.
_RETIRED_NAMES = {"delisted legends"}


def _admin_user_id():
    for em in (os.environ.get("ADMIN_EMAILS", "") or "").split(","):
        em = em.strip()
        if not em:
            continue
        try:
            u = auth_service.get_user_by_email(em)
        except Exception:
            u = None
        if u and u.get("id"):
            return u["id"]
    return None


def _load_etfs():
    try:
        with open(_ETF_PATH, encoding="utf-8") as fh:
            return [str(t).upper() for t in json.load(fh) if t]
    except Exception:
        return []


def _find_prebuilt(name_lower):
    for w in wl.list_prebuilt_watchlists(500):
        if (w.get("name") or "").strip().lower() == name_lower:
            return w
    return None


def seed_prebuilt_watchlists() -> None:
    try:
        # 1. Delete retired prebuilt lists (they must not linger or reappear).
        for nm in _RETIRED_NAMES:
            w = _find_prebuilt(nm)
            while w:
                owner = w.get("user_id")
                if owner:
                    wl.delete_watchlist(owner, w["id"])
                nxt = _find_prebuilt(nm)
                w = nxt if (nxt and nxt.get("id") != w.get("id")) else None

        # 2. Ensure 'Liquid Major ETFs' exists + is topped up.
        etfs = _load_etfs()
        existing = _find_prebuilt(_ETF_LIST_NAME.lower())
        if existing:
            if etfs and existing.get("user_id"):
                wl.bulk_add_items(existing["user_id"], existing["id"], etfs)
            return
        admin = _admin_user_id()
        if not admin or not etfs:
            if not admin:
                _log.info("[prebuilt] no admin user yet — ETF seed deferred to next boot")
            return
        created = wl.create_watchlist(admin, _ETF_LIST_NAME, _ETF_LIST_DESC, is_public=True)
        if not created:
            return
        wl.bulk_add_items(admin, created["id"], etfs)
        wl.update_watchlist(admin, created["id"], {"is_prebuilt": 1})
        _log.info("[prebuilt] seeded 'Liquid Major ETFs' with %d ETFs", len(etfs))
    except Exception as e:
        _log.warning("[prebuilt] seed failed: %s", e)
