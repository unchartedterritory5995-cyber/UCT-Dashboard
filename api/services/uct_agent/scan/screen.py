"""SC-1 `screen.run` and `screen.count` — adapters over the canonical screener (owner: agent-sc).

Wrap, don't fork: the rows come from `screener.query.run_scan`, the count from `query.preview_count`,
the receipt from `query.coverage_for` (closed by `api/services/coverage_receipt.close`). Nothing here
composes SQL of its own, opens a provider connection, writes, or checks alerts: the screener reads its
own SQLite snapshot (`screener_rows`), so `provider_calls` is honestly 0.

Data honesty (MD-1 §3):
* `freshness` is `periodic` — `screener_rows` is rebuilt nightly. Never worded as live.
* `as_of` is the DATA's own time: the close (16:00 ET) of the session the matched rows' bars run
  through — the median `bars_asof` over the SAME where/FROM the scan used (`snapshot_db.describe_rows`,
  the service's own describer, with the bars column as its date). `snapshot_date` is when the row was
  BUILT, which is not the data's time, so it is never used as `as_of`.
* `stale` is true when that session is more than one NYSE session behind the last closed one, or when
  the matched rows span more than one bars session (the service's own `mixed` signal on that column).
  Rows the screener itself EXCLUDED for stopped bars (its stale gate) are counted in
  `coverage.dropped` and named in a note — never silent.
* When the screener's live overlay served values on the returned page, the note says which columns
  and from when (`snapshot.live`, the service's own disclosure).
"""
from __future__ import annotations

import datetime as dt
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.scan import sources
from api.services.uct_agent.scan import spec as scan_spec

SOURCE = "uct-screener"
_ET = ZoneInfo("America/New_York")
#: Dropped / not-computable names carried in `data` (the counts stay exact; the list is bounded).
MAX_LISTED = 10
#: Row keys that are the screener's own plumbing, never a member field.
_PLUMBING = frozenset({"live_row", "live_asof", "rank_score_raw"})


# ── time ───────────────────────────────────────────────────────────────────────────────────────

def _ymd(v: Any) -> Optional[dt.date]:
    s = str(v or "").strip().replace("-", "")
    if len(s) < 8 or not s[:8].isdigit():
        return None
    try:
        return dt.date(int(s[:4]), int(s[4:6]), int(s[6:8]))
    except ValueError:
        return None


def session_close_utc(day: dt.date) -> str:
    """ISO-8601 UTC of that ET session's 16:00 close."""
    return env.utc_iso(dt.datetime(day.year, day.month, day.day, 16, 0, tzinfo=_ET))


def _is_session(day: dt.date) -> bool:
    if day.weekday() >= 5:
        return False
    try:
        from api.services.bars_fetch import _is_nyse_holiday
        return not _is_nyse_holiday(int(day.strftime("%Y%m%d")))
    except Exception:  # noqa: BLE001 — without the calendar, a weekday is a session
        return True


def last_closed_session(now: Optional[dt.datetime] = None) -> dt.date:
    et = (now or dt.datetime.now(dt.timezone.utc)).astimezone(_ET)
    day = et.date()
    if not (_is_session(day) and et.hour >= 16):
        day -= dt.timedelta(days=1)
        while not _is_session(day):
            day -= dt.timedelta(days=1)
    return day


def sessions_behind(day: dt.date, now: Optional[dt.datetime] = None) -> int:
    """NYSE sessions after `day` up to and including the last closed one (0 = current)."""
    last = last_closed_session(now)
    n, d = 0, day
    while d < last and n < 60:
        d += dt.timedelta(days=1)
        if _is_session(d):
            n += 1
    return n


# ── service reads (each is the screener's own function) ─────────────────────────────────────────

def _bars_provenance(spec: dict, user_id: Any) -> dict:
    """The bars session the matched rows run through: the service's `describe_rows` over the scan's own
    plan, with `bars_asof` as the date column. Read-only, one local connection."""
    from api.services.screener import query, snapshot_db

    def _describe(conn, s):
        plan = query.build_scan_sql(s, query._overlay(conn, None), user_id=user_id, conn=conn)
        return snapshot_db.describe_rows(conn, plan["where"], plan["describe_params"],
                                         from_sql=plan["from_sql"],
                                         date_expr=f'{query._ROWS}."bars_asof"')
    with snapshot_db.connect() as conn:
        prov = _describe(conn, spec)
        if not prov.get("rows"):
            # Nothing matched: date the screen's UNIVERSE instead (its scope filters only — the same universe
            # `coverage_for` evaluates), so zero matches reads "none as of the <date> close", not "undated".
            scope = [f for f in (spec.get("filters") or []) if f.get("key") in query._SCOPE_KEYS]
            prov = {**_describe(conn, {"filters": scope}), "described": "universe"}
        return prov


