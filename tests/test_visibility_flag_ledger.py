"""A flag that decides who can SEE the output must say so, and a wildcard must be attributable.

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
3. a WILDCARD on a public-exposure flag with no dated `owner_decision` to attribute it to;
4. a declared value that names a show section the router cannot actually produce
   (so a section rename cannot leave the ledger quietly describing fiction);
5. the derivation itself going vacuous — a broken predicate that finds nothing would
   otherwise pass every assertion above (rule 14: an empty result is a failed
   invocation until proven otherwise).

⛔ WHAT THIS CANNOT DO: it has no network. It enforces that the decision is WRITTEN and
that the written decision is internally coherent — never that Railway agrees with it.
`tools/flag_ledger_audit.py --visibility` is the half that reads the live services and
applies the same rule THERE. Keep them separate so this suite stays offline.
"""
from __future__ import annotations

import json
import re
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
def test_a_wildcard_is_refused_unless_the_ledger_carries_a_dated_owner_decision(name):
    """A wildcard means "everything we produce, to everyone". That is a decision a person
    makes, not a value that appears.

    ⭐ OWNER RULING 2026-09-13, and it is the right correction to what this rail first did:
    **the rail's job is to record intent, not to block it.** The first version refused `*`
    outright — which would have made a legitimate, deliberate business decision
    unexpressible, and the predictable result of a rail that forbids something the owner
    wants is that someone sets it on Railway and never writes it down. That is exactly the
    state that produced the 25-day ambiguity: the decision WAS made on 2026-08-19 and the
    only thing missing was the record.

    So the wildcard is allowed, and it costs an attributable sentence: `owner_decision`,
    carrying a date. A wildcard WITHOUT it still fails — because then nobody can tell a
    decision from a leak, which is the whole problem.
    """
    problem = wildcard_authorisation_error(_ledger().get(name) or {})
    assert problem is None, f"{name}: {problem}"


def wildcard_authorisation_error(entry: dict):
    """The ONE implementation of "may this entry carry a wildcard?" — returns None or why not.

    ⛔ It is a named function, called by BOTH the real-ledger test above and the synthetic-entry
    test below, because the on-disk ledger is (correctly) AUTHORISED — so a test that only reads
    it can never drive this rule's FAILING direction. The mutation harness proved exactly that:
    neutering the check left all 15 tests green, because nothing ever asked it about an
    UNauthorised entry. Same shape as the `_advanceable` survivor in S-A. A guard whose failing
    branch no fixture can reach is not a guard.
    """
    if entry.get("exposure") != "public":
        return None
    wildcards = [v for v in [entry.get("default"), *entry.get("values", [])]
                 if isinstance(v, str) and v.strip().lower() in WILDCARDS]
    if not wildcards:
        return None
    decision = (entry.get("owner_decision") or "").strip()
    if not decision:
        return (f"declares the wildcard {wildcards!r} with no `owner_decision`. A wildcard on a "
                f"public-exposure flag is allowed ONLY as a recorded decision — otherwise it is "
                f"indistinguishable from the 2026-08-19 state, which ran 25 days precisely "
                f"because the decision was never written down.")
    if not re.search(r"\b20\d{2}-\d{2}-\d{2}\b", decision):
        return f"`owner_decision` must carry the DATE of the decision. Got: {decision!r}"
    if len(decision) < 40:
        return (f"`owner_decision` must say what was decided, not just that something was. "
                f"Got {len(decision)} chars.")
    return None


def test_the_authorisation_rule_is_driven_in_its_FAILING_direction_too():
    """CONTROL for the rule above, and it exists because a mutation SURVIVED without it.

    The on-disk ledger is authorised, so the real-ledger test passes whether the rule works or
    not. These synthetic entries are the only thing that makes it load-bearing.
    """
    ok = {"exposure": "public", "values": ["*"],
          "owner_decision": "Owner decision 2026-08-19, reaffirmed 2026-09-13: all auto-recorded "
                            "sessions publish public to YouTube."}
    assert wildcard_authorisation_error(ok) is None                        # the live entry's shape
    assert "no `owner_decision`" in wildcard_authorisation_error(
        {k: v for k, v in ok.items() if k != "owner_decision"})            # the 2026-08-19 state
    assert "DATE" in wildcard_authorisation_error(
        {**ok, "owner_decision": "the owner approved this at some point and said it was fine"})
    assert "what was decided" in wildcard_authorisation_error({**ok, "owner_decision": "2026-09-13"})
    # ...and it stays silent where it should: no wildcard, or not a public-exposure flag.
    assert wildcard_authorisation_error({"exposure": "public", "values": ["sunday scans"]}) is None
    assert wildcard_authorisation_error({"exposure": "internal", "values": ["*"]}) is None


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
            if value.strip().lower() in WILDCARDS:
                continue   # a wildcard names every section by definition, not one of them
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


