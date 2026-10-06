/** The one id the live preview installs under. Legal under `defSchema.ID_RE`;
 *  the server mints `u_` + 12 hex, so no stored definition can ever wear it. */
export const PREVIEW_DEF_ID = 'u_editor-preview'

/** ⭐ P2 — the conversation's working-definition preview (`ConverseBox`). A
 *  second id, so it can draw beside the formula box's preview; same rules. */
export const CONVERSE_PREVIEW_DEF_ID = 'u_converse-preview'
