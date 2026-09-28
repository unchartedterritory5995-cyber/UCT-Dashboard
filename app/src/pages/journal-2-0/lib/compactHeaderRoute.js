/**
 * Wave 10 lane D2 (design finding D-1): the route whose Journal header folds on a
 * phone. Measured at 390 px on fa6710394, the Journal took 257 px below the app's
 * top bar before the Notebook began (the title row, then the action cluster
 * wrapped onto two rows, then the section strip), and a note's title sat
 * 1,530 px down. On this route, and only at <=640 px (CSS decides the width; this
 * decides the route), the header shows Log Trade and one "Journal tools" toggle;
 * the rest of the cluster is one tap away and works exactly as before when open.
 * The section strip is NOT folded: every Journal tab stays one tap away.
 */
export function isCompactHeaderRoute(pathname) {
  return pathname === '/journal/notebook' || pathname.startsWith('/journal/notebook/')
}
