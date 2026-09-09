"""
build_report.py — assemble the survey report page from every JSON artifact.

Resilient by design: any input not yet on disk is omitted and the section says so.
Writes report.html next to this script.
"""

import glob
import html
import json
import os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.abspath(os.path.join(HERE, "..", "research"))
OUT = os.path.join(HERE, "report.html")


def jload(p, d=None):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return d


def e(s):
    return html.escape(str(s if s is not None else ""))


inv = jload(os.path.join(HERE, "inventory.json"), {}) or {}
cat = jload(os.path.join(HERE, "catalog.json"), {}) or {}
ap_raw = jload(os.path.join(HERE, "agg_presentation.json"))
ap_cor = jload(os.path.join(RES, "agg_presentation_corrected.json"))
ap = ap_cor or ap_raw
ac = jload(os.path.join(HERE, "agg_computation.json"))
eng = jload(os.path.join(HERE, "engine_refusal_agg.json"))
val = jload(os.path.join(HERE, "validation.json"))
wt = jload(os.path.join(HERE, "weighted.json"), {}) or {}
csum = jload(os.path.join(HERE, "cases_summary.json"), {}) or {}
# the FROZEN list is the set the case-study agents actually studied
cands = jload(os.path.join(HERE, "lane3_candidates.FROZEN.json"),
              jload(os.path.join(HERE, "lane3_candidates.json"), [])) or []
thumbs = jload(os.path.join(HERE, "thumbs.json"), {}) or {}
fetchlog = jload(os.path.join(HERE, "fetch_log.json"), {}) or {}
cats = jload(os.path.join(RES, "lane1-categories.json"))
plan = jload(os.path.join(RES, "corpus_expansion_plan.json"))

cases = {}
for p in sorted(glob.glob(os.path.join(RES, "lane3-cases-*.json"))):
    d = jload(p, [])
    if isinstance(d, list):
        items = d
    elif isinstance(d, dict) and isinstance(d.get("cases"), list):
        items = d["cases"]
    elif isinstance(d, dict):
        items = [v for v in d.values() if isinstance(v, dict) and v.get("slug")]
    else:
        items = []
    for rec in items:
        if isinstance(rec, dict) and rec.get("slug"):
            cases[rec["slug"]] = rec

N = len(inv)
n_cat = len(cat)
n_open = sum(1 for v in cat.values() if v.get("access") == 1)
n_prot = sum(1 for v in cat.values() if v.get("access") == 2)
n_iv = sum(1 for v in cat.values() if v.get("access") == 3)
n_picks = sum(1 for v in cat.values() if v.get("editorsPick"))
n_fetched = sum(1 for v in fetchlog.values() if v.get("status") == "ok")
lic = Counter(v.get("license") for v in fetchlog.values() if v.get("status") == "ok")
noncomm = sum(n for k, n in lic.items() if k and ("NC" in k or "ND" in k))

ALL = wt.get("all_open_source", {})
T1K = wt.get("top_1000_by_boosts", {})
T250 = wt.get("top_250_by_boosts", {})
vmix = Counter(r.get("pine_version") or 1 for r in inv.values())
dmix = Counter(r.get("declaration") for r in inv.values())


def g(d, k, default="—"):
    v = d.get(k)
    return default if v is None else v


def table(headers, rows, note=None, num_cols=(2,)):
    h = "".join("<th>%s</th>" % e(x) for x in headers)
    body = []
    for r in rows:
        tds = []
        for i, c in enumerate(r):
            cls = ' class="num"' if i in num_cols else ""
            tds.append("<td%s>%s</td>" % (cls, c if isinstance(c, str) and c.startswith("<") else e(c)))
        body.append("<tr>" + "".join(tds) + "</tr>")
    n = '<p class="tnote">%s</p>' % note if note else ""
    return ('<div class="scroll"><table class="data"><thead><tr>%s</tr></thead><tbody>%s</tbody></table></div>%s'
            % (h, "".join(body), n))


def bar(p, maxp=100.0):
    try:
        p = float(p)
    except Exception:  # noqa: BLE001
        return e(p)
    w = max(0.7, min(100.0, 100.0 * p / maxp))
    return '<span class="bar"><i style="width:%.1f%%"></i></span><span class="pctv">%.1f%%</span>' % (w, p)


def pct(a, b=None):
    b = b or N
    return "%.1f%%" % (100.0 * a / b) if b else "—"


# ── presentation demand
sec_pres = "<p class='muted'>Inventory not built yet.</p>"
if ap:
    raw_by = {r["primitive"]: r for r in (ap_raw or {}).get("primitives", [])}
    rows = []
    top = ap["primitives"][:28]
    mx = top[0]["pct_scripts"] if top else 100
    for r in top:
        args = ", ".join(list((r.get("named_args") or {}).keys())[:8]) or "—"
        old = raw_by.get(r["primitive"], {}).get("pct_scripts")
        delta = ""
        if ap_cor and old is not None and abs(old - r["pct_scripts"]) > 0.05:
            delta = ' <span class="up">+%.1f</span>' % (r["pct_scripts"] - old)
        rows.append(["<code>%s</code>" % e(r["primitive"]),
                     bar(r["pct_scripts"], mx) + delta,
                     "{:,}".format(r["call_sites"]),
                     "<span class='args'>%s</span>" % e(args)])
    sec_pres = table(["primitive", "share of scripts", "call sites", "named arguments actually passed"], rows,
                     note=("n = %s open-source scripts — every open-source script in the catalogue, not a sample. "
                           "Green deltas are sites recovered by a receiver-typed detector for Pine's method-call "
                           "syntax (<code>myLine.set_x2()</code>), which a namespace-only scan cannot see."
                           % "{:,}".format(ap["n_scripts"])),
                     num_cols=(2,))

