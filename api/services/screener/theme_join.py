"""Theme-taxonomy join — the tier the screener's one TEXT column throws away,
the size of a name's thematic footprint, and the rotation percentile the theme
engine already computes.

The taxonomy is one of only two assets in this product that could not be
rebuilt from market data: a hand-curated set of themes whose memberships each
carry a tier and a written rationale. GICS has no analogue — a sub-industry
code is built to be STABLE and a theme is built to be TIMELY. The screener
exposes all of it today as a single TEXT `theme` column naming ONE theme per
row, which discards (a) whether the name is a core or a peripheral member of
that theme, (b) that it may sit in seven others, and (c) whether the theme is
the hottest thing on the board this week or the coldest.

ONE bulk read per build. The whole merged taxonomy is loaded in a single
`theme_db.get_all_themes()` call and grouped in Python; nothing here is
per-ticker.


WHICH ARTIFACT IS AUTHORITATIVE — and why this module reads none of them
directly
-------------------------------------------------------------------------
The taxonomy exists in two places and that is a second-authority trap the
2026-08-23 discovery flagged by name:

* `themes_taxonomy.json` at the repo root (v4.22.0, committed to git) — the
  OWNER BASELINE. `theme_db.seed_from_json()` reseeds from it whenever its
  version *or* its content hash moves. The engine overlay never edits it.
* `auth.db::themes` / `theme_sectors` / `theme_memberships` — the SERVED copy,
  reseeded from that JSON, and the only one the app actually reads.

Measured 2026-08-23 on this box: the two agree exactly — 112 themes, 2,029
memberships, 0 pairs present in one and not the other, 0 tier disagreements.
They agree *because* the DB is a lossless seed, not because either is checked
against the other, so a reader that picked the JSON would answer correctly
today and silently diverge the first time the DB carried anything the seed did
not — which is precisely what the engine overlay is for.

**Neither is this module's source. `theme_db` is.** A third fact lives on top
of both: `theme_db._MERGED_MEMBERSHIP_SQL` unions the owner rows with the
`engine_memberships` overlay under owner precedence, drops overlay rows whose
theme no longer exists, and tags every row `source='owner'|'engine'`. That
merge is the contract, `theme_db.get_all_themes()` is its one bulk reader, and
`groups`, `theme_performance`, `compare_groups`, `scan_period` and
`bars_seeder` all go through it. Re-executing that SQL here — or reading the
JSON, or reading the tables raw — would put a SECOND copy of the merge rule in
the tree, which is this repo's most-repeated defect. So this module opens no
membership connection of its own; the only store it opens directly is the
read-only freshness probe below, which reads a column the merged view does not
expose.


WHAT THIS MODULE DELIBERATELY DOES NOT ANSWER
---------------------------------------------
* **The theme NAME.** `snapshot_db`'s existing `theme` column is written by
  `snapshot_builder` from `ticker_meta.get_ticker_meta()`, which delegates to
  `groups.resolve_primary_theme`. That is the single authority on *which*
  theme a ticker belongs to. Nothing here re-answers it, and no key emitted
  here names a theme.
* **A theme's RETURN.** `theme_performance` owns every theme return and the
  0-100 percentile it ranks them into. This module consumes the percentile
  verbatim and computes no return, no average and no rank of its own.
* **`momentum_delta`.** It is exactly `1w_rank - 1m_rank` and
  `theme_performance` already publishes it (and the ±20 rotating-in/out
  classification built on it). Both ranks are emitted; a formula subtracts
  them. A third column carrying their difference would be one value with two
  writers.
* **`theme_is_core` / a numeric tier ordinal.** Both are pure functions of
  `theme_tier`. If the closed table needs a numeric core flag, derive it
  downstream from `theme_tier` and name `theme_tier` as its source — do not
  add a second reader-side writer.


THE TIER THIS EMITS IS THE TIER OF THE THEME THE `theme` COLUMN NAMES — by
construction, not by coincidence
--------------------------------------------------------------------------
`theme_tier` must not disagree with `theme` on the same row, and computing it
by re-running `resolve_primary_theme` per symbol is a ~3,700-query N+1. It is
also unnecessary. `resolve_primary_theme` sorts the ticker's memberships by::

    (owner-before-engine, _TIER_RANK[tier], owner theme size, theme_id)

Tier is the SECOND key, so whichever theme wins, **its tier is the best tier
the ticker holds in the considered set** — size and id only break ties *within*
that tier. So the best tier over the same considered set is the same value,
and this module derives it in bulk without restating the tiebreak it cannot
see. `test_theme_tier_agrees_with_what_resolve_primary_theme_picks` pins the
equality against the real function so a change to that sort goes red here.

"The considered set" copies that function's own two exclusions, importing the
constants rather than retyping them:

* **Factor buckets are excluded** — `groups._FACTOR_THEME_NAMES`. They are
  style buckets, not stories, and `resolve_primary_theme` already refuses
  them, so including them here would put a tier on a row whose `theme` is
  NULL. Measured 2026-08-23: 44 of 2,029 memberships, 9 symbols whose ONLY
  memberships are factor buckets (they are absent from this reader's output
  entirely, exactly as they are absent from `theme`), and 3 symbols whose best
  tier would differ if they were included.
* **Owner precedence** — `groups._TIER_RANK` orders the tiers, and a symbol
  with ANY owner membership is described by its owner rows alone. An overlay
  add can therefore never move the tier or the count of a symbol the owner has
  already classified, which is the same invariant `groups._theme_sizes` and
  `theme_performance` §4b hold for their aggregates. A symbol with only
  overlay rows is described by those (its `theme` column is engine-derived
  too, so the row stays internally consistent). Measured 2026-08-23:
  `engine_memberships` holds 0 rows, so today every answer here is owner-only.


⛔ ABSENT IS NOT ZERO, AND THIS SOURCE HAS NO CENSUS TO INFER FROM
------------------------------------------------------------------
A ticker outside the taxonomy is ABSENT from this reader's output, so every
theme column reads NULL for it. It never gets `theme_count = 0`. The taxonomy
is a curation, not an enumeration of the market: 1,279 of its 1,336 symbols
are in `cap_universe` and 2,463 `cap_universe` names are simply not in it —
not "measured and found themeless", just never curated. `theme_count = 0`
would be a claim the owner never made, and it would sort to the bottom of
every range and pass every `< n` filter. Same rule inside a row: a membership
whose `tier` is blank contributes to `theme_count` and omits `theme_tier`; a
theme with no `1w_rank` yet omits the percentile keys rather than reading 0
(0 is the WORST percentile on the board, which is the opposite of unknown).

Absence of a *whole source* is different from absence of a row and is
COUNTED, never silent: a dead `theme_db`, an empty taxonomy or an unavailable
`groups` constant returns `{}` with a `_note(failures, "theme_join", ...)`
census entry, so a build that lost the taxonomy is distinguishable from one
where nobody was in a theme.


FRESHNESS — the reason this module has a probe and not just columns
--------------------------------------------------------------------
All 2,029 memberships and all 112 themes share ONE `updated_at`
(`2026-07-26 03:29:56`, measured 2026-08-23 — 28 days), because they are a
single bulk seed, and `engine_memberships`/`engine_runs`/`engine_decisions`
are all empty: the machine built to keep the taxonomy timely has never written
a row. Shipping a tier from that without saying so ships a four-week-old
editorial judgement as a live fact.

It is NOT shipped as a column. Every row would carry the identical value, so a
`theme_asof` column would sort, filter and rank identically for all 3,742 rows
— zero cross-sectional information, the same reason the daily exposure rating
is a product and not a screener dimension. Instead:

* `taxonomy_asof()` is the ONE derivation of the taxonomy's age, public so the
  manifest/as-of layer consumes it instead of re-deriving a second one. It is
  the only place this module opens a store itself, and it opens it read-only.
* `read_theme_fields` calls it once and, when the taxonomy is older than
  `_STALE_DAYS` (env `SCREENER_THEME_STALE_DAYS`, default 14), records
  `stale_taxonomy:<n>d` in the census — a source that answered with something
  this old is a degradation worth a line in the build log. It does NOT
  suppress the columns: 28-day-old curation is still the best answer anyone
  has for these names, and withholding it would be a worse lie than dating it.
  ⭐ The threshold is 14 rather than a number today's data clears, so this
  fires on the CURRENT state of the store — a staleness gate nobody has seen
  trip is not a gate.

`as_of` family for every column here: `snapshot_date`, never `bars_asof`. Tier
and rotation age independently of the bar series the build ran against.


THE ROTATION LEG IS A SEPARATE FAILURE DOMAIN
---------------------------------------------
`theme_performance.compute_rotation_signals()` already ranks every theme's
1w/1m/3m return into a 0-100 percentile among all themes and caches it 15
minutes. This module reads `rankings[...]["1w_rank"]` / `["1m_rank"]` verbatim
for the ticker's HOTTEST considered theme (max `1w_rank`; ties break to the
lowest theme id so a build is reproducible) and emits both from that SAME
theme, so the pair is never a mix of two themes.

⚠️ Two disclosures the wiring wave owns:

1. **That call has side effects.** `compute_rotation_signals` →
   `get_theme_performance`, which never blocks but on a cold cache starts a
   `theme-perf-compute` daemon thread, and on a warm one overlays live prices
   (a bounded, 30s-cached provider call). At 03:00 ET that is one bounded
   external call and possibly one background recompute. `SCREENER_THEME_ROTATION=0`
   drops the whole leg — the two percentile keys go absent and the taxonomy
   columns are unaffected.
2. **The percentile is a point-in-time read stamped into a nightly row.** It
   is computed at BUILD time against whatever `theme_performance` last priced,
   not at the taxonomy's `updated_at` and not at the bar close. A cold cache
   returns `{"rankings": {}}`, which is counted (`rotation_empty`) and emits
   NOTHING — never a zero percentile.

⚠️ Every reader below emits DICT LITERALS keyed by the exact snapshot column
names (never a dynamically-built mapping) — the scalar-population rail derives
writers by AST over ``d["col"] = v`` shapes, and a mapping built from a runtime
comprehension is an invisible collector.
"""
from __future__ import annotations

