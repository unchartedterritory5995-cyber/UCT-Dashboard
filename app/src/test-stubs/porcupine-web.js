// Test stub for @picovoice/porcupine-web — the real package has broken
// package.json exports that trip Vite's module resolver under vitest.
// We never use the real wake-word engine in unit tests; this stub lets
// any component that imports it render without exploding.
export const PorcupineWorker = {
  create: () => Promise.resolve({
    start: () => {},
    stop: () => {},
    release: () => {},
    postMessage: () => {},
  }),
}
export const BuiltInKeyword = {
  ALEXA: 'alexa',
  AMERICANO: 'americano',
  BLUEBERRY: 'blueberry',
  BUMBLEBEE: 'bumblebee',
  COMPUTER: 'computer',
  GRAPEFRUIT: 'grapefruit',
  GRASSHOPPER: 'grasshopper',
  HEY_GOOGLE: 'hey google',
  HEY_SIRI: 'hey siri',
  JARVIS: 'jarvis',
  OK_GOOGLE: 'ok google',
  PICOVOICE: 'picovoice',
  PORCUPINE: 'porcupine',
  TERMINATOR: 'terminator',
}
export default { PorcupineWorker, BuiltInKeyword }