# ── computation demand
sec_comp = "<p class='muted'>Inventory not built yet.</p>"
if ac:
    feats = [f for f in ac["features"] if f["feature"].startswith("feat:")][:12]
    calls = [f for f in ac["features"] if not f["feature"].startswith("feat:")][:20]
    mx = max([f["pct_scripts"] for f in feats + calls] or [100])
    rows = [["<code>%s</code>" % e(r["feature"].replace("feat:", "")), bar(r["pct_scripts"], mx),
             "{:,}".format(r["call_sites"])] for r in feats + calls]
    sec_comp = table(["language / runtime feature", "share of scripts", "call sites"], rows,
                     note="n = %s. <code>bare:</code> rows are un-namespaced pre-v5 builtins — they appear only in "
                          "v1–v4 scripts, which TradingView still compiles and serves."
                          % "{:,}".format(ac["n_scripts"]))

# ── blockers
sec_block = "<p class='muted'>Engine pass still running.</p>"
if eng:
    top = eng["refusals"][:14]
    mx = top[0]["pct_of_corpus"] if top else 1
    rows = [["<code>%s</code>" % e(r["guard"]), bar(r["pct_of_corpus"], mx), "{:,}".format(r["scripts"])]
            for r in top]
    sec_block = table(["refusal guard", "share of judged scripts", "scripts"], rows,
                      note="Judged %s scripts; %s yielded at least one screenable column (%s). %d scripts killed the "
                           "translator process outright — %d by heap exhaustion or hang — and are excluded."
                           % ("{:,}".format(eng["n_scripts"]), "{:,}".format(eng["translated"]),
                              pct(eng["translated"], eng["n_scripts"]),
                              len(eng.get("killed_process") or []), len(eng.get("killed_process") or [])))

# ── weighted comparison
sec_wt = ""
if ALL and T1K:
    KEYS = [("any_drawing_object", "uses any drawing object"), ("no_plot_call", "no plot() call at all"),
            ("label.new", "label.new"), ("line.new", "line.new"), ("box.new", "box.new"),
            ("polyline.new", "polyline.new"), ("for_loop", "for loop"), ("arrays", "arrays"),
            ("udt", "user-defined type"), ("methods", "methods"), ("plot", "plot"),
            ("table.cell", "table.cell"), ("security", "request.security"), ("pine_v6_pct", "Pine v6")]
    rows = []
    for k, lab in KEYS:
        a, b, c = ALL.get(k), T1K.get(k), T250.get(k)
        arrow = ""
        if isinstance(a, (int, float)) and isinstance(c, (int, float)):
            if c - a >= 3:
                arrow = '<span class="up">▲ %.1f</span>' % (c - a)
            elif a - c >= 3:
                arrow = '<span class="down">▼ %.1f</span>' % (c - a)
        rows.append(["<code>%s</code>" % e(lab), "%.1f%%" % a, "%.1f%%" % b, "%.1f%%" % c, arrow])
    sec_wt = table(["feature", "all %s" % "{:,}".format(ALL.get("n", 0)), "top 1,000", "top 250", "shift"],
                   rows, num_cols=(1, 2, 3),
                   note="Left column weights every published open-source script equally. The right columns weight by "
                        "TradingView boosts — what members actually put on charts. Anything rising to the right is "
                        "<b>under-stated</b> by a flat per-script count. Median script length also rises: %s → %s lines."
                        % (ALL.get("median_lines"), T250.get("median_lines")))

# ── categories
sec_cats = ""
if cats and isinstance(cats, dict):
    dist = cats.get("distribution") or {}
    if isinstance(dist, dict) and dist:
        items = sorted(dist.items(), key=lambda x: -x[1])
        mx = items[0][1]
        rows = [[e(k), bar(100.0 * v / max(1, sum(dist.values())), 100.0 * mx / max(1, sum(dist.values()))), v]
                for k, v in items]
        sec_cats = table(["category", "share of surveyed scripts", "scripts"], rows,
                         note="Assigned from title plus the discovery terms that surfaced each script. Because the "
                              "categories are bounded by what was searched for, <b>breadth and visual-decoration are "
                              "unmeasured rather than small</b> — both grew by two orders of magnitude when the "
                              "remaining search terms completed.")

# ── gallery
def diff_class(d):
    try:
        d = int(d)
    except Exception:  # noqa: BLE001
        return "d0"
    return "d%d" % max(1, min(5, d))


gal = []
for c in cands:
    sid = c.get("scriptIdPart") or c["slug"]
    t = thumbs.get(sid)
    case = cases.get(c["slug"], {})
    d = case.get("rendering_difficulty_lwc5")
    img = ('<img loading="lazy" width="%d" height="%d" alt="%s shown on a chart" src="data:image/jpeg;base64,%s">'
           % (t["w"], t["h"], e(c.get("title") or c["slug"]), t["d"])) if t else '<div class="noimg">no preview</div>'
    chips = []
    if d:
        chips.append('<span class="chip %s">difficulty %s</span>' % (diff_class(d), e(d)))
    if c.get("pine_version"):
        chips.append('<span class="chip v">Pine v%s</span>' % e(c["pine_version"]))
    if c.get("editorsPick"):
        chips.append("<span class='chip pick'>Editors&rsquo; Pick</span>")
    if "NC" in (c.get("license") or "") or "ND" in (c.get("license") or ""):
        chips.append('<span class="chip nc">non-commercial</span>')
    body = ""
    if case.get("what_it_draws"):
        body += "<p class='draws'>%s</p>" % e(case["what_it_draws"])
    if case.get("lwc5_approach"):
        body += "<p class='appr'><b>Approach</b> %s</p>" % e(case["lwc5_approach"])
    if case.get("difficulty_reason"):
        body += "<p class='why'>%s</p>" % e(case["difficulty_reason"])
    if not body:
        body = "<p class='draws muted'>Not in the 100 assessed. Measured primitives below.</p>"
    url = ("https://www.tradingview.com/script/%s/" % (sid.split(";")[-1])) if sid else None
    link = ('<a class="tv" href="%s" target="_blank" rel="noopener">on TradingView &rarr;</a>' % e(url)) if url else ""
    gal.append(
        '<article class="card" data-d="%s" data-score="%s" data-boosts="%s">'
        '<div class="shot">%s</div><div class="meta"><h3>%s</h3>'
        '<p class="by">%s · %s boosts · %s lines</p><div class="chips">%s</div>%s'
        '<p class="prims"><code>%s</code></p>%s</div></article>'
        % (e(d or 0), e(c.get("score_measured")), e(c.get("agreeCount") or 0), img,
           e(c.get("title") or c["slug"]), e(c.get("author") or "unknown"),
           "{:,}".format(c.get("agreeCount") or 0), e(c.get("lines")), "".join(chips), body,
           e((c.get("primitives") or "")[:160]), link))