import contextlib
import os
import pathlib
import sqlite3
from datetime import datetime, timezone

#: The keys this reader may ever put on a ticker's dict. Declared so a test can
#: prove the emitted set never drifts past what the integration contract names;
#: `_TAXONOMY_COLUMNS` answer off the taxonomy alone, `_ROTATION_COLUMNS` off
#: `theme_performance`, and the two legs fail independently.
_TAXONOMY_COLUMNS = ("theme_tier", "theme_count")
_ROTATION_COLUMNS = ("theme_rot_pctile_1w", "theme_rot_pctile_1m")
THEME_COLUMNS = _TAXONOMY_COLUMNS + _ROTATION_COLUMNS

#: Age (days) past which the taxonomy's single bulk-seed stamp is reported into
#: the build census. See the module docstring: 14 is below the store's CURRENT
#: age on purpose, so the note is observable rather than theoretical.
_STALE_DAYS_DEFAULT = 14


def _note(failures, source, outcome) -> None:
    if failures is None:
        return
    key = outcome if isinstance(outcome, str) else type(outcome).__name__
    failures.setdefault(source, {})
    failures[source][key] = failures[source].get(key, 0) + 1


def _env_flag(name: str, default: str = "1") -> bool:
    return str(os.environ.get(name, default)).strip().lower() not in (
        "0", "false", "no", "off", "")


