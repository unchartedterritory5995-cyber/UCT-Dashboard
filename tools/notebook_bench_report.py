"""The head-to-head benchmark report: dumps in, docs/notebook/benchmark/results.md out.

Wave 9, lane 9A, item A5. It reads the owner's HAND dumps (one JSON per app, op and round, made by
``tools/bench_probes/bench_probe.js``'s ``dump()``), the automated UCT runner's summary
(``tools/notebook_bench_uct.py``) and the sitting's ``machine.json``, and writes one table per op:

    app · client · instrument · n · p50 · p95 · invalid · source files

⛔ results.md IS GENERATED, NEVER TYPED. The committed file is this tool's output over the
committed run directory, and ``tests/test_notebook_bench_report.py`` regenerates it and compares:
a hand-typed number goes red. Until the owner runs the protocol, every cell reads NOT MEASURED.

What it refuses, BY NAME, per input -- a refused input contributes nothing to any cell:
  * a dump whose ``probeVersion`` is not the version in bench_probe.js (an old probe was pasted);
  * a dump with no PASSING ``selfTest`` reading (R-HON: an unverified probe times nothing);
  * a dump that carries installed test hooks (a jsdom/test dump is never a measurement);
  * a dump missing a key of ``DUMP_SCHEMA_KEYS``, or whose app/op disagree with its file name;
  * every hand dump while ``machine.json`` still holds ``FILL``, or when the machine it names is
    not the one a dump's user agent implies (OS family, Chrome major, Obsidian version).

How a cell reads: no accepted dump ⇒ ``NOT MEASURED`` (never 0); n < 10 ⇒ labelled
``anecdote``; every attempt timed out ⇒ ``not in DOM`` (a virtualising editor may never hold the
last paragraph); a typing dump with fewer samples than keys sent ⇒ ``INCONCLUSIVE``, never a p95
over the keys that landed. There is NO winner column. A ratio is printed only between two cells
measured by the SAME instrument on the SAME machine record (the hand probe against the hand probe;
the automated sandbox run is never ratioed against a hand cell).

This file is the ONE authority on: the dump schema (``DUMP_SCHEMA_KEYS``, imported by the runner
and read by the probe's jsdom rail), the op list (``OPS``: reps, rounds, targets -- the protocol and
the runner read it), the apps (``APPS``) and the machine template (``MACHINE_KEYS``).

    python tools/notebook_bench_report.py --run docs/notebook/benchmark/runs \\
        --machine docs/notebook/benchmark/machine.json --out docs/notebook/benchmark/results.md
    python tools/notebook_bench_report.py --run <sitting-dir> --uct-auto <summary.json> \\
        --machine <sitting-dir>/machine.json --out -

Exit: 0 written; 3 bad arguments (a missing run directory or machine file).
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO / "tools") not in sys.path:
    sys.path.insert(0, str(REPO / "tools"))
from notebook_perf_harness import percentile  # noqa: E402  ONE implementation (harness :189)

PROBE_FILE = REPO / "tools" / "bench_probes" / "bench_probe.js"
RESULTS_MD = REPO / "docs" / "notebook" / "benchmark" / "results.md"

# ⛔ THE dump schema -- the runner imports it, the probe's jsdom rail reads it from this file.
DUMP_SCHEMA_KEYS = ("probeVersion", "app", "op", "kind", "status", "userAgent", "viewport",
                    "capturedAt", "samples", "invalid", "selfTest")
# Every per-op record in the automated runner's summary carries these (validate_summary).
SUMMARY_OP_KEYS = ("op", "kind", "n", "p50_ms", "p95_ms", "status", "reason", "dumps")
SUMMARY_STATUSES = ("MEASURED", "INCONCLUSIVE")

AUTO_APP = "uct-sandbox-auto"
# (id, label, client) -- the client is what the protocol prescribes; the dump's user agent adds
# the version. D-9A4: Notion and Evernote on the web in the SAME Chrome as UCT; Obsidian desktop.
APPS = (
    ("notion", "Notion", "web, the sitting's Chrome"),
    ("evernote", "Evernote", "web, the sitting's Chrome"),
    ("obsidian", "Obsidian", "desktop (Electron)"),
    ("uct", "UCT production (bench account)", "web, the sitting's Chrome"),
    (AUTO_APP, "UCT sandbox (automated)", "headless Chromium (Playwright), loopback"),
)
HAND_APPS = tuple(a[0] for a in APPS if a[0] != AUTO_APP)
BASELINE_APP = "uct"          # ratios are printed against the UCT hand cell, same instrument only
MIN_N = 10                    # n < 10 is an anecdote, labelled so

# The head-to-head ops (dispatch plan §1.2), the ONE list the protocol and the runner use.
# `target` names an entry of the corpus manifest's `timed_notes`.
OPS = (
    {"id": "H1", "kind": "open", "mode": "first", "target": "small", "rounds": 2, "reps_per_round": 10,
     "what": "open a small note in-app (warm) -> first content visible"},
    {"id": "H2", "kind": "open", "mode": "first", "target": "large_1000", "rounds": 2, "reps_per_round": 10,
     "what": "open the 1,000-paragraph note -> first content visible"},
    {"id": "H2-full", "kind": "open", "mode": "full", "target": "large_1000", "rounds": 2, "reps_per_round": 10,
     "what": "open the 1,000-paragraph note -> fully in DOM (its last paragraph is present)"},
    {"id": "H3", "kind": "open", "mode": "first", "target": "large_2000", "rounds": 2, "reps_per_round": 10,
     "what": "open the 2,000-paragraph note -> first content visible"},
    {"id": "H3-full", "kind": "open", "mode": "full", "target": "large_2000", "rounds": 2, "reps_per_round": 10,
     "what": "open the 2,000-paragraph note -> fully in DOM (its last paragraph is present)"},
    {"id": "H4", "kind": "search", "target": "rare", "rounds": 2, "reps_per_round": 10,
     "what": "search the rare term -> the expected note's row appears"},
    {"id": "H5", "kind": "search", "target": "switcher", "rounds": 2, "reps_per_round": 10,
     "what": "quick switcher by unique title -> the row appears"},
    {"id": "H6", "kind": "typing", "target": "small", "rounds": 3, "chars_per_round": 60,
     "what": "typing per character at the end of the small note"},
    {"id": "H7", "kind": "typing", "target": "large_2000", "rounds": 3, "chars_per_round": 60,
     "what": "typing per character at the end of the 2,000-paragraph note"},
    {"id": "H8", "kind": "paste", "target": "paste", "rounds": 2, "reps_per_round": 5,
     "what": "paste the 200-paragraph payload into an empty note -> its end marker renders"},
    {"id": "H9", "kind": "cold", "target": None, "rounds": 5, "reps_per_round": 1,
     "what": "cold start: reload -> largest contentful paint (LCP proxy), reported separately"},
)
OPS_BY_ID = {o["id"]: o for o in OPS}

# machine.json: every key, and the committed template holds "FILL" in each.
MACHINE_KEYS = (
    "run_id", "sitting_date", "operator", "machine_name", "os", "cpu", "ram_gb", "power_plan",
    "display", "network", "chrome_version", "chrome_profile", "obsidian_version", "notion_plan",
    "evernote_plan", "uct_build", "gate_box_lock", "trading_platform_and_zoom_closed",
)
FILL = "FILL"
NOT_MEASURED = "NOT MEASURED"
_NAME_RE = re.compile(r"^(?P<app>[a-z0-9-]+)__(?P<op>H\d(?:-full)?)__r(?P<round>\d+)\.json$")


def op_total(op: dict) -> int:
    """What one app owes for this op across all rounds: attempts, or characters for typing."""
    return op["rounds"] * (op.get("chars_per_round") or op.get("reps_per_round") or 0)


def probe_version(path: Path | None = None) -> str:
    """The version constant IN bench_probe.js -- read, never retyped here."""
    text = Path(path or PROBE_FILE).read_text(encoding="utf-8")
    m = re.search(r"PROBE_VERSION\s*=\s*['\"]([^'\"]+)['\"]", text)
    if not m:
        raise RuntimeError(f"no PROBE_VERSION constant in {path or PROBE_FILE}")
    return m.group(1)


def machine_template() -> dict:
    return {k: FILL for k in MACHINE_KEYS}


def _holds_fill(v) -> bool:
    if isinstance(v, dict):
        return any(_holds_fill(x) for x in v.values())
    if isinstance(v, list):
        return any(_holds_fill(x) for x in v)
    return isinstance(v, str) and v.strip().upper() == FILL


def load_machine(path: Path) -> tuple[dict | None, str | None]:
    """(record, None) when usable, else (None, the refusal sentence)."""
    try:
        rec = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return None, f"machine.json unreadable ({type(e).__name__}: {e})"
    if not isinstance(rec, dict):
        return None, "machine.json is not an object"
    missing = [k for k in MACHINE_KEYS if k not in rec]
    if missing:
        return None, f"machine.json lacks {', '.join(missing)}"
    filled = [k for k in MACHINE_KEYS if _holds_fill(rec[k])]
    if filled:
        return None, (f"machine.json still holds FILL in {len(filled)} of {len(MACHINE_KEYS)} keys "
                      f"({', '.join(filled[:4])}{', ...' if len(filled) > 4 else ''}) -- a template, not a sitting")
    return rec, None


def ua_facts(ua: str) -> dict:
    ua = ua or ""
    os_family = ("windows" if "Windows" in ua else "mac" if "Mac OS X" in ua or "Macintosh" in ua
                 else "linux" if "Linux" in ua else None)
    chrome = re.search(r"(?:Headless)?Chrome/(\d+)", ua)
    obsidian = re.search(r"obsidian/([\d.]+)", ua, re.I)
    return {"os": os_family, "chrome_major": int(chrome.group(1)) if chrome else None,
            "obsidian": obsidian.group(1) if obsidian else None}


def machine_conflict(machine: dict, dump: dict) -> str | None:
    """Why this dump's user agent names a different machine than machine.json, or None."""
    f = ua_facts(str(dump.get("userAgent") or ""))
    mos = str(machine.get("os", "")).lower()
    if f["os"] and f["os"] not in mos:
        return f"its user agent says {f['os']}, machine.json says {machine.get('os')!r}"
    if dump.get("app") == "obsidian":
        if f["obsidian"] and f["obsidian"] != str(machine.get("obsidian_version")).strip():
            return (f"its user agent says Obsidian {f['obsidian']}, machine.json says "
                    f"{machine.get('obsidian_version')!r}")
        return None
    want = re.match(r"\s*(\d+)", str(machine.get("chrome_version", "")))
    if f["chrome_major"] is not None and want and int(want.group(1)) != f["chrome_major"]:
        return (f"its user agent says Chrome {f['chrome_major']}, machine.json says "
                f"{machine.get('chrome_version')!r}")
    return None