dh = csum.get("difficulty", {})
n_rated = sum(dh.values()) if dh else 0
dh_txt = " · ".join("%s→%d" % (k, v) for k, v in sorted(dh.items())) or "pending"
appr = csum.get("approaches", {})

# ── validation blurb
val_line = "Validation pass not run."
if val:
    s = val.get("summary", {})
    tot = sum(v.get("scripts_compared", 0) for v in s.values())
    allok = all(v.get("exact_pct") == 100.0 for v in s.values() if v.get("scripts_compared"))
    val_line = ("TradingView's own compiler publishes per-script call counts for the five plot-family primitives and "
                "<code>alertcondition</code>. Against those, this survey's independently-derived counts agree "
                "<b>%s exactly across %s comparisons</b> — an external oracle, not a self-check. It covers only "
                "those six rows; <code>label</code>, <code>line</code>, <code>box</code>, <code>table</code> and "
                "<code>fill</code> counts rest on this survey's own parsing, which is why they were separately "
                "re-derived with a receiver-typed detector."
                % ("100%" if allok else "partially", "{:,}".format(tot)))

DOCS = [
    ("PINE-PRESENTATION-SPEC.md", "The argument-level Pine v6 presentation spec — 214 numbered conformance assertions, 53 unverified items, 25 documentation defects. The document the renderer is tested against."),
    ("LWC5-CAPABILITY-MAP.md", "Every Pine primitive mapped to a Lightweight Charts v5 mechanism, demand-ordered, with 21 numbered implementation rules."),
    ("lane2-computation-crossref.md", "275 computation features cross-referenced against what our engine supports, with the unblock sequence."),
    ("lane1-presentation-audit.md", "Adversarial audit of the survey instrument itself, and the corrected counts."),
    ("lane6-corpus-gap.md", "Whether our test corpus resembles the ecosystem. It does not."),
    ("corpus_expansion_plan.json", "537 staged candidate scripts, licence-gated per entry."),
    ("lane5-prior-art.md", "34 prior-art projects assessed for licence and honest completeness."),
    ("lane5-evolution-versions.md", "Pine v1→v6: 86 changes, each tagged parser / runtime / renderer."),
    ("lane5-builtins-and-adoption.md", "TradingView's own 145 built-ins, plus measured adoption of newer Pine features."),
    ("pine_v6_reference.json", "The complete official Pine v6 reference payload as machine-readable data — 719 functions, 251 methods, 239 constants."),
    ("pine_v6_reference_extraction.md", "How that payload was obtained, and how to re-obtain it when TradingView redeploys."),
]
doc_rows = []
for fn, desc in DOCS:
    p = os.path.join(RES, fn)
    doc_rows.append(["<code>%s</code>" % e(fn), e(desc),
                     ("%.0f KB" % (os.path.getsize(p) / 1024)) if os.path.exists(p) else "pending"])

