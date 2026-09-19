// S5 CP4 (GATE-S5-PERSISTENCE-USER-STATE) — the switch that keeps Tracings on
// its dedicated store dark until CP5's browser-certification pass opens it.
//
// ⛔ A COMPILED CONSTANT, NOT A RUNTIME FLAG — deliberately simpler than
// Notebook's own `offlineFlag.js`, which evolved a per-browser localStorage
// override only once it needed real cross-browser certification (Wave Q1
// §32). Tracings is not there yet: CP5 is that same certification gate for
// this adopter, unscheduled. Until CP5 signs it default-ON, rollback for this
// checkpoint is a DEPLOY, not a variable — the same tradeoff Wave Q1 accepted
// at this exact stage of its own life (`lesson` carried in offlineFlag.js's
// own header: "reverting would throw away work that is correct and railed").
//
// ⛔ WHEN FALSE, `useTracingsSync` behaves EXACTLY as it did before CP4:
// reads/writes `tracings_doc` through `usePreferences`, no call to
// `/api/tracings`, nothing new stored, nothing already stored touched.
export const TRACINGS_STORE_ENABLED = false
