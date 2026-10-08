# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 18:56:37`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\61625d99-f8db-4269-a728-231c08d3da11\scratchpad\fin\keys3\data-ta2; identity = fd41d082d51d338cc06717296878f2ab
- `2026-10-07 18:57:11`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 18:59:03`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
