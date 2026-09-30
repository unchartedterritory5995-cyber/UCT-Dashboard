# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-29 21:14:02`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\dra-data\d256; identity = d33e1d804c27253ec43029039cef5150
- `2026-09-29 21:16:53`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 21:18:49`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 21:19:05`  **shutdown** — C:\data, 62 db files — CLEAN
