"""The after-the-fact verifier, tested against the SHAPE OF THE REAL INCIDENT.

🔴 Every fixture below is a production measurement, not an invented one. `TR` really
does read 0.86261 on pre-2020 history and 1.00000 on 2020+; `BF-A` really was rescaled
3.3475×. A verifier tested on tidy synthetic data would pass and still miss this,
because the thing that made the incident invisible was the SHAPE — clean where everyone
looks, wrong where nobody does.
"""
import importlib

import pytest

vv = importlib.import_module("api.services.bars_vendor_verify")


def series(spec):
    """`{key: close}` from `(key, close)` pairs."""
    return {k: c for k, c in spec}


def scaled(base, factor, lo=None, hi=None):
    """`base` with `factor` applied inside `[lo, hi)` — the exact shape of a rescale."""
    out = {}
    for k, c in base.items():
        inside = (lo is None or k >= lo) and (hi is None or k < hi)
        out[k] = c * factor if inside else c
    return out


VENDOR = series([(20180102 + i, 100.0 + i) for i in range(20)]
                + [(20210102 + i, 200.0 + i) for i in range(20)])


# --------------------------------------------------------------------------- #
# 🔴 the incident
# --------------------------------------------------------------------------- #

def test_the_TR_shape_is_caught_history_wrong_recent_clean():
    """🔴 THE ONE THAT MATTERS. Five stacked 1.03 rescales left TR's pre-2020 history
    at 0.86261 of the vendor while 2020+ reads exactly 1.0. Every operational lane
    reads the recent window — so a verifier that judged on `recent` alone would have
    called this CLEAN, truthfully and uselessly."""
    ours = scaled(VENDOR, 1.0 / 1.03 ** 5, hi=vv.RECENT_FROM_KEY)
    r = vv.compare(ours, VENDOR)

    assert r["ok"] is False, "the TR shape was not caught"
    assert r["spans"]["history"]["ok"] is False
    assert r["spans"]["history"]["ratio"] == pytest.approx(0.86261, abs=1e-5)
    # ⛔ AND THE RECENT SPAN IS GENUINELY CLEAN — which is exactly why `ok` must be the
    # CONJUNCTION and not an average or an either-or.
    assert r["spans"]["recent"]["ok"] is True
    assert r["spans"]["recent"]["ratio"] == pytest.approx(1.0, abs=1e-9)


def test_a_recent_only_check_would_have_reported_it_CLEAN():
    """⛔ THE CONTROL FOR THE TEST ABOVE, and the reason `SPANS` exists. Without it,
    'we check against a vendor' sounds sufficient — and it is not, if the window is
    wrong."""
    ours = scaled(VENDOR, 1.0 / 1.03 ** 5, hi=vv.RECENT_FROM_KEY)
    ratio, n = vv._median_ratio(ours, VENDOR, vv.RECENT_FROM_KEY, None)
    assert n > 0
    assert ratio == pytest.approx(1.0, abs=1e-9), (
        "the recent window really is clean — which is what made the incident invisible")


@pytest.mark.parametrize("label,factor", [
    ("BF-A", 3.3475), ("LBTYA", 2.30), ("VOD", 1.80),
    ("SAN", 0.479), ("BBD", 0.474), ("one 3% pass", 1.03),
])
def test_every_measured_production_factor_is_caught(label, factor):
    """The real magnitudes, including the SMALLEST one. ⚠️ A single 3% pass is the
    hardest to see and the easiest to dismiss as vendor noise; it is the floor this
    tolerance was chosen against."""
    ours = scaled(VENDOR, factor, hi=vv.RECENT_FROM_KEY)
    r = vv.compare(ours, VENDOR)
    assert r["ok"] is False, f"{label} ({factor}x) slipped through"


def test_a_genuinely_clean_series_passes():
    """⛔ THE CONTROL. Without it `compare` could `return ok=False` and every assertion
    above would pass while the verifier was useless."""
    r = vv.compare(dict(VENDOR), VENDOR)
    assert r["ok"] is True
    assert all(s["ok"] is True for s in r["spans"].values())


