#!/usr/bin/env python3
"""Track A vendor-capture ingestion + adjudication -- turns an owner's real
TradingView reading of ``OWNER_VENDOR_CAPTURE_PACKET_V3_1.md`` into vendor
observation files, without a human doing the arithmetic by eye.

    python tools/track_a_ingest_vendor_capture.py --csv capture.csv --when 2026-09-10
    python tools/track_a_ingest_vendor_capture.py --json capture.json --when 2026-09-10 --dry-run

Input is either:
  * ``--csv``  a TradingView "Export chart data" file (or any CSV with the
    same column names as the packet script's ``plot(...)`` titles), covering
    as much history as was exported -- every ``phase == 24`` row is found and
    cross-checked for agreement.
  * ``--json`` a single flat object with the same field names, for the Data
    Window fallback path (one bar, hand-transcribed).

Required fields (case-insensitive, either source): ``phase``, ``raw``,
``rising_builtin``, ``rising_candA_runningMax``, ``rising_candB_monotone``,
``median_builtin``, ``median_candLower``, ``median_candMean``,
``percentrank_builtin``, ``percentrank_candA_overL``,
``percentrank_candB_overLplus1``, ``bbw_builtin``, ``bbw_candRatio``,
``bbw_candPercent``. Optional: ``time``/``t`` and ``open``/``high``/``low``/
``close``/``volume`` (the real underlying chart's OHLCV, per
``VENDOR_OBSERVATION_SCHEMA_EXTENSION.md``'s rule that ``market.bars`` is
never synthetic) -- if absent, a clearly-flagged placeholder is written
instead of guessing.

⛔ THIS TOOL NEVER CLASSIFIES A DELTA IT DID NOT FIRST CROSS-CHECK. Two
refusals happen BEFORE any candidate adjudication, and both are fatal
(``CaptureError``, non-zero exit) rather than warnings:

  1. If the capture holds more than one ``phase == 24`` row, every one of
     them must agree exactly (within a numeric tolerance) on all 13 plotted
     values. Disagreement means the capture itself is unreliable -- picking
     one silently would be exactly the "a second authority over one value"
     defect this program keeps naming and fixing elsewhere.
  2. The capture's OWN candidate/control columns must match this packet's
     documented expected values (raw=6, rising_candA=True, ..., see
     ``EXPECTED_CONTROL_VALUES``). If they don't, either the wrong row was
     sent, the paste was corrupted, or TradingView disagrees with this
     program's own arithmetic about plain ``math.min``/``math.max`` -- any of
     which means adjudicating the BUILTIN against these candidates would be
     adjudicating against numbers we cannot trust yet.

Every observation this tool writes has ``engine: {"formula": null, "ast":
null}`` -- it is VENDOR SEMANTICS CAPTURED, never UCT VENDOR-PARITY VERIFIED,
because no UCT engine implementation of these four functions exists. This
tool does not create one; see ``--help`` and the module docstring end for
what happens next and who authorizes it.

⛔ VENDOR SEMANTICS CAPTURED IS NOT THE SAME CLAIM AS RAW VENDOR ARTIFACT
COMPLETE. Everything above proves the CAPTURE is internally trustworthy
(repeated rows agree, control arithmetic checks out) -- it does not by
itself prove a third party could independently verify the browser really
reached TradingView and read these exact numbers. Pass ``--raw-artifact``
(a TradingView CSV export or a saved screenshot image) whenever one exists,
and this tool preserves it verbatim under
``tests/fixtures/vendor/raw_captures/`` and records its path in every
observation's ``provenance.rawArtifact``, closing that gap for future
captures. See ``PROJECT_EVIDENCE_ASSUMPTION_AUDIT_01.md`` §3 for the
capture this gap was found in (no raw artifact exists for it).
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import shutil
import subprocess
import sys
from datetime import date

sys.stdout.reconfigure(encoding="utf-8")

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from tools.vendor_truth import OBS_DIR, VENDOR_DIR  # noqa: E402  (single authority for the path)

PACKET_DOC = "docs/superpowers/specs/universal-indicator-ecosystem/OWNER_VENDOR_CAPTURE_PACKET_V3_1.md"
PACKET_SCRIPT_ID = "uct-oracle-ambiguity-v3"

#: Where a preserved raw CSV/screenshot artifact lives, beside (never inside)
#: the observation records themselves -- vendor_truth.py's load_observations()
#: only reads *.json directly under OBS_DIR and would choke on a binary file
#: there; this directory is a sibling, not a subdirectory of OBS_DIR, and is
#: never scanned by vendor_truth.py at all.
RAW_ARTIFACT_DIR = os.path.join(VENDOR_DIR, "raw_captures")

#: Extensions accepted as a raw artifact -- a real CSV export, or a saved
#: screenshot image (per the packet's own two capture paths).
RAW_ARTIFACT_EXTENSIONS = {".csv", ".png", ".jpg", ".jpeg"}

#: The packet's own "What exactly to expect at the probe row" table -- these
#: are OUR arithmetic, not TradingView's, and are checked BEFORE any builtin
#: is adjudicated (see module docstring, refusal #2).
EXPECTED_CONTROL_VALUES = {
    "raw": (6.0, "float", 1e-9),
    "rising_candA_runningMax": (True, "bool", None),
    "rising_candB_monotone": (False, "bool", None),
    "median_candLower": (3.0, "float", 1e-6),
    "median_candMean": (4.0, "float", 1e-6),
    "percentrank_candA_overL": (75.0, "float", 1e-6),
    "percentrank_candB_overLplus1": (80.0, "float", 1e-6),
    # Tolerance for these two derived from realistic vendor display precision
    # (TradingView's Table view rounds bbw-scale columns to 2 decimals) --
    # 0.5 * 10**-2, matching tools/vendor_truth.py's own
    # "the vendor's own display precision, and NOTHING else" tolerance
    # philosophy, rather than the infinite-precision value this program's
    # own local self-check computed.
    "bbw_candRatio": (1.908367198512619, "float", 5e-3),
    "bbw_candPercent": (190.8367198512619, "float", 5e-3),
}

#: One entry per Tranche 1A ambiguity. ``field`` names match the packet
#: script's own ``plot(..., "name")`` title strings exactly -- that was a
#: deliberate design choice in the packet so a CSV export's header row needs
#: no renaming.
FUNCTIONS = [
    {
        "key": "rising",
        "vendor_function": "ta.rising",
        "builtin_field": "rising_builtin",
        "value_type": "bool",
        "read_decimals": 0,
        "match_tolerance": None,
        "candidates": [
            {
                "name": "candidate_a_running_max",
                "field": "rising_candA_runningMax",
                "label": "running-maximum (candidate A: v5/v6 RETURNS-clause reading -- "
                         "cur > max(prior 3))",
            },
            {
                "name": "candidate_b_monotone",
                "field": "rising_candB_monotone",
                "label": "strict monotone over length+1 samples (candidate B: v3/v4 "
                         "DESCRIPTION reading -- every step up)",
            },
        ],
    },
    {
        "key": "median_even_length",
        "vendor_function": "ta.median (even length)",
        "builtin_field": "median_builtin",
        "value_type": "float",
        "read_decimals": 4,
        "match_tolerance": 1e-4,
        "candidates": [
            {
                "name": "candidate_lower_middle",
                "field": "median_candLower",
                "label": "lower-of-the-two-middles",
            },
            {
                "name": "candidate_mean_of_middles",
                "field": "median_candMean",
                "label": "mean-of-the-two-middles",
            },
        ],
    },
    {
        "key": "percentrank",
        "vendor_function": "ta.percentrank",
        "builtin_field": "percentrank_builtin",
        "value_type": "float",
        "read_decimals": 2,
        "match_tolerance": 1e-4,
        "candidates": [
            {
                "name": "candidate_a_over_L",
                "field": "percentrank_candA_overL",
                "label": "divide by L=4, current bar NOT in the sample",
            },
            {
                "name": "candidate_b_over_Lplus1",
                "field": "percentrank_candB_overLplus1",
                "label": "divide by L+1=5, current bar joins the sample",
            },
        ],
    },
    {
        "key": "bbw",
        "vendor_function": "ta.bbw",
        "builtin_field": "bbw_builtin",
        "value_type": "float",
        "read_decimals": 6,
        "match_tolerance": 1e-3,
        "candidates": [
            {
                "name": "candidate_ratio",
                "field": "bbw_candRatio",
                "label": "raw ratio (2 * mult * stdev / sma)",
            },
            {
                "name": "candidate_percent",
                "field": "bbw_candPercent",
                "label": "ratio times 100",
            },
        ],
    },
]

#: Every non-phase field a capture row must carry, in the packet's own order.
REQUIRED_ROW_FIELDS = [
    "raw",
    "rising_builtin", "rising_candA_runningMax", "rising_candB_monotone",
    "median_builtin", "median_candLower", "median_candMean",
    "percentrank_builtin", "percentrank_candA_overL", "percentrank_candB_overLplus1",
    "bbw_builtin", "bbw_candRatio", "bbw_candPercent",
]

BOOL_FIELDS = {
    "rising_builtin", "rising_candA_runningMax", "rising_candB_monotone",
}


class CaptureError(RuntimeError):
    """A refusal to adjudicate untrustworthy or inconsistent capture data."""


def _norm_key(k: str) -> str:
    return k.strip()


def to_bool(v) -> bool:
    if isinstance(v, bool):
        return v
    s = str(v).strip().lower()
    if s in ("1", "true", "t", "yes", "y"):
        return True
    if s in ("0", "false", "f", "no", "n", ""):
        return False
    raise CaptureError(f"cannot parse {v!r} as a boolean")


def to_float(v) -> float:
    if isinstance(v, bool):
        raise CaptureError(f"expected a number, got a boolean ({v!r})")
    try:
        return float(v)
    except (TypeError, ValueError) as exc:
        raise CaptureError(f"cannot parse {v!r} as a number") from exc


def _coerce_row(raw_row: dict) -> dict:
    """Normalize a raw parsed row (CSV/JSON) into {field: python value}."""
    row = {_norm_key(k): v for k, v in raw_row.items() if v is not None}
    if "phase" not in row:
        raise CaptureError("row is missing 'phase' -- cannot locate the probe row without it")
    out = {"phase": int(round(to_float(row["phase"])))}
    missing = [f for f in REQUIRED_ROW_FIELDS if f not in row]
    if missing:
        raise CaptureError(
            f"row is missing required field(s): {', '.join(missing)}. "
            f"Every one of the packet's 13 non-phase plotted columns is required."
        )
    for field in REQUIRED_ROW_FIELDS:
        out[field] = to_bool(row[field]) if field in BOOL_FIELDS else to_float(row[field])
    # Optional real-chart provenance (never fabricated if absent).
    time_val = row.get("time", row.get("t"))
    out["_time"] = time_val
    for k, alias in (("open", "o"), ("high", "h"), ("low", "l"), ("close", "c"), ("volume", "v")):
        v = row.get(k, row.get(alias))
        out[f"_{k}"] = to_float(v) if v is not None else None
    return out


def parse_capture(path: str) -> list[dict]:
    """Parse a CSV export or a single-row JSON capture into normalized rows."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".json":
        with io.open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        rows = data if isinstance(data, list) else [data]
        return [_coerce_row(r) for r in rows]
    if ext == ".csv":
        with io.open(path, encoding="utf-8-sig", newline="") as fh:
            reader = csv.DictReader(fh)
            return [_coerce_row(r) for r in reader]
    raise CaptureError(f"unrecognized capture file extension: {ext!r} (use .csv or .json)")


