"""darkpool_agg.py -- block-print aggregates + signature-DPL distance.

Reads `/data/darkpool.db` (web-local; `api.darkpool_db.init_db()` runs at
MODULE IMPORT, so any caller that needs an isolated DB must pin
`RAILWAY_VOLUME_MOUNT_PATH` before that module is first imported -- the
canonical idiom is `tests/test_signature_darkpool_levels.py:7-10`). READ-ONLY
(K9): this module never INSERTs into `darkpool_trades` / `darkpool_today`.
Any write there moves the `(row_count, max_id)` cache signature the
`darkpool_aggregator` disk cache keys on and triggers a multi-million-row
window rebuild (map 2 SS5) -- so this module issues SELECTs only, on
connections it always closes.

Windows -- the DISTINCT-date Python-sorted idiom, EXACTLY (K1):
`darkpool_trades.date` is unpadded `M/D/YYYY` TEXT, so `ORDER BY date` /
`MAX(date)` sort lexicographically wrong ("9/9/2026" > "10/1/2026" as a
string). Every window here is `SELECT DISTINCT date` -> Python-sort via
`darkpool_db.parse_date_to_sortable` (imported, never re-derived) -> newest
N -- the same shape as `resolve_universe`
(`api/darkpool_massive_ingest.py:222-240`), with `COUNT(*)` added. "1d" = the
single newest trading-day session present in the DB; "5d" = the 5 newest
distinct sessions (a superset of "1d"). Both cuts share the same
5-newest-dates resolution, so a ticker whose only prints fall outside that
5-date set is absent from BOTH windows -- not merely blank on the 1d columns.

D7 -- emission scope: a ticker is emitted here at all ONLY if it has >= 1
qualifying print (see floor below) somewhere in the 5-newest-dates window.
A ticker resolving to zero rows across that window is a real absence, not a
zero-filled row.

Column semantics (state these wherever a column reaches a member):
  * `dp_notional_1d` / `dp_prints_1d` -- sum(notional) / count of qualifying
    prints on the single newest session in the DB.
  * `dp_notional_5d` -- sum(notional) of qualifying prints across the 5
    newest sessions (includes whatever contributed to the 1d figure).
  * A "qualifying print" mirrors the ingest floor exactly (map 2 SS1):
    off-exchange (Massive `exchange IN (4, 9)`), notional >= $4,000,000,
    07:00-19:00 ET. Every row already carries that floor by construction at
    ingest time; this reader additionally requires `notional IS NOT NULL`
    (the same guard `resolve_universe` applies) so a phantom/cancelled or
    message-only row with no priced notional never inflates a count or sum.
    So these are block/institutional notional -- NOT total dark-pool volume.
  * Coverage is a POD FACT, not a repo-default fact. The repo DEFAULT writer
    (`DARKPOOL_MASSIVE_INGEST_ENABLED`) only ever sees a ~560-name base
    universe + a top-150 self-ranked tail (`darkpool_massive_ingest.py`) --
    NOT the full screener universe. MEASURED on this deployment, though,
    `DARKPOOL_FLATFILE_ENABLED=1` is ALSO armed (the all-symbols T+1
    flat-file ingest), and `darkpool_trades` holds ~7.0M rows across ~5,500
    distinct tickers and ~120 retained trading days -- so on THIS pod
    coverage is effectively universal, not the narrower base+self-ranked
    set the map's dark-default state describes. Which writers are armed is
    always a live fact (`railway variables --service web --kv | grep
    DARKPOOL`), never something to assume from a code default.
  * NULL / absence is THREE-WAY ambiguous regardless of which writers are
    armed: no qualifying blocks that session, prints existed but were all
    sub-$4M, or the ticker was simply never polled by whichever writer(s)
    happen to be on. This reader cannot and does not disambiguate the three;
    it only ever reports "no qualifying print found," never guesses which.
  * The 1d number can still miss same-session flat-file-only prints
    (supersession #6, KEPT even with the flat-file flag on): the nightly
    per-ticker ingest posts the newest session same-night; the ALL-symbols
    T+1 flat-file backfill for that SAME session lands the FOLLOWING day at
    11:45 ET -- after any 03:00 ET snapshot build has already read
    `dp_notional_1d` for that session. A 5d window mostly absorbs this
    (the earlier 4 sessions' flat-file rows have long since landed); a 1d
    window does not, by construction, and is not "fixed" by chasing the
    flat-file publish time.

`dp_level_dist_pct` (D8): the minimum, over `fetch_dp_levels(sym)["levels"]`,
of `abs(close_price - level["price"]) / close_price * 100`. Levels come ONLY
from the signature DPL clusterer (`api.services.signature.darkpool_levels
.fetch_dp_levels`, 0.25%-bin / $10M-floor / 20-trading-day / top-5, owner-
tuned constants in `api/services/signature/rules.py`) -- NEVER the chart
"zones" clusterer (`darkpool_db._cluster_prints_to_zones`, 2%/180d/top-25),
which is a different, differently-tuned authority for a different UI (map 2
SS4). `fetch_dp_levels` is accessed through the `darkpool_levels` MODULE
object (not a name imported at this module's top level) so a test that
monkeypatches `api.services.signature.darkpool_levels.fetch_dp_levels`
reaches every call. `datesCovered == 0` or an empty `levels` list means "no
signature DPL levels for this name" -- `dp_level_dist_pct` is simply absent
from that ticker's dict, never a fabricated 0/None sentinel value.

Candidate bounding (D8): DPL distance is only ever attempted for tickers
already emitted by the aggregate above (the distinct-tickers-in-window set,
already intersected with `targets`) -- never a loop over the full ~3,685
screener universe. A candidate is further skipped, per-ticker, when the
caller's `closes` dict has no entry (or a non-positive entry) for it --
`closes=None` (task A6 has not yet supplied last-close prices, e.g. the
darkpool reader is exercised standalone) skips DPL for every ticker while
still emitting every aggregate column.

`snapshot_date` is this join's as_of family (ruling D11, K6) -- stated here
for the builder that stamps it; this module has no `as_of` column of its own
to write.
"""
from __future__ import annotations


