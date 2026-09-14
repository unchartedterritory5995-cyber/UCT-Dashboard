"""A flag that decides who can SEE the output must say so, and may never be a wildcard.

⚰️ WHY THIS FILE EXISTS. On 2026-08-19 `DESK_PUBLIC_SHOWS` was set to `*`. From that
day every auto-recorded Zoom session — paid Live Trading Sessions, a paid workshop,
Evening Updates — uploaded to YouTube as **public and searchable** instead of unlisted.
It ran for 25 days and was found on 2026-09-13 by an agent that mentioned it in passing
while doing unrelated work. 27 videos had to be set back to unlisted one at a time.

⛔⛔ **NOTHING IN THE REPO COULD HAVE CAUGHT IT, AND THAT IS THE ACTUAL DEFECT.**
`tests/test_feature_flag_ledger.py` is a good rail and it was blind here for two
independent reasons, either of which alone was enough:

  1. it narrows the census with `is_gate()`, which is TRUE only for names carrying
     `ENABLED` / `DISABLE` / `_ON` — `DESK_PUBLIC_SHOWS` carries none of them;
  2. it only asks about gates that default OFF, and this one defaults to a non-empty
     string, so even a name-agnostic version would have read it as a live decision.

⭐ The generalisable lesson, and the reason this is a separate axis rather than a
widened `is_gate()`: **a gate decides whether a feature RUNS; a visibility flag decides
who can see what it produced.** The blast radius of the first is an outage, which is
loud and reversible. The blast radius of the second is paid content on the open
internet, which is silent and **cannot be un-published**. They deserve different rails.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a visibility flag with no ledger entry at all (the 2026-08-19 shape);
2. a visibility flag declared without `exposure`, `default` or `values`;
3. a WILDCARD in the declared default or values of a public-exposure flag;
4. a declared value that names a show section the router cannot actually produce
   (so a section rename cannot leave the ledger quietly describing fiction);
5. the derivation itself going vacuous — a broken predicate that finds nothing would
   otherwise pass every assertion above (rule 14: an empty result is a failed
   invocation until proven otherwise).

⛔ WHAT THIS CANNOT DO: it has no network. It enforces that the decision is WRITTEN and
that the written decision is internally coherent — never that Railway agrees with it.
`tools/flag_ledger_audit.py --visibility` is the half that reads the live services and
refuses a wildcard THERE. Keep them separate so this suite stays offline.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services import feature_flag_index as ffi

REPO = Path(__file__).resolve().parents[1]
LEDGER_PATH = REPO / "docs" / "feature_flags.json"

WILDCARDS = {"*", "all", "any", "everything"}
REQUIRED_KEYS = ("exposure", "default", "values")
VALID_EXPOSURE = {"public", "internal"}


def _ledger() -> dict:
    return json.loads(LEDGER_PATH.read_text(encoding="utf-8"))["flags"]


def _visibility_flags() -> dict:
    return ffi.visibility_flags(ffi.repo_roots(REPO), REPO)


# ── 5. the derivation must not be vacuous ───────────────────────────────────

def test_the_derivation_finds_the_flag_this_file_was_written_for():
    """CONTROL, and it runs first on purpose.

    Every assertion below is over the derived set. If the predicate broke — a typo in a
    marker, an exclusion widened by one character — the set goes empty and every other
    test in this file passes while checking nothing, which is precisely the failure
    `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail` names.
    """
    found = _visibility_flags()
    assert "DESK_PUBLIC_SHOWS" in found, (
        "the predicate no longer finds the flag that published 27 paid sessions; "
        f"it found: {sorted(found)}")
    assert "DESK_TSDR_ANNOUNCE_SHOWS" in found, "the public-Discord announce selector is not caught"
    assert len(found) >= 4, f"the visibility census collapsed to {len(found)}: {sorted(found)}"


def test_the_predicate_still_excludes_destinations_credentials_and_locations():
    """The other half of the control: a predicate that matched EVERYTHING would also
    satisfy the test above. These three carry a marker word and decide nothing — a
    webhook destination, a signing key and a base URL — and pulling them in would make
    the ledger a list of every string in the codebase."""
    assert not ffi.is_visibility_flag("DISCORD_TSDR_WEBHOOK_URL")
    assert not ffi.is_visibility_flag("DISCORD_CHART_PUBLIC_KEY")
    assert not ffi.is_visibility_flag("UCT_PUBLIC_BASE")
    assert not ffi.is_visibility_flag("DESK_ANNOUNCE_DB_PATH")
    # ...while the real ones still pass
    assert ffi.is_visibility_flag("DESK_PUBLIC_SHOWS")
    assert ffi.is_visibility_flag("WISDOM_BRAINKB_PUBLISH_ENABLED")


# ── 1-2. declared, and declared completely ──────────────────────────────────

def test_every_visibility_flag_is_declared():
    declared, found = _ledger(), _visibility_flags()
    missing = sorted(set(found) - set(declared))
    assert not missing, (
        "These flags decide who can SEE the output and nothing in docs/feature_flags.json "
        "declares them:\n"
        + "\n".join(f"  {k}  ({found[k]['sites'][0]})" for k in missing)
        + "\n\nThis is the DESK_PUBLIC_SHOWS shape: 27 paid sessions went public for 25 days "
          "because no rail asked this question.")


@pytest.mark.parametrize("name", sorted(_visibility_flags()))
def test_a_visibility_flag_declares_its_exposure_default_and_allowed_values(name):
    entry = _ledger().get(name)
    assert entry is not None, f"{name} is not declared at all"
    missing = [k for k in REQUIRED_KEYS if k not in entry]
    assert not missing, (
        f"{name} is declared but does not say {missing}. 'armed' alone is not enough for a "
        f"flag whose VALUE decides public exposure — the ledger has to carry what the value "
        f"is allowed to be, or it cannot tell a deliberate setting from a leak.")
    assert entry["exposure"] in VALID_EXPOSURE, f"{name}: exposure must be one of {VALID_EXPOSURE}"
    assert isinstance(entry["values"], list) and entry["values"], f"{name}: values must be a non-empty list"


# ── 3. the wildcard ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("name", sorted(_visibility_flags()))
def test_a_public_exposure_flag_never_declares_a_wildcard(name):
    """⛔ The exact 2026-08-19 value. A wildcard on a visibility flag means "everything
    we produce, to everyone" — and the whole point of a per-show decision is that it is
    made per show. If that is ever genuinely wanted it is a code change with a review,
    not a one-character environment value nobody can see."""
    entry = _ledger().get(name) or {}
    if entry.get("exposure") != "public":
        return
    bad = [v for v in [entry.get("default"), *entry.get("values", [])]
           if isinstance(v, str) and v.strip().lower() in WILDCARDS]
    assert not bad, (
        f"{name} declares the wildcard {bad!r}. On 2026-08-19 this exact value turned every "
        f"paid Zoom session into a public YouTube video for 25 days.")


# ── 4. declared values must name something the router can produce ───────────

def test_declared_show_values_name_real_router_sections():
    """A ledger that describes sections the router cannot emit is fiction, and it fails in
    the dangerous direction: someone renames a section, the flag silently stops matching,
    and a show that was meant to be public goes quiet (or worse, the reverse)."""
    from api.services import desk_daily_session as desk

    sections = {desk._WS.sub(" ", s).strip().lower()
                for s in ({r[1] for r in desk._RULES} | {h[1] for h in desk._HOST_AWARE}
                          | {desk._DEFAULT_ROUTE[0]})}
    assert sections, "could not derive any routed section — the probe is broken, not the ledger"

    ledger = _ledger()
    for name in ("DESK_PUBLIC_SHOWS", "DESK_TSDR_ANNOUNCE_SHOWS"):
        for value in ledger[name]["values"]:
            assert any(value in s for s in sections), (
                f"{name} declares {value!r}, which matches no section the router can produce: "
                f"{sorted(sections)}")


def test_the_declared_default_matches_the_code_default():
    """Two authorities over one value drift; this pins them together.

    ⚰️ And the drift here is not cosmetic: the owner's own revert instruction on
    2026-09-13 read `DESK_PUBLIC_SHOWS=sundayscans` — no space — which `privacy_for_section`
    would have matched against NOTHING, quietly making even Sunday Scans unlisted. The
    space is load-bearing because the match is a plain substring test.
    """
    from api.services import desk_daily_session as desk

    assert _ledger()["DESK_PUBLIC_SHOWS"]["default"] == desk._PUBLIC_SHOWS_DEFAULT
    assert desk._PUBLIC_SHOWS_DEFAULT == "sunday scans"


def test_the_default_publishes_only_sunday_scans():
    """The owner's ruling, asserted against the real classifier rather than the docs.

    Owner, 2026-09-13: "the wildcard was NOT intentional. Public = Sunday Scans only."
    """
    from api.services import desk_daily_session as desk

    sections = sorted({r[1] for r in desk._RULES} | {h[1] for h in desk._HOST_AWARE}
                      | {desk._DEFAULT_ROUTE[0]})
    import os
    from unittest import mock

    with mock.patch.dict(os.environ, {"DESK_PUBLIC_SHOWS": desk._PUBLIC_SHOWS_DEFAULT}):
        got = {s: desk.privacy_for_section(s) for s in sections}
    public = sorted(s for s, v in got.items() if v == "public")
    assert public == ["Sunday Scans"], f"sections resolving to public: {public}"
    assert len(got) >= 6, "the section list collapsed; this assertion would pass vacuously"


# ── the LIVE half — proven to fire, without touching production ─────────────

def test_the_live_audit_catches_the_wildcard_that_actually_shipped(monkeypatch):
    """⛔ A GUARD NOBODY HAS SEEN FIRE IS NOT A GUARD (`lesson_gate_that_cannot_fail`).

    The offline rails above cannot catch the real incident: the wildcard was never in the
    repo. It existed only as a value on a live Railway service, which is why 25 days
    passed with every rail green. `tools/flag_ledger_audit.py --visibility` is the half
    that looks — so it has to be shown failing on the exact value that shipped, and
    passing on the value that replaced it, without setting anything on production.
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "flag_ledger_audit_under_test", REPO / "tools" / "flag_ledger_audit.py")
    audit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(audit)

    monkeypatch.setattr(audit, "_services", lambda: ("web",))

    def live(values):
        monkeypatch.setattr(audit, "_values_for", lambda service, wanted: dict(values))

    # 1. the value that actually shipped on 2026-08-19
    live({"DESK_PUBLIC_SHOWS": "*"})
    out = audit.visibility_audit()
    assert len(out["findings"]) == 1, out
    assert out["findings"][0]["why"].startswith("WILDCARD")
    assert out["findings"][0]["flag"] == "DESK_PUBLIC_SHOWS"

    # 2. a wildcard hiding in a LIST — the shape a partial revert would leave
    live({"DESK_PUBLIC_SHOWS": "sunday scans,*"})
    assert len(audit.visibility_audit()["findings"]) == 1

    # 3. a value the ledger does not allow (a show quietly added to the public set)
    live({"DESK_PUBLIC_SHOWS": "live trading sessions"})
    f = audit.visibility_audit()["findings"]
    assert len(f) == 1 and "outside the declared values" in f[0]["why"]

    # 4. CONTROL — the value the owner ruled for is clean, so the checks above are
    #    discriminating rather than simply always-red.
    live({"DESK_PUBLIC_SHOWS": "sunday scans"})
    assert audit.visibility_audit()["findings"] == []

    # 5. CONTROL — an empty read must never be reported as clean.
    monkeypatch.setattr(audit, "_values_for",
                        lambda service, wanted: (_ for _ in ()).throw(
                            audit.RailwayUnavailable("no variables")))
    with pytest.raises(audit.RailwayUnavailable):
        audit.visibility_audit()