def check_dump(d: dict, *, version: str, apps: tuple[str, ...], name: tuple[str, str, int] | None = None) -> str | None:
    """Why this dump is refused, or None. Pure."""
    if not isinstance(d, dict):
        return "not a JSON object"
    missing = [k for k in DUMP_SCHEMA_KEYS if k not in d]
    if missing:
        return f"missing key(s) {', '.join(missing)} (the dump schema, DUMP_SCHEMA_KEYS)"
    if d["probeVersion"] != version:
        return (f"probe version {d['probeVersion']!r} is not bench_probe.js's {version!r} "
                "(an old or edited probe was pasted)")
    st = d.get("selfTest")
    if not (isinstance(st, dict) and st.get("ok") is True and st.get("version") == version):
        return "no passing selfTest reading in this dump (R-HON: an unverified probe times nothing)"
    if d.get("hooks"):
        return "test hooks were installed in the probe (a test dump, never a measurement)"
    if d["app"] not in apps:
        return f"unknown app {d['app']!r}"
    op = OPS_BY_ID.get(d["op"])
    if not op:
        return f"unknown op {d['op']!r}"
    if d["kind"] != op["kind"]:
        return f"op {d['op']} is a {op['kind']} op but the dump is a {d['kind']} session"
    if op["kind"] == "open" and d.get("mode") != op["mode"]:
        return f"op {d['op']} is timed in {op['mode']!r} mode but the dump says {d.get('mode')!r}"
    if name and (name[0], name[1]) != (d["app"], d["op"]):
        return f"the file name says {name[0]}/{name[1]} but the dump says {d['app']}/{d['op']}"
    s = d["samples"]
    if not isinstance(s, list) or not all(isinstance(x, (int, float)) and math.isfinite(x) and x >= 0 for x in s):
        return "samples is not a list of finite non-negative milliseconds"
    if not isinstance(d["invalid"], list) or not all(isinstance(x, str) for x in d["invalid"]):
        return "invalid is not a list of reason strings"
    return None


