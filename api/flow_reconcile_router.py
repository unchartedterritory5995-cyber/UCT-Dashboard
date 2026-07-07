"""
Retrospective backfill of flow.db from raw OPRA + BBS.

Purpose: fill in institutional-size flow that got dropped by the live
LiveMassive pipeline. Two common failure modes today:

  1. Per-event premium under curated floor even though contract's daily
     total premium is well above (RIVN pattern — 19 events of ~$127K,
     $1.46M daily, dropped because each event alone fails floor).

  2. NBBO tick-test can't classify Side on single-print single-exchange
     BLOCKs. Result: alert gets Side='', strict_bid_only_bb drops it
     even though the print is enormous (BAC pattern — $6.6M single-print
     block, no side, dropped).

Fix path: accept externally-computed rollup rows (aggregated OPRA + BBS-
derived Side) and insert them into flow.db with source='reconcile_<date>'.
Idempotent via unique-key check.

Design notes:
- Isolated from live_massive_router.py per the 7/6 LEARNINGS: str_replace
  on that file already ate a return block once. Isolating keeps blast
  radius zero.
- Trusts caller-provided Side (assumes it's BBS-derived, not fabricated).
- Won't insert if a row already exists with same
  (CreatedDate, Symbol, CallPut, Strike, ExpirationDate, source).
- Marks source='reconcile_<date>' so backfilled rows are distinguishable
  in later analysis and can be deleted as a batch if needed.

To deploy:
  1. Drop this file next to live_massive_router.py.
  2. In main.py, add:
       from api.flow_reconcile_router import router as flow_reconcile_router
       app.include_router(flow_reconcile_router)
  3. Restart web. Endpoint lives at POST /api/flow-reconcile/insert.
"""

from __future__ import annotations

import logging
import os
import sqlite3
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/flow-reconcile", tags=["flow-reconcile"])

DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")


class ReconcileRow(BaseModel):
    """One row to insert into flow.db. Field names mirror the BBS CSV
    schema so this matches what event_to_bbs_row would have produced."""
    CreatedDate: str
    CreatedTime: str
    Symbol: str
    Type: str  # SWEEP / BLOCK / ML/
    Volume: str
    Price: str
    Side: str  # A / AA / B / BB
    CallPut: str  # CALL / PUT
    Strike: str
    Spot: str
    Premium: str
    ExpirationDate: str
    Color: str
    ImpliedVolatility: str = "0"
    Dte: str
    ER: str = "F"
    StockEtf: str = "STOCK"
    Sector: str = ""
    Uoa: str = "F"
    Weekly: str = "F"
    MktCap: str = "0"
    OI: str = "0"


class ReconcilePayload(BaseModel):
    date: str = Field(description="Trading date, M/D/YYYY. Used for the source tag.")
    rows: List[ReconcileRow]
    dry_run: bool = Field(default=False, description="If true, validate and echo but don't insert.")


class ReconcileResult(BaseModel):
    inserted: int
    skipped_duplicate: int
    total_submitted: int
    source_tag: str
    dry_run: bool
    inserted_previews: List[dict]


@router.post("/insert", response_model=ReconcileResult)
def reconcile_insert(payload: ReconcilePayload) -> ReconcileResult:
    """Insert reconcile rows into flow.db. Idempotent on
    (CreatedDate, Symbol, CallPut, Strike, ExpirationDate, source)."""
    # Normalize date for the source tag: 7/6/2026 -> reconcile_2026_07_06
    try:
        m, d, y = payload.date.split("/")
        source_tag = f"reconcile_{int(y):04d}_{int(m):02d}_{int(d):02d}"
    except Exception:
        raise HTTPException(status_code=400, detail=f"Bad date format: {payload.date!r}")

    if not payload.rows:
        return ReconcileResult(inserted=0, skipped_duplicate=0, total_submitted=0,
                                source_tag=source_tag, dry_run=payload.dry_run,
                                inserted_previews=[])

    inserted = 0
    skipped = 0
    previews: List[dict] = []

    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        cur = conn.cursor()
        # Sanity: does the flow table exist and does it have a source column?
        cur.execute("PRAGMA table_info(flow)")
        cols = {r[1] for r in cur.fetchall()}
        if not cols:
            raise HTTPException(status_code=500, detail="flow table not found")
        if "source" not in cols:
            raise HTTPException(status_code=500, detail="flow table missing 'source' column")

        for row in payload.rows:
            # Idempotency check
            cur.execute(
                """
                SELECT 1 FROM flow
                 WHERE CreatedDate = ? AND Symbol = ? AND CallPut = ?
                   AND Strike = ? AND ExpirationDate = ? AND source = ?
                 LIMIT 1
                """,
                (row.CreatedDate, row.Symbol, row.CallPut, row.Strike,
                 row.ExpirationDate, source_tag),
            )
            if cur.fetchone() is not None:
                skipped += 1
                continue

            if payload.dry_run:
                previews.append({
                    "would_insert": {
                        "Symbol": row.Symbol, "CallPut": row.CallPut,
                        "Strike": row.Strike, "Exp": row.ExpirationDate,
                        "Vol": row.Volume, "Prem": row.Premium,
                        "Side": row.Side, "Type": row.Type, "Color": row.Color,
                        "source": source_tag,
                    }
                })
                continue

            # Build INSERT dynamically from ReconcileRow fields + source
            data = row.dict()
            data["source"] = source_tag
            # Only insert columns the table actually has
            insertable = {k: v for k, v in data.items() if k in cols}
            col_names = list(insertable.keys())
            placeholders = ",".join("?" for _ in col_names)
            cur.execute(
                f"INSERT INTO flow ({','.join(col_names)}) VALUES ({placeholders})",
                [insertable[k] for k in col_names],
            )
            inserted += 1
            previews.append({
                "inserted": {
                    "Symbol": row.Symbol, "CallPut": row.CallPut,
                    "Strike": row.Strike, "Exp": row.ExpirationDate,
                    "Vol": row.Volume, "Prem": row.Premium,
                    "Side": row.Side, "Type": row.Type, "Color": row.Color,
                    "source": source_tag,
                }
            })

        if not payload.dry_run:
            conn.commit()
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[flow-reconcile] insert failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

    logger.info(
        f"[flow-reconcile] {source_tag}: submitted={len(payload.rows)} "
        f"inserted={inserted} skipped_duplicate={skipped} dry_run={payload.dry_run}"
    )

    return ReconcileResult(
        inserted=inserted, skipped_duplicate=skipped,
        total_submitted=len(payload.rows), source_tag=source_tag,
        dry_run=payload.dry_run, inserted_previews=previews,
    )


@router.get("/preview")
def reconcile_preview(source_tag: Optional[str] = None) -> dict:
    """Show what reconcile rows currently exist in flow.db.
    Optionally filter to one source_tag (e.g. reconcile_2026_07_06)."""
    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        conn.row_factory = sqlite3.Row
        if source_tag:
            cur = conn.execute(
                "SELECT * FROM flow WHERE source = ? ORDER BY CreatedTime",
                (source_tag,),
            )
        else:
            cur = conn.execute(
                "SELECT * FROM flow WHERE source LIKE 'reconcile_%' "
                "ORDER BY source, CreatedTime"
            )
        rows = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()
    return {"count": len(rows), "rows": rows}