def find_phase24_rows(rows: list[dict]) -> list[dict]:
    hits = [r for r in rows if r["phase"] == 24]
    if not hits:
        raise CaptureError(
            "no row with phase == 24 was found in the capture. Locate the probe row "
            f"per {PACKET_DOC}'s step 5 before re-running."
        )
    return hits


def validate_consistency(rows: list[dict]) -> None:
    """Refuse (not silently pick one) if repeated phase==24 rows disagree.

    ⛔ This is a correctness gate, not a convenience check -- see the module
    docstring's refusal #1.
    """
    if len(rows) < 2:
        return
    reference = rows[0]
    mismatches = []
    for i, row in enumerate(rows[1:], start=1):
        for field in REQUIRED_ROW_FIELDS:
            a, b = reference[field], row[field]
            if field in BOOL_FIELDS:
                agree = bool(a) == bool(b)
            else:
                agree = abs(float(a) - float(b)) <= 1e-6
            if not agree:
                mismatches.append(f"row 0 vs row {i}, field {field!r}: {a!r} != {b!r}")
    if mismatches:
        raise CaptureError(
            f"{len(rows)} phase==24 rows were found and they DISAGREE -- refusing to "
            f"pick one. This means the capture itself is unreliable (wrong bars mixed "
            f"together, a mid-transcription error, or a genuinely non-deterministic "
            f"script, which the packet's design rules out). Mismatches:\n  " +
            "\n  ".join(mismatches)
        )


