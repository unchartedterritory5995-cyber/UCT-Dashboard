// UCT Terminal — `usePanelView(defaults)`, `usePanelSort`, `usePanelSortSlot`: a panel's view kept
// with the board. The code lives in PanelTable.jsx (one chunk for the panel kit's view code, so the
// Terminal adds one chunk name, not three, to any first open that preloads a panel); this file is
// the hook's name for it. See PanelTable.jsx.
export { usePanelView as default, readSortSlot, sortSlotKey, usePanelSort, usePanelSortSlot } from './PanelTable'
