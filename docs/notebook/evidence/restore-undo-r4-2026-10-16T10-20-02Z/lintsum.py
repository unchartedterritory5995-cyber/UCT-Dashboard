import json, collections, os, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
for f in d:
    c = collections.Counter((m.get('ruleId'), m['severity']) for m in f['messages'])
    print(os.path.basename(f['filePath']), dict(c))
