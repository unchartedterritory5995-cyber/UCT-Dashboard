"""Mechanical: every sandbox/<label>/{probe.json, sandbox-integrity.txt, build.log, verify-*.log}
-> sandbox-results.md. No verdicts; the reading is in docs/notebook/wave5-rollback.md.

    python results.py > sandbox-results.md
"""
import json
import re
from pathlib import Path

EV = Path(__file__).resolve().parent / "sandbox"
ORDER = ["p00-tip-seed-run1", "p00-tip-run1", "p01-38bb9a421-run1", "p02-4bba30b73-run1", "p03-d9e887ca0-run1",
         "p00-tip", "p01-38bb9a421", "p02-4bba30b73", "p03-d9e887ca0", "p04-4f708a0d2",
         "p07-1c4b0bf74", "p08-7e3f9e117", "p09-caf6d1b9e", "p10-2e0598bfa", "p11-f883e0996",
         "p12-271a078b6", "p13b-fd87271fd", "r2-p12-271a078b6", "r2-p13b-fd87271fd"]
PROBES = [("L1c_switcher_body_recall", "L1c recall"), ("L1b_admin_notebook_slo", "L1b slo"),
          ("L1a_unbuildable_body_at_create", "L1a unbuildable"), ("h203_depth_cap_at_create", "#203 depth"),
          ("w9_batch_export_bogus_format", "w9 bogus fmt"), ("w8_share_links", "w8 share"),
          ("w8_publish", "w8 publish"), ("9C_admin_notebook_soak", "9C soak"),
          ("w7_personal_tokens", "w7 tokens"), ("w6_note_templates", "w6 templates"),
          ("w5_switcher_door", "w5 switcher")]


def totals(path):
    if not path.is_file():
        return "not run"
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    t = [re.sub(r"\x1b\[[0-9;]*m", "", l).strip() for l in lines
         if re.search(r"\b(passed|failed)\b", l) and re.search(r"Tests|Test Files|\d+ passed|\d+ failed", l)]
    return "; ".join(t[-2:]) if t else "NO TOTALS LINE"


def cell(v):
    if not isinstance(v, dict):
        return "-"
    s = str(v.get("status"))
    if "json" in v:
        s += " json" if v["json"] else f" {v.get('content_type') or 'no body'}"
    if "text_matches" in v:
        s += f" ({v['text_matches']} by text)"
    return s


print("# Sandbox results, raw (lane R1, 2026-09-28)\n")
print("Data dir `C:\\data-w10rb`, port 8229, one boot per row, in this order. Fixtures seeded by the first tip run.\n")
print("## Integrity (first line of each boot's sandbox-integrity.txt)\n")
for lab in ORDER:
    f = EV / lab / "sandbox-integrity.txt"
    b = EV / lab / "build.log"
    br = re.search(r"# build rc (\d+) in (\d+) s", b.read_text(encoding="utf-8", errors="replace")) if b.is_file() else None
    print(f"- **{lab}** (build rc {br.group(1) if br else '?'}, {br.group(2) + ' s' if br else '?'}): "
          + (f.read_text(encoding="utf-8").strip() if f.is_file() else "NO INTEGRITY FILE"))
print("\n## A. One door per landing (HTTP status; the recall row also counts body matches)\n")
print("| boot | " + " | ".join(n for _k, n in PROBES) + " | skip link pointer-events | pane heading position |")
print("|---|" + "---|" * (len(PROBES) + 2))
for lab in ORDER:
    f = EV / lab / "probe.json"
    if not f.is_file():
        print(f"| {lab} | NO probe.json |")
        continue
    d = json.loads(f.read_text(encoding="utf-8"))
    L, dom = d.get("landings", {}), d.get("dom", {})
    sk, ph = dom.get("skip_link", {}), dom.get("pane_heading", {})
    print(f"| {lab} | " + " | ".join(cell(L.get(k)) for k, _n in PROBES)
          + f" | {sk.get('pointerEvents') if sk.get('present') else 'absent'}"
          + f" | {ph.get('position') if ph.get('present') else 'absent'} |")
print("\n## B. The never-revert set: the three tip-made notes in the served editor\n")
print("| boot | note | editor mounted | editable | notice on page | body PUT schema headers | PUT statuses "
      "| stored keeps node/mark | typed words stored | page errors |")
print("|---|---|---|---|---|---|---|---|---|---|")
for lab in ORDER:
    f = EV / lab / "probe.json"
    if not f.is_file():
        continue
    d = json.loads(f.read_text(encoding="utf-8"))
    for key, v in d.get("editor", {}).items():
        print(f"| {lab} | {key} | {v.get('editor_mounted')} | {v.get('editable_before_typing')} "
              f"| {', '.join(v.get('notice_strings_after') or []) or '-'} "
              f"| {', '.join(str(p.get('schema')) for p in v.get('body_puts', [])) or 'none'} "
              f"| {', '.join(str(s) for s in v.get('put_statuses', [])) or 'none'} "
              f"| {v.get('stored_keeps_marker')} | {v.get('stored_has_typed')} "
              f"| {len(v.get('page_errors') or [])}{' ' + v['error'] if v.get('error') else ''} |")
print("\n## C. The procedure's check list, inside each step tree\n")
print("| boot | pytest tests/test_notebook_schema_guard.py | vitest list (--maxWorkers=2) |")
print("|---|---|---|")
for lab in ORDER:
    print(f"| {lab} | {totals(EV / lab / 'verify-pytest.log')} | {totals(EV / lab / 'verify-vitest.log')} |")
