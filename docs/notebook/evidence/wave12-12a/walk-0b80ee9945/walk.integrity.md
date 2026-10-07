# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-02 12:02:20`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w12a\w12a-data2; identity = b0c8542dbf1957a30ec5556c4fc78db8
- `2026-10-02 12:03:24`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 12:05:18`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 12:05:29`  **shutdown** — C:\data, 62 db files — CLEAN