def validate_control_values(row: dict) -> None:
    """Refuse (not adjudicate against untrusted numbers) if OUR OWN control
    arithmetic, as reported back by TradingView, doesn't match what this
    program independently proved it should be (module docstring refusal #2).
    """
    mismatches = []
    for field, (expected, kind, tol) in EXPECTED_CONTROL_VALUES.items():
        got = row[field]
        if kind == "bool":
            ok = bool(got) == bool(expected)
        else:
            ok = abs(float(got) - float(expected)) <= tol
        if not ok:
            mismatches.append(f"{field}: expected {expected!r}, capture reported {got!r}")
    if mismatches:
        raise CaptureError(
            "The capture's own control/candidate arithmetic does NOT match this "
            "program's independently property-tested expected values -- refusing to "
            "adjudicate the builtins against numbers that cannot be trusted yet. "
            f"See {PACKET_DOC}'s expected-value table. Mismatches:\n  " +
            "\n  ".join(mismatches)
        )


def _values_match(a, b, value_type: str, tol) -> bool:
    if value_type == "bool":
        return bool(a) == bool(b)
    a, b = float(a), float(b)
    scale = max(abs(a), abs(b), 1.0)
    return abs(a - b) <= max(tol, tol * scale)


def classify_builtin(func: dict, row: dict) -> dict:
    """Which candidate (if either) the real vendor builtin matches."""
    builtin = row[func["builtin_field"]]
    matches = []
    for cand in func["candidates"]:
        cand_value = row[cand["field"]]
        if _values_match(builtin, cand_value, func["value_type"], func.get("match_tolerance") or 0.0):
            matches.append(cand)
    if len(matches) == 1:
        outcome = "matches_one_candidate"
        finding = (
            f"{func['vendor_function']} builtin ({builtin!r}) matches "
            f"{matches[0]['name']} -- {matches[0]['label']}."
        )
    elif len(matches) > 1:
        # Only possible if two candidates coincide numerically for this probe;
        # the packet's own local self-check proved they don't, so this is a
        # loud, unexpected finding, not a quiet default.
        outcome = "ambiguous_matches_multiple"
        finding = (
            f"{func['vendor_function']} builtin ({builtin!r}) matches MORE THAN ONE "
            f"candidate at this probe row, which the packet's own property test said "
            f"should not happen: {[c['name'] for c in matches]}. Treat as a finding "
            f"requiring re-examination, not a resolved ruling."
        )
    else:
        outcome = "matches_neither"
        finding = (
            f"{func['vendor_function']} builtin ({builtin!r}) matches NEITHER hypothesized "
            f"candidate. The real vendor semantics differ from both {[c['name'] for c in func['candidates']]}. "
            f"This is itself the finding -- do not force a match."
        )
    return {
        "function": func["key"],
        "vendor_function": func["vendor_function"],
        "builtin_value": builtin,
        "outcome": outcome,
        "matched_candidates": [c["name"] for c in matches],
        "finding": finding,
    }


