"""Background warm of the calendar week's earnings AI (preview + analysis), plus
the Profile + Catalysts companions the same modal opens.

Generates the AI ahead of a click so the names people actually open are instant
instead of a ~25-40s cold Claude call. Two ranking + freshness ideas over a
naive "top market cap on a timer":

  • CLICK-RELEVANCE RANKING — the warm set is ranked by (is-tracked, market-cap):
    every name in ANY user's watchlist / positions / My-Stocks is warmed first,
    then the biggest remaining caps fill the budget. So a $2B name someone
    actually follows is instant, not just the megacaps.
  • SKIP-IF-STABLE — a name is re-checked at most every few hours; the generator
    only re-sends to Claude when the inputs actually changed (consensus,
    actuals, date, session). Stable names cost ~$0 to keep warm, and a preview
    refreshes the moment its inputs move (e.g. consensus populating N/A → real).
    Names without a consensus yet are skipped so we never warm an "N/A" preview.

Plus a post-report pass warms the ANALYSIS for names that just reported, so the
after-the-print read is instant too.

🔴 2026-08-21 — BOTH passes had been NO-OPS since they shipped, for one reason:
the calendar and the engine spell the same facts differently.
    calendar rows:  eps_est / eps_act / rev_est / rev_act          (no verdict)
    engine rows:    eps_estimate / reported_eps / rev_estimate / rev_actual
                    + verdict / surprise_pct
The preview ranker filtered on `e.get("eps_estimate") is None` — never present
on a calendar row — so EVERY pending name was skipped and every log line read
`candidates=0`. The analysis pass did find its names but handed the generator a
row with no `verdict`; the generator reads `""` as pending, skips the AI step,
ends with `analysis=None`, and persists nothing — re-running the whole provider
fan-out every cycle for nothing. Every click on a reporter was therefore a cold
generation; the owner measured ~40s. `engine_row()` below is the ONE adapter,
and verdict + surprise are DERIVED by engine._build_earnings_entry — the same
function the click path's rows come from — never restated here.

Gated by EARNINGS_WARM_ENABLED (default on). Never raises.
"""
import logging
import os
import re as _re
import threading
from concurrent.futures import ThreadPoolExecutor

from api.services import earnings_ai_store

_logger = logging.getLogger(__name__)
_WORKERS = int(os.environ.get("EARNINGS_WARM_WORKERS", "3") or 3)
_POOL = ThreadPoolExecutor(max_workers=_WORKERS, thread_name_prefix="earn-warm")
_locks = {"preview": threading.Lock(), "analysis": threading.Lock()}

# Names under this market cap (in $B) are not warmed unless someone tracks them
# — the house "Small+ (over $300mln)" standard. A row with NO cap is kept: an
# unknown cap is not a small cap.
_MIN_MC_B = float(os.environ.get("EARNINGS_WARM_MIN_MC_B", "0.3") or 0.3)

# Below this share of the visible board being answerable from artifacts, the
# pass says so at WARNING. Not 100: a name that joined the board minutes ago is
# legitimately still being written, and a floor that cries on every normal pass
# is a floor people mute.
_COVERAGE_FLOOR_PCT = int(os.environ.get("EARNINGS_WARM_COVERAGE_FLOOR_PCT", "80") or 80)

# Calendar spelling → engine spelling. Read in this order so a row that already
# carries the engine key (a test, or a future calendar change) still works.
_CAL_TO_ENGINE = {
    "eps_actual":   ("eps_act", "reported_eps", "eps_actual"),
    "eps_estimate": ("eps_est", "eps_estimate"),
    "rev_actual":   ("rev_act", "rev_actual"),
    "rev_estimate": ("rev_est", "rev_estimate"),
}


