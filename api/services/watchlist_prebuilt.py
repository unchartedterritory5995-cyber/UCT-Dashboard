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
# Every committed prebuilt config file (ETF lists only — the thematic lists were reverted).
_CONFIG_PATHS = [_LISTS_PATH]
# Durable overlay written by the monthly auto-refresh (watchlist_prebuilt_refresh):
# a fresh liquidity ranking for 'Liquid Major ETFs' + a delisted-ticker set pruned from
# EVERY list. Survives deploys. Absent = pure committed config (first boot before a refresh).
_OVERLAY_PATH = os.path.join(os.environ.get("DATA_DIR", "/data"), "prebuilt_lists_overlay.json")
_LIQUID_NAME = "liquid major etfs"

# The auto-maintained community lists built from the Desk's Sunday Scans issues:
# ONE DATED LIST PER ISSUE, the newest SUNDAY_SCANS_KEEP kept — a rolling
# one-quarter look-back. Their SOURCE is the desk store, not the committed config,
# so the seeder must never treat "source unreadable right now" as "retired": the
# whole family (any name starting with SUNDAY_SCANS_NAME — dated, or the legacy
# undated list) is exempt from the delete-what-isn't-configured step, and
# retention is pruned by the family's own reconcile, BY ISSUE DATE.
SUNDAY_SCANS_NAME = "Sunday Scans"
SUNDAY_SCANS_KEEP = 12
# A widget pinned to a dated list stays on that issue. The NEWEST issue's list also
# carries this stable alias, so a widget pinned to `community:alias:<alias>` follows
# each new issue as it lands (resolved client-side by pages/watchlist/communityPick.js).
SUNDAY_SCANS_LATEST_ALIAS = "sunday-scans-latest"
SUNDAY_SCANS_LATEST_LABEL = f"{SUNDAY_SCANS_NAME} — Latest issue"
_COMMUNITY_CATEGORY = "UCT Community"
_ISSUE_DATE_FMT = "%B %d, %Y"          # "August 16, 2026" — the article's own date style
_NAME_SEP = " — "


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


_DEFAULT_CATEGORY = "UCT ETF Lists"


def _load_committed():
    """[{name, desc, category, tickers[]}] from every committed config file (ETF + theme
    lists) — the curated baseline the overlay is layered onto."""
    out = []
    for path in _CONFIG_PATHS:
        try:
            with open(path, encoding="utf-8") as fh:
                for row in json.load(fh):
                    name = str(row.get("name") or "").strip()
                    tickers = [str(t).upper() for t in (row.get("tickers") or []) if t]
                    if name and tickers:
                        out.append({
                            "name": name,
                            "desc": str(row.get("desc") or ""),
                            "category": str(row.get("category") or _DEFAULT_CATEGORY),
                            "tickers": tickers,
                        })
        except Exception:
            continue
    out.extend(_breadth_lists())
    out.extend(sunday_scans_specs())
    return out


# ── The Sunday Scans family: one dated list per issue ────────────────────────

def _issue_day(published_at):
    """The issue's calendar date in ET (an 11pm-Saturday publish is still Saturday)."""
    from datetime import datetime, timezone
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo("America/New_York")
    except Exception:
        tz = timezone.utc
    return datetime.fromtimestamp(int(published_at), tz).date()


def _name_for_day(day) -> str:
    label = day.strftime(_ISSUE_DATE_FMT).replace(" 0", " ")
    return f"{SUNDAY_SCANS_NAME}{_NAME_SEP}{label}"


def sunday_scans_list_name(row) -> str:
    """'Sunday Scans — August 16, 2026' for a desk post row ({published_at, …}).
    The ONE owner of the family's name format; _issue_date_from_name is its
    inverse (retention prunes by the date parsed back out of the name), and the
    article audit derives the expected name from here rather than restating it."""
    return _name_for_day(_issue_day(row["published_at"]))


def _is_sunday_family(name) -> bool:
    return (name or "").strip().lower().startswith(SUNDAY_SCANS_NAME.lower())


def _issue_date_from_name(name):
    """The issue date carried by a dated family list name; None for the legacy
    undated list or anything that isn't one of ours."""
    from datetime import datetime
    nm = (name or "").strip()
    if not _is_sunday_family(nm):
        return None
    tail = nm[len(SUNDAY_SCANS_NAME):]
    sep = _NAME_SEP.strip()
    if not tail.strip().startswith(sep):
        return None
    try:
        return datetime.strptime(tail.strip()[len(sep):].strip(), _ISSUE_DATE_FMT).date()
    except ValueError:
        return None


