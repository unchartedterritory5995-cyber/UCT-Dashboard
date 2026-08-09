"""Seed the admin-curated PREBUILT watchlists shown in the Watchlist picker's Prebuilt tab.

The full set is data-driven from `api/data/prebuilt_lists.json` (built by
tools/build_prebuilt_lists.py): 'Liquid Major ETFs' plus the curated theme lists
(Sector SPDRs, Broad Market, Industry/Thematic, Country/Region, Commodities, Bonds/Rates,
Crypto, Factor/Smart-Beta). Idempotent + self-healing + MANAGED: on every boot it makes the
prebuilt set match the config EXACTLY — reconciles each configured list (rebuild if its ticker
set drifted or a duplicate exists) and DELETES any prebuilt list not in the config (so a
retired/renamed list — e.g. the removed 'Delisted Legends' — can never linger or reappear).

Runs on a startup background thread (needs the admin user to exist)."""
import json
import logging
import os
from collections import defaultdict

from api.services import auth_service
from api.services import watchlist_service as wl

_log = logging.getLogger(__name__)

_LISTS_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "prebuilt_lists.json")


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


def _load_lists():
    """[{name, desc, tickers[]}] — the authoritative prebuilt set."""
    try:
        with open(_LISTS_PATH, encoding="utf-8") as fh:
            out = []
            for row in json.load(fh):
                name = str(row.get("name") or "").strip()
                tickers = [str(t).upper() for t in (row.get("tickers") or []) if t]
                if name and tickers:
                    out.append({"name": name, "desc": str(row.get("desc") or ""), "tickers": tickers})
            return out
    except Exception:
        return []


def _create_list(admin, name, desc, tickers):
    created = wl.create_watchlist(admin, name, desc, is_public=True)
    if not created:
        return False
    wl.bulk_add_items(admin, created["id"], tickers)
    wl.update_watchlist(admin, created["id"], {"is_prebuilt": 1})
    _log.info("[prebuilt] seeded '%s' with %d tickers", name, len(tickers))
    return True


def seed_prebuilt_watchlists() -> None:
    try:
        lists = _load_lists()
        if not lists:
            return  # no config/data — never wipe live lists
        config = {l["name"].strip().lower(): l for l in lists}

        # Group every existing prebuilt list by lowercased name.
        existing_by_name = defaultdict(list)
        for w in wl.list_prebuilt_watchlists(500):
            existing_by_name[(w.get("name") or "").strip().lower()].append(w)

        # 1. Delete any prebuilt list NOT in the config (retired/renamed — e.g. Delisted Legends).
        for nm, rows in existing_by_name.items():
            if nm not in config:
                for w in rows:
                    if w.get("user_id"):
                        wl.delete_watchlist(w["user_id"], w["id"])

        # 2. Reconcile each configured list — keep exactly one with the right ticker set,
        #    rebuild if the set drifted (bulk_add only ADDS, so removals need a recreate).
        admin = None
        for nm, l in config.items():
            desired = {t.upper() for t in l["tickers"]}
            rows = existing_by_name.get(nm, [])
            keep = None
            for w in rows:
                cur = {(i.get("sym") or "").upper() for i in (w.get("items") or [])}
                if cur == desired and keep is None:
                    keep = w                                  # first correct one stays
                elif w.get("user_id"):
                    wl.delete_watchlist(w["user_id"], w["id"])  # stale set or duplicate → drop
            if keep:
                continue
            if admin is None:
                admin = _admin_user_id()
            if not admin:
                _log.info("[prebuilt] no admin user yet — '%s' seed deferred to next boot", l["name"])
                continue
            _create_list(admin, l["name"], l["desc"], l["tickers"])
    except Exception as e:
        _log.warning("[prebuilt] seed failed: %s", e)