def _display(p: Path | str | None) -> str:
    if p is None:
        return "(none)"
    p = Path(p)
    try:
        return p.resolve().relative_to(REPO.resolve()).as_posix()
    except ValueError:
        return p.resolve().as_posix()


def collect(run_dir: Path, machine: dict | None, machine_problem: str | None, version: str,
            apps: tuple[str, ...]) -> tuple[dict, list[tuple[str, str]]]:
    """Accepted dumps by (op, app), and every refused file with its reason."""
    cells: dict[tuple[str, str], list[tuple[str, dict]]] = {}
    refused: list[tuple[str, str]] = []
    for p in sorted(Path(run_dir).rglob("*.json")):
        if p.name == "machine.json":
            continue
        shown = _display(p)
        m = _NAME_RE.match(p.name)
        if not m:
            refused.append((shown, "file name is not <app>__<op>__r<round>.json"))
            continue
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            refused.append((shown, f"unreadable JSON ({type(e).__name__})"))
            continue
        why = check_dump(d, version=version, apps=apps, name=(m["app"], m["op"], int(m["round"])))
        if not why and d["app"] == AUTO_APP:
            why = "an automated dump belongs to --uct-auto, not the hand run directory"
        if not why:
            if machine is None:
                why = f"machine record refused: {machine_problem}"
            else:
                why = machine_conflict(machine, d)
        if why:
            refused.append((shown, why))
            continue
        cells.setdefault((d["op"], d["app"]), []).append((shown, d))
    return cells, refused


