// scanKey → endpoint for the Scanner widget's preset scans. New presets add a line here
// + one in ScannerPicker's PRESET_SCANS.
//
// ONE authority, two readers: ScannerResults (shows the scan) and COV-10's tracking list
// (`SubscribedList`, which re-resolves a subscribed scan). A key missing here is a scan
// this board can no longer read — the tracking list says so rather than going empty.
export const SCAN_ENDPOINTS = {
  'highest-volume-1y': '/api/scans/highest-volume-1y',
  'highest-volume-ever': '/api/scans/highest-volume-ever',
  'ipo-1y': '/api/scans/ipo-1y',
  'top-gainers-30d': '/api/scans/top-gainers-30d',
  'top-gainers-60d': '/api/scans/top-gainers-60d',
  'top-gainers-90d': '/api/scans/top-gainers-90d',
}
