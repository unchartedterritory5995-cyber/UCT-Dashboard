# teach-ship-4: layouts — Rename and Version history on the member's own layout

Base: ship-3. Stack position: 4 of 5. Local only; not pushed.

Stacking: this slice stacks on teach-ship-3's tested code head `297e4621aa`, not on its doc commit, so `PR-teach-ship-3.md` is absent from this slice on purpose. The stack is not broken.

## Behaviour changes
- The layout-bar steps for Rename and Version history ring one of the member's OWN layouts on the bar, by name, never the first layout there. Their layouts come from `host.layouts.snapshot()`, scope `user`. UCT Default has neither control.
- With no layouts of their own, the guide says so instead of ringing a built-in.

## Touches deixis / useAgent / runtime / host
No. It only reads `host.layouts.snapshot()`.

## Note
The overlay pointer fix that was proposed for this slice is in ship-2, because the lifecycle code builds on it.
