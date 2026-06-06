"""One-shot: normalize hardcoded mono font-family declarations to var(--font-mono).

All these stacks already resolve to JetBrains Mono at runtime (it's the loaded
font); this just makes the source consistent. Excludes Landing (intentional
marketing island) and StockChart (already uses the token with a fallback).
"""
import os
import re

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "src")
EXCLUDE = {"Landing.module.css", "StockChart.module.css"}
# font-family decl whose value mentions a hardcoded mono face → var(--font-mono)
PAT = re.compile(r"font-family:\s*[^;{}]*(?:IBM Plex Mono|JetBrains Mono)[^;{}]*;")

changed = []
for dirpath, _, files in os.walk(ROOT):
    for fn in files:
        if not fn.endswith(".css") or fn in EXCLUDE:
            continue
        p = os.path.join(dirpath, fn)
        with open(p, encoding="utf-8") as f:
            src = f.read()
        new, n = PAT.subn("font-family: var(--font-mono);", src)
        if n:
            with open(p, "w", encoding="utf-8") as f:
                f.write(new)
            changed.append((os.path.relpath(p, ROOT), n))

total = sum(n for _, n in changed)
print(f"normalized {total} mono declarations across {len(changed)} files")
for rel, n in sorted(changed):
    print(f"  {n:2d}  {rel}")