def _stale_days() -> int:
    try:
        return int(os.environ.get("SCREENER_THEME_STALE_DAYS",
                                  str(_STALE_DAYS_DEFAULT)))
    except (TypeError, ValueError):
        return _STALE_DAYS_DEFAULT


def _parse_stamp(s):
    """`updated_at` as an aware UTC datetime, or None.

    SQLite's `datetime('now')` default writes `'YYYY-MM-DD HH:MM:SS'` in UTC
    with no offset; an overlay row written by Python may carry an ISO string
    with a `T` and/or an offset. Both parse; anything else reads as unknown
    rather than as a guessed date."""
    if not s:
        return None
    txt = str(s).strip()
    try:
        dt = datetime.fromisoformat(txt.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _age_days(stamp, now=None):
    dt = _parse_stamp(stamp)
    if dt is None:
        return None
    now = now or datetime.now(timezone.utc)
    return max(0, int((now - dt).total_seconds() // 86400))


def _auth_db_uri():
    """`file:...?mode=ro` URI for auth.db, or None when the path is unknown.

    `auth_db._DB_PATH` is the ONE place the app resolves this file (env
    `AUTH_DB_PATH`, with a repo-local fallback when `/data` is absent);
    re-deriving it here would be a second authority over which database the
    process is using — and in the test suite, over which sandbox the root
    conftest redirected to."""
    from api.services import auth_db
    raw = getattr(auth_db, "_DB_PATH", None)
    if not raw:
        return None
    path = pathlib.Path(os.path.abspath(str(raw)))
    if not path.exists():
        return None
    return path.as_uri() + "?mode=ro"


def taxonomy_asof(failures=None):
    """Freshness of the theme taxonomy, or None when it cannot be read.

    ``{"owner_updated_at", "owner_rows", "owner_age_days",
       "engine_updated_at", "engine_rows", "engine_age_days", "seed_version"}``

    The ONE derivation of the taxonomy's age. The manifest / `_scalars_as_of`
    layer should call this rather than compute a second one, and every
    `theme_*` column's published description should carry `owner_updated_at`
    and `seed_version` — see the module docstring for why the age is not a
    column.

    Read-only by construction: the merged membership view does not expose
    `updated_at`, so this is the one place the module opens auth.db itself,
    and it opens it `mode=ro` so a probe can never write, checkpoint or lock
    the file the web pod is serving from. The engine leg is guarded
    separately — a pre-migration database has no `engine_memberships` and that
    is not a failure of the owner read.
    """
    uri = _auth_db_uri()
    if uri is None:
        _note(failures, "theme_asof", "no_db_path")
        return None
    out = {"owner_updated_at": None, "owner_rows": 0, "owner_age_days": None,
           "engine_updated_at": None, "engine_rows": 0, "engine_age_days": None,
           "seed_version": None}
    try:
        with contextlib.closing(sqlite3.connect(uri, uri=True, timeout=5)) as conn:
            row = conn.execute(
                "SELECT MAX(updated_at), COUNT(*) FROM theme_memberships").fetchone()
            out["owner_updated_at"] = row[0] if row else None
            out["owner_rows"] = int(row[1] or 0) if row else 0
            out["owner_age_days"] = _age_days(out["owner_updated_at"])
            try:
                erow = conn.execute(
                    "SELECT MAX(updated_at), COUNT(*) FROM engine_memberships "
                    "WHERE action = 'add'").fetchone()
                out["engine_updated_at"] = erow[0] if erow else None
                out["engine_rows"] = int(erow[1] or 0) if erow else 0
                out["engine_age_days"] = _age_days(out["engine_updated_at"])
            except sqlite3.Error:
                pass  # pre-migration DB: no overlay table, owner answer stands
            try:
                srow = conn.execute(
                    "SELECT pref_value FROM user_preferences WHERE user_id = 'system' "
                    "AND pref_key = 'theme_seed_version'").fetchone()
                out["seed_version"] = srow[0] if srow else None
            except sqlite3.Error:
                pass
    except Exception as e:
        _note(failures, "theme_asof", e)
        return None
    return out


def _rotation_rankings(failures=None) -> dict:
    """`{lookup key -> ranking entry}` from `theme_performance`, or `{}`.

    Keyed three ways because `compute_rotation_signals` keys `rankings` by the
    WIRE ticker — the theme's `etf_ticker` for ETF-backed themes and the theme
    id for the 49 curated-only ones — while this module holds taxonomy rows.
    Copies `groups._rotation_order`'s idiom (id / etf_ticker first, lowercased
    name as the fallback) so a wire↔DB name drift cannot silently drop a theme
    to "no rank". `setdefault` means an id/ticker key can never be clobbered by
    another theme's name.
    """
    if not _env_flag("SCREENER_THEME_ROTATION"):
        _note(failures, "theme_rotation", "disabled")
        return {}
    try:
        from api.services import theme_performance
        signals = theme_performance.compute_rotation_signals() or {}
    except Exception as e:
        _note(failures, "theme_rotation", e)
        return {}
    rankings = signals.get("rankings") or {}
    if not rankings:
        # A cold theme-performance cache and a genuinely rank-less board are
        # both "cannot answer"; neither is a percentile of 0.
        _note(failures, "theme_rotation", "rotation_empty")
        return {}
    out = {}
    for wire_key, entry in rankings.items():
        if not isinstance(entry, dict):
            continue
        for key in (wire_key, entry.get("ticker"),
                    str(entry.get("name") or "").strip().lower()):
            if key:
                out.setdefault(str(key), entry)
    return out


def _pctile(entry, period):
    """`{period}_rank` as a float, or None. `theme_performance` already
    rounds it to one decimal; this never re-rounds, re-scales or re-ranks —
    a percentile with two owners is a percentile with none."""
    if not isinstance(entry, dict):
        return None
    val = entry.get(f"{period}_rank")
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def read_theme_fields(targets, failures=None) -> dict:
    """`{TICKER: {column: value}}` for the theme taxonomy.

    ONE bulk read (`theme_db.get_all_themes()`) plus one cached call into
    `theme_performance` and one read-only freshness probe — all three
    independent of how many targets are passed. See the module docstring for
    the authority, the tier-equality argument, the owner-precedence rule and
    the absent-is-not-zero contract.
    """
    # `groups` owns both exclusions `resolve_primary_theme` applies. They are
    # imported, never retyped — and if either is gone this module cannot
    # reproduce that function's considered set, so it answers nothing rather
    # than answering differently. A rename lands in the census, not in a
    # column that quietly stopped agreeing with `theme`.
    try:
        from api.services import groups
        tier_rank = groups._TIER_RANK
        factor_names = groups._FACTOR_THEME_NAMES
        to_taxonomy_sym = groups.to_taxonomy_sym
    except Exception as e:
        _note(failures, "theme_join", e)
        return {}
    if not tier_rank or factor_names is None:
        _note(failures, "theme_join", "resolution_constants_unavailable")
        return {}

    try:
        from api.services import theme_db
        taxonomy = theme_db.get_all_themes() or {}
    except Exception as e:
        _note(failures, "theme_join", e)
        return {}
    themes = taxonomy.get("themes") or []
    if not themes:
        # A dead/unseeded taxonomy and a taxonomy with no themes are the same
        # fact here — "cannot answer" — and neither means "nobody is themed".
        _note(failures, "theme_join", "empty")
        return {}

    rankings = _rotation_rankings(failures)

    # {taxonomy sym -> [(theme_id, tier, source, ranking entry or None)]},
    # factor buckets already dropped. Built once; never re-read per target.
    by_sym: dict = {}
    for theme in themes:
        name = str(theme.get("name") or "").strip()
        if name.lower() in factor_names:
            continue
        theme_id = str(theme.get("id") or "")
        entry = None
        if rankings:
            for key in (theme_id, theme.get("etf_ticker"), name.lower()):
                if key and str(key) in rankings:
                    entry = rankings[str(key)]
                    break
        for holding in (theme.get("holdings") or []):
            sym = str(holding.get("sym") or "").strip().upper()
            if not sym:
                _note(failures, "theme_join", "blank_sym")
                continue
            by_sym.setdefault(sym, []).append(
                (theme_id, holding.get("tier"),
                 holding.get("source") or "owner", entry))

    out = {}
    for target in targets:
        tu = str(target or "").strip().upper()
        if not tu:
            continue
        rows = by_sym.get(to_taxonomy_sym(tu))
        if not rows:
            # The normal case for most of the universe — a curated taxonomy is
            # not a census. No per-ticker note: `snapshot_builder` makes the
            # same call for the `theme` column, because counting ~2,400
            # not-curated symbols would bury every real provider miss.
            continue
        owner_rows = [r for r in rows if r[2] != "engine"]
        considered = owner_rows or rows

        row = {}
        # Distinct THEMES, not membership rows: the owner table is
        # UNIQUE(theme_id, sym) but the overlay is not, and "how many themes"
        # is the fact, not "how many rows".
        row["theme_count"] = len({r[0] for r in considered})

        best = min(considered, key=lambda r: tier_rank.get(r[1], 99))
        tier = str(best[1] or "").strip()
        if tier:
            row["theme_tier"] = tier
        else:
            # A membership with no tier still proves the name is in the theme,
            # so it counts; the tier itself is unknown and stays unknown.
            _note(failures, "theme_join", "blank_tier")
        if tier and tier not in tier_rank:
            # Served verbatim (it is the owner's value, not ours to correct)
            # but surfaced, because an unrecognised tier means the vocabulary
            # moved and `_TIER_RANK` sorted it last without saying so.
            _note(failures, "theme_join", f"tier_unrecognised:{tier}")

        # Hottest CONSIDERED theme by 1-week percentile; ties break to the
        # lowest theme id so two builds off one cache agree. Both percentiles
        # come from that one theme — never a 1w from one and a 1m from another.
        ranked = [r for r in considered if _pctile(r[3], "1w") is not None]
        if ranked:
            hottest = min(ranked, key=lambda r: (-_pctile(r[3], "1w"), r[0]))
            row["theme_rot_pctile_1w"] = _pctile(hottest[3], "1w")
            month = _pctile(hottest[3], "1m")
            if month is not None:
                row["theme_rot_pctile_1m"] = month
        out[tu] = row

    # ONE freshness probe per build, reported by AGE rather than presented as
    # current. Best-effort: a failed probe costs the note, never the columns.
    asof = taxonomy_asof(failures)
    if asof is not None:
        age = asof.get("owner_age_days")
        if age is None:
            _note(failures, "theme_join", "asof_unparseable")
        elif age > _stale_days():
            _note(failures, "theme_join", f"stale_taxonomy:{age}d")
    return out