def preserve_raw_artifact(path: str, *, when: str, artifact_dir: str = RAW_ARTIFACT_DIR) -> str:
    """Copy a real CSV export or screenshot into the golden-artifact store
    verbatim (byte-for-byte, never re-encoded) and return its path relative
    to the repo root, for embedding in every observation's provenance.

    ⛔ Refuses an unrecognized extension rather than silently accepting
    anything -- a golden artifact whose format nobody checked is a golden
    artifact nobody can trust later.
    """
    ext = os.path.splitext(path)[1].lower()
    if ext not in RAW_ARTIFACT_EXTENSIONS:
        raise CaptureError(
            f"--raw-artifact {path!r} has extension {ext!r}, not one of "
            f"{sorted(RAW_ARTIFACT_EXTENSIONS)}. Pass the real TradingView CSV "
            f"export or a saved screenshot image, not a transcription."
        )
    if not os.path.isfile(path):
        raise CaptureError(f"--raw-artifact {path!r} does not exist or is not a file.")
    os.makedirs(artifact_dir, exist_ok=True)
    dest_name = f"{when}-{os.path.basename(path)}"
    dest_path = os.path.join(artifact_dir, dest_name)
    shutil.copyfile(path, dest_path)
    return os.path.relpath(dest_path, _ROOT).replace(os.sep, "/")


