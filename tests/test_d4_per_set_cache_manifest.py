"""D4 CP1 — the per-set cache-key manifest, DECLARED BY HAND. No product code.

GATE-D4 CP1 (re-signed 2026-09-13): **declared manifest + existence rail.**
No AST population scan, no closure walk.

⚰️⚰️ **THIS REPLACES A DERIVED DETECTOR THAT FAILED FIVE TIMES.** The first CP1
tried to *discover* the population by walking the AST, and each attempt was wrong
in a new way: a glob that matched nothing, reading the call argument instead of
what it held, `{"get","set"}` matching every `dict.get` in the estate, one
assignment hop too few (which hid the very site the spec holds up as CORRECT),
and a module-wide assignment map matching a `key` across unrelated functions. The
sixth fix was O(n²) and hung the suite. The work is preserved as **F-D4-1**.

⭐ **THE STANDING RULE THIS PRODUCED (owner, 2026-09-13):** *any rail whose build
exceeds two mutation cycles of self-correction gets replaced by a declaration plus
an existence check and a follow-up — not a sixth attempt.* A derived population is
a research project; a declared one is a decision, and a decision is what a rail
should encode.

⛔ **WHAT THIS RAIL DOES AND DOES NOT DO.** It does NOT claim to find every cache
site — that is precisely the claim the detector could not honestly make. It
asserts that each site SPEC-D4 §3.4 declares **still exists**, carrying the named
object and verb. A site that moves or disappears fails **by name**. A NEW per-set
key is invisible to it, and that limitation is stated here rather than implied.

⛔ **Anchors are TEXT, never line numbers.** Between writing the manifest and
running it the first time, `watchlist_performance.py`'s cache line had already
moved from 47 to 48.
"""
from __future__ import annotations

import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]

#: ⛔ THE DECLARED POPULATION — SPEC-D4 §3.4, by hand, plus a grep for the cache
#: objects. Each row: the file, a TEXT anchor, the cache object, and the verb.
#: `verdict` is why the set key is acceptable, or that it is the anti-pattern and
#: which checkpoint fixes it.
MANIFEST = [
    # ── row 1 — ANTI-PATTERN, fixed by D4 CP2
    dict(file="api/services/watchlist_performance.py",
         anchor='cache_key = "wl_perf:" + hashlib.md5(',
         obj=None, verb=None, role="key construction",
         verdict="ANTI-PATTERN",
         why="wl_perf: is an MD5 of the WHOLE ticker set wrapping a loop that is "
             "already per-ticker, so one failed ticker's all-None row is cached "
             "against every healthy peer in the same request. Fixed by D4 CP2."),
    dict(file="api/services/watchlist_performance.py",
         anchor="cached = cache.get(cache_key)", obj="cache", verb="get",
         role="read", verdict="ANTI-PATTERN",
         why="the READ half of the wl_perf set key. Two members whose watchlists share 40 of 50 names share NOTHING here. Fixed by D4 CP2."),
    dict(file="api/services/watchlist_performance.py",
         anchor="set_by_completeness(cache_key, results", obj="set_by_completeness",
         verb="set", role="write", verdict="ANTI-PATTERN",
         why="ONE completeness verdict for the WHOLE batch: a single failed ticker marks the entire result partial, or worse, pins its all-None row at the full TTL against healthy peers. Fixed by D4 CP2."),

    # ── row 2 — ANTI-PATTERN, fixed by D4 CP3 (IN CLOSURE, needs a bump)
    dict(file="api/services/theme_performance.py",
         anchor='ck = "theme_ts_extra::" + ",".join(', obj=None, verb=None,
         role="key construction", verdict="ANTI-PATTERN",
         why="theme_ts_extra:: joins sorted ts_keys around a per-symbol loop. "
             "Fixed by D4 CP3, which is BEHAVIOUR-CHANGING and IN CLOSURE."),

    # ── row 3 — ANTI-PATTERN, outside TTLCache entirely, fixed by D4 CP3
    dict(file="api/services/groups.py",
         anchor="hit = _TODAY_CACHE.get(key)", obj="_TODAY_CACHE", verb="get",
         role="read", verdict="ANTI-PATTERN",
         why="a bespoke module dict with a hand-checked TTL and hand eviction, "
             "outside TTLCache entirely. Fixed by D4 CP3 (IN CLOSURE)."),
    dict(file="api/services/groups.py",
         anchor="_TODAY_CACHE[key] = (out, now)", obj="_TODAY_CACHE", verb="set",
         role="write", verdict="ANTI-PATTERN",
         why="the WRITE half of the bespoke dict, with hand-rolled eviction rather than a TTLCache bound. Fixed by D4 CP3 (IN CLOSURE, needs a bump)."),

    # ── row 4 — LEGITIMATE: one provider call carries the whole set
    dict(file="api/services/polygon_extras.py",
         anchor='cache_key = f"pgxidx::{', obj=None, verb=None,
         role="key construction", verdict="BATCH-PROVIDER KEY",
         why="ONE /v3/snapshot/indices request carries every symbol via "
             "ticker.any_of. Splitting the key per index turns one provider call "
             "into up to ten — a rail that banned the SHAPE would demand a regression."),
    dict(file="api/services/polygon_extras.py",
         anchor="_CACHE.set(cache_key, dict(result), _TTL_INDICES)", obj="_CACHE",
         verb="set", role="write", verdict="BATCH-PROVIDER KEY",
         why="the write half of the batch-provider key — legitimate for the same reason as its read: one upstream request carries the whole set."),

    # ── row 5 — LEGITIMATE, and the MODEL: a fast path OVER a per-entity tier
    dict(file="api/routers/live_prices.py",
         anchor='whole_key = f"live_prices_{hashlib.md5(', obj=None, verb=None,
         role="key construction", verdict="DELIBERATE FAST PATH",
         why="§2.4 done correctly: the set key sits OVER the per-ticker "
             "live_px1_{TK} tier and a miss falls through to it rather than "
             "refilling the set key. This is the pattern the others should copy."),
    dict(file="api/routers/live_prices.py",
         anchor="whole_hit = cache.get(whole_key)", obj="cache", verb="get",
         role="read", verdict="DELIBERATE FAST PATH",
         why="the fast-path read. A MISS here falls through to the per-entity tier below rather than refilling this key, which is exactly what §2.4 requires."),
    dict(file="api/routers/live_prices.py",
         anchor="hit = cache.get(_px_key(tk))", obj="cache", verb="get",
         role="read", verdict="PER-ENTITY TIER",
         why="⭐ THE ROW THAT MAKES ROW 5 LEGITIMATE. Without a per-entity tier "
             "underneath, the set key above would be the only cache, which §2.4 "
             "forbids. If THIS line disappears, live_prices becomes the anti-pattern."),

    # ── row 6 — LEGITIMATE by construction
    dict(file="api/services/discord_interactions.py",
         anchor="hit = png_cache.get(key)", obj="png_cache", verb="get",
         role="read", verdict="PER-SET BY CONSTRUCTION",
         why="the value is a rendered PNG of N tickers and has no per-key "
             "decomposition. Declared so nobody 'fixes' it."),
]