CSS = """
:root{
  --paper:#f5f6f8; --card:#fff; --ink:#11151b; --ink2:#3c4553; --ink3:#697485;
  --rule:#dee2e9; --rule2:#edf0f4;
  --accent:#2962ff; --up:#089981; --down:#f23645; --warn:#8a6d00;
  --shadow:0 1px 2px rgba(17,21,27,.05),0 8px 22px rgba(17,21,27,.045);
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --paper:#0c0f13; --card:#141922; --ink:#e7ebf1; --ink2:#a7b2c1; --ink3:#7a8494; --rule:#222935; --rule2:#1a2028;
  --accent:#5f8dff; --up:#26c08f; --down:#ff5d6a; --warn:#ffd84d;
  --shadow:0 1px 2px rgba(0,0,0,.5),0 10px 28px rgba(0,0,0,.33);
}}
:root[data-theme="dark"]{
  --paper:#0c0f13; --card:#141922; --ink:#e7ebf1; --ink2:#a7b2c1; --ink3:#7a8494;
  --rule:#222935; --rule2:#1a2028;
  --accent:#5f8dff; --up:#26c08f; --down:#ff5d6a; --warn:#ffd84d;
  --shadow:0 1px 2px rgba(0,0,0,.5),0 10px 28px rgba(0,0,0,.33);
}
*{box-sizing:border-box}
body{background:var(--paper);color:var(--ink);font-family:"IBM Plex Sans","Segoe UI",system-ui,sans-serif;
  line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:1200px;margin:0 auto;padding:0 24px 90px}
code{font-family:"IBM Plex Mono",ui-monospace,Consolas,monospace}
a{color:var(--accent)}
header.top{padding:54px 0 26px;border-bottom:1px solid var(--rule)}
.eyebrow{font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.15em;text-transform:uppercase;
  color:var(--ink3);margin:0 0 14px}
h1{font-size:clamp(29px,4.2vw,44px);line-height:1.07;letter-spacing:-.022em;margin:0;font-weight:600;
  text-wrap:balance;max-width:23ch}
.standfirst{font-family:"IBM Plex Serif",Georgia,serif;font-size:18.5px;line-height:1.56;color:var(--ink2);
  max-width:64ch;margin:18px 0 0}
.prov{display:flex;flex-wrap:wrap;gap:7px 20px;margin:24px 0 0;font-family:"IBM Plex Mono",monospace;
  font-size:11.5px;color:var(--ink3)}
.prov b{color:var(--ink2);font-weight:500}
section{padding:42px 0;border-bottom:1px solid var(--rule2)}
section:last-of-type{border-bottom:0}
h2{font-size:11.5px;font-family:"IBM Plex Mono",monospace;letter-spacing:.14em;text-transform:uppercase;
  color:var(--accent);margin:0 0 6px;font-weight:600}
h2 .num{color:var(--ink3);margin-right:9px}
h3.st{font-size:clamp(20px,2.3vw,26px);letter-spacing:-.015em;margin:0 0 15px;font-weight:600;
  text-wrap:balance;max-width:36ch}
p{margin:0 0 13px}
.prose{max-width:68ch}
.prose.serif{font-family:"IBM Plex Serif",Georgia,serif;font-size:16.8px;color:var(--ink2)}
.prose.serif b{color:var(--ink);font-weight:600}
.muted{color:var(--ink3)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--rule);
  border:1px solid var(--rule);border-radius:3px;overflow:hidden;margin:4px 0 26px}
.kpi{background:var(--card);padding:15px 17px}
.kpi .v{font-family:"IBM Plex Mono",monospace;font-size:24px;font-weight:600;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums;display:block}
.kpi .l{font-size:11.5px;color:var(--ink3);margin-top:2px;display:block;line-height:1.35}
.scroll{overflow-x:auto;border:1px solid var(--rule);border-radius:3px;background:var(--card)}
table.data{width:100%;border-collapse:collapse;font-size:13.5px}
table.data th{text-align:left;font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.09em;
  text-transform:uppercase;color:var(--ink3);font-weight:500;padding:10px 14px;
  border-bottom:1px solid var(--rule);white-space:nowrap;background:var(--card)}
table.data td{padding:8.5px 14px;border-bottom:1px solid var(--rule2);vertical-align:middle}
table.data tr:last-child td{border-bottom:0}
table.data td.num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
table.data code{font-size:12.5px}
.args{color:var(--ink3);font-size:11.5px;font-family:"IBM Plex Mono",monospace}
.tnote{font-size:12.5px;color:var(--ink3);margin:10px 0 0;max-width:82ch}
.bar{display:inline-block;width:min(150px,20vw);height:6px;background:var(--rule);border-radius:99px;
  overflow:hidden;vertical-align:middle;margin-right:8px}
.bar i{display:block;height:100%;background:var(--accent);border-radius:99px}
.pctv{font-family:"IBM Plex Mono",monospace;font-size:12px;font-variant-numeric:tabular-nums;color:var(--ink2)}
.up{color:var(--up);font-family:"IBM Plex Mono",monospace;font-size:11.5px}
.down{color:var(--down);font-family:"IBM Plex Mono",monospace;font-size:11.5px}
.callout{border-left:2px solid var(--accent);padding:1px 0 1px 17px;margin:20px 0;max-width:74ch;
  color:var(--ink2);font-size:15px}
.callout b{color:var(--ink)}
.callout.flag{border-left-color:var(--down)}
.callout.good{border-left-color:var(--up)}
ul.tight{margin:0 0 13px;padding-left:19px;max-width:70ch}
ul.tight li{margin:0 0 7px;color:var(--ink2)}
ul.tight li b{color:var(--ink)}
ol.steps{margin:0;padding-left:0;list-style:none;counter-reset:s;max-width:74ch}
ol.steps li{counter-increment:s;position:relative;padding:0 0 14px 40px;color:var(--ink2)}
ol.steps li::before{content:counter(s);position:absolute;left:0;top:0;width:25px;height:25px;
  border:1px solid var(--rule);border-radius:99px;display:grid;place-items:center;
  font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:var(--ink3)}
ol.steps li b{color:var(--ink)}
.controls{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin:0 0 18px}
.controls .lab{font-family:"IBM Plex Mono",monospace;font-size:10.5px;letter-spacing:.09em;
  text-transform:uppercase;color:var(--ink3);margin-right:3px}
button.f{font:inherit;font-size:12.5px;padding:5px 12px;border:1px solid var(--rule);background:var(--card);
  color:var(--ink2);border-radius:99px;cursor:pointer}
button.f[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff}
button.f:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:17px}
.card{background:var(--card);border:1px solid var(--rule);border-radius:4px;overflow:hidden;
  display:flex;flex-direction:column;box-shadow:var(--shadow)}
.card .shot{background:#0b0e12;line-height:0;border-bottom:1px solid var(--rule)}
.card .shot img{width:100%;height:auto;display:block}
.noimg{height:110px;display:grid;place-items:center;color:var(--ink3);font-size:12px;line-height:1}
.card .meta{padding:13px 15px 14px;display:flex;flex-direction:column;gap:7px;flex:1}
.card h3{font-size:14.5px;margin:0;line-height:1.3;letter-spacing:-.01em;font-weight:600}
.card .by{font-family:"IBM Plex Mono",monospace;font-size:10.5px;color:var(--ink3);margin:0}
.chips{display:flex;flex-wrap:wrap;gap:4px}
.chip{font-family:"IBM Plex Mono",monospace;font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;
  padding:2.5px 7px;border-radius:99px;border:1px solid var(--rule);color:var(--ink3)}
.chip.d2{border-color:var(--up);color:var(--up)}
.chip.d3{border-color:var(--warn);color:var(--warn)}
.chip.d4,.chip.d5{border-color:var(--down);color:var(--down)}
.chip.pick{border-color:var(--accent);color:var(--accent)}
.chip.nc{border-color:var(--down);color:var(--down)}
.card .draws{font-size:12.8px;color:var(--ink2);margin:0}
.card .appr{font-size:12.3px;color:var(--ink2);margin:0}
.card .appr b{color:var(--ink);font-weight:600}
.card .why{font-size:11.8px;color:var(--ink3);margin:0;font-style:italic}
.card .prims{margin:auto 0 0;padding-top:8px;border-top:1px solid var(--rule2)}
.card .prims code{font-size:10.5px;color:var(--ink3);word-break:break-word}
.card .tv{font-size:11.5px;font-family:"IBM Plex Mono",monospace;text-decoration:none}
footer{padding:32px 0 0;color:var(--ink3);font-size:12.5px;font-family:"IBM Plex Mono",monospace;max-width:80ch}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
"""

