// Notebook P1: the journal-styles surfaces as ONE module, so the whole feature is ONE dynamic import
// (lazyStyles.js). Each dynamic import in an eager file costs first-open bytes -- the expression plus a
// preload list as long as the chunk's dependencies -- and there used to be five. Nothing else imports this.
export { default as KindSection } from './KindSection'
export { default as StyleHost } from './StyleHost'
export { default as SaveStyleDoor } from './SaveStyleDoor'
