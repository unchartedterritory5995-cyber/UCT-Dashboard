// Notebook P1: the journal-styles surfaces as ONE module, so the whole feature is ONE dynamic import
// (lazyStyles.js). Each dynamic import in an eager file costs first-open bytes -- the expression plus a
// preload list as long as the chunk's dependencies -- and there used to be five. Nothing else imports this.
export { default as KindSection } from './KindSection'
export { default as StyleHost } from './StyleHost'
export { default as SaveStyleDoor } from './SaveStyleDoor'
// Task 11.19: My tools' Templates tab opens a template in the style editor through this same one door (loadStyle),
// never a second import() of a styles/ module (NoteEditorPage.styleChunks.test.js).
export { default as StyleEditor } from './StyleEditor'
