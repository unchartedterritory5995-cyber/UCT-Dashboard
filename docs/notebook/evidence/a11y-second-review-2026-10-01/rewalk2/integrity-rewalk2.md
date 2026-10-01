# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-01 17:43:18`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\a11y2-rewalk2b-data; identity = 5db7a38325d6bfc168b1182005f4b25a
- `2026-10-01 17:44:29`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-01 17:46:25`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-01 17:47:52`  **shutdown** — C:\data, 62 db files — CLEAN