# A closed-end fund "reports" on the earnings board, but there is no earnings
# story to preview — no segments, no guidance, no consensus anyone publishes.
# Measured 2026-08-24: of the 70 board names with no consensus in our feed, 47
# were funds and 23 were real operating companies (XPEV, Woodside, EHang,
# Citi Trends). Skipping ALL of them to avoid an "N/A preview" cost the 23.
# ⛔ DELIBERATELY NARROW. `trust` and `income` were in this pattern and are now
# out: a REIT is a real company that reports real earnings, and "…Trust" /
# "…Income" appear in plenty of REIT and operating-company industry strings.
# Being wrong in that direction re-creates the exact harm this rule exists to
# fix. Checked against the live board (2026-08-24): the fund industries that
# actually occur are `Closed-End Fund` (28), `Asset Management` (18) and
# `Real Estate Fund` (1) — the narrow pattern classifies all 70 no-consensus
# names IDENTICALLY to the broad one, so the width bought nothing and risked
# the REITs (`Residential REITs`, `Diversified REITs`, `Diversified Real
# Estate` are all on that board, and all must stay companies).
# An industry that settles it on its own. ⛔ DELIBERATELY NARROW: `trust`
# and `income` are NOT here — a REIT is a real company that reports real
# earnings, and being wrong in that direction re-creates the exact harm this
# rule exists to fix. Verified against the live board: `Residential REITs`,
# `Diversified REITs` and `Diversified Real Estate` all stay companies.
_FUND_INDUSTRY = _re.compile(r"\bfunds?\b|closed.?end|municipal|\betfs?\b", _re.I)

# …and one that does NOT settle it. `Asset Management` is the industry of
# closed-end funds AND of real asset managers — BlackRock and Noah Holdings
# carry it exactly like Royce Micro-Cap Trust does. Measured on the live
# board (2026-08-24): 48 of the 70 no-consensus names matched on industry
# alone, and one of them, `Noah Holdings Limited`, is an operating company
# that was being denied a brief for it. So the NAME breaks the tie — a fund
# announces itself there ("…Fund", "…Trust", "…Income"), a company does not.
_FUND_SOFT_INDUSTRY = _re.compile(r"asset manage", _re.I)
_FUND_NAME = _re.compile(r"\bfunds?\b|\btrust\b|\bincome\b|\bportfolio\b|\bmuni", _re.I)


def _looks_like_a_fund(sym: str) -> bool:
    """Industry/sector says fund-like. `_base_meta` rather than
    `get_ticker_meta` on purpose: this needs only the 24h-cached sector and
    industry, not the live taxonomy theme lookup that rides the public front.

    ⚠️ UNKNOWN IS NOT A FUND. A name we hold no meta for is treated as a real
    company and gets its brief — the same direction as "an unknown cap is not
    a small cap" above. The cost of being wrong that way is one cheap preview;
    the cost of the other way is a reader waiting 30-40s on a real company."""
    try:
        from api.services import ticker_meta
        m = ticker_meta._base_meta(sym) or {}
    except Exception:
        return False
    text = f"{m.get('industry') or ''} {m.get('sector') or ''}"
    if _FUND_INDUSTRY.search(text):
        return True
    # Ambiguous industry → the NAME decides, and an unknown name decides
    # "company" (the same direction as an unknown industry). Known cost of
    # that choice, measured: two closed-end funds whose names read like
    # operating companies (`FS Credit Opportunities Corp.`, `Tri-Continental
    # Corporation`) each buy one cheap preview nobody reads. Known benefit:
    # `Noah Holdings Limited` stops being a 30-40s cold click. The asymmetry
    # is the whole argument — a wasted preview costs ~$0.02 once, a cold click
    # costs a reader half a minute every time.
    if _FUND_SOFT_INDUSTRY.search(text):
        return bool(_FUND_NAME.search(m.get("name") or ""))
    return False


def _first(e: dict, *keys):
    for k in keys:
        v = e.get(k)
        if v is not None:
            return v
    return None


def has_actual(e: dict) -> bool:
    return _first(e, *_CAL_TO_ENGINE["eps_actual"]) is not None


def has_consensus(e: dict) -> bool:
    return _first(e, *_CAL_TO_ENGINE["eps_estimate"]) is not None


