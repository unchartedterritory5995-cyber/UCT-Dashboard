"""Rebuild the bank segments the audit touches, with every /data path pinned to
a scratch sandbox first (CLAUDE.md: apply the census before importing api.**).
regime.bottoms is built from the catalog alone; the wire half of gen_regime
reads the wire archive and is never run here.

  python -I -X utf8 audit_rebuild.py <segment> [<segment> ...]
"""
import os
import pathlib
import sys

REPO = pathlib.Path("C:/Users/pgosz/uct-worktrees/study-import")
SANDBOX = "C:/Users/pgosz/AppData/Local/Temp/claude/C--Users-pgosz/e53aca68-7b0c-4e23-87db-a74a97087865/scratchpad/audit_sandbox"
os.makedirs(SANDBOX, exist_ok=True)
sys.path.insert(0, str(REPO))
os.chdir(REPO)

import conftest  # noqa: E402  (the census only; nothing is armed outside pytest? see below)

_, pins, _ = conftest.shared_data_root_census()
for env, literal in pins.items():
    os.environ[env] = literal.replace("/data", SANDBOX)
os.environ["DATA_DIR"] = SANDBOX

from scripts.study import gen_recall, gen_regime, gen_size, gen_terms, gen_walkthroughs  # noqa: E402
from scripts.study._common import write_segment  # noqa: E402

targets = sys.argv[1:]
outs = {}
want = set(targets)
if want & {"size.house_rule"}:
    outs.update(gen_size.generate())
if want & {"walk.method"}:
    outs.update(gen_walkthroughs.generate())
if want & {"vocab.chart"}:
    outs.update(gen_terms.generate())
if want & {"recall.glossary", "recall.concepts", "recall.bible", "recall.principles", "recall.playbooks"}:
    outs.update(gen_recall.generate())
if "regime.bottoms" in want:
    js = gen_regime.BOTTOMS.read_text(encoding="utf-8")
    outs["regime.bottoms"] = gen_regime.bottom_items(gen_regime.read_bottoms(js), gen_regime.read_signposts(js))
for name in targets:
    if name not in outs:
        raise SystemExit(f"no generator produced {name}")
    write_segment(name, outs[name])
    print(f"{name}: {len(outs[name])} items written")