def test_ordinary_vendor_noise_does_NOT_trip_it():
    """⚠️ A verifier that fires on cent rounding is one people learn to ignore.
    Dividend-adjustment and rounding differences live below ~0.5%."""
    noisy = {k: c * 1.002 for k, c in VENDOR.items()}
    assert vv.compare(noisy, VENDOR)["ok"] is True


# --------------------------------------------------------------------------- #
# "no evidence" is not "fine"
# --------------------------------------------------------------------------- #

def test_no_overlap_is_NO_EVIDENCE_not_a_pass():
    """⛔ THE FAIL-CLOSED DIRECTION. A verifier that returns True when it could not
    compare anything is a permanently-green monitor, which this repo has already paid
    for once."""
    r = vv.compare({19990101: 10.0}, VENDOR)
    assert r["ok"] is None
    assert r["judged"] is False


def test_a_zero_vendor_price_is_skipped_not_divided_by():
    ours = dict(VENDOR)
    vendor = dict(VENDOR)
    vendor[20180105] = 0.0
    r = vv.compare(ours, vendor)
    assert r["ok"] is True, "a zero price poisoned the median instead of being skipped"


def test_only_SHARED_keys_are_compared():
    """A bar we hold and the vendor does not is a COVERAGE question, not a scale one."""
    ours = dict(VENDOR)
    ours[20180401] = 999.0          # vendor has no such session
    assert vv.compare(ours, VENDOR)["ok"] is True


# --------------------------------------------------------------------------- #
# the report names things
# --------------------------------------------------------------------------- #

def test_the_summary_carries_the_NAMES_not_only_a_count():
    """⛔ Tonight a summary reported '16 could not be' and took the names to the grave
    because an emoji broke the print. A count without names is an alert nobody can
    act on."""
    results = {
        "BFA": vv.compare(scaled(VENDOR, 3.3475, hi=vv.RECENT_FROM_KEY), VENDOR),
        "AAPL": vv.compare(dict(VENDOR), VENDOR),
        "ZZZZ": vv.compare({19990101: 1.0}, VENDOR),
    }
    s = vv.summarise(results)
    assert s == {
        "checked": 3, "clean": 1, "diverged": 1, "no_evidence": 1,
        "diverged_tickers": ["BFA"], "no_evidence_tickers": ["ZZZZ"],
    }


def test_the_verdict_line_states_the_RATIOS_not_just_a_boolean():
    line = vv.verdict_line("TR", vv.compare(
        scaled(VENDOR, 1.0 / 1.03 ** 5, hi=vv.RECENT_FROM_KEY), VENDOR))
    assert "DIVERGED" in line
    assert "0.86261" in line, "the line reported a state with no number behind it"
    assert "history" in line and "recent" in line


def test_the_verdict_line_is_pure_ASCII():
    """📛 An emoji in the line whose job is to NAME things is what killed the last
    summary: redirected stdout on Windows encodes cp1252 and the print dies mid-line."""
    line = vv.verdict_line("TR", vv.compare(dict(VENDOR), VENDOR))
    line.encode("cp1252")   # raises if a non-encodable character crept in


# --------------------------------------------------------------------------- #
# the module cannot write
# --------------------------------------------------------------------------- #

def test_the_verifier_has_no_way_to_MUTATE_anything():
    """⛔ A verifier that can also write is one whose green result might be describing
    its own edit. Asserted structurally, against the shipped source."""
    import ast
    import inspect

    tree = ast.parse(inspect.getsource(vv))
    called = {
        n.func.attr for n in ast.walk(tree)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
    }
    for forbidden in ("put_bars", "execute", "executemany", "commit", "write"):
        assert forbidden not in called, f"the verifier calls {forbidden}"
    imported = {a.name.split(".")[0] for n in ast.walk(tree)
                if isinstance(n, ast.Import) for a in n.names}
    imported |= {n.module.split(".")[0] for n in ast.walk(tree)
                 if isinstance(n, ast.ImportFrom) and n.module}
    assert "sqlite3" not in imported, "the verifier imports a database driver"