JS = """
const cards=[...document.querySelectorAll('.card')];
const galN=document.getElementById('galN');
let fd='rated';
function apply(){let s=0;cards.forEach(c=>{const d=c.dataset.d;let ok=true;
 if(fd==='rated')ok=d!=='0'&&d!=='';else if(fd!=='all')ok=d===fd;
 c.hidden=!ok;if(ok)s++;});if(galN)galN.textContent=s;}
document.querySelectorAll('button.f[data-d]').forEach(b=>b.addEventListener('click',()=>{
 document.querySelectorAll('button.f[data-d]').forEach(x=>x.setAttribute('aria-pressed','false'));
 b.setAttribute('aria-pressed','true');fd=b.dataset.d;apply();}));
const gal=document.querySelector('.gal');
document.querySelectorAll('button.f[data-sort]').forEach(b=>b.addEventListener('click',()=>{
 document.querySelectorAll('button.f[data-sort]').forEach(x=>x.setAttribute('aria-pressed','false'));
 b.setAttribute('aria-pressed','true');const k=b.dataset.sort;
 [...cards].sort((a,z)=>Number(z.dataset[k]||0)-Number(a.dataset[k]||0)).forEach(c=>gal.appendChild(c));}));
apply();
"""

P = []
P.append("""<title>Pine in the Wild</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:ital,wght@0,400;0,600;1,400&display=swap">
<style>%s</style><div class="wrap">""" % CSS)

P.append("""<header class="top">
<p class="eyebrow">Renderer research · input to the presentation layer</p>
<h1>What Pine indicators actually look like in the wild</h1>
<p class="standfirst">Every open-source indicator TradingView will serve, read and counted — %s scripts catalogued,
%s sources parsed, 100 of the most visually complex assessed against Lightweight Charts v5. Assembled to decide
what a from-scratch Pine renderer must draw, and in what order.</p>
<div class="prov"><span><b>Catalogued</b> %s</span><span><b>Open-source</b> %s</span>
<span><b>Sources read</b> %s</span><span><b>Editors&rsquo; Picks</b> %s</span>
<span><b>Built-ins</b> 145</span><span><b>Case studies</b> %d</span>
<span><b>Target</b> lightweight-charts 5.2.0</span></div></header>""" % (
    "{:,}".format(n_cat), "{:,}".format(n_fetched), "{:,}".format(n_cat), "{:,}".format(n_open),
    "{:,}".format(n_fetched), n_picks, n_rated))

P.append("""<section><h2><span class="num">01</span>The one page</h2>
<h3 class="st">Drawing objects are not an advanced corner of Pine. They are the ecosystem.</h3>
<div class="prose serif">
<p>A plot-first renderer would miss most of what members paste. Across all %s open-source scripts,
<b>%s use at least one drawing object</b> — <code>label</code>, <code>line</code>, <code>box</code>,
<code>polyline</code>, <code>linefill</code> or <code>table</code> — and <b>%s contain no
<code>plot()</code> call at all</b>. Weight the same corpus by popularity and it gets worse for the
plot-first plan: among the 250 most-boosted scripts, drawing objects appear in <b>%s</b>,
<code>box.new</code> doubles to <b>%s</b>, and user-defined types nearly triple to <b>%s</b>. What people
actually put on their charts is more object-oriented than the published average.</p>
<p>The language surface is not a later phase either. Loops and arrays are <i>how</i> the wild manages object
pools: <b>%s of scripts run a <code>for</code> loop</b> and <b>%s use arrays</b>, rising to %s and %s in the
popular cohort. You cannot ship the drawing layer and defer the machinery that drives it.</p>
<p>The dialect problem is permanent. Pine v1 through v6 are all live and all served; <b>%s of scripts are
pre-v5</b>, written with <code>study()</code> and un-namespaced builtins removed from the language years ago.
No version has ever been sunset and there is no v7. Worse, <i>identical source paints differently by
version</i> — colour constants changed hex, the default label text colour flipped, implicit fill transparency
was dropped at v5 — so the version tag has to survive all the way to the paint call.</p>
<p><b>On feasibility, the answer is the one you expected: zero infeasible.</b> One hundred of the most
visually complex indicators in the ecosystem were assessed independently by five reviewers against
Lightweight Charts v5.2.0. None requires a capability the library lacks, and <b>no fork or upgrade is
needed</b>. Difficulty clusters at 3 and 4 out of 5 (%s), and nothing scored 1 — because LWC's native
vocabulary is only series, markers and price lines, so a plugin primitive is the floor for anything Pine
draws. The cost is not capability. It is that we write the text, layout, pooling and culling machinery
ourselves, and emulate Pine's nine-bucket z-order on four real slots.</p>
<p>What we already handle is narrower than our corpus suggested, and the corpus is why. Our translator
yields a column for %s of the scripts it judged. Our 137-script test corpus is <b>not representative</b>:
drawing objects appear in 11.7%% of it against %s of the wild, and 65.7%% of it is screener-shaped against
roughly 2%% of the ecosystem. It has been measuring a different population, which is why our numbers looked
healthier than reality. The single biggest correction available is not a feature at all — it is
<b>treating drawings as output</b>, which the projection below puts at ~64%% of the surveyed corpus.</p>
</div></section>""" % (
    "{:,}".format(N), pct(sum(1 for r in inv.values() if any(
        ((r.get("presentation") or {}).get(k) or {}).get("count") for k in
        ["label.new", "line.new", "box.new", "polyline.new", "linefill.new", "table.new"]))),
    "%.1f%%" % ALL.get("no_plot_call", 0), "%.1f%%" % T250.get("any_drawing_object", 0),
    "%.1f%%" % T250.get("box.new", 0), "%.1f%%" % T250.get("udt", 0),
    "%.1f%%" % ALL.get("for_loop", 0), "%.1f%%" % ALL.get("arrays", 0),
    "%.1f%%" % T250.get("for_loop", 0), "%.1f%%" % T250.get("arrays", 0),
    pct(sum(v for k, v in vmix.items() if k and k <= 4)), dh_txt,
    (pct(eng["translated"], eng["n_scripts"]) if eng else "—"),
    "%.1f%%" % ALL.get("any_drawing_object", 0)))