def sunday_scans_specs() -> list:
    """One dated list spec per issue, newest first: the newest SUNDAY_SCANS_KEEP
    Sunday Scans issues that carry a roster ('Charts Covered' heading + chart
    labels, in the author's own order). [] when the desk store is unavailable —
    callers must treat that as 'leave the existing lists alone', never 'delete
    them'."""
    try:
        from api.services import desk_store
        rows = desk_store.sunday_scans_posts(SUNDAY_SCANS_KEEP) or []
    except Exception:
        return []
    specs = []
    for row in list(rows)[:SUNDAY_SCANS_KEEP]:
        try:
            tickers = [str(t).upper() for t in (row.get("tickers") or []) if t]
            if not tickers:
                continue
            day = _issue_day(row["published_at"])
        except Exception:
            continue
        name = _name_for_day(day)
        label = name[len(SUNDAY_SCANS_NAME) + len(_NAME_SEP):]
        specs.append({
            "name": name,
            "desc": (f"Every chart from the Sunday Scans issue of {label} — the community "
                     f"keeps the last {SUNDAY_SCANS_KEEP} issues, one list each."),
            "category": _COMMUNITY_CATEGORY,
            "tickers": tickers,
            "issue_date": day.isoformat(),
            "published_at": int(row["published_at"]),
        })
    return specs


def issue_date_map():
    """{lowercased list name: 'YYYY-MM-DD'} for the DATED prebuilt lists (the
    Sunday Scans archive) — the picker orders those newest-first instead of A→Z."""
    return {l["name"].strip().lower(): l["issue_date"]
            for l in _load_committed() if l.get("issue_date")}


def alias_map():
    """{lowercased list name: {"alias", "label"}} — the stable alias the NEWEST
    Sunday Scans issue carries (exactly one row, or none when the store is
    unavailable), so a widget can pin "the latest issue" rather than a date."""
    specs = sunday_scans_specs()
    if not specs:
        return {}
    newest = max(specs, key=lambda s: s["issue_date"])
    return {newest["name"].strip().lower():
            {"alias": SUNDAY_SCANS_LATEST_ALIAS, "label": SUNDAY_SCANS_LATEST_LABEL}}


def _reconcile_sunday_family(existing) -> dict:
    """Make the prebuilt store's Sunday Scans family match the specs: create a
    missing issue list, rebuild one whose ticker set drifted (set comparison,
    delete-and-recreate — bulk_add only ADDS), keep exactly one per issue, and
    RETIRE what fell out of the window: the legacy undated list, plus — only once
    the store can fill the whole window — any dated list older than the oldest
    kept issue. A dated list inside the window with no spec (its post gone from
    the store) is left standing: the failure direction is stale-persists.

    ONE owner for the boot seeder and the hourly poller. `existing` = the
    prebuilt rows as already listed by the caller."""
    specs = sunday_scans_specs()
    if not specs:
        return {"status": "unavailable"}
    family = [w for w in existing if _is_sunday_family(w.get("name"))]
    oldest_kept = (min(s["issue_date"] for s in specs)
                   if len(specs) >= SUNDAY_SCANS_KEEP else None)
    pruned = rebuilt = current = 0
    standing = []
    for w in family:
        d = _issue_date_from_name(w.get("name"))
        retire = d is None or (oldest_kept is not None and d.isoformat() < oldest_kept)
        if retire and w.get("user_id"):
            wl.delete_watchlist(w["user_id"], w["id"])
            pruned += 1
        else:
            standing.append(w)
    admin = None
    for spec in specs:
        nm = spec["name"].strip().lower()
        desired = {t.upper() for t in spec["tickers"]}
        keep = None
        for w in standing:
            if (w.get("name") or "").strip().lower() != nm:
                continue
            cur = {(i.get("sym") or "").upper() for i in (w.get("items") or [])}
            if cur == desired and keep is None:
                keep = w                                   # first correct one stays
            elif w.get("user_id"):
                wl.delete_watchlist(w["user_id"], w["id"])   # drifted set or duplicate → drop
                pruned += 1
        if keep:
            current += 1
            continue
        if admin is None:
            admin = _admin_user_id()
        if not admin:
            return {"status": "no_admin", "lists": len(specs),
                    "current": current, "rebuilt": rebuilt, "pruned": pruned}
        _create_list(admin, spec["name"], spec["desc"], spec["tickers"])
        rebuilt += 1
    return {"status": "rebuilt" if (rebuilt or pruned) else "current",
            "lists": len(specs), "current": current, "rebuilt": rebuilt, "pruned": pruned}


def sync_sunday_scans() -> dict:
    """Reconcile the Sunday Scans family against the desk store — the hourly
    path (the substack poller calls it right after storing a new issue's
    roster, so the new list lands within the hour; the boot seeder runs the
    same reconcile). Fail-soft: an unreadable source returns 'unavailable'
    and touches nothing."""
    try:
        return _reconcile_sunday_family(wl.list_prebuilt_watchlists(500))
    except Exception as e:
        _log.warning("[prebuilt] sunday-scans sync failed: %s", e)
        return {"status": "error", "error": str(e)[:200]}


_BREADTH_CATEGORY = "UCT Breadth Indicators"
_BREADTH_LIST_DESC = {
    "ma": "Percent of the market above each moving average — 5, 10, 20, 40, 50, 100, 200-day. Type UCTA50 etc. to chart any one.",
    "momentum": "Momentum breadth: 4% movers, weekly/monthly/quarterly gainers & losers, 13%/34d momentum, and up/down ratios.",
    "highs_lows": "New highs vs new lows (52-week & 20-day), all-time highs, % at highs/lows, and volume/extension internals.",
    "score_regime": "The composite Health Score, UCT Exposure, McClellan, A/D line, stage counts, and leadership/sentiment ratios.",
}


