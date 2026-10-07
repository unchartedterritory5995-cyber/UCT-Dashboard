# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 07:32:03`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13q3-run2; identity = 6cb71e7345fbe82802c8453aaf677c6f
- `2026-10-03 07:32:35`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 07:34:27`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 07:43:24`  **shutdown** — C:\data, 62 db files — CLEAN
