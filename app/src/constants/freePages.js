// S9 CP1 follow-up — FREE_PAGES was hand-typed identically in THREE files
// (AuthGuard.jsx, mobile/MoreSheet.jsx, NavBar.jsx), each carrying a "keep in
// sync with" comment pointing at the other two. One value, one place.
//
// ⛔ THE MATCHING LOGIC STAYS AT EACH CALL SITE, DELIBERATELY NOT EXPORTED
// HERE ALONGSIDE THE VALUE. AuthGuard.jsx tests a live `location.pathname`
// (which could be any nested path a member navigates to) and needs PREFIX
// matching (`.some(p => pathname.startsWith(p))`); NavBar.jsx/MoreSheet.jsx
// test one FIXED nav-item target string (`item.to`, always exactly one of the
// declared NAV_ITEMS paths, never a sub-path) and EXACT matching
// (`.includes(item.to)`) is correct there, not a bug to converge. Exporting a
// single `isFreePage()` here would force one semantic onto both questions,
// which is wrong for whichever side didn't need it. Only the VALUE was ever
// actually duplicated — this file ends that, and nothing else.
export const FREE_PAGES = ['/morning-wire']
