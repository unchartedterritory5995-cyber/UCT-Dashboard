// Tour `note-resurfaces` (plan 4.2 row 21): a passive, two-step explainer attached to the
// resurfacing notice, the "What you wrote then" sheet a resurfacing insight opens over a
// note. `replayable: false` in the entry; see docs/notebook/wave14-w14-b3.md for what the
// current engine can and cannot do with a passive entry.
const F = 'components/notebook/ResurfaceVersionSheet.jsx'

export const STEPS = Object.freeze([
  Object.freeze({ id: 'then', anchor: 'resurface-then', file: F }),
  Object.freeze({ id: 'back', anchor: 'resurface-back', file: F }),
])

export const COPY = Object.freeze({
  then: {
    title: 'What you wrote then',
    body: 'A level this note named was touched, the name moved 8% or more, or a date you set arrived. This is the saved version that first named it, shown read only.',
  },
  back: {
    title: 'Your note is unchanged',
    body: 'Close this to go back to the note as it is now. To restore an older version, use History.',
  },
})
