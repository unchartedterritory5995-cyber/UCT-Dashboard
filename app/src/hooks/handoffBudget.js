// ⚠️ A HANG GUARD, NOT A LATENCY BUDGET. `prepareForDisplay` settles on success
// and on failure, so this only fires when a request never settles at all.
// Deliberately generous: firing it early would race a slow-but-healthy prepare
// and reintroduce the blind commit it exists to prevent.
// A leaf module (no imports) so the bars hook can share the number without importing a UI hook: a test that mocks
// useSymbolHandoff must not take the timeframe hold's bound away with it (#3033 review).
export const HANDOFF_HANG_MS = 4000