def _packet_script_source() -> str:
    path = os.path.join(_ROOT, PACKET_DOC)
    with io.open(path, encoding="utf-8") as fh:
        text = fh.read()
    start = text.index("```pine\n") + len("```pine\n")
    end = text.index("\n```", start)
    return text[start:end] + "\n"


def build_observation(func: dict, row: dict, *, when: str, who: str, symbol: str,
                       timeframe: str, platform_version: str, capture_source: str,
                       raw_artifact_path: str | None = None) -> dict:
    real_ohlcv = all(row.get(f"_{k}") is not None for k in ("open", "high", "low", "close"))
    bar_t = row["_time"] if row.get("_time") is not None else 0
    if real_ohlcv:
        bar = {
            "t": bar_t, "o": row["_open"], "h": row["_high"], "l": row["_low"],
            "c": row["_close"], "v": row.get("_volume") or 0,
        }
        ohlcv_note = "real underlying-chart OHLCV captured alongside the plotted values."
    else:
        bar = {"t": bar_t, "o": 0.0, "h": 0.0, "l": 0.0, "c": 0.0, "v": 0}
        ohlcv_note = (
            "PLACEHOLDER bar -- the packet's Data Window fallback does not require the "
            "underlying chart's real OHLCV, and none was independently captured for "
            "this observation. This has no effect on the finding below: this function "
            "is vendor-semantics-only (engine.ast is null), so market.bars is never "
            "read by tools/vendor_truth.py's evaluate()/compare()."
        )
    classification = classify_builtin(func, row)
    obs_id = f"ta-{func['key']}-oracle-ambiguity-v3-1-{when}"
    return {
        "id": obs_id,
        "shape": "stateless",
        "script": {
            "dialect": "pine",
            "source": _packet_script_source(),
            "plot": func["builtin_field"],
        },
        "engine": {"formula": None, "ast": None},
        "market": {"symbol": symbol, "timeframe": timeframe, "bars": [bar]},
        "input": {
            "kind": "synthetic",
            "formula": (
                "phase = bar_index % 25; raw = phase==24?6.0:phase==23?3.0:phase==22?5.0:"
                "phase==21?1.0:phase==20?9.0:10.0+phase"
            ),
            "valuesAtProbe": {
                "phase": 24, "raw": row["raw"],
                "raw[1]": None, "raw[2]": None, "raw[3]": None, "raw[4]": None,
                "note": "raw[n] are not separately reported by the packet's plots; "
                        "derivable as 3.0, 5.0, 1.0, 9.0 respectively per the packet's own worked example.",
            },
        },
        "vendor": {
            "readDecimals": func["read_decimals"],
            "values": {str(bar_t): classification["builtin_value"]},
        },
        "provenance": {
            "platform": "TradingView",
            "platformVersion": platform_version,
            "who": who,
            "when": when,
            "chartUrl": None,
            "rawArtifact": raw_artifact_path,
            "note": (
                f"Captured via {capture_source} against {PACKET_DOC} "
                f"(script id {PACKET_SCRIPT_ID!r}). {ohlcv_note} "
                f"CLASSIFICATION: VENDOR SEMANTICS CAPTURED, NOT UCT VENDOR-PARITY "
                f"VERIFIED -- no UCT engine implementation of {func['vendor_function']} "
                f"exists yet. Finding: {classification['finding']} "
                + (
                    f"RAW ARTIFACT PRESERVED at {raw_artifact_path} -- independently "
                    f"inspectable, not just this session's own transcription."
                    if raw_artifact_path else
                    "RAW ARTIFACT: NONE -- this observation rests on a hand-transcribed "
                    "capture with no independently-inspectable screenshot/CSV/HAR. See "
                    "PROJECT_EVIDENCE_ASSUMPTION_AUDIT_01.md §3."
                )
            ),
        },
        "_classification": classification,  # stripped before writing; see write_observation
    }