def validate_summary(summary: dict) -> list[str]:
    """Problems with an automated runner summary; [] when it is usable. The runner's rail holds
    its own output to this, so the two cannot drift."""
    problems = []
    if not isinstance(summary, dict):
        return ["the summary is not an object"]
    for k in ("tool", "git_head", "integrity", "self_test", "per_op", "machine"):
        if k not in summary:
            problems.append(f"summary lacks {k!r}")
    for op_id, rec in (summary.get("per_op") or {}).items():
        if op_id not in OPS_BY_ID:
            problems.append(f"per_op names an unknown op {op_id!r}")
            continue
        missing = [k for k in SUMMARY_OP_KEYS if k not in rec]
        if missing:
            problems.append(f"{op_id}: lacks {', '.join(missing)}")
            continue
        if rec["status"] not in SUMMARY_STATUSES:
            problems.append(f"{op_id}: status {rec['status']!r} is not one of {SUMMARY_STATUSES}")
        if rec["status"] == "MEASURED" and not (isinstance(rec["p50_ms"], (int, float)) and rec["n"]):
            problems.append(f"{op_id}: MEASURED without numbers")
        if rec["status"] == "INCONCLUSIVE" and (rec["p50_ms"] is not None or not rec["reason"]):
            problems.append(f"{op_id}: INCONCLUSIVE must carry a reason and no number")
    return problems


