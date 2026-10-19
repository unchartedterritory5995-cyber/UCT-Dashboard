"""P5 Task 1 V11/V12/F11: which source files' marker strings sit in the Notebook first-open
closure. Reads app/dist with tools/notebook_perf_budgets.py's own closure function."""
import json
import sys
from pathlib import Path

WT = Path(r"C:\Users\Patrick\uct-worktrees\notebook-p5")
sys.path.insert(0, str(WT / "tools"))
import notebook_perf_budgets as npb  # noqa: E402

dist = WT / "app" / "dist"
budgets = json.loads((WT / "docs/notebook/perf-budgets.json").read_text(encoding="utf-8"))
roots = budgets["bytes"]["notebook_first_open"]["roots"]
manifest = npb.load_manifest(dist)
keys = npb.static_closure(manifest, roots)
closure_files = sorted({manifest[k]["file"] for k in keys})
all_js = sorted(str(p.relative_to(dist)).replace("\\", "/") for p in (dist / "assets").glob("*.js"))

MARKERS = [
    ("lib/notebookTelemetry.js", "conflict_forked"),
    ("onboarding/tourRegistry.js", "tour registry: "),
    ("onboarding/tours/b1Core.js", "formulas-rollups"),
    ("onboarding/learnTours.js", "Writing and capture"),
    ("onboarding/capabilityList.js", "What your Notebook can do"),
    ("lib/offline/notebookFlags.js FLAG_FALLBACKS", "notebook_style_library_enabled"),
    ("lib/noteCreation.js", "Could not create note ("),
    ("lib/widgetEmbedNode.jsx", "uct-widget-embed"),
    ("lib/journalStyles.js", "/mapping-offer"),
    ("styles/StyleHost.jsx", "Updated to the latest version of"),
    ("styles/KindSection.jsx", "Choose another style"),
    ("styles/StylesManager.jsx", "A style is how a kind of note starts"),
    ("TemplateGallery.jsx", "Search the community gallery"),
    ("TemplatePicker.jsx", "Browse the community gallery"),
    ("StyleLibraryCard.jsx", "Adopt "),
    ("styles/LibraryDoor.jsx", "Loading the community library"),
    ("tabs/NotebookTab.jsx", "Notes list tools"),
    ("widgets/registry.js blockManifest", "Morning wire and exposure"),
    ("lib/journalBlocks.js", "Include my before-entry rules"),
    ("surfaces/TodaySurface.jsx (P4a)", "Loading your day"),
]

out = {"closure_chunk_count": len(closure_files), "closure_chunks": closure_files, "markers": []}
texts = {f: (dist / f).read_text(encoding="utf-8", errors="replace") for f in all_js}
for label, marker in MARKERS:
    hits = [f for f in all_js if marker in texts[f]]
    out["markers"].append({
        "file": label, "marker": marker,
        "in_closure": [f for f in hits if f in closure_files],
        "outside_closure": [f for f in hits if f not in closure_files],
    })
print(json.dumps(out, indent=1))