def test_the_CODE_default_still_fails_conservative_when_nothing_is_set():
    """⭐ This pins the FALLBACK, not the live policy, and the distinction is the point.

    The live value is the wildcard `*` — every show publishes public, by the owner's decision
    of 2026-08-19 reaffirmed 2026-09-13. That is a Railway VALUE. `_PUBLIC_SHOWS_DEFAULT` is
    what runs when the variable is ABSENT — a fresh service, a typo'd name, a wiped
    environment — and it must stay the conservative answer, so that losing the variable can
    never silently widen exposure. An unset flag publishing everything would be the one
    failure direction nobody would notice.
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

def test_the_live_audit_flags_an_UNAUTHORISED_wildcard_and_passes_an_authorised_one(monkeypatch, tmp_path):
    """⛔ A GUARD NOBODY HAS SEEN FIRE IS NOT A GUARD (`lesson_gate_that_cannot_fail`).

    The offline rails cannot catch the real incident: the wildcard was never in the repo.
    It existed only as a value on a live Railway service, which is why 25 days passed with
    every rail green. `tools/flag_ledger_audit.py --visibility` is the half that looks.

    ⭐ And since the owner's 2026-09-13 ruling it must distinguish two states that LOOK
    IDENTICAL on the wire — the live value is `*` in both:
      * `*` with a dated `owner_decision`  -> a recorded decision, CLEAN;
      * `*` with none                      -> indistinguishable from a leak, FINDING.
    A rail that cannot tell those apart is either useless (never fires) or a nuisance that
    fires on the owner's own decision until someone mutes it. Both paths are driven here.
    """
    import importlib.util, json as _json

    spec = importlib.util.spec_from_file_location(
        "flag_ledger_audit_under_test", REPO / "tools" / "flag_ledger_audit.py")
    audit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(audit)
    monkeypatch.setattr(audit, "_services", lambda: ("web",))

    def with_ledger(entry: dict, live_value: str):
        """Point the tool at a crafted ledger + live value, exercising the REAL code path."""
        docs = tmp_path / "docs"
        docs.mkdir(exist_ok=True)
        (docs / "feature_flags.json").write_text(
            _json.dumps({"flags": {"DESK_PUBLIC_SHOWS": entry}}), encoding="utf-8")
        monkeypatch.setattr(audit, "REPO", tmp_path)
        monkeypatch.setattr(audit, "_values_for",
                            lambda service, wanted: {"DESK_PUBLIC_SHOWS": live_value})
        return audit.visibility_audit()

    AUTHORISED = {"exposure": "public", "default": "sunday scans", "values": ["*", "sunday scans"],
                  "owner_decision": "Owner decision 2026-08-19, reaffirmed 2026-09-13: all "
                                    "auto-recorded sessions publish public to YouTube."}

    # 1. THE 2026-08-19 STATE — the wildcard was live and nothing recorded the decision.
    unrecorded = {k: v for k, v in AUTHORISED.items() if k != "owner_decision"}
    out = with_ledger(unrecorded, "*")
    assert len(out["findings"]) == 1 and "no dated owner_decision" in out["findings"][0]["why"], out

    # 2. an owner_decision with no DATE is not a record anybody can age — still a finding.
    undated = {**AUTHORISED, "owner_decision": "the owner said it was fine at some point"}
    assert len(with_ledger(undated, "*")["findings"]) == 1

    # 3. CONTROL — the same live wildcard, properly recorded, is CLEAN.
    assert with_ledger(AUTHORISED, "*")["findings"] == []

    # 4. a value outside the declared set is still caught, wildcard or not.
    f = with_ledger(AUTHORISED, "live trading sessions,mystery show")["findings"]
    assert len(f) == 1 and "outside the declared values" in f[0]["why"]

    # 5. CONTROL — a declared value is clean, so 4 is discriminating rather than always-red.
    assert with_ledger(AUTHORISED, "sunday scans")["findings"] == []

    # 6. CONTROL — an empty read is never reported as clean.
    monkeypatch.setattr(audit, "_values_for",
                        lambda service, wanted: (_ for _ in ()).throw(
                            audit.RailwayUnavailable("no variables")))
    with pytest.raises(audit.RailwayUnavailable):
        audit.visibility_audit()
