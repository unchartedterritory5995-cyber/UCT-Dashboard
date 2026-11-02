import json, os, sys
WT = 'C:/Users/Patrick/uct-worktrees/pine-w3'
SC = 'C:/Users/Patrick/AppData/Local/Temp/claude/C--Users-Patrick/4f6b7973-3f6b-449e-85dd-943a3359950a/scratchpad/w3'
SAMPLE = 'C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/pine-sample'
d = json.load(open(WT + '/docs/pine/coverage-map.json', encoding='utf8'))
m = {r['key']: r for r in json.load(open(SAMPLE + '/sample_manifest.json', encoding='utf8'))['rows']}
DRAW = ('[drawing-objects]', 'object op dropped', 'line.', 'label.', 'box.', 'table.', 'polyline', 'linefill', 'chart.point')
rows = []
for r in d['scripts']:
    w = r['walls'] or []
    if any(x.startswith(DRAW) for x in w):
        p = m[r['key']]['path'].replace('<cache>/', '')
        f = [c for c in (os.path.join(SAMPLE, p), os.path.join(WT, p)) if os.path.exists(c)]
        if not f:
            print('MISSING', p)
            continue
        rows.append({'key': r['key'], 'path': os.path.abspath(f[0]).replace(os.sep, '/'), 'cap': 8})
print(len(rows))
json.dump(rows, open(SC + '/input.json', 'w'))
