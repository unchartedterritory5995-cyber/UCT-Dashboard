"""Build the input list for the W3 object-drop "why" measurement
(app/src/components/chart/engine/ast/w3ObjectWhy.measure.test.js, env W3_INPUT).

Selects every script of docs/pine/coverage-map.json whose walls name a drawing item and
resolves its source: a committed script under the repo (corpus/...), or a licence-held one
under the sample cache (read only, never committed).

    python tools/pine_coverage/w3_why_input.py --out <input.json> [--sample <dir>] [--worktree <dir>]

No machine paths live here: the repo root defaults to this file's own checkout, the sample
cache to $UCT_PINE_SAMPLE, else $UCT_RESUME/pine-sample (env-laptop.sh exports UCT_RESUME).
"""
import argparse
import json
import os
import sys

DRAW = ('[drawing-objects]', 'object op dropped', 'line.', 'label.', 'box.', 'table.', 'polyline', 'linefill', 'chart.point')


def default_sample():
    if os.environ.get('UCT_PINE_SAMPLE'):
        return os.environ['UCT_PINE_SAMPLE']
    if os.environ.get('UCT_RESUME'):
        return os.path.join(os.environ['UCT_RESUME'], 'pine-sample')
    return None


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', required=True, help='where to write the input json ([{key, path, cap}])')
    ap.add_argument('--worktree', default=os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')),
                    help='repo root holding docs/pine/coverage-map.json and corpus/ (default: this checkout)')
    ap.add_argument('--sample', default=default_sample(),
                    help='the sample cache holding sample_manifest.json and reference/ (default: $UCT_PINE_SAMPLE or $UCT_RESUME/pine-sample)')
    ap.add_argument('--cap', type=int, default=8, help='per-script cap carried to the measurement (default 8)')
    a = ap.parse_args(argv)
    if not a.sample:
        sys.exit('no sample cache: pass --sample or set UCT_PINE_SAMPLE / UCT_RESUME')
    with open(os.path.join(a.worktree, 'docs', 'pine', 'coverage-map.json'), encoding='utf8') as f:
        cov = json.load(f)
    with open(os.path.join(a.sample, 'sample_manifest.json'), encoding='utf8') as f:
        manifest = {r['key']: r for r in json.load(f)['rows']}
    rows, missing = [], []
    for r in cov['scripts']:
        walls = r.get('walls') or []
        if not any(w.startswith(DRAW) for w in walls):
            continue
        row = manifest.get(r['key'])
        if not row:
            missing.append(r['key'])
            continue
        rel = row['path'].replace('<cache>/', '')
        found = [c for c in (os.path.join(a.sample, rel), os.path.join(a.worktree, rel)) if os.path.exists(c)]
        if not found:
            missing.append(rel)
            continue
        rows.append({'key': r['key'], 'path': os.path.abspath(found[0]).replace(os.sep, '/'), 'cap': a.cap})
    with open(a.out, 'w', encoding='utf8') as f:
        json.dump(rows, f)
    print(f'{len(rows)} scripts -> {a.out}' + (f' ({len(missing)} missing: {missing[:5]})' if missing else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
