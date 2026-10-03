# Capture queue — 2026-10-02 L1, a function imported from a library (Q-L1)

Branch `pine/l1-libraries`. One new probe, `tools/visual_conformance/probes/vw-library-import.pine`,
for the parent session to run on the live TradingView rig with `tools/vendor_harness/tv_capture.js`
— same procedure as `docs/pine/capture-queue-2026-09-28.md` (visibility gate, **Create new ▸
Indicator**, "Add to chart" binding gate, `__uctVH.capture({...})`, chunks,
`verify_capture.mjs --assemble`).

## What L1 serves, and what no committed capture shows yet

L1 links an `import Author/Library/Version` by splicing the library's reached definitions into the
script (`app/src/components/chart/engine/ast/pineLibraries.js`). Its proof is an EQUIVALENCE: a
script calling `lib.f(x)` compiles to the same program, bar for bar in both lanes, as the script with
`f` pasted in (`pineLibraries.test.js`). So everything L1 serves is something the engine already
serves for a script's own function — and that is graded on captures.

What no committed capture shows: that TradingView itself runs an imported function exactly as the
same function written in the script. Pine's documentation says it does (an exported function is
compiled into the importing script, each call site with its own series history and `var` state);
none of the 47 captures or the committed harness dir imports a library (measured 2026-10-02: 0 of
139 harness files carry an `import` line).

## The capture

| # | capture | settles | what it would move |
|---|---|---|---|
| Q-L1 | `vw-library-import.pine` on NYSE:RDDT 1D (full history) | L01c and L02c are 0 on every bar (a pure export equals the same formula written here); L03 vs L04 — one export at two call sites keeps two states; L05 — an omitted series default | nothing is refused on it today: it RATIFIES what L1 serves, and the grading rail is the vendorHarness test this capture makes possible. If L01c / L02c are not 0, or L03 = L04 where the windows differ, L1's linking is wrong and must be switched off (empty the server store) |

⚠️ Measured on this branch with the library in a scratch store: the host lane SERVES L02 and L02c
(`dema`); it refuses L01 / L01c (`ao()` omits defaulted arguments) and L03–L05 (`highestSince` holds
`var` state) on its own walls (`pine:function-def`), and the runtime lane refuses the script on
`ao`'s defaults. Those rows are for the vendor's side of the question.