def write_observation(obs: dict, obs_dir: str, *, force: bool) -> str:
    os.makedirs(obs_dir, exist_ok=True)
    path = os.path.join(obs_dir, f"{obs['id']}.json")
    if os.path.exists(path) and not force:
        raise CaptureError(f"{path} already exists -- pass --force to overwrite deliberately.")
    to_write = {k: v for k, v in obs.items() if not k.startswith("_")}
    with io.open(path, "w", encoding="utf-8") as fh:
        json.dump(to_write, fh, indent=2, sort_keys=False)
        fh.write("\n")
    return path


def run_vendor_truth(flag: str) -> tuple[int, str]:
    proc = subprocess.run(
        [sys.executable, os.path.join(_ROOT, "tools", "vendor_truth.py"), flag],
        cwd=_ROOT, capture_output=True, text=True,
    )
    return proc.returncode, (proc.stdout + proc.stderr)


def ingest(capture_path: str, *, when: str, who: str, symbol: str, timeframe: str,
           platform_version: str, obs_dir: str, force: bool, dry_run: bool,
           raw_artifact: str | None = None, raw_artifact_dir: str = RAW_ARTIFACT_DIR) -> dict:
    capture_source = f"CSV export ({os.path.basename(capture_path)})" \
        if capture_path.lower().endswith(".csv") else f"Data Window transcription ({os.path.basename(capture_path)})"
    rows = parse_capture(capture_path)
    probe_rows = find_phase24_rows(rows)
    validate_consistency(probe_rows)
    probe = probe_rows[0]
    validate_control_values(probe)

    raw_artifact_path = None
    if raw_artifact and not dry_run:
        raw_artifact_path = preserve_raw_artifact(raw_artifact, when=when, artifact_dir=raw_artifact_dir)
    elif raw_artifact and dry_run:
        # Validate the file is real/acceptable without actually copying it,
        # so a dry run still catches a bad --raw-artifact path early.
        ext = os.path.splitext(raw_artifact)[1].lower()
        if ext not in RAW_ARTIFACT_EXTENSIONS or not os.path.isfile(raw_artifact):
            raise CaptureError(
                f"--raw-artifact {raw_artifact!r} is not an existing file with one of "
                f"{sorted(RAW_ARTIFACT_EXTENSIONS)}."
            )
        raw_artifact_path = f"(dry-run: would preserve under {raw_artifact_dir} as {when}-{os.path.basename(raw_artifact)})"

    observations = [
        build_observation(
            func, probe, when=when, who=who, symbol=symbol, timeframe=timeframe,
            platform_version=platform_version, capture_source=capture_source,
            raw_artifact_path=raw_artifact_path,
        )
        for func in FUNCTIONS
    ]

    report = {
        "capture_source": capture_source,
        "phase24_rows_found": len(probe_rows),
        "consistency": "AGREE" if len(probe_rows) > 1 else "single row, nothing to cross-check",
        "control_values": "MATCH expected (capture trusted)",
        "raw_artifact": raw_artifact_path or "NONE -- capture rests on transcription only, see PROJECT_EVIDENCE_ASSUMPTION_AUDIT_01.md §3",
        "classifications": [obs["_classification"] for obs in observations],
        "written": [],
        "vendor_truth": {},
    }

    if dry_run:
        report["written"] = ["(dry-run: no files written)"]
        return report

    for obs in observations:
        path = write_observation(obs, obs_dir, force=force)
        report["written"].append(path)

    if os.path.abspath(obs_dir) == os.path.abspath(OBS_DIR):
        # tools/vendor_truth.py's CLI always resolves its OWN OBS_DIR constant
        # (by design -- see its load_observations() docstring on why a caller
        # cannot redirect it). Only invoke it when we actually wrote there;
        # a custom --obs-dir (used by this tool's own tests) would otherwise
        # silently check the real, unrelated store and misreport.
        for flag in ("--check", "--coverage"):
            code, output = run_vendor_truth(flag)
            report["vendor_truth"][flag] = {"exit_code": code, "output": output}
    else:
        report["vendor_truth"]["skipped"] = (
            f"obs_dir {obs_dir!r} is not the real observation store "
            f"({OBS_DIR!r}) -- tools/vendor_truth.py's CLI cannot be pointed "
            f"at a custom directory, so the check/coverage run was skipped."
        )

    return report