def _note(failures, source, outcome):
    if failures is None:
        return
    key = outcome if isinstance(outcome, str) else type(outcome).__name__
    failures.setdefault(source, {})
    failures[source][key] = failures[source].get(key, 0) + 1


def read_darkpool_fields(targets, closes=None, failures=None):
    """Block-print aggregates + signature-DPL distance for `targets`.

    Returns `{TICKER: {...}}`. A ticker is a key here ONLY when it has >= 1
    qualifying print in the 5-newest-dates window (D7) -- everything else is
    a genuine absence, not a zero/None-filled row. Per emitted ticker:
      - `dp_notional_5d` -- always present when the ticker is emitted.
      - `dp_notional_1d` / `dp_prints_1d` -- present together, only when the
        ticker also has a qualifying print on the single newest session.
      - `dp_level_dist_pct` -- present only when `closes` supplies a usable
        close for the ticker AND the signature DPL clusterer returns >= 1
        level for it.

    `closes` is `{TICKER: last_close}` (Task A6 supplies it from the prior
    snapshot in one query); `closes=None` still emits every aggregate column,
    with `dp_level_dist_pct` absent for all tickers.
    """
    targets_u = {str(t).strip().upper() for t in (targets or []) if t}
    if not targets_u:
        return {}

    try:
        from api import darkpool_db
    except Exception as e:
        _note(failures, "darkpool_agg", e)
        return {}

    try:
        conn = darkpool_db.get_conn()
    except Exception as e:
        _note(failures, "darkpool_agg", e)
        return {}

    try:
        try:
            date_rows = conn.execute(
                "SELECT DISTINCT date FROM darkpool_trades").fetchall()
        except Exception as e:
            _note(failures, "darkpool_agg", e)
            return {}

        all_dates = [r["date"] for r in date_rows if r["date"]]
        if not all_dates:
            _note(failures, "darkpool_agg", "empty")
            return {}

        # K1: never ORDER BY the raw TEXT column -- parse-sort in Python.
        all_dates.sort(key=darkpool_db.parse_date_to_sortable, reverse=True)
        five_newest = all_dates[:5]
        newest = five_newest[:1]

        # Same shape as `resolve_universe` (darkpool_massive_ingest.py:222-240)
        # -- notional IS NOT NULL excludes phantom/cancelled/message-only rows
        # from both the sum and the qualifying-print count -- plus COUNT(*).
        ph5 = ",".join("?" * len(five_newest))
        rows5 = conn.execute(
            f"""SELECT ticker, SUM(COALESCE(notional,0)) AS notional_5d,
                       COUNT(*) AS prints_5d
                  FROM darkpool_trades
                 WHERE date IN ({ph5}) AND notional IS NOT NULL
                 GROUP BY ticker""",
            tuple(five_newest)).fetchall()

        ph1 = ",".join("?" * len(newest))
        rows1 = conn.execute(
            f"""SELECT ticker, SUM(COALESCE(notional,0)) AS notional_1d,
                       COUNT(*) AS prints_1d
                  FROM darkpool_trades
                 WHERE date IN ({ph1}) AND notional IS NOT NULL
                 GROUP BY ticker""",
            tuple(newest)).fetchall()
    finally:
        conn.close()

    agg5 = {str(r["ticker"]).upper(): (r["notional_5d"], r["prints_5d"])
            for r in rows5 if r["ticker"]}
    agg1 = {str(r["ticker"]).upper(): (r["notional_1d"], r["prints_1d"])
            for r in rows1 if r["ticker"]}

    out = {}
    for t, (notional_5d, _prints_5d) in agg5.items():
        if t not in targets_u:
            continue
        row = {"dp_notional_5d": notional_5d}
        one = agg1.get(t)
        if one is not None:
            row["dp_notional_1d"] = one[0]
            row["dp_prints_1d"] = one[1]
        out[t] = row

    if not out:
        return out

    # D8: DPL distance is attempted ONLY for tickers already emitted above --
    # that set is already "distinct tickers in the window" INTERSECTED with
    # `targets`, so this never loops the full screener universe.
    closes_u = {str(k).strip().upper(): v for k, v in (closes or {}).items()}
    if not closes_u:
        return out

    try:
        from api.services.signature import darkpool_levels
    except Exception as e:
        _note(failures, "darkpool_agg_dpl", e)
        return out

    for t in out:
        close_price = closes_u.get(t)
        if not close_price or close_price <= 0:
            continue
        try:
            # Module-attribute access (not a name imported at this module's
            # top level) so a test that monkeypatches
            # `api.services.signature.darkpool_levels.fetch_dp_levels`
            # reaches this call.
            payload = darkpool_levels.fetch_dp_levels(t)
        except Exception as e:
            _note(failures, "darkpool_agg_dpl", e)
            continue

        payload = payload or {}
        levels = payload.get("levels") or []
        dates_covered = payload.get("datesCovered") or 0
        if not dates_covered or not levels:
            continue

        try:
            dist = min(
                abs(close_price - lv["price"]) / close_price * 100.0
                for lv in levels
            )
        except Exception as e:
            _note(failures, "darkpool_agg_dpl", e)
            continue

        out[t]["dp_level_dist_pct"] = dist

    return out
