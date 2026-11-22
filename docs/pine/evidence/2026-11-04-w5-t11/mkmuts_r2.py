import json, sys
C = 'api/services/pine_runtime_client.py'
F = 'tests/fakes/pine_runtime_fake.py'
src = {C: open(C, encoding='utf-8').read(), F: open(F, encoding='utf-8').read()}
M = []


def m(name, f, old, new):
    assert src[f].count(old) == 1, (name, src[f].count(old))
    M.append([name, f, old, new])


m("CONTROL r2 no-op comment", C, "# --- the client ---", "# --- the client (control) ---")
m("V01 warm-up curtain not checked", C, "            if any(v == v for v in col[:wb]):", "            if False:")
m("V02 curtain checks one bar short", C, "            if any(v == v for v in col[:wb]):", "            if any(v == v for v in col[:wb - 1]):")
m("V03 curtain checks the first column only", C, "        for key, col in columns.items():\n            if any(v == v for v in col[:wb]):",
  "        for key, col in list(columns.items())[:1]:\n            if any(v == v for v in col[:wb]):")
m("V04 curtain over-reaches one bar (refuses a real value)", C, "            if any(v == v for v in col[:wb]):", "            if any(v == v for v in col[:wb + 1]):")
json.dump(M, open(sys.argv[1], 'w', encoding='utf-8', newline='\n'), indent=1, ensure_ascii=True)
print(len(M))