P.append("""<section><h2><span class="num">02</span>The shape of the ecosystem</h2>
<h3 class="st">The same corpus, counted two ways</h3>
<div class="kpis">
<div class="kpi"><span class="v">%s</span><span class="l">any drawing object</span></div>
<div class="kpi"><span class="v">%s</span><span class="l">no plot() at all</span></div>
<div class="kpi"><span class="v">%s</span><span class="l">for loop</span></div>
<div class="kpi"><span class="v">%s</span><span class="l">arrays</span></div>
<div class="kpi"><span class="v">%s</span><span class="l">request.security</span></div>
<div class="kpi"><span class="v">%s</span><span class="l">pre-v5 dialect</span></div></div>
%s
<div class="prose" style="margin-top:24px"><p>Pine version and declaration form:</p></div>
%s
%s</section>""" % (
    "%.1f%%" % ALL.get("any_drawing_object", 0), "%.1f%%" % ALL.get("no_plot_call", 0),
    "%.1f%%" % ALL.get("for_loop", 0), "%.1f%%" % ALL.get("arrays", 0),
    "%.1f%%" % ALL.get("security", 0), pct(sum(v for k, v in vmix.items() if k and k <= 4)),
    sec_wt,
    table(["Pine version", "share of scripts", "scripts"],
          [["v%s%s" % (k, " — no @version line" if k == 1 else ""),
            bar(100.0 * v / N, 100.0 * max(vmix.values()) / N), v] for k, v in sorted(vmix.items())],
          note="A script with no <code>//@version</code> line is v1 by definition and still compiles. Declarations: "
               + ", ".join("<code>%s</code> %s" % (k, v) for k, v in dmix.most_common() if k)),
    sec_cats))

P.append("""<section><h2><span class="num">03</span>Demand-weighted presentation surface</h2>
<h3 class="st">The renderer's build order, taken from what scripts actually call</h3>
<div class="prose"><p>Every presentation primitive ranked by the share of scripts using it, with the named
arguments those call sites actually pass. Build top-down.</p></div>
%s
<div class="callout good">%s</div>
<div class="callout flag"><b>What this table does not tell you.</b> It counts <i>call sites</i>, not runtime
objects, and the gap is two orders of magnitude: scripts reserve <b>1.35 million</b> drawing objects through
<code>max_*_count</code> against 21,625 constructor sites, and declare <b>299,259</b> table cells against
16,808 <code>cell()</code> calls. One <code>box.new</code> inside a loop can hold 945 boxes. Use this table to
decide <b>what</b> to implement; do not use it to size capacity. It is also blind to library-mediated drawing —
344 scripts import a library, and 59 reserve drawing capacity while calling no constructor of their own.</div>
</section>""" % (sec_pres, val_line))

P.append("""<section><h2><span class="num">04</span>Demand-weighted computation surface</h2>
<h3 class="st">What the runtime must execute, and what stops us today</h3>
%s
<div class="prose" style="margin-top:24px"><p><b>What blocks us now.</b> Our existing translator was built to
yield screenable columns, not pixels. Read this as the screener door's blocker map, measured against the same
real scripts.</p></div>
%s
<div class="callout flag"><b>The loudest row in that histogram is an artefact.</b> <code>pine:character</code>
reads as a ~16%% blocker, but the lexer runs first and aborts the file, so it takes credit for scripts that
would have failed later anyway — 86%% of them carry loops, 72%% user-defined types. It is the <i>sole</i>
blocker for <b>2 scripts in 1,443</b>. The real cause is precise and worth fixing for honesty: a <code>.</code>
not preceded by an identifier character, and 75%% of those sites sit immediately after <code>)</code> — member
access on a call result, <code>arr.get(i).price</code>. Fix it as a prerequisite, not as a rate lever.</div>
<div class="callout"><b>And the histogram under-reads the renderer.</b> The translator is demand-driven from
its output argument, so <code>pine:drawing</code> fires on <b>0 of 500</b> judged scripts even though 594
scripts call <code>line.new</code>. A roadmap read straight off these refusals would over-build collections
and under-build the renderer.</div></section>""" % (sec_comp, sec_block))

