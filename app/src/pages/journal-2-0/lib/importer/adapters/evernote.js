/**
 * Evernote adapter — DETECTION ONLY for now. Real `parse()` lands in Task 12.
 *
 * Detection score (per plan): 1.0 when the export contains any `.enex` file
 * (Evernote's export format is unambiguous — no other tool produces it).
 */

export const evernoteAdapter = {
  id: 'evernote',
  label: 'Evernote',
  detect,
  async parse() {
    throw new Error('not implemented')
  },
}

function detect(vfiles) {
  return vfiles.some((v) => /\.enex$/i.test(v.path)) ? 1.0 : 0
}
