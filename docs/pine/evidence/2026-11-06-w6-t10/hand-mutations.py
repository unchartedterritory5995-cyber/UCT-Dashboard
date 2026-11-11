import io, subprocess, sys, shutil, os, re
WT = 'C:/Users/Patrick/uct-worktrees/pine-dsk-w6t10'
FE = WT + '/app/src/components/chart/engine/ast/pineRuntimeFrontend.js'
RAIL = 'src/components/chart/engine/runtime/__tests__/w6Enum.test.js'
DOOR = 'src/components/chart/engine/runtime/__tests__/objectDoorGate.test.js'
NODE = '/c/Users/Patrick/uct-worktrees/_resume-2026-11-01/dsk/node20.sh'

MUTS = [
  ('C0 no-op control (a comment)', "  const ENUM_UNKNOWN = '?'\n", "  // mutation control\n  const ENUM_UNKNOWN = '?'\n", [RAIL]),
  ('M1 compare by TITLE (spec)', "          return str(enumValueKey(m.decl.name, m.field))\n",
   "          return str(enumValueKey(m.decl.name, m.decl.members.get(m.field)))\n", [RAIL]),
  ('M2 the leaf guard admits everything', "        if (!enumOk.has(node)) {\n          throw enumRefusal(", "        if (false) {\n          throw enumRefusal(", [RAIL]),
  ('M3 drop the str.tostring W6-E1 refusal', "      if (node.type === 'call' && node.name === 'str.tostring'\n          && enumOf(", "      if (false && node.type === 'call' && node.name === 'str.tostring'\n          && enumOf(", [RAIL]),
  ('M4 == admits two different enums', "if (l === null || r === null || l !== r || l === ENUM_UNKNOWN) {", "if (l === null || r === null || l === ENUM_UNKNOWN) {", [RAIL]),
  ('M5 := admits any value', "    if (en === null && want === null) return\n    if (en !== want) {", "    if (en === null && want === null) return\n    if (false) {", [RAIL]),
  ('M6 member-set input.enum served', "    if (bn && (own(inputs) || own(inputDefaults))) {", "    if (false) {", [RAIL]),
  ('M7 options need not hold the default', "      if (!fields.includes(m.field)) {", "      if (false) {", [RAIL]),
  ('M8 written type ignored at a binding', "    if (want !== null && en !== want) {", "    if (false) {", [RAIL]),
  ('M9 nested / repeated enum accepted', "        const decl = st.enumDecl ? enumDecls.get(toks[1].value) : null", "        const decl = enumDecls.get(toks[1].value)", [RAIL]),
  ('M10 initialiser does not type an enum slot', "      if (en !== null && en !== ENUM_UNKNOWN) return makeTy('enum', { name: en })", "      if (false) return makeTy('enum', { name: en })", [RAIL]),
  ('M11 enum-typed UDT field accepted', "        if (enumField) {", "        if (false) {", [RAIL]),
  ('M12 a bad declaration served', "        if (decl.bad) throw enumRefusal(", "        if (false) throw enumRefusal(", [RAIL]),
  ('M13 route exclusion removed', "        && !(enumDecls.size && containsEnum(node, scope))) {", "        ) {", [RAIL]),
  ('M14 registry built at the object door too', "  const enumDecls = atObjectDoor ? new Map() : collectEnums(stmts)", "  const enumDecls = collectEnums(stmts)", [RAIL, DOOR]),
  ('M14b statement arm also at the object door', "      if (word === 'enum' && !atObjectDoor && enumDeclarationHead(toks)) {", "      if (word === 'enum' && enumDeclarationHead(toks)) {", [RAIL, DOOR]),
  ('M16 reserved enum names accepted', "    if (ENUM_RESERVED_NAMES.has(name)) {", "    if (false) {", [RAIL]),
  ('M17 enum named like a declared type accepted', "        if (udtTypes.has(decl.name)) {", "        if (false) {", [RAIL]),
]

orig = io.open(FE, encoding='utf-8', newline='').read()
results = []
only = sys.argv[1:]  # optional ids
try:
    for name, old, new, tests in MUTS:
        if only and name.split()[0] not in only: continue
        n = orig.count(old)
        if n != 1:
            results.append((name, f'ANCHOR x{n}', '')); continue
        io.open(FE, 'w', encoding='utf-8', newline='').write(orig.replace(old, new))
        cmd = f'source {NODE}; cd {WT}/app && npx vitest run ' + ' '.join(tests) + ' --maxWorkers=1 2>&1'
        out = subprocess.run(['bash', '-c', cmd], capture_output=True, text=True, encoding='utf-8', errors='replace').stdout
        out = re.sub(r'\x1b\[[0-9;]*m', '', out)
        tl = [l.strip() for l in out.splitlines() if l.strip().startswith('Tests ')]
        failed = [l.strip()[2:].strip() for l in out.splitlines() if l.strip().startswith('×')]
        verdict = 'KILLED' if failed else 'SURVIVED'
        results.append((name, verdict, (tl[-1] if tl else '?') + ' | ' + '; '.join(failed[:3])))
        print(results[-1], flush=True)
finally:
    io.open(FE, 'w', encoding='utf-8', newline='').write(orig)
print('RESTORED', io.open(FE, encoding='utf-8', newline='').read() == orig)
