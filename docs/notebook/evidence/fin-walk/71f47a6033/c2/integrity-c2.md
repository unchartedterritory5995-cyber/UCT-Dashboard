tip under test: 71f47a6033 (configuration c2)

# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-10 21:22:34`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\61625d99-f8db-4269-a728-231c08d3da11\scratchpad\finwalk-final2\data\c2; identity = f5e3ac573d1ddcae2bad090fe18cf829
- `2026-10-10 21:23:14`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-10 21:25:06`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-10 21:44:58`  **shutdown** — C:\data, 62 db files — CLEAN