def _coverage(spec: dict, user_id: Any) -> tuple[dict, list]:
    from api.services.screener import query
    r = query.coverage_for(spec, user_id=user_id, user=None)
    four = {k: int(r.get(k) or 0) for k in ("evaluated", "answered", "dropped", "not_computable")}
    listed = [{"symbol": e.get("ticker"), "reason": e.get("reason"), "detail": e.get("detail")}
              for e in (r.get("dropped_symbols") or [])[:MAX_LISTED]]
    return four, listed


# ── envelope assembly ──────────────────────────────────────────────────────────────────────────

def _refused(kind: str, params: Any, reason: str) -> dict:
    return env.make_envelope(kind, params, status="refused", freshness="unavailable", as_of=None,
                             source=SOURCE, notes=[reason])


def _provenance_fields(prov: dict, now: Optional[dt.datetime] = None) -> tuple[Optional[str], bool, list]:
    notes: list[str] = []
    day = _ymd(prov.get("snapshot_date"))
    if day is None:
        # an absent date is reported, never inferred to be old
        notes.append("The screener could not say which session these values run through, so no time is given.")
        return None, False, notes
    behind = sessions_behind(day, now)
    stale = behind > 1 or bool(prov.get("mixed"))
    if prov.get("described") == "universe":
        notes.append(f"No names matched. Screener snapshot as of the {day.isoformat()} close (nightly), not live.")
    else:
        notes.append(f"Screener snapshot — values as of the {day.isoformat()} close (nightly), not live.")
    if behind > 1:
        notes.append(f"This snapshot is {behind} sessions behind the last close.")
    if prov.get("mixed"):
        oldest = _ymd(prov.get("oldest_snapshot_date"))
        notes.append("The matched rows do not all run through the same session"
                     + (f" (oldest {oldest.isoformat()})." if oldest else "."))
    return session_close_utc(day), stale, notes


def _coverage_notes(cov: dict) -> list[str]:
    out = []
    d, n = cov["dropped"], cov["not_computable"]
    if d:
        out.append(f"{d} {'name was' if d == 1 else 'names were'} excluded because {'its' if d == 1 else 'their'} own price history stopped.")
    if n:
        out.append(f"{n} {'name' if n == 1 else 'names'} could not be decided: a value this screen needs is missing.")
    return out


def _live_note(live: Any) -> list[str]:
    if not isinstance(live, dict) or live.get("state") not in ("live", "live_unnamed"):
        return []
    cols = ", ".join(live.get("columns") or []) or "unnamed columns"
    when = live.get("as_of_et") or "an unreported time"
    return [f"{live.get('live_rows_on_page', 0)} of these rows carry the screener's intraday overlay for "
            f"{cols} (derived {when}); every other value is the nightly snapshot."]


def _project(rows: list, fields: list) -> list:
    out = []
    for r in rows:
        sym = r.get("ticker")
        rec = {"symbol": sym}
        for f in fields:
            if f == "ticker" or f in _PLUMBING:
                continue
            if f in r:
                rec[f] = r[f]
        out.append(rec)
    return out


def _status(cov: dict) -> str:
    return "partial" if (cov["dropped"] or cov["not_computable"]) else "ok"