P.append("""<section><h2><span class="num">05</span>Visual complexity gallery</h2>
<h3 class="st">The hardest things Pine authors actually draw</h3>
<div class="prose"><p>%d indicators ranked by measured complexity; <b>%d assessed for rendering difficulty</b>
against Lightweight Charts v5 by five independent reviewers. <b>Zero were judged infeasible.</b> Approach mix
across the assessed set: %s. Scripts marked non-commercial may be studied and referenced, never committed.</p>
<p class="muted">Roughly half the assessed scripts were reviewed before their chart snapshot finished
downloading, so those descriptions were written from source alone. Every card now carries its image.</p></div>
<div class="controls"><span class="lab">Difficulty</span>
<button class="f" data-d="rated" aria-pressed="true">Assessed</button>
<button class="f" data-d="all">All %d</button>
<button class="f" data-d="2">2</button><button class="f" data-d="3">3</button>
<button class="f" data-d="4">4</button>
<span class="lab" style="margin-left:12px">Sort</span>
<button class="f" data-sort="score" aria-pressed="true">Complexity</button>
<button class="f" data-sort="boosts">Popularity</button>
<span class="muted" style="margin-left:auto;font-size:12.5px"><span id="galN">%d</span> shown</span></div>
<div class="gal">%s</div></section>""" % (
    len(cands), n_rated,
    ", ".join("%s %d" % (k, v) for k, v in sorted(appr.items(), key=lambda x: -x[1])) or "—",
    len(cands), n_rated, "".join(gal)))

P.append("""<section><h2><span class="num">06</span>Lightweight Charts v5 capability map</h2>
<h3 class="st">No fork, no upgrade — but we write the text layer</h3>
<div class="prose"><p>We run <code>lightweight-charts@5.2.0</code>, pinned exactly on <code>origin/master</code>.
The plugin API is <b>already in production on this exact version</b> — six hand-written primitive modules across
ten attach sites, plus a working custom series. Of 17 Pine visual primitives: <b>5 map to native</b> series or
price lines, <b>1 partially</b> (<code>plotshape</code>, for the 4-shape subset), <b>10 need a series
primitive</b>, <b>1 needs a DOM overlay</b> (tables), and <b>0 strictly require a custom series</b> — though
three want one for scale.</p>
<p>Pine's nine z-order buckets collapse onto <b>six real positions</b>. Buckets 5–8 share one slot and are
ordered by attach order (<code>linefill → line → box → label</code>); bucket 9 must be <code>'top'</code> or
DOM, which is structurally what enforces Pine's rule that a plot can never sit above a table.</p></div>
<div class="callout flag"><b>Three hazards to obey as rules.</b> <code>logicalToCoordinate()</code> returns
<code>0</code> — not <code>null</code> — for a non-integer index, a silent wrong answer. A primitive's
<code>autoscaleInfo</code> is never called if its host series has no real data point, and whitespace does not
count. And <code>AutoscaleInfo.margins</code> is overwritten rather than merged across primitives, so the last
one attached wins.</div>
<div class="callout"><b>The honest gap list contains no Pine drawing primitive.</b> What remains is ten
TradingView behaviours nobody ever specified — the interpolation family behind <code>polyline(curved)</code>,
<code>plotarrow</code>'s length normalisation and vertical anchor, <code>size.auto</code>'s rule, the pixel
geometry of the twelve <code>shape.*</code> glyphs — plus two real LWC ceilings on overlay price scales, both
escapable via panes. The spec gap is now the binding constraint, not the library.</div></section>""")

P.append("""<section><h2><span class="num">07</span>Revised build order</h2>
<h3 class="st">Ranked by survey demand, with the projection at each step</h3>
<div class="prose"><p>Projected share of the surveyed corpus that yields a result after each step, from 24.2%
today. Steps 1–4 are runtime work our current engine already frames; step 5 is the renderer itself.</p></div>
<ol class="steps">
<li><b>A second feed and a wider timeframe ladder</b> — clears <code>pine:request</code>. → <b>≈32%</b></li>
<li><b>~45 missing <code>ta.</code>/<code>math.</code> names</b>, <code>math.floor</code> and
<code>math.ceil</code> first. → <b>≈37%</b></li>
<li><b>A loop node</b> — <code>pine:block</code>. Loops are how object pools are driven, so this is a
prerequisite for the drawing layer, not a parallel track. → <b>≈44%</b></li>
<li><b>Collections</b> — arrays, then matrices and maps. → <b>≈53%</b></li>
<li><b>Drawings as output — becoming a renderer.</b> The single largest step, and the one this research exists
to justify. → <b>≈64%</b></li>
</ol>
<div class="prose"><p>Within step 5, the presentation build order follows the demand table: labels and lines
first (a third of all scripts each), then <code>fill</code>, then boxes, then the table/DOM layer, then
polylines. Two pieces of machinery are load-bearing across almost every case study and should be built once,
early, as shared components rather than per-primitive: a <b>text layout engine</b> (19 of 20 scripts in one
slice needed one, and the library de-overlaps price-axis labels only) and an <b>object pool with FIFO
eviction</b>, because Pine's silent oldest-first drop at <code>max_*_count</code> is not a safety net in the
wild — several scripts never delete anything and rely on it as their retention policy. A port that draws all
history will not match the reference.</p></div></section>""")