def engine_row(e: dict, date_iso: str | None = None, bucket: str | None = None) -> dict:
    """Adapt ONE calendar entry into the row the generators read.

    Verdict and surprise come from `engine._build_earnings_entry` — the exact
    function that builds the click path's rows — so the warm path and the
    click path agree by construction (and so the skip-if-stable signals hash,
    which reads engine keys, sees the same inputs from both). `date` and
    `session` are added because the preview prompt labels the report by them
    and the hash keys on them: a report-date shift must regenerate.
    """
    from api.services.engine import _build_earnings_entry
    raw = {
        "symbol": (e.get("sym") or e.get("symbol") or "").upper(),
        "ew_total": e.get("ew") or e.get("ew_total") or 0,
    }
    for engine_key, cal_keys in _CAL_TO_ENGINE.items():
        raw[engine_key] = _first(e, *cal_keys)
    row = _build_earnings_entry(raw)
    row["date"] = date_iso or e.get("date") or e.get("earnings_date")
    row["session"] = str(bucket or e.get("session") or e.get("when") or "").upper()
    for k in ("name", "time_et", "mc_b", "sector"):
        if e.get(k) is not None:
            row[k] = e[k]
    return row


def _tracked_union() -> set:
    """Flat set of every ticker in any user's watchlist / positions / My-Stocks."""
    try:
        from api.services.calendar_alerts import _collect_all_users_ticker_sets
        sets = _collect_all_users_ticker_sets() or {}
        out: set = set()
        for s in sets.values():
            out |= {str(t).upper() for t in (s or set())}
        return out
    except Exception as e:
        _logger.debug("[earn-warm] tracked union failed: %s", e)
        return set()


def _rank(weeks: int, *, reported: bool | None, tracked: set) -> list[dict]:
    """Collect this-and-next-week reporters, dedupe by sym keeping the best
    market cap, and rank by (is-tracked, market-cap) descending. Rows come back
    in ENGINE spelling.

    `reported` selects WHICH names, and it has three modes:
      False → pending names that carry a consensus (the preview budget)
      True  → names that have already printed (the analysis budget)
      None  → EVERY name on the board, printed or not, consensus or not.

    None exists for the COMPANIONS (Profile + Catalysts). Those two tabs
    describe the COMPANY — what it does, its market cap, what moved it this
    year — none of which depends on a consensus estimate for the upcoming
    print. Riding the preview's eligibility meant a name with no consensus in
    our feed got no brief AND no profile AND no catalysts: measured 2026-08-24,
    61 of 252 names on the board had no Profile and 68 had no Catalysts, and
    every one of them was a name `reported=False` had filtered out. Whether we
    can price tonight's print is simply not a fact about whether we can say
    what the company does."""
    from datetime import timedelta
    from api.routers.calendar import get_calendar, get_day_metrics, _week_dates

    cur_monday = _week_dates()[0]
    best: dict[str, dict] = {}
    for wk in range(max(weeks, 1)):
        monday = cur_monday + timedelta(days=7 * wk)
        try:
            payload = get_calendar(week=monday.isoformat()) or {}
        except Exception as e:
            _logger.warning("[earn-warm] get_calendar failed %s: %s", monday, e)
            continue
        for ds, day in (payload.get("days") or {}).items():
            metrics = {}
            try:
                metrics = get_day_metrics(date_str=ds) or {}
            except Exception:
                pass
            for bucket in ("bmo", "amc", "tbd"):
                for e in (day.get(bucket) or []):
                    sym = (e.get("sym") or "").upper()
                    if not sym:
                        continue
                    actual = has_actual(e)
                    no_consensus = False
                    if reported is not None:
                        if reported and not actual:
                            continue
                        if not reported:
                            if actual:             # already reported → analysis path
                                continue
                            # PENDING preview without a consensus. The rule used to
                            # be "skip", to avoid warming an "N/A" preview. That is
                            # right for a FUND and wrong for a company: XPEV,
                            # Woodside and EHang all sit here because our feed has
                            # no consensus for them, while the generator still has
                            # four quarters of actuals, the implied move, revisions
                            # and the news tape to write from — and skip-if-stable
                            # rewrites it the moment a consensus appears (XPEV,
                            # measured, did exactly that). So: funds still skip;
                            # real companies are WARMED, ranked behind every
                            # consensus name so the budget serves those first.
                            # ⛔ This rule is the PREVIEW's — `reported is None`
                            # (companions) never reaches it, deliberately.
                            if not has_consensus(e):
                                if _looks_like_a_fund(sym):
                                    continue
                                no_consensus = True
                    mc = e.get("mc_b")
                    if mc is None:
                        mc = (metrics.get(sym) or {}).get("mc_b")
                    is_tracked = sym in tracked
                    # Below the house $300M floor → DEMOTED, not dropped. Owner
                    # 2026-08-23: "every reporter you can see" — a sub-$300M
                    # name still has a tile on the board, and a tile that opens
                    # to a 30s spinner is the exact complaint. The budget
                    # (`top_n`) is what bounds the spend now; the floor only
                    # decides who gets warmed LAST. Set
                    # EARNINGS_WARM_DROP_BELOW_FLOOR=1 to restore the old drop.
                    below_floor = mc is not None and mc < _MIN_MC_B and not is_tracked
                    if below_floor and _drop_below_floor():
                        continue
                    row = engine_row(e, ds, bucket)
                    row["mc_b"] = mc
                    row["_is_tracked"] = is_tracked
                    row["_below_floor"] = below_floor
                    row["_no_consensus"] = no_consensus
                    cur = best.get(sym)
                    if cur is None or (mc or -1) > (cur.get("mc_b") or -1):
                        best[sym] = row
    return sorted(
        best.values(),
        key=lambda r: (r.get("_is_tracked", False), not r.get("_below_floor", False),
                       not r.get("_no_consensus", False),
                       r.get("mc_b") is not None, r.get("mc_b") or 0),
        reverse=True,
    )


