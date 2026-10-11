// The `@` date list's listbox id, in a file of its own. The list's UI (components/notebook/
// DateSuggestList.jsx) is a lazy chunk, loaded on the first `@`; the suggestion plugin
// (lib/dateSuggest.js) is on the editor's first-open path and needs the id to wire the
// editor's combobox ARIA, so the id must not live in the lazy module.
export const DATE_SUGGEST_MENU_ID = 'uct-date-suggest'
