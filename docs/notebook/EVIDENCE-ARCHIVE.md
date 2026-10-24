# Notebook evidence archive

On 2026-10-24, 2,332 evidence files (290 MB: old gate-run logs, screenshots and
walk output) were moved out of this repo into the private repo
**unchartedterritory5995-cyber/UCT-Dashboard-evidence**, to shrink the source
snapshot Railway downloads on every build (builds were failing at
"failed to fetch snapshot").

- Paths are preserved: `docs/notebook/<path>` here is `docs/notebook/<path>` there.
- Files are byte-identical (same git blob hashes); `MANIFEST.tsv` in that repo lists them.
- The archive repo holds 2,650 files; 318 of them were kept here too because a
  remaining evidence file names them.
- Only files NOTHING in this repo referenced were moved. Everything a test, tool,
  code comment or doc names stayed, and all of `docs/notebook/proof/` stayed.
- They also remain in this repo's git history: `git show 33da998ff:<path>`.
