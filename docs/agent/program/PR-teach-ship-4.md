# teach-ship-4: layouts — Rename and Version history on the member's own layout

Base: teach-ship-3. Stack position: 4 of 5. Master `25f049554f` is merged in through the stack. Local only; pushed by the Lead. Evidence: LOCAL native Windows Node v24, BROWSER-MOCK-MODEL / SIMULATED.

**Production: not yet verified.**

## Behaviour
- The layout-bar steps for Rename and Version history ring one of the member's OWN layouts on the bar, by name, never the first layout there. Their layouts come from `host.layouts.snapshot()` (scope `user`). UCT Default and the prebuilt layouts have neither control.
- With no layouts of their own, the guide says so ("Save this board as a layout first…") instead of ringing a built-in.

## Files (against teach-ship-3)
- `app/src/agent/capabilities/guide.js` (`mineOnly`)
- `app/src/agent/guide/actions.js` (the layout menu rows carry `mine`)
- Test: `agentGuideFamilies.test.js`
- This doc

## Touches useAgent / deixis / host / runtime
- **host: read only.** It reads `host.layouts.snapshot()` and writes nothing.
- **useAgent, deixis, runtime: no.**

## Verification (SIMULATED)
- **Full suite before the restack** (at `15c5fa00e0`): Test Files 266 passed | 5 skipped, Tests 9299 passed | 6 skipped.
- **AUDIT review (11-08):** ACCEPTED.
- **Browser** (teach-cov-2/3 runner passes, which build on this slice): C3-040 and C3-041 (a layout's version history, with the version store given) and the layout library rows VERIFIED.
- **Owed:** a full suite on this head once a lock slot is free.

## Note
The overlay pointer fix that was proposed for this slice is in ship-2, because the lifecycle code builds on it.
