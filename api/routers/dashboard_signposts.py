"""One aggregate behind Zone D's eight signpost cards.

⛔ NO NETWORK I/O, AND NOTHING UNCACHED PER REQUEST. Zone D exists to replace
~4,000px of preview tiles with ~90px of links-with-numbers; if it costs eight
fetches (or even one slow one) it has not replaced anything. The whole payload
sits behind ONE 60s `cache.set` below, so the ceiling on everything this
function does is once per minute across every member.

⚠️ THAT SENTENCE USED TO READ "no new SQLite queries on the request path", and
it was overtight in a way that cost a working door. See the `desk` note below:
a local SQLite read that happens at most once per minute, for everyone, is not
"on the request path" in any sense that matters — it is behind the same cache
as every other line here.

Each card block below is independently best-effort: an exception (or a genuine
absence of cached data) in one block never takes the other seven down, and
never blocks the response. A card whose value is `None` renders as a plain
link with no number — a valid state, not an error.

Several of the eight doors are deliberately left `None` rather than wired to
a "cheap-looking" read that is not actually safe on this request path:

  * `journal`  — per-user data. This endpoint's payload is cached under ONE
                 global key (`dashboard_signposts`) shared by every logged-in
                 user, so writing one member's open-trade count into it would
                 leak that count to the next 60 seconds' worth of everyone
                 else's requests.
  * `community`— same per-user/single-global-cache-key problem as `journal`.

Those two are FIRM refusals: their cause is that the value differs per member
and this cache key does not. `desk` was listed beside them and did not belong
— it is the same number for everybody, and its only objection was that
`desk_store.list_posts` has no TTLCache of its own. It does not need one: this
endpoint already owns a 60s cache, so the read happens at most once a minute
across all members.

🔴 AND THE CLIENT-SIDE STAND-IN IT WAS LEFT TO WAS BROKEN, WHICH IS HOW A
"conservative" refusal became the expensive choice. `ZoneDoors.jsx` filled the
door from `TheWeek`'s SWR cache, which meant it was blank Monday–Friday (that
hero mounts only at the weekend) — and on the days it DID render it could only
ever say "0", because `substack_posts.published_at` is a UNIX EPOCH INT and the
client filtered with `Date.parse(a.published_at)`, which is `NaN` for an
integer. Every article failed `Number.isFinite` and the count was structurally
zero. Computing it here is both correct and seven-days-a-week.

🔴 AND `uct20` WAS THE SAME MISTAKE IN A THIRD COSTUME — not a refusal this
time, but a read aimed one tier too shallow. It peeked the `uct20_portfolio`
cache key to avoid `engine.get_uct20_portfolio_data()`'s network tail, which was
the right instinct and the wrong depth: nothing on this pod ever warms that key
(it is absent from `main.py`'s warm roster, and `/api/push` invalidates it every
morning), while `wire_data` — which carries the whole portfolio — is seeded into
the cache at boot from the volume. The door filled only when some unrelated
request had warmed the key first. See the `uct20` block for the fix and
`engine.get_uct20_portfolio_warm()` for the one authority it now reads.

⭐ THE SHAPE, THREE TIMES: `desk` was refused for a reason that did not apply,
`journal`/`community` are refused for a reason that does, and `uct20` was not
refused at all — it read a source that happens to be cold. "Why is this door
bare" is three different questions, and only the middle one is a decision.

See `app/src/pages/dashboard/doors.js` for the manifest these 8 keys are
derived from — it is the single authority for what the doors are.
"""
import time

from fastapi import APIRouter, Depends

from api.middleware.auth_middleware import get_current_user
from api.services import engine
from api.services.cache import cache

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

_TTL = 60

# "New" reads as RECENCY, not archive size: the listing returns its `limit`
# regardless of age, so counting the array would answer "how many did we read"
# under a label promising "how many are new". 48h is deliberately loose for a
# desk that publishes at most a few times a day.
_DESK_NEW_WINDOW_SEC = 48 * 60 * 60


def _card(label: str, value, tone: str = "neutral") -> dict:
    return {"label": label, "value": value, "tone": tone}


