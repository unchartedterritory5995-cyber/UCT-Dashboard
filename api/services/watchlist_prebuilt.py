"""Seed the admin-curated 'Delisted Legends' prebuilt watchlist — the flagship UCT list
in the Watchlist picker's Prebuilt tab. Every symbol is a delisted-registry key, so opening
the list and clicking a row charts the dead company via the frozen delisted serve path
(date-clamped, no live-path interference).

Idempotent: creates the list once, and on every boot tops it up with any newly-added
legends. Runs on a startup background thread (needs the admin user to exist)."""
import logging
import os

from api.services import auth_service
from api.services import watchlist_service as wl

_log = logging.getLogger(__name__)

_LIST_NAME = "Delisted Legends"
_LIST_DESC = (
    "The most iconic companies that no longer trade — the 2008 financial giants "
    "(Lehman, Bear Stearns, Merrill, Countrywide) and fallen tech/consumer titans "
    "(Yahoo, Twitter, VMware, RadioShack, Borders). Historical study charts."
)

# All verified chartable via Massive (2004+), each ending at its delisting date.
# 'BSC-OLD' is the reuse-disambiguated key for Bear Stearns (bare 'BSC' is a live ETN).
DELISTED_LEGENDS = [
    # 2008 financial crisis
    "LEH", "BSC-OLD", "MER", "CFC", "NCC",
    # tech / internet
    "YHOO", "TWTR", "ATVI", "LNKD", "RHT", "VMW", "TWX", "TWC", "NUAN",
    # semiconductors
    "XLNX", "LLTC", "MXIM", "FSL",
    # pharma / healthcare
    "CELG", "WYE", "HSP", "AGN",
    # retail / consumer
    "BGP", "RSH", "HNZ", "WWY", "JCP", "LIZ",
    # media / entertainment
    "MVL", "TPUB",
    # industrial / airlines / energy
    "DPH", "NWA", "XTO", "BJS",
]


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


def seed_delisted_legends() -> None:
    try:
        # Already present? Top it up with any new legends (idempotent) and return.
        for w in wl.list_prebuilt_watchlists(200):
            if (w.get("name") or "").strip().lower() == _LIST_NAME.lower():
                owner = w.get("user_id")
                if owner:
                    wl.bulk_add_items(owner, w["id"], DELISTED_LEGENDS)
                return

        admin = _admin_user_id()
        if not admin:
            _log.info("[prebuilt] no admin user yet — 'Delisted Legends' seed deferred to next boot")
            return
        created = wl.create_watchlist(admin, _LIST_NAME, _LIST_DESC, is_public=True)
        if not created:
            return
        wl.bulk_add_items(admin, created["id"], DELISTED_LEGENDS)
        wl.update_watchlist(admin, created["id"], {"is_prebuilt": 1})
        _log.info("[prebuilt] seeded 'Delisted Legends' with %d tickers", len(DELISTED_LEGENDS))
    except Exception as e:
        _log.warning("[prebuilt] delisted-legends seed failed: %s", e)