def collect_auto(summary_path: Path | None, version: str) -> tuple[dict, list[tuple[str, str]], str]:
    """The automated summary's dumps as cells, its refusals, and one sentence about it."""
    if summary_path is None:
        return {}, [], "not given -- the UCT sandbox row reads NOT MEASURED"
    p = Path(summary_path)
    try:
        summary = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return {}, [(_display(p), f"unreadable ({type(e).__name__})")], "unreadable"
    problems = validate_summary(summary)
    if problems:
        return {}, [(_display(p), "; ".join(problems[:3]))], "refused"
    integ = (summary.get("integrity") or {}).get("status")
    if integ != "CLEAN":
        return {}, [(_display(p), f"sandbox integrity {integ!r}: every timing is withheld")], "refused"
    if not (summary.get("self_test") or {}).get("ok"):
        return {}, [(_display(p), "the run's selfTest did not pass (R-HON)")], "refused"
    cells: dict = {}
    refused: list = []
    for rec in summary["per_op"].values():
        for rel in rec.get("dumps") or []:
            dp = (p.parent / rel)
            try:
                d = json.loads(dp.read_text(encoding="utf-8"))
            except (OSError, ValueError) as e:
                refused.append((_display(dp), f"unreadable ({type(e).__name__})"))
                continue
            why = check_dump(d, version=version, apps=(AUTO_APP,))
            if why:
                refused.append((_display(dp), why))
                continue
            cells.setdefault((d["op"], d["app"]), []).append((_display(dp), d))
    return cells, refused, (f"{_display(p)} at `{str(summary.get('git_head'))[:9]}`, sandbox "
                            f"integrity CLEAN, selfTest {summary['self_test'].get('ms')} ms")


def summarize_cell(op: dict, dumps: list[tuple[str, dict]]) -> dict:
    samples = [x for _, d in dumps for x in d["samples"]]
    invalid: dict[str, int] = {}
    for _, d in dumps:
        for r in d["invalid"]:
            invalid[r] = invalid.get(r, 0) + 1
    sources = [s for s, _ in dumps]
    if op["kind"] == "typing":
        short = [(s, len(d["samples"]), d.get("expectKeys")) for s, d in dumps
                 if d.get("status") == "INCONCLUSIVE" or (isinstance(d.get("expectKeys"), int)
                                                          and len(d["samples"]) < d["expectKeys"])]
        if short:
            s, got, want = short[0]
            return {"state": "INCONCLUSIVE", "n": len(samples), "invalid": invalid, "sources": sources,
                    "why": f"{len(short)} typing dump(s) short of keys ({got} samples for {want} keys in {s})"}
    if not samples:
        if invalid and set(invalid) == {"not-in-dom"}:
            return {"state": "NOT_IN_DOM", "n": 0, "invalid": invalid, "sources": sources}
        return {"state": "NO_SAMPLES", "n": 0, "invalid": invalid, "sources": sources}
    return {"state": "MEASURED", "n": len(samples), "p50": percentile(samples, 50), "p95": percentile(samples, 95),
            "anecdote": len(samples) < MIN_N, "invalid": invalid, "sources": sources}


def _ms(x: float) -> str:
    return f"{x:.1f} ms"


def _client(app: str, label_client: str, dumps: list[tuple[str, dict]]) -> str:
    if not dumps:
        return label_client
    f = ua_facts(str(dumps[0][1].get("userAgent") or ""))
    extra = (f"Obsidian {f['obsidian']}" if f["obsidian"] else
             f"Chrome {f['chrome_major']}" if f["chrome_major"] else "")
    return f"{label_client}{'; ' + extra if extra else ''}"