def _print_report(report: dict) -> None:
    print("=" * 70)
    print("TRACK A VENDOR CAPTURE INGESTION REPORT")
    print("=" * 70)
    print(f"Capture source     : {report['capture_source']}")
    print(f"phase==24 rows     : {report['phase24_rows_found']} ({report['consistency']})")
    print(f"Control values     : {report['control_values']}")
    print(f"Raw artifact       : {report['raw_artifact']}")
    print("-" * 70)
    for c in report["classifications"]:
        print(f"[{c['function']}] {c['finding']}")
    print("-" * 70)
    for path in report["written"]:
        print(f"wrote: {path}")
    for flag, result in report.get("vendor_truth", {}).items():
        if flag == "skipped":
            print(f"\n(vendor_truth.py check skipped: {result})")
            continue
        print(f"\n--- vendor_truth.py {flag} (exit {result['exit_code']}) ---")
        print(result["output"])
    print("-" * 70)
    print(
        "CLASSIFICATION FOR ALL FOUR: VENDOR SEMANTICS CAPTURED, NOT UCT "
        "VENDOR-PARITY VERIFIED. No engine implementation exists for these four "
        "functions; implementing them requires separate authorization after this "
        "evidence is reviewed (per program governing intent -- see GOVERNING_INTENT.md)."
    )
    print(
        "NEXT (manual, deliberately not automated by this tool): update the Track A "
        "rows in RISK_REGISTER.md / PROGRESS.md / VALIDATION_COVERAGE_MAP.md / "
        "PHASE_ONE_PLAN.md with these findings, and record the four rulings in "
        "app/src/components/chart/engine/ast/closedTable.json's _functions_excluded "
        "block -- ONLY as documentation of the now-known semantics, not as "
        "implementation, unless separately authorized."
    )


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--csv", help="TradingView CSV export (or any CSV with the packet's column names)")
    src.add_argument("--json", help="single flat JSON object for the Data Window fallback path")
    ap.add_argument("--when", default=date.today().isoformat(), help="capture date, YYYY-MM-DD (default: today)")
    ap.add_argument("--who", default="owner", help="provenance.who (default: 'owner')")
    ap.add_argument("--symbol", default="AAPL", help="underlying chart symbol (default: AAPL)")
    ap.add_argument("--timeframe", default="1D", help="underlying chart timeframe (default: 1D)")
    ap.add_argument("--platform-version", default="Pine v5, web", help="provenance.platformVersion")
    ap.add_argument("--obs-dir", default=OBS_DIR, help="observation directory (default: tests/fixtures/vendor/observations)")
    ap.add_argument("--force", action="store_true", help="overwrite existing observation files for this --when")
    ap.add_argument("--dry-run", action="store_true", help="validate + classify only; write nothing, run nothing")
    ap.add_argument("--raw-artifact", default=None,
                     help="a real TradingView CSV export or a saved screenshot (.csv/.png/.jpg) to preserve "
                          "verbatim under tests/fixtures/vendor/raw_captures/ as independently-inspectable "
                          "evidence, referenced from every observation's provenance.rawArtifact")
    ap.add_argument("--raw-artifact-dir", default=RAW_ARTIFACT_DIR,
                     help="where to preserve --raw-artifact (default: tests/fixtures/vendor/raw_captures/)")
    args = ap.parse_args(argv)

    capture_path = args.csv or args.json
    try:
        report = ingest(
            capture_path, when=args.when, who=args.who, symbol=args.symbol,
            timeframe=args.timeframe, platform_version=args.platform_version,
            obs_dir=args.obs_dir, force=args.force, dry_run=args.dry_run,
            raw_artifact=args.raw_artifact, raw_artifact_dir=args.raw_artifact_dir,
        )
    except CaptureError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1

    _print_report(report)
    if report.get("vendor_truth", {}).get("--check", {}).get("exit_code", 0) not in (0, None):
        # A non-zero --check after a fresh, correctly-validated ingestion means
        # something ELSE in the store has an unexplained delta -- surface it,
        # don't swallow it into an otherwise-successful ingestion run.
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
