/**
 * P5: the starter packs' switch, read from the latched auth payload. It gates the "How do you
 * trade?" offer, installing a pack and the firm style rows in the library, never rendering: a
 * style a member installed is an ordinary style row and renders whatever this says.
 */
import { notebookFlag } from './offline/notebookFlags'

export const STARTER_PACKS_FLAG = 'notebook_starter_packs_enabled'
export const starterPacksEnabled = () => notebookFlag(STARTER_PACKS_FLAG) === true