def run(params: dict, ctx: dict) -> dict:
    """`screen.run` — `{spec, rows: [≤50: symbol + requested fields], total_matches}`."""
    kind = "screen.run"
    try:
        spec, origin = sources.resolve(params, ctx.get("user_id"))
    except scan_spec.SpecError as e:
        return _refused(kind, params, str(e))
    limit = scan_spec.row_limit({"limit": params["limit"]} if params.get("limit") is not None
                                else params.get("spec"))
    user_id = ctx.get("user_id")
    from api.services.json_finite import scrub
    from api.services.screener import query
    try:
        out = scrub(query.run_scan({**spec, "page": 1, "page_size": limit}, user_id=user_id, user=None))
        prov = _bars_provenance(spec, user_id)
    except ValueError as e:  # the screener's own refusal, with its own sentence
        return _refused(kind, params, f"the Screener refused this spec: {e}")
    cov, listed = _coverage(spec, user_id)
    as_of, stale, notes = _provenance_fields(prov)
    fields = list(spec.get("columns") or out.get("view_columns") or [])
    rows = _project((out.get("rows") or [])[:scan_spec.ROW_CAP], fields)
    snap = out.get("snapshot") or {}
    notes += _coverage_notes(cov) + _live_note(snap.get("live"))
    total = int(out.get("total") or 0)
    if total > len(rows):
        notes.append(f"Showing {len(rows)} of {total} matches.")
    data = {"spec": spec, "rows": rows, "total_matches": total, "fields": [f for f in fields if f != "ticker"],
            "excluded": listed, "origin": origin}
    if out.get("rank"):
        data["rank"] = out["rank"]
    return env.make_envelope(kind, params, status=_status(cov), freshness="periodic", as_of=as_of, source=SOURCE,
                             data=data, stale=stale, coverage=cov, notes=notes, provider_calls=0)


def count(params: dict, ctx: dict) -> dict:
    """`screen.count` — `{spec, count}`."""
    kind = "screen.count"
    try:
        spec, origin = sources.resolve(params, ctx.get("user_id"))
    except scan_spec.SpecError as e:
        return _refused(kind, params, str(e))
    user_id = ctx.get("user_id")
    from api.services.screener import query
    try:
        res = query.preview_count(spec, user_id=user_id, user=None)
        prov = _bars_provenance(spec, user_id)
    except ValueError as e:
        return _refused(kind, params, f"the Screener refused this spec: {e}")
    cov, listed = _coverage(spec, user_id)
    as_of, stale, notes = _provenance_fields(prov)
    notes += _coverage_notes(cov)
    data = {"spec": spec, "count": int(res.get("count") or 0), "excluded": listed, "origin": origin}
    if res.get("top_n"):
        data["top_n"] = res["top_n"]
    return env.make_envelope(kind, params, status=_status(cov), freshness="periodic", as_of=as_of, source=SOURCE,
                             data=data, stale=stale, coverage=cov, notes=notes, provider_calls=0)


def saved(params: dict, ctx: dict) -> dict:
    """`screen.saved` — `{screens: [{id, name, spec, runnable, reason?}]}`: THE MEMBER'S OWN saved screens,
    read-only (`saved_screens.list_for(user_id)`, the service's member-scoped read). Starters and other
    members' public screens are not listed.

    Envelope: `as_of` is the newest screen's `updated_at` (when these definitions were last written —
    the data's own time). `coverage` counts the screens: `answered` = runnable by the Agent (its spec
    passes the field catalog), `not_computable` = listed but not runnable (e.g. an indicator-condition
    screen, unavailable to the Agent in Sprint 1), so the member is never told a screen is missing."""
    kind = "screen.saved"
    recs = sources.read_saved(ctx.get("user_id")) or []
    # coverage counts EVERY screen the member has (agent-qa); only the 100 newest are listed in data
    screens, runnable, newest = [], 0, None
    for i, r in enumerate(recs):
        entry = {"id": r.get("id"), "name": r.get("name"), "spec": r.get("spec")}
        try:
            scan_spec.validate(r.get("spec"))
            entry["runnable"] = True
            runnable += 1
        except scan_spec.SpecError as e:
            entry["runnable"] = False
            entry["reason"] = str(e)
        if i < 100:
            screens.append(entry)
        ts = r.get("updated_at") or r.get("created_at")
        if isinstance(ts, (int, float)) and ts > 0 and (newest is None or ts > newest):
            newest = ts
    n = len(recs)
    cov = {"evaluated": n, "answered": runnable, "dropped": 0, "not_computable": n - runnable}
    notes = []
    if newest is None:
        notes.append("You have no saved screens." if not n else "The saved screens carry no save time.")
    as_of = env.utc_iso(dt.datetime.fromtimestamp(newest, dt.timezone.utc)) if newest else None
    if len(recs) > 100:
        notes.append(f"Showing your 100 most recently saved of {len(recs)} screens.")
    if n - runnable:
        notes.append(f"{n - runnable} of your screens can't be run by the Agent yet; each says why.")
    return env.make_envelope(kind, params, status="partial" if n - runnable else "ok", freshness="periodic",
                             as_of=as_of, source=SOURCE, data={"screens": screens}, coverage=cov, notes=notes,
                             provider_calls=0)