def _breadth_lists():
    """The four UCT Breadth prebuilt lists, generated from the breadth-symbol
    registry (the single source of truth) so they never drift from the chart
    symbols. Appended AFTER the file lists so the section renders below UCT ETF
    Lists (picker category order is first-seen)."""
    try:
        from api.services import breadth_symbols as bs
        by_group = bs.symbols_by_group()
        out = []
        for gid in bs.GROUP_ORDER:
            syms = by_group.get(gid) or []
            if not syms:
                continue
            out.append({
                "name": bs.LIST_META[gid]["list_name"],
                "desc": _BREADTH_LIST_DESC.get(gid, ""),
                "category": _BREADTH_CATEGORY,
                "tickers": [s.upper() for s in syms],
            })
        return out
    except Exception:
        return []


def category_map():
    """{lowercased list name: category} — the section each prebuilt list belongs to in the
    picker. Presentation-only (not stored in the DB); resolved from the committed config."""
    return {l["name"].strip().lower(): l["category"] for l in _load_committed()}


def category_order():
    """Category sections in the order they first appear in the committed config —
    UCT ETF Lists → UCT Index Components → UCT Breadth Indicators (breadth is appended
    last by _load_committed). The picker renders sections in THIS order rather than
    relying on the alphabetical accident of each section's first list name."""
    seen = []
    for l in _load_committed():
        c = l["category"]
        if c not in seen:
            seen.append(c)
    return seen


def sample_map(n=5):
    """{lowercased list name: first n tickers} — a preview shown under each list name in the
    picker. Uses the overlay-applied set so the sample reflects the live (pruned) list."""
    return {l["name"].strip().lower(): l["tickers"][:n] for l in _load_lists()}


def _read_overlay():
    try:
        with open(_OVERLAY_PATH, encoding="utf-8") as fh:
            d = json.load(fh)
            return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _apply_overlay(lists):
    """Overlay the durable auto-refresh onto the committed baseline:
      - replace 'Liquid Major ETFs' tickers with the fresh liquidity ranking (if present)
      - replace each UCT Index Components list with its fresh FMP constituent set (if present)
      - subtract the known-delisted set from EVERY list (curated names, minus the dead ones).
    Name/desc always stay from the committed config, so a curated edit is never lost — the
    overlay only re-ranks the liquid list, refreshes index membership, and removes tickers
    that stopped trading."""
    ov = _read_overlay()
    liquid = [str(t).upper() for t in (ov.get("liquid_ranking") or []) if t]
    delisted = {str(t).upper() for t in (ov.get("delisted") or []) if t}
    # {lowercased list name: [tickers]} — fresh index membership from watchlist_prebuilt_refresh.
    index_ov = ov.get("index_constituents") if isinstance(ov.get("index_constituents"), dict) else {}
    for l in lists:
        nm = l["name"].strip().lower()
        if nm == _LIQUID_NAME and liquid:
            l["tickers"] = liquid
        elif nm in index_ov and index_ov[nm]:
            l["tickers"] = [str(t).upper() for t in index_ov[nm] if t]
        if delisted:
            l["tickers"] = [t for t in l["tickers"] if t not in delisted]
    return [l for l in lists if l["tickers"]]


def _load_lists():
    """The authoritative prebuilt set = committed config with the durable overlay applied."""
    return _apply_overlay(_load_committed())


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
        existing = wl.list_prebuilt_watchlists(500)
        existing_by_name = defaultdict(list)
        for w in existing:
            existing_by_name[(w.get("name") or "").strip().lower()].append(w)

        # 1. Delete any prebuilt list NOT in the config (retired/renamed — e.g. Delisted Legends).
        #    The Sunday Scans family is exempt: its source is the desk store, so an unreadable
        #    source at boot must leave the existing lists standing, never wipe them — the
        #    family's own reconcile (step 3) retires what genuinely fell out of the window.
        for nm, rows in existing_by_name.items():
            if nm not in config and not _is_sunday_family(nm):
                for w in rows:
                    if w.get("user_id"):
                        wl.delete_watchlist(w["user_id"], w["id"])

        # 2. Reconcile each configured list — keep exactly one with the right ticker set,
        #    rebuild if the set drifted (bulk_add only ADDS, so removals need a recreate).
        #    The Sunday Scans family is step 3's (its rosters are NOT overlay-pruned: a
        #    dated issue list is a record of what the issue covered).
        admin = None
        for nm, l in config.items():
            if _is_sunday_family(nm):
                continue
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

        # 3. The Sunday Scans family — the same reconcile the hourly poller runs.
        _reconcile_sunday_family(existing)
    except Exception as e:
        _log.warning("[prebuilt] seed failed: %s", e)
