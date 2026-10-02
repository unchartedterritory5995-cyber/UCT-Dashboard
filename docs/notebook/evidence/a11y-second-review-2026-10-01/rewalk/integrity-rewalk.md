# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-01 15:31:43`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\a11y2-rewalk-data; identity = 900788445205756d61e68bfd00addba8
- `2026-10-01 15:33:24`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-01 15:35:22`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-01 15:36:57`  **shutdown** — C:\data, 62 db files — CLEAN