def _instrument(app: str, op: dict, version: str) -> str:
    how = "Playwright, automated" if app == AUTO_APP else "by hand"
    lcp = "; LCP proxy" if op["kind"] == "cold" else ""
    return f"bench_probe.js `{version}`, {how}{lcp}"


INPUTS_RE = re.compile(r"^- Inputs: --run `(?P<run>[^`]+)` --machine `(?P<machine>[^`]+)` "
                       r"--uct-auto `(?P<auto>[^`]+)`$", re.M)


def inputs_of(results_text: str) -> tuple[Path, Path, Path | None]:
    """The three inputs a results.md was generated from, read off its own Inputs line -- so the
    rail can regenerate ANY committed results.md (the empty template run, or a real sitting with
    its own machine.json) from exactly what produced it."""
    m = INPUTS_RE.search(results_text)
    if not m:
        raise ValueError("results.md has no Inputs line")
    def resolve(s: str) -> Path:
        p = Path(s)
        return p if p.is_absolute() else REPO / p
    return resolve(m["run"]), resolve(m["machine"]), (None if m["auto"] == "(none)" else resolve(m["auto"]))


def render(cells: dict, refused: list, *, version: str, run_dir: Path, machine_path: Path,
           machine: dict | None, machine_problem: str | None, auto_note: str,
           apps: tuple = APPS, auto_path: Path | None = None) -> str:
    lines = [
        "# Head-to-head benchmark: results",
        "",
        "> ⛔ **GENERATED by `tools/notebook_bench_report.py` -- never typed.** "
        "`tests/test_notebook_bench_report.py` regenerates this file and fails on any difference.",
        "> No number exists until the owner runs `docs/notebook/benchmark/protocol.md`; a cell with "
        "nothing accepted behind it reads **NOT MEASURED**, never 0.",
        "> Internal only until the owner has checked each vendor's terms on publishing benchmarks (ruling D-9A6).",
        "",
        f"- Probe: `tools/bench_probes/bench_probe.js`, version `{version}`.",
        f"- Inputs: --run `{_display(run_dir)}` --machine `{_display(machine_path)}` "
        f"--uct-auto `{_display(auto_path) if auto_path else '(none)'}`",
        f"- Hand run directory: `{_display(run_dir)}`.",
        f"- Machine record: `{_display(machine_path)}` -- "
        + (f"REFUSED: {machine_problem}." if machine is None else
           f"accepted: {machine.get('machine_name')}, {machine.get('os')}, Chrome {machine.get('chrome_version')}, "
           f"Obsidian {machine.get('obsidian_version')}, sitting {machine.get('sitting_date')}."),
        f"- UCT automated summary: {auto_note}.",
        "- n < 10 reads `anecdote`. `not in DOM`: every attempt timed out before the marker was in the "
        "page (an editor that virtualises its content may never hold it). No winner column; a ratio is "
        "printed only between two cells of the same instrument on the same machine record.",
        "",
    ]
    for op in OPS:
        lines += [f"## {op['id']}: {op['what']}", "",
                  f"Owed per app: {op_total(op)} {'characters' if op['kind'] == 'typing' else 'attempts'} "
                  f"over {op['rounds']} round(s).", "",
                  "| app | client | instrument | n | p50 | p95 | invalid | source files |",
                  "|---|---|---|---:|---:|---:|---|---|"]
        for app, label, client in apps:
            dumps = cells.get((op["id"], app), [])
            s = summarize_cell(op, dumps) if dumps else None
            inv = "; ".join(f"{k} ×{v}" for k, v in sorted((s or {}).get("invalid", {}).items())) or "-"
            src = "<br>".join(f"`{x}`" for x in (s or {}).get("sources", [])) or "-"
            ins = _instrument(app, op, version)
            cl = _client(app, client, dumps)
            if s is None or s["state"] == "NO_SAMPLES":
                n = p50 = p95 = NOT_MEASURED
            elif s["state"] == "NOT_IN_DOM":
                n, p50, p95 = "0", "not in DOM", "not in DOM"
            elif s["state"] == "INCONCLUSIVE":
                n, p50, p95 = str(s["n"]), "INCONCLUSIVE", s["why"]
            else:
                tag = f" (anecdote, n={s['n']})" if s["anecdote"] else ""
                n, p50, p95 = str(s["n"]), _ms(s["p50"]) + tag, _ms(s["p95"]) + tag
            lines.append(f"| {label} | {cl} | {ins} | {n} | {p50} | {p95} | {inv} | {src} |")
        lines += ["", "Ratios (p50, same instrument, same machine record): " + _ratios(op, cells, machine, apps), ""]
    lines += ["## Refused inputs", ""]
    if refused:
        lines += ["| file | why |", "|---|---|"] + [f"| `{f}` | {w} |" for f, w in refused]
    else:
        lines.append("None.")
    lines.append("")
    return "\n".join(lines)