# ── Companions: the Profile + Catalysts tabs of the same modal ───────────────
# Both services are generate-once (their own stores + daily caps gate the
# spend), but each `_gen_async` spawns an UNBOUNDED thread per name — kicking
# 180 of them at once is a fan-out the web pod cannot absorb. So the warm calls
# their synchronous generators on THIS pool, paced by its worker count.

def _companion_weeks() -> int:
    """How many weeks ahead the COMPANIONS walk — further than the briefs.

    `EARNINGS_WARM_WEEKS` (2) is the right horizon for a PREVIEW: three weeks
    out a report date is still a provider's guess, and the skip-if-stable hash
    keys on that date, so every shift re-bills the generation. A Profile and a
    Catalyst history have no such problem — "what does this company do" and
    "what moved it this year" do not change when the date does, and they are
    generate-once + disk-persisted, so warming them early is paid once and
    never again.

    That asymmetry is the whole reason this is a separate knob rather than a
    bigger `EARNINGS_WARM_WEEKS`: a reader who opens the month view, or steps
    out to the week after next, gets the company pages instantly, and only the
    print preview is written on demand."""
    return max(int(os.environ.get("EARNINGS_WARM_COMPANION_WEEKS", "4") or 4),
               int(os.environ.get("EARNINGS_WARM_WEEKS", "2") or 2))


def _companion_top_n() -> int:
    """Companion budget. Sized ABOVE the preview budget on purpose: the board
    is bigger than the brief-eligible set (the whole point of walking it), and
    a Profile is generate-once + disk-persisted, so a covered name costs
    nothing on every later pass. Both companion services keep their own daily
    caps, which is what actually bounds spend."""
    return int(os.environ.get("EARNINGS_WARM_COMPANION_TOPN", "400") or 400)


def _companions_enabled() -> bool:
    return os.environ.get("EARNINGS_WARM_COMPANIONS", "1").lower() in ("1", "true", "yes")


def _drop_below_floor() -> bool:
    """Restore the pre-2026-08-23 behaviour of excluding sub-floor caps entirely."""
    return os.environ.get("EARNINGS_WARM_DROP_BELOW_FLOOR", "0").lower() in ("1", "true", "yes")


def _needs_profile(sym: str) -> bool:
    from api.services.stock_brief import service as sb, store as sb_store
    if not sb._enabled():
        return False
    sb_store._init_db()
    return sb_store.needs_generation(sym, sb._period(sb._year()), sb._RETRY_AFTER, sb._REFRESH_AFTER)


