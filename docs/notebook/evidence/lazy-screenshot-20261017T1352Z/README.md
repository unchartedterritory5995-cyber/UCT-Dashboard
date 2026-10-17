# Lazy modern-screenshot (I-A bytes), run 20261017T1352Z

Base: origin/master `5d053e399c`. Branch `notebook-lazy-screenshot`.

## Bytes (`python tools/notebook_perf_budgets.py --dist app/dist`, `bytes.notebook_first_open`)

| | bytes | JS chunks | headroom vs budget 2,260,793 |
|---|---|---|---|
| base (rebuilt on this worktree before the edit; matches the stated 2,259,916) | 2,259,916 | 61 | 877 |
| after | 2,235,468 | 60 | 25,325 |
| delta | **-24,448** | -1 | +24,448 |

The scratch-copy experiment measured -24,423; this build is 25 B better. Raw outputs:
`base-build.log`, `base-budgets.log`, `after-build.log`, `after-budgets.log` (VERDICT: PASS both).

## Change

- `lib/exportNote.js`: static import removed; `const { domToBlob } = await import('modern-screenshot')`
  inside `async exportNoteAsPng`, just before the call.
- `lib/embedArchive.js`: static import removed; in `async captureElementPng`, after the `!el` early
  return, `const shot = import('modern-screenshot')` + `shot.catch(() => {})` (so a probe-loop throw
  never leaves an unhandled rejection), then `const { domToBlob } = await shot` before the call.
- `lib/screenshotLazy.test.js`: new AST rail (acorn, same shape as `RefusedCopyOffer.lazy.test.js`).
- `app/src/pages/breadth/breadthShare.js` still imports it statically (outside journal-2-0, not in the Notebook closure; untouched).

## Tests (each run alone, `cd app && npx vitest run <file>`; logs `t1`..`t7`)

| file | result |
|---|---|
| `src/pages/journal-2-0/lib/exportNote.test.js` | 1 file, 26 passed |
| `src/pages/journal-2-0/components/notebook/NoteExportControls.test.jsx` | 1 file, 29 passed |
| `src/pages/journal-2-0/lib/widgetEmbed.test.jsx` | 1 file, 65 passed |
| `src/pages/journal-2-0/components/notebook/NoteEditorPage.marketContext.test.jsx` | 1 file, 9 passed |
| `src/pages/journal-2-0/lib/screenshotLazy.test.js` (new) | 1 file, 4 passed |
| `src/components/screener/reachable.test.js` | 1 file, 17 passed |
| `src/__tests__/entryExcludesChartEngine.test.js` | 1 file, 8 passed |

0 failures. Not run: the full suite.

## Mutation proof

Temporarily added `import { domToBlob as _mut } from 'modern-screenshot'` to `lib/exportNote.js`
(`mutation-red.log`): rail RED, `AssertionError: expected [ 'lib/exportNote.js' ] to deeply equal []`
(1 failed, 3 passed). Restored by writing back the exact pre-mutation bytes (`cmp` identical to a
saved copy); reversing the two intended edits on the restored file reproduces
`git cat-file blob HEAD:app/src/pages/journal-2-0/lib/exportNote.js` byte-for-byte after CRLF->LF
(the working tree is CRLF, the index LF). Re-run green (`mutation-restored-green.log`, 4 passed).
The control cell runs the matcher on string fixtures (static import seen, re-export seen, comment
ignored, dynamic told apart, similarly named package not matched).