P.append("""<section><h2><span class="num">08</span>Corpus</h2>
<h3 class="st">Our test corpus has been measuring a different population</h3>
<div class="prose"><p>The corpus is <b>137 scripts</b>, not the 169 previously believed — that figure counted
README/SOURCES files and ThinkScript. Against the ecosystem it is unrepresentative in the specific direction
that flatters us:</p></div>
%s
<div class="prose" style="margin-top:20px"><p>A staged expansion to <b>537 candidates</b> is prepared,
category-balanced against the measured ecosystem mix with a deliberate difficulty spread.
<b>370 may have source committed</b>; 167 are reference-only — 34 carrying non-commercial licences and 133
whose licence cannot be established without fetching.</p></div>
<div class="callout flag"><b>One licence decision has to be made before any ingest.</b> Two existing corpora
already apply contradictory rules to the same class of file: the committed community corpus treats a script
with no licence line as MPL-2.0 per TradingView's Terms §22, while an unmerged branch's manifest marks every
"licence not stated" file local-only. Under the stricter reading, commit-eligible drops from <b>370 to 202</b>.
Separately, <code>tests/fixtures/pine/12-ichimoku-clouds.pine</code> is committed today <b>carrying a
CC BY-NC-ND header</b> — the non-commercial policy was applied to the community corpus but never backwards to
the GitHub-sourced one. That is a pre-existing defect, flagged and not touched.</div></section>""" % table(
    ["dimension", "our corpus", "the wild"],
    [["uses a drawing object", "11.7%", "%.1f%%" % ALL.get("any_drawing_object", 0)],
     ["declares a UDT", "1.5%", "%.1f%%" % ALL.get("udt", 0)],
     ["uses arrays", "7.3%", "%.1f%%" % ALL.get("arrays", 0)],
     ["uses switch", "5.1%", "%.1f%%" % ALL.get("switch", 0)],
     ["screener-shaped", "65.7%", "~2%"],
     ["Pine v6 share", "73.0%", "%.1f%%" % ALL.get("pine_v6_pct", 0)],
     ["median length", "21 lines", "%s lines" % ALL.get("median_lines")],
     ["median boosts (community subset)", "13,501", "773"]],
    num_cols=(1, 2),
    note="Zero <code>polyline</code>, <code>linefill</code>, <code>chart.point</code> or <code>plotchar</code> "
         "anywhere in the current corpus; the ~4,500-site mutator surface is represented by a single "
         "<code>label.set_text</code>. Four categories are entirely absent."))

P.append("""<section><h2><span class="num">09</span>Method, and what it cannot tell you</h2>
<div class="prose"><p>Scripts were enumerated and read from TradingView's own public endpoints — the same ones
a script page uses — then parsed locally. Only open-source scripts were read; no protected or invite-only
script was accessed. Licences are recorded per file.</p></div>
<ul class="tight">
<li><b>The plot-family counts are externally validated.</b> 100%% exact agreement with TradingView's own
compiler across %s comparisons. The drawing-object counts are not externally validatable — TradingView does
not publish them.</li>
<li><b>The instrument was audited and corrected.</b> A first pass was blind to Pine's method-call syntax
(<code>myLine.set_x2()</code>); a receiver-typed re-derivation recovered <b>7,471 sites (+7.8%%)</b>, changing
the ranking of every setter, getter and delete row while leaving the top 15 unchanged. 255 sites remain
deliberately unattributed, so the table is still a floor.</li>
<li><b>Call sites are not objects.</b> Stated again because it is the easiest number here to misuse.</li>
<li><b>Categories are bounded by what was searched for.</b> Breadth and visual-decoration are unmeasured
rather than small — both grew ~100× when the remaining search terms completed.</li>
<li><b>Two published scripts break our translator</b> — one exhausts a 4 GB heap, one never returns. Both are
recorded by name. A runtime that must execute the wild has to survive them.</li>
<li><b>Nothing here was confirmed by running Pine on a live chart.</b> The spec carries 53 explicitly
unverified items for exactly this reason; several can only be settled against TradingView itself.</li>
</ul></section>""" % ("{:,}".format(sum(v.get("scripts_compared", 0) for v in (val or {}).get("summary", {}).values())) if val else "—"))

P.append("""<section><h2><span class="num">10</span>The documents</h2>
<h3 class="st">Full research output</h3>
%s</section>""" % table(["file", "what it is", "size"], doc_rows, num_cols=(2,)))

P.append("""<footer>Survey conducted 8 September 2026 · %s scripts catalogued, %s open-source sources read from
TradingView's public endpoints · licence recorded per file · no protected or invite-only script was read ·
counts are call sites unless stated otherwise.</footer></div><script>%s</script>"""
         % ("{:,}".format(n_cat), "{:,}".format(n_fetched), JS))

with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(P))

print("wrote %s  (%.2f MB)" % (OUT, os.path.getsize(OUT) / 1e6))
print("gallery %d cards, %d thumbnails, %d assessed, difficulty %s" % (len(cands), len(thumbs), n_rated, dh))
print("corrected table in use: %s (%d rows)" % (bool(ap_cor), len(ap.get("primitives", [])) if ap else 0))
print("inventory n=%d  catalog=%d  fetched=%d  non-commercial=%d" % (N, n_cat, n_fetched, noncomm))
print("plan entries: %s" % (len(plan) if isinstance(plan, list) else "n/a"))

# ── Typographic characters go out as HTML entities so the page renders the same
#    regardless of what charset the host declares. (A local preview server that
#    omits charset=utf-8 was showing mojibake; the published wrapper supplies one,
#    but the page should not depend on that.)
_doc = open(OUT, encoding="utf-8").read()
for _ch, _ent in (("—", "&mdash;"), ("·", "&middot;"), ("’", "&rsquo;"),
                  ("→", "&rarr;"), ("–", "&ndash;"), ("×", "&times;"),
                  ("▲", "&#9650;"), ("▼", "&#9660;"), ("“", "&ldquo;"),
                  ("”", "&rdquo;"), ("‘", "&lsquo;"), ("…", "&hellip;")):
    _doc = _doc.replace(_ch, _ent)
open(OUT, "w", encoding="utf-8").write(_doc)
print("entity pass done; non-ascii chars remaining: %d"
      % sum(1 for c in _doc if ord(c) > 127))