def _ratios(op: dict, cells: dict, machine: dict | None, apps: tuple) -> str:
    """Only hand cells share an instrument and a machine record, and only MEASURED non-anecdote
    cells enter a ratio. The automated row never does."""
    if machine is None:
        return "none -- no accepted machine record."
    base_id = BASELINE_APP if any(a[0] == BASELINE_APP for a in apps) else apps[0][0]
    base = cells.get((op["id"], base_id))
    bs = summarize_cell(op, base) if base else None
    if not bs or bs["state"] != "MEASURED" or bs["anecdote"]:
        return f"none -- the {base_id} hand cell is not measured with n >= {MIN_N}."
    out = []
    for app, label, _ in apps:
        if app in (base_id, AUTO_APP):
            continue
        d = cells.get((op["id"], app))
        s = summarize_cell(op, d) if d else None
        if s and s["state"] == "MEASURED" and not s["anecdote"] and bs["p50"] > 0:
            out.append(f"{label} / {base_id} = {s['p50'] / bs['p50']:.2f}")
    return "; ".join(out) + "." if out else "none -- no other hand cell is measured with n >= 10."


def build_report(run_dir: Path, machine_path: Path, uct_auto: Path | None = None, apps: tuple = APPS) -> str:
    version = probe_version()
    machine, problem = load_machine(machine_path)
    cells, refused = collect(run_dir, machine, problem, version, tuple(a[0] for a in apps))
    auto_cells, auto_refused, auto_note = collect_auto(uct_auto, version)
    cells.update(auto_cells)
    return render(cells, refused + auto_refused, version=version, run_dir=run_dir, machine_path=machine_path,
                  machine=machine, machine_problem=problem, auto_note=auto_note, apps=apps, auto_path=uct_auto)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", required=True, help="the hand run directory (dumps named <app>__<op>__r<round>.json)")
    ap.add_argument("--machine", required=True, help="the sitting's machine.json")
    ap.add_argument("--uct-auto", default=None, help="tools/notebook_bench_uct.py's summary JSON")
    ap.add_argument("--out", required=True, help="results.md path, or '-' for stdout")
    args = ap.parse_args(argv)
    if not Path(args.run).is_dir():
        print(f"no such run directory: {args.run}")
        return 3
    if not Path(args.machine).is_file():
        print(f"no such machine file: {args.machine}")
        return 3
    text = build_report(Path(args.run), Path(args.machine), Path(args.uct_auto) if args.uct_auto else None)
    data = text.encode("utf-8")
    if args.out == "-":
        sys.stdout.flush()
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
    else:
        Path(args.out).write_bytes(data)       # LF bytes, on every platform
        print(f"REPORT WRITTEN: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
