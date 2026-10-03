# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 00:42:32`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13h2-walk-18; identity = 5b0b3738bbb7045d1080def6e4902463
- `2026-10-03 00:44:03`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 00:45:59`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 00:46:25`  **shutdown** — C:\data, 62 db files — CLEAN