@router.get("/signposts")
def signposts(user: dict = Depends(get_current_user)) -> dict:
    cached = cache.get("dashboard_signposts")
    if cached is not None:
        return cached

    out: dict[str, dict] = {}

    # breadth — Exposure score. engine.get_breadth() never does network I/O on
    # Railway: its only live-fetch fallback imports a local-dev-only package
    # that isn't deployed, so a cache miss falls through to a disk read (or
    # empty) instead of a live Finviz call.
    try:
        b = engine.get_breadth() or {}
        out["breadth"] = _card("Exposure", (b.get("exposure") or {}).get("score"))
    except Exception:
        out["breadth"] = _card("Exposure", None)

    # options_flow — count of live Top Flow picks. top_flow_tracker.get_all()
    # reads an in-process dict loaded once at startup — zero I/O per call.
    try:
        from api.top_flow_tracker import get_all as _get_top_flow_picks
        picks = _get_top_flow_picks() or {}
        active = picks.get("active")
        out["options_flow"] = _card("Today", len(active) if active is not None else None)
    except Exception:
        out["options_flow"] = _card("Today", None)

    # uct20 — open positions entered on the most recent entry date. This is the
    # SAME number a member can count off /uct-20: `UCT20.jsx` badges a row NEW
    # when `posData.entry_date === latestEntry`, where `latestEntry` is the max
    # `entry_date` across open positions. Matching that idiom (rather than
    # inventing a 7-day window) means the door and the page it opens can never
    # disagree. Measured against the live wire on 2026-08-30: 18 positions dated
    # 2026-08-27 and 2 dated 2026-08-28, so this says 2 — not 20.
    #
    # 🔴 IT WAS BARE IN PRODUCTION, AND THE REASON WAS ORDER-DEPENDENCE.
    # This block used to peek `cache.get("uct20_portfolio")` by hand — the first
    # tier of `engine.get_uct20_portfolio_data()`'s resolution — deliberately
    # avoiding that function because its LAST tier fetches bars for every
    # ever-held symbol. But the tier it skipped in the middle is the warm one:
    #
    #   * `wire_data` IS seeded into the cache at boot by `api/main.py`'s
    #     lifespan, from `/data/wire_data.json` on the Railway volume, and it
    #     carries `uct20_portfolio` whole. Zero network, warm on a fresh pod.
    #   * `uct20_portfolio` itself is warmed by NOTHING. It is not in
    #     `main.py`'s `_warm_dashboard_caches` roster, and `/api/push`
    #     INVALIDATES it on every morning wire run while re-setting `wire_data`.
    #
    # So the door filled only if some unrelated request (a member opening
    # /uct-20, the voice tools, /api/uct20/backtest) had already re-derived the
    # key — a coin flip, re-tossed every morning. `engine.get_uct20_portfolio_warm()`
    # is those two warm tiers and nothing else; `get_uct20_portfolio_data()` is
    # now DERIVED from it, so there is one authority for "where does the
    # portfolio come from without a network call".
    #
    # ⛔ `open_positions: []` is 0, not null. An empty book is an ANSWER ("no
    # names are new"); only a missing/absent portfolio is "we do not know".
    try:
        portfolio = engine.get_uct20_portfolio_warm() or {}
        positions = portfolio.get("open_positions")
        if isinstance(positions, list):
            # `entry_date` is an ISO 'YYYY-MM-DD' STRING (verified against the
            # live wire payload). ISO dates sort lexicographically, so `max` is
            # the newest — but only over strings: a stray non-string would make
            # `max` raise on a mixed list and null the whole card.
            entry_dates = [
                p.get("entry_date") for p in positions
                if isinstance(p, dict) and isinstance(p.get("entry_date"), str)
            ]
            latest = max(entry_dates) if entry_dates else None
            new_count = (
                sum(1 for p in positions
                    if isinstance(p, dict) and p.get("entry_date") == latest)
                if latest else 0
            )
        else:
            new_count = None
        out["uct20"] = _card("New", new_count)
    except Exception:
        out["uct20"] = _card("New", None)

    # calendar — tonight's AMC reporter count ("on deck" = up next). Peeks the
    # "earnings" cache key directly rather than calling engine.get_earnings():
    # that function does a LIVE EarningsWhispers/Finnhub/FMP fetch on a cache
    # miss, which is exactly the network call this endpoint must never make.
    #
    # ⚠️ THIS ONE STAYS A PEEK, AND THE REASON IS NOT THE SAME AS uct20's WAS.
    # `uct20` had a warm mirror (wire_data carries the whole portfolio) and was
    # simply not reading it. `amc_tonight` has NO warm mirror anywhere:
    # `_normalize_earnings` builds it from `_fetch_ew_live(today)` plus a live
    # Finnhub calendar call, and `wire_data["earnings"]` carries only `bmo` and
    # `amc` (today's BMO + YESTERDAY's after-close) — measured against the live
    # wire payload, whose earnings keys are exactly {"bmo", "amc"}. Reading
    # `weekly_calendar[today]["amc"]` instead would be a SECOND, different
    # definition of "on deck" (a raw provider roster vs EW's ranked top-15),
    # silently swapping which one the door shows depending on cache state — a
    # worse failure than a bare door.
    #
    # It is therefore order-dependent, but not a coin flip like uct20 was. The
    # `earnings` key IS warmed deterministically, and in the windows where
    # "tonight's reporters" is the live question:
    #   * boot        — `main.py::_warm_dashboard_caches` calls get_earnings()
    #                   ~8s after startup.
    #   * every 15min — `fundamentals_reporters_warm`, `CronTrigger(day_of_week=
    #                   "mon-fri", hour="6-9,16-19", minute="*/15")`, which reads
    #                   `amc_tonight` itself. Cadence is under the key's 1800s TTL.
    # Between ~10:15 and 16:00 ET the key can expire and the door goes bare
    # until a member opens /calendar. Closing THAT would mean adding provider
    # load on a schedule, which is an owner call, not a signposts change.
    #
    # ⛔ A WARM-BUT-EMPTY EARNINGS KEY IS `0`, NOT NULL. `_normalize_earnings`
    # always returns an `amc_tonight` list, so a genuinely quiet night prints
    # "0" and only a cold key leaves the door bare. Those two states must stay
    # distinguishable — do not `or []` this into a fake zero.
    try:
        earnings = cache.get("earnings") or {}
        amc_tonight = earnings.get("amc_tonight")
        out["calendar"] = _card(
            "On deck", len(amc_tonight) if amc_tonight is not None else None
        )
    except Exception:
        out["calendar"] = _card("On deck", None)

    # screener — total scanner candidates. get_candidates() never does network
    # I/O even on a cache miss (cache → wire_data → local file → empty dict).
    try:
        candidates = engine.get_candidates() or {}
        out["screener"] = _card("Matches", (candidates.get("counts") or {}).get("total"))
    except Exception:
        out["screener"] = _card("Matches", None)

    # desk — articles published in the last 48h. One local SQLite read, behind
    # this endpoint's own 60s cache, identical for every member.
    #
    # ⛔ EPOCH SECONDS, NOT A DATE STRING. `substack_posts.published_at` is an
    # INTEGER (verified against the live store: every row of 40 sampled). This
    # is exactly what the client-side version got wrong — `Date.parse` of an
    # integer is NaN, so its count was structurally zero — so the comparison is
    # numeric here and a non-numeric row is skipped rather than coerced.
    try:
        from api.services import desk_store

        now_ts = time.time()
        fresh = 0
        for post in desk_store.list_posts(limit=12) or []:
            ts = post.get("published_at")
            if not isinstance(ts, (int, float)) or isinstance(ts, bool):
                continue
            age = now_ts - float(ts)
            # "In the last 48 hours" — a future-dated row is not "new", it is a
            # clock problem, and counting it would inflate the number silently.
            if 0 <= age <= _DESK_NEW_WINDOW_SEC:
                fresh += 1
        out["desk"] = _card("New", fresh)
    except Exception:
        out["desk"] = _card("New", None)

    # journal, community — see module docstring: per-user, and this payload is
    # cached under ONE key shared by every member. Filled on the CLIENT instead.
    for key, label in (("journal", "Open"), ("community", "Unread")):
        out[key] = _card(label, None)

    cache.set("dashboard_signposts", out, ttl=_TTL)
    return out
