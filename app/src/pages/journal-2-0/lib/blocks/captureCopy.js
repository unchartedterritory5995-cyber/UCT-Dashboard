// The words a "Capture now" says when it could not land (R-T12-C fix round 2, M-6). ONE copy, imported by
// the prep blocks' frame (components/notebook/blocks/PrepCapture.jsx) and the market context stamp's own
// Capture now (components/notebook/MarketContextEmbed.jsx), so neither restates it and the stamp's chunk
// never imports a block component for a string. No imports, no network: a block file may read it.
export const CAPTURE_FAILED = "This couldn't be read just now. Nothing was changed."