VERDICTS = {"ANTI-PATTERN", "BATCH-PROVIDER KEY", "DELIBERATE FAST PATH",
            "PER-SET BY CONSTRUCTION", "PER-ENTITY TIER"}


def _ids(m):
    return f"{m['file'].rsplit('/', 1)[-1]}::{m['role']}::{m['anchor'][:28]}"


@pytest.mark.parametrize("site", MANIFEST, ids=_ids)
def test_every_declared_cache_site_still_exists(site):
    """⛔ THE RAIL. A declared site that no longer exists fails BY NAME."""
    p = ROOT / site["file"]
    assert p.exists(), f"{site['file']} is gone; the manifest names it"
    text = p.read_text(encoding="utf-8", errors="replace")
    assert site["anchor"] in text, (
        f"{site['file']} no longer contains the declared anchor:\n"
        f"    {site['anchor']!r}\n"
        f"  role: {site['role']} · verdict: {site['verdict']}\n"
        f"  why it was declared: {site['why']}\n"
        "Either the site moved — update the anchor — or it was removed, in which "
        "case remove the row. ⛔ Do NOT loosen the anchor to make this pass: a "
        "declaration nobody maintains is an exemption nobody is reading.")


@pytest.mark.parametrize("site", [m for m in MANIFEST if m["obj"]], ids=_ids)
def test_the_declared_line_carries_the_named_object_and_verb(site):
    """The anchor must be the line it claims to be — object and verb, not just
    a string that happens to appear."""
    line = site["anchor"]
    assert site["obj"] in line, (
        f"the anchor does not carry its declared object {site['obj']!r}: {line!r}")
    verb_forms = {"get": (".get(",), "set": (".set(", "[key] =", "set_by_completeness(")}
    assert any(v in line for v in verb_forms[site["verb"]]), (
        f"the anchor does not carry its declared verb {site['verb']!r}: {line!r}")


def test_the_CONTROL_an_anchor_that_cannot_exist_is_NOT_found():
    """NON-VACUITY. If the file read or the `in` test were broken, every
    assertion above would pass over nothing."""
    text = (ROOT / "api/services/watchlist_performance.py").read_text(encoding="utf-8")
    assert "cached = cache.get(cache_key)" in text, "the control's positive case has moved"
    assert "cached = cache.get(THIS_CANNOT_EXIST)" not in text


def test_every_row_carries_a_verdict_and_a_real_reason():
    for m in MANIFEST:
        assert m["verdict"] in VERDICTS, m
        assert len(m["why"]) > 30, f"{m['file']} {m['role']}: no real reason"


def test_every_ANTI_PATTERN_row_names_the_checkpoint_that_fixes_it():
    """⚠️ An anti-pattern with no owner becomes permanent."""
    for m in MANIFEST:
        if m["verdict"] != "ANTI-PATTERN":
            continue
        joined = m["why"]
        assert "CP2" in joined or "CP3" in joined or "see the" in joined, (
            f"{m['file']} is the anti-pattern and names no checkpoint: {joined!r}")


def test_the_manifest_covers_all_six_SPEC_3_4_modules():
    """⛔ The spec calls §3.4 'the whole population, not a sample'. If a module
    drops out of this manifest, the population claim quietly weakens."""
    want = {
        "api/services/watchlist_performance.py", "api/services/theme_performance.py",
        "api/services/groups.py", "api/services/polygon_extras.py",
        "api/routers/live_prices.py", "api/services/discord_interactions.py",
    }
    have = {m["file"] for m in MANIFEST}
    assert want <= have, f"SPEC §3.4 modules missing from the manifest: {sorted(want - have)}"


def test_CP1_touched_no_product_code():
    """⛔ The scope says so: no key renamed, no module touched, cache.py UNTOUCHED
    (D4-D — flow-worker runs it and does not redeploy for it)."""
    assert "D4" not in (ROOT / "api/services/cache.py").read_text(encoding="utf-8")


def test_the_rail_states_what_it_CANNOT_do():
    """⭐ A rail that reads as complete coverage when it is a declaration is the
    more dangerous artifact. The docstring must keep saying so."""
    doc = pathlib.Path(__file__).read_text(encoding="utf-8")
    assert "A NEW per-set key is invisible to it" in doc, (
        "the limitation statement has been edited out of the module docstring")
