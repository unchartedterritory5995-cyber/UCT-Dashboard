/** The one id the live preview installs under. Legal under `defSchema.ID_RE`;
 *  the server mints `u_` + 12 hex, so no stored definition can ever wear it. */
export const PREVIEW_DEF_ID = 'u_editor-preview'
