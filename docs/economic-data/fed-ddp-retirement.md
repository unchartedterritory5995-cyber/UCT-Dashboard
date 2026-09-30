# Federal Reserve Board DDP retirement — impact on UCT Economic Data

Researched live 2026-09-28 (UTC 2026-09-29). Adapter: `api/services/econ/adapters/fed_ddp.py`.

## 1. The notices (exact text)

**A. Every statistical-release page** (e.g. https://www.federalreserve.gov/releases/h15/, also h41, h6, g17):

> During the week of November 9, the “Build Your Package” feature in the Data Download Program (DDP) will be removed in preparation for the **eventual retirement of the DDP**. Users can access data and expanded download options through the Federal Reserve Bank of St. Louis's Federal Reserve Economic Data (FRED). Learn more about the DDP and FRED partnership.

**B. The linked page** https://www.federalreserve.gov/data/data-download-fred-information.htm ("Last Update: July 16, 2026"), item dated July 16, 2026:

> As part of the Board’s continued effort to streamline our data offerings, the Board plans to remove the “Build Your Package” option from the Data Download Program the week of November 9, 2026. **Historical data will remain available for download as XML files on statistical release pages.** This change transitions users from the DDP to the Federal Reserve Bank of St. Louis’s Federal Reserve Economic Data (FRED). FRED offers multiple data access tools, including an API for programmatic retrieval. Account holders can use the API to download bulk observations for any FRED or DDP series in JSON or XML format, with complete historical data available. […] Users who wish to manually access Board DDP data can download an XML format of the release directly from statistical releases pages or take advantage of the Board’s crosswalk (CSV) to help translate Board series IDs to FRED series IDs for FRED downloads.
>
> **The Board plans additional changes to the DDP later this year and in 2027, including removal of the preformatted data packages and the eventual retirement of the DDP.** More details and timelines will be shared in advance.

Earlier items on the same page: "View chart" retired 2025-12-18; FRED API v2 (bulk, key required) announced 2025-11-04 as the programmatic route for "all FRED and DDP series".

**C. Per-release RSS** (https://www.federalreserve.gov/feeds/h15.xml, h41.xml, h6.xml, dated 2026-07-16): "…remove the "Build Your Package" (BYP) option from the DDP the week of November 9 in preparation for the eventual retirement of the DDP. Users who rely on the BYP option can access the data and tools through […] FRED **or by downloading the XML format of the release now added to release pages**."

**D. Inside the data files themselves** (`<message:Source>` of every `*_data.xml` header):

> The Data Download Program (DDP) application is being retired. During the week of November 9, the “Build Your Package” feature in the Data Download Program (DDP) will be removed in preparation for the eventual retirement of the DDP. For complete release data, please refer to data release pages. For customized data retrieval, please use the tools available through Federal Reserve Economic Data (FRED).

## 2. What dies, what survives

| Endpoint | Status | Timeline |
|---|---|---|
| DDP "Build Your Package" (custom series selection) | **removed** | week of 2026-11-09 |
| DDP preformatted packages `Output.aspx?rel=..&series=<hash>&type=package` (CSV) | removal announced, date TBA | "later this year and in 2027" |
| DDP release zip `Output.aspx?rel=..&filetype=zip` | dies with the DDP | "eventual retirement" |
| **Release-page XML** `https://www.federalreserve.gov/releases/<rel>/data/FRB_<rel>_xml.zip` | **stated to remain** ("Historical data will remain available…") | — |
| Release RSS feeds `/feeds/<rel>.xml`, `/feeds/datadownload.xml` | not mentioned; live | watch |
| FRED / FRED API v2 | the Board's named replacement | **NOT USABLE by UCT** (below) |

Live 2026-09-28 the release-page zips exist for every release the registry uses: H.15 4.3 MB, H.4.1 9.1 MB, H.6 1.4 MB, G.17 8.6 MB, H.8 8.4 MB, G.19 and H.10 (200, zip). They are **static files with real `ETag` + `Last-Modified`** (unlike DDP output, whose Last-Modified is the generation time), so latest-mode polling is a cheap conditional GET (304 until the file changes). Format = SDMX-ML 1.0 compact, identical to the DDP zip: `<frb:DataSet id="H6_M2"><kf:Series SERIES_NAME="M2.M" UNIT="Currency" UNIT_MULT="1e+09" CURRENCY="USD">…<frb:Obs TIME_PERIOD="2026-08-31" OBS_VALUE="23342.8" OBS_STATUS="A"/>`. Missing = `OBS_STATUS="ND"` with `OBS_VALUE="-9999"`. Monthly TIME_PERIOD is the month-END date.

**Why not FRED:** owner ruling #10 + `docs`/licensing rail — FRED's legal terms prohibit storing/caching/archiving and require the St. Louis Fed's consent for commercial use; the FRED API also needs an account key. The Board's own XML files carry the same Board data (public domain, GREEN) and keep UCT independent of FRED. No FRED code path was added.

## 3. Migration path (implemented)

`fed_ddp` takes the endpoint family as a registry parameter, `source.params.transport`:

- `release_xml` — **DEFAULT**. The surviving release-page zip. One request per release covers every series of that release; parsed by streaming (H.4.1's 126 MB XML in ~2 s). Conditional GET in latest mode only.
- `ddp_package` — the preformatted CSV package (needs `params.package` hash; `params.layout` seriescolumn|seriesrow). Smallest payload for latest polls (`lastobs=N`). Kept as a cross-check / alternate until the Board removes packages.
- `ddp_zip` — DDP-served SDMX zip; fallback only.
- `params.fallback` — ordered transports tried when the primary is GONE (404/410, redirect, an HTML page or an empty 200 in place of data). Defaults: `ddp_package → [release_xml]`, `release_xml → [ddp_zip]`. A 5xx/timeout is `SourceUnavailable` and never triggers fallback (it is an outage, not a retirement). Every fallback is recorded in `FetchResult.warnings`.

So the Nov-9 change needs **no action** (UCT never used Build Your Package), and removal of the preformatted packages needs **no action** either (release_xml is already the default; a series pinned to `ddp_package` falls back automatically and warns). Verified live 2026-09-28: all 5 cohort series agree exactly between `release_xml` and `ddp_package` (docs/economic-data/verification/fed_ddp.txt §2).

Identity validation is transport-independent: the requested mnemonic must exist in the requested dataset, and UNIT / multiplier / currency must match the registry `units.raw` — so a silent schema change during the transition fails closed instead of storing mis-scaled data.

## 4. Remaining risks / watch items

1. **Release-page XML is the single surviving Board source.** If the Board later drops or restructures it, the adapter fails closed (`MalformedPayload`/`TransportGone`), currentness goes SOURCE_UNAVAILABLE/VALIDATION_FAILED, nothing wrong is stored. Watch `/feeds/h15.xml`, `h41.xml`, `h6.xml`, `g17.xml` notices (`FedDdpAdapter.arrivals(kinds=("notice",))`).
2. **Publication time is not in the XML.** File `Last-Modified` is a (re)posting time (H.6 file stamped 20:05 ET for a 13:00 ET release; G.17 stamped 09-22 for the 09-18 release), so the adapter never reports it as `source_published_at`. Only G.17/G.19 RSS carry "Data for <month> are now available" items (`arrivals()`); for H.15/H.4.1/H.6 the arrival signal is the ETag change seen by latest polling within the scheduled window.
3. **Size.** release_xml re-downloads a whole release when it changes (H.15 4.3 MB daily, H.4.1 9 MB weekly). Acceptable for the dedicated ingestion service; ETag keeps unchanged polls at ~0 bytes.
4. **G.17 annual revision 2026-11-24 re-bases IP to 2022=100** (G.17 RSS 2026-09-18). The unit becomes `Index:_2022_100`; the identity check will refuse USINDPRO until the registry `units.raw` is changed to "Index 2022=100" on that day (intended fail-closed behaviour — schedule the registry edit with the release).
5. Registry dataset ids must be the Board's (e.g. H.6 M2 lives in dataset `H6_M2`, not `H6`) — corrections in `registry-corrections/fed_ddp.json`.
