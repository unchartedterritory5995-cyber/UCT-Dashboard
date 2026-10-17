/**
 * P3a: the community style library's switch, read from the latched auth payload.
 * It gates CREATING (share, adopt, helpful, follow), never rendering: a style already
 * adopted is an ordinary style row and renders whatever this says.
 */
import { notebookFlag } from './offline/notebookFlags'

export const STYLE_LIBRARY_FLAG = 'notebook_style_library_enabled'
export const styleLibraryEnabled = () => notebookFlag(STYLE_LIBRARY_FLAG) === true