def _needs_catalysts(sym: str) -> bool:
    # ⛔ ONE authority on this policy — `nc.needs_catalysts` — never a second
    # copy of its retry knobs here. The warm and the click path disagreeing
    # about what is already covered is precisely how a name ends up warmed
    # forever or never.
    from api.services.news_catalysts import service as nc
    return nc.needs_catalysts(sym)


def _needs_companion(sym: str) -> bool:
    for needs in (_needs_profile, _needs_catalysts):
        try:
            if needs(sym):
                return True
        except Exception as e:
            _logger.debug("[earn-warm] companion check failed %s: %s", sym, e)
    return False


def is_covered(sym: str) -> bool:
    """Would clicking this name RIGHT NOW answer instantly, from artifacts?

    ⛔ Read the artifacts, never the pass's own bookkeeping. `submitted=80` in
    a log line is a statement of intent; this is a statement of fact. Both warm
    passes spent months reporting healthy numbers while writing nothing to
    disk, and the gap between those two sentences is the only thing that would
    have shown it (`lesson_a_warm_pass_that_persists_nothing_reads_as_healthy`).

    "Instant" is deliberately generous about the catalysts: a name that was
    ATTEMPTED and genuinely has nothing to report (a bond fund) answers
    immediately with an empty feed, and that is a covered click, not a hole."""
    try:
        if not (earnings_ai_store.is_fresh("preview", sym)
                or earnings_ai_store.is_fresh("analysis", sym)):
            return False
        from api.services.stock_brief import service as sb, store as sb_store
        if not sb_store.has_content(sym, sb._period(sb._year())):
            return False
        from api.services.news_catalysts import service as nc
        # `needs_catalysts` False = either rows exist, or we looked and there
        # was nothing — both answer the click without a spinner.
        return not nc.needs_catalysts(sym)
    except Exception as exc:
        _logger.debug("[earn-warm] coverage check failed for %s: %s", sym, exc)
        return False


def _safe_companions(sym: str) -> None:
    """Profile (stock_brief) then Catalysts (news_catalysts) for one name."""
    from api.services.stock_brief import service as sb
    from api.services.news_catalysts import service as nc
    for label, needs, svc in (("profile", _needs_profile, sb), ("catalysts", _needs_catalysts, nc)):
        try:
            if not needs(sym):
                continue
            if sym in getattr(svc, "_generating", ()):   # a viewer already kicked it
                continue
            svc._generate_and_store(sym)
        except Exception as e:
            _logger.debug("[earn-warm] %s gen failed %s: %s", label, sym, e)


