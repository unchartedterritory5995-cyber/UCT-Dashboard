/**
 * P5: the starter packs' switch, read from the latched auth payload. On the client it gates the
 * "How do you trade?" offer and installing a pack, never rendering: a style a member installed is
 * an ordinary style row and renders whatever this says. The firm style rows in the gallery are
 * gated on the server (listed only while this AND the library switch are on, P5-AUD-1).
 */
import { notebookFlag } from './offline/notebookFlags'

export const STARTER_PACKS_FLAG = 'notebook_starter_packs_enabled'
export const starterPacksEnabled = () => notebookFlag(STARTER_PACKS_FLAG) === true