def _run(kind: str, generator, reported: bool) -> dict:
    if os.environ.get("EARNINGS_WARM_ENABLED", "1").lower() not in ("1", "true", "yes"):
        return {"skipped": "disabled"}
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return {"skipped": "no-anthropic-key"}
    lock = _locks[kind]
    if not lock.acquire(blocking=False):
        return {"skipped": "already-running"}
    try:
        # 500 covers a full two-week board (~137 reporters in a busy single week)
        # with the sub-floor names now included rather than dropped. Raised from
        # 200 for the owner's "no cold click, ever" call — `dropped_by_topn` is
        # logged below so a bounded warm still never reads as full coverage.
        top_n = int(os.environ.get("EARNINGS_WARM_TOPN", "500"))
        weeks = int(os.environ.get("EARNINGS_WARM_WEEKS", "2"))
        recheck = float(os.environ.get("EARNINGS_WARM_RECHECK_HOURS", "6")) * 3600
        tracked = _tracked_union()
        ranked = _rank(1 if reported else weeks, reported=reported, tracked=tracked)
        chosen = ranked[:top_n]
        dropped = len(ranked) - len(chosen)

        # ── Submit order IS the priority order ────────────────────────────────
        # `chosen` is ranked by (is-tracked, market-cap), but the pool is a
        # 3-worker FIFO: whatever is submitted first is what gets warmed first.
        # This loop used to queue EVERY preview and only then start on the
        # companions, so the Profile and Catalysts tabs of the #1-ranked name
        # sat behind up to `top_n` preview generations — at ~30s each across 3
        # workers, half an hour before the biggest reporter's Profile even
        # STARTED. The ranking was computed correctly and then thrown away by
        # the queue. A name's three jobs now go in together, so rank survives
        # into the pool and the front of the list is warm within a minute.
        want_companions = _companions_enabled()
        # The BOARD — every name a reader can see this window, in the same rank
        # order — is what the companions walk. `chosen` (brief-eligible, budget-
        # truncated) is a SUBSET of it, so iterating the board keeps the
        # interleaving the ranking exists for AND reaches the names the preview
        # filter drops. One loop, so a name's brief and its two companions still
        # go into the pool together.
        brief_rows = {r["sym"]: r for r in chosen}
        # The companions walk a LONGER horizon than the briefs (see
        # `_companion_weeks`), so the board is built on its own week count.
        board = (_rank(_companion_weeks(), reported=None, tracked=tracked)
                 if want_companions else chosen)
        board = board[:max(top_n, _companion_top_n())]

        submitted = fresh = companions = 0
        for row in board:
            sym = row["sym"]
            brief_row = brief_rows.get(sym)
            if brief_row is not None:
                age = earnings_ai_store.age(kind, sym)
                if age is not None and age < recheck:
                    fresh += 1      # checked recently → don't re-fetch this cycle
                else:
                    # force_fresh_check=True → the generator re-checks the
                    # signals_hash and only calls Claude if the inputs changed.
                    _POOL.submit(_safe_gen, generator, sym, brief_row)
                    submitted += 1
            if want_companions and _needs_companion(sym):
                _POOL.submit(_safe_companions, sym)
                companions += 1

        # COVERED is measured from the artifacts, not from what this pass just
        # queued — see `is_covered`. It is the number that makes a silently
        # broken warm impossible to mistake for a healthy one.
        covered = sum(1 for r in board if is_covered(r["sym"]))
        if board and covered * 100 < len(board) * _COVERAGE_FLOOR_PCT:
            _logger.warning(
                "[earn-warm:%s] COVERAGE %d/%d (%d%%) is below the %d%% floor — "
                "names a reader can see are opening cold. Check the artifacts "
                "(/data/earnings_ai_cache, stock_brief.db, news_catalysts.db), "
                "not this pass's submitted count.",
                kind, covered, len(board), covered * 100 // max(len(board), 1),
                _COVERAGE_FLOOR_PCT)
        if dropped:
            # Louder than the census line, because this is the one number that
            # means "a name a reader can see was deliberately left cold".
            _logger.warning("[earn-warm:%s] BUDGET TRUNCATED the board: %d of %d "
                            "candidates not warmed (EARNINGS_WARM_TOPN=%d)",
                            kind, dropped, len(ranked), top_n)
        # `dropped_by_topn` is logged so a bounded warm never reads as "covered
        # everything" — a silently truncated list is how a cold click hides.
        _logger.info("[earn-warm:%s] candidates=%d tracked=%d submitted=%d recent=%d "
                     "board=%d covered=%d companions=%d dropped_by_topn=%d",
                     kind, len(ranked), sum(1 for r in ranked if r.get("_is_tracked")),
                     submitted, fresh, len(board), covered, companions, dropped)
        return {"kind": kind, "candidates": len(ranked), "submitted": submitted,
                "recent": fresh, "board": len(board), "covered": covered,
                "companions": companions, "dropped_by_topn": dropped}
    except Exception as e:
        _logger.warning("[earn-warm:%s] pass failed: %s", kind, e)
        return {"error": str(e)}
    finally:
        lock.release()


def _safe_gen(generator, sym: str, row: dict) -> None:
    try:
        generator(sym, row, force_fresh_check=True)
    except Exception as e:
        _logger.warning("[earn-warm] gen failed %s: %s", sym, e)


def warm_week_previews() -> dict:
    """Warm PENDING reporters' previews (current + next week)."""
    from api.services.engine import _generate_earnings_preview
    return _run("preview", _generate_earnings_preview, reported=False)


def warm_reported_analyses() -> dict:
    """Warm the ANALYSIS for names that already reported this week, so the
    post-print read is instant too (runs after the BMO and AMC prints)."""
    from api.services.engine import _generate_earnings_analysis
    return _run("analysis", _generate_earnings_analysis, reported=True)
