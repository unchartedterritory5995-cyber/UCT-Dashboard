"""Earnings preview/analysis enrichment helpers.

Provides high-value pre-earnings data members care about:
- Pre-earnings price-action context (5d / 30d returns)
- Historical earnings-day moves (avg ± move over last N reports)
- Estimate / analyst revision trends (Finnhub recommendation-trends proxy)
- Beat-magnitude history (surprise % per quarter for visualization)
- Implied move from front-week ATM options straddle (yfinance)
- Key quotes extracted from the most recent earnings call transcript

All helpers are best-effort — return None on any failure, never raise.
The earnings router fans these out in parallel via ThreadPoolExecutor and
folds the results into the existing _generate_earnings_preview /
_generate_earnings_analysis responses.
"""
from __future__ import annotations

import datetime as _dt
import logging
import os
from typing import Optional

import requests as _req

_logger = logging.getLogger(__name__)


# ─── 1. Pre-earnings price-action context ──────────────────────────────────────

def get_pre_earnings_context(sym: str) -> Optional[dict]:
    """Recent price action: 5-day and 30-day returns + a one-line label.

    Returns: {ret_5d_pct, ret_30d_pct, label} or None on failure.
    """
    try:
        import yfinance as _yf
        df = _yf.Ticker(sym.upper()).history(period="3mo", interval="1d", auto_adjust=False)
        if df is None or df.empty or len(df) < 6:
            return None
        closes = df["Close"]
        last = float(closes.iloc[-1])
        ret_5d = ((last / float(closes.iloc[-6])) - 1) * 100 if len(closes) >= 6 else None
        ret_30d = ((last / float(closes.iloc[-22])) - 1) * 100 if len(closes) >= 22 else None
        parts = []
        if ret_30d is not None:
            parts.append(f"{'+' if ret_30d >= 0 else ''}{ret_30d:.1f}% / 30d")
        if ret_5d is not None:
            parts.append(f"{'+' if ret_5d >= 0 else ''}{ret_5d:.1f}% / 5d")
        return {
            "ret_5d_pct":  round(ret_5d, 1) if ret_5d is not None else None,
            "ret_30d_pct": round(ret_30d, 1) if ret_30d is not None else None,
            "label":       " · ".join(parts) if parts else None,
        }
    except Exception as e:
        _logger.warning("get_pre_earnings_context failed for %s: %s", sym, e)
        return None


# ─── 2. Historical earnings-day moves ──────────────────────────────────────────

def get_historical_earnings_moves(sym: str, av_quarters: list) -> Optional[dict]:
    """Compute past earnings-day % moves from Alpha Vantage quarterly history
    + yfinance daily prices.

    Args:
        sym: ticker
        av_quarters: AV `quarterlyEarnings` list (each row has `reportedDate`,
                     `reportTime` "post-market"/"pre-market", etc.)

    Returns: {avg_abs_move_pct, moves_pct[], n_quarters} or None.
    """
    if not av_quarters:
        return None
    try:
        import yfinance as _yf
        dates = []
        report_times = []
        for q in av_quarters[:8]:
            d_str = q.get("reportedDate") or q.get("fiscalDateEnding")
            if not d_str:
                continue
            try:
                d = _dt.datetime.strptime(d_str, "%Y-%m-%d").date()
                dates.append(d)
                report_times.append(q.get("reportTime") or "")
            except (ValueError, TypeError):
                continue
        if not dates:
            return None

        df = _yf.Ticker(sym.upper()).history(period="2y", interval="1d", auto_adjust=False)
        if df is None or df.empty:
            return None

        # df.index is DatetimeIndex; convert to date for matching
        idx_dates = [d.date() for d in df.index.to_pydatetime()]
        opens  = df["Open"].astype(float).tolist()
        closes = df["Close"].astype(float).tolist()

        moves = []
        for ed, rtime in zip(dates, report_times):
            # Find idx of the report date or nearest trading day
            report_idx = None
            for i in range(len(idx_dates) - 1, -1, -1):
                if idx_dates[i] <= ed:
                    report_idx = i
                    break
            if report_idx is None or report_idx == 0 or report_idx >= len(closes) - 1:
                continue
            prev_close  = closes[report_idx - 1]
            report_open = opens[report_idx]
            next_open   = opens[report_idx + 1] if report_idx + 1 < len(opens) else None
            if prev_close <= 0:
                continue
            # Pre-market report: gap from prev close to report-day open
            # Post-market report: gap from report-day close to next-day open
            if "pre" in (rtime or "").lower():
                move = (report_open - prev_close) / prev_close * 100
            elif "post" in (rtime or "").lower():
                if next_open is None:
                    continue
                report_close = closes[report_idx]
                move = (next_open - report_close) / report_close * 100
            else:
                # Unknown: take bigger of bmo/amc
                bmo = (report_open - prev_close) / prev_close * 100
                amc_move = (
                    (next_open - closes[report_idx]) / closes[report_idx] * 100
                    if next_open is not None and closes[report_idx] > 0
                    else None
                )
                move = bmo if amc_move is None or abs(bmo) >= abs(amc_move) else amc_move
            moves.append(move)

        if not moves:
            return None
        avg_abs = sum(abs(m) for m in moves) / len(moves)
        return {
            "avg_abs_move_pct": round(avg_abs, 1),
            "moves_pct":        [round(m, 1) for m in moves],
            "n_quarters":       len(moves),
        }
    except Exception as e:
        _logger.warning("get_historical_earnings_moves failed for %s: %s", sym, e)
        return None


# ─── 3. Estimate / analyst revision trend ──────────────────────────────────────

def get_estimate_revisions(sym: str) -> Optional[dict]:
    """Analyst recommendation trend over last ~3 months (proxy for EPS revisions).

    Uses Finnhub /stock/recommendation. Returns net change in (strongBuy+buy)
    minus (sell+strongSell) over 30d and 90d.
    """
    fh_key = os.environ.get("FINNHUB_API_KEY", "")
    if not fh_key:
        return None
    try:
        url = f"https://finnhub.io/api/v1/stock/recommendation?symbol={sym.upper()}&token={fh_key}"
        resp = _req.get(url, timeout=8).json()
        if not isinstance(resp, list) or not resp:
            return None
        resp.sort(key=lambda x: x.get("period", ""), reverse=True)
        latest = resp[0]
        prior_30 = resp[1] if len(resp) >= 2 else None
        prior_90 = resp[3] if len(resp) >= 4 else None

        def _net_buy(r):
            if not r:
                return 0
            return (
                int(r.get("strongBuy", 0) or 0)
                + int(r.get("buy", 0) or 0)
                - int(r.get("sell", 0) or 0)
                - int(r.get("strongSell", 0) or 0)
            )

        latest_net  = _net_buy(latest)
        prior30_net = _net_buy(prior_30) if prior_30 else latest_net
        prior90_net = _net_buy(prior_90) if prior_90 else prior30_net

        delta_30d = latest_net - prior30_net
        delta_90d = latest_net - prior90_net

        if delta_90d > 0:
            arrow = "↑"
            label = f"Analyst sentiment improving — {delta_90d:+d} net buy ratings vs 90d ago"
        elif delta_90d < 0:
            arrow = "↓"
            label = f"Analyst sentiment weakening — {delta_90d:+d} net buy ratings vs 90d ago"
        else:
            arrow = "→"
            label = "Analyst sentiment flat over 90 days"

        return {
            "buy_count":   int(latest.get("strongBuy", 0) or 0) + int(latest.get("buy", 0) or 0),
            "hold_count":  int(latest.get("hold", 0) or 0),
            "sell_count":  int(latest.get("sell", 0) or 0) + int(latest.get("strongSell", 0) or 0),
            "delta_30d":   delta_30d,
            "delta_90d":   delta_90d,
            "arrow":       arrow,
            "label":       label,
        }
    except Exception as e:
        _logger.warning("get_estimate_revisions failed for %s: %s", sym, e)
        return None


# ─── 4. Beat-magnitude history (visualization data) ───────────────────────────

def extract_beat_surprises(av_quarters: list) -> Optional[list]:
    """Extract last 8 EPS surprise %s from AV quarterly history.

    Returns list of {date, surprise_pct, beat} most-recent first, or None.
    """
    if not av_quarters:
        return None
    out = []
    try:
        for q in av_quarters[:8]:
            r = q.get("reportedEPS")
            e = q.get("estimatedEPS")
            try:
                rf = float(r); ef = float(e)
                if ef == 0:
                    continue
                pct = (rf - ef) / abs(ef) * 100
                out.append({
                    "date":         q.get("reportedDate") or q.get("fiscalDateEnding"),
                    "surprise_pct": round(pct, 1),
                    "beat":         rf >= ef,
                })
            except (TypeError, ValueError):
                continue
        return out or None
    except Exception:
        return None


# ─── 5. Implied move from ATM options straddle ────────────────────────────────

def get_implied_move(sym: str, earnings_date: Optional[str] = None) -> Optional[dict]:
    """Implied move from front-week ATM call+put straddle via yfinance.

    Args:
        sym: ticker
        earnings_date: ISO date of earnings; pick first option expiry on/after.
                       If None, use front expiry.

    Returns: {pct, dollar, expiry, strike, spot, call_mark, put_mark} or None.
    """
    try:
        import yfinance as _yf
        t = _yf.Ticker(sym.upper())

        spot_hist = t.history(period="5d", interval="1d", auto_adjust=False)
        if spot_hist is None or spot_hist.empty:
            return None
        spot = float(spot_hist["Close"].iloc[-1])
        if spot <= 0:
            return None

        expiries = list(t.options or [])
        if not expiries:
            return None

        # Pick first expiry on/after earnings (or first available)
        target_date = None
        if earnings_date:
            try:
                target_date = _dt.datetime.strptime(earnings_date, "%Y-%m-%d").date()
            except (ValueError, TypeError):
                target_date = None

        chosen = None
        for exp in expiries:
            try:
                exp_d = _dt.datetime.strptime(exp, "%Y-%m-%d").date()
            except ValueError:
                continue
            if target_date is None or exp_d >= target_date:
                chosen = exp
                break
        if chosen is None:
            chosen = expiries[0]

        chain = t.option_chain(chosen)
        calls = chain.calls
        puts  = chain.puts
        if calls is None or calls.empty or puts is None or puts.empty:
            return None

        # ATM strike = closest to spot
        atm_strike = float(calls["strike"].iloc[(calls["strike"] - spot).abs().argsort().iloc[0]])

        c_row = calls[calls["strike"] == atm_strike].head(1)
        p_row = puts[puts["strike"] == atm_strike].head(1)
        if c_row.empty or p_row.empty:
            return None

        def _mark(row):
            bid = float(row["bid"].iloc[0] or 0)
            ask = float(row["ask"].iloc[0] or 0)
            last = float(row["lastPrice"].iloc[0] or 0)
            if bid > 0 and ask > 0:
                return (bid + ask) / 2
            return last  # fallback to last trade

        call_mark = _mark(c_row)
        put_mark  = _mark(p_row)
        if call_mark <= 0 or put_mark <= 0:
            return None
        straddle = call_mark + put_mark
        pct = (straddle / spot) * 100
        return {
            "pct":       round(pct, 1),
            "dollar":    round(straddle, 2),
            "expiry":    chosen,
            "strike":    atm_strike,
            "spot":      round(spot, 2),
            "call_mark": round(call_mark, 2),
            "put_mark":  round(put_mark, 2),
        }
    except Exception as e:
        _logger.warning("get_implied_move failed for %s: %s", sym, e)
        return None


# ─── 6. Key quotes from previous earnings call transcript ─────────────────────

def get_key_quotes(sym: str) -> Optional[list]:
    """Extract the 3 most material quotes from the prior earnings call transcript.

    Pulls transcript via Finnhub and runs a one-shot AI extraction.
    Returns list of {topic, quote} or None on failure.
    """
    try:
        from api.services.transcripts import _fetch_latest_transcript
        tr = _fetch_latest_transcript(sym.upper())
    except Exception as e:
        _logger.warning("transcript fetch failed for %s: %s", sym, e)
        return None
    if not tr or not isinstance(tr, dict):
        return None
    text = tr.get("text") or ""
    if not text or len(text) < 500:
        return None

    try:
        from api.services.engine import _get_anthropic_client, _EARNINGS_AI_MODEL
    except Exception:
        return None

    # Truncate to ~30K chars to keep token usage modest
    excerpt = text[:30_000]
    try:
        client = _get_anthropic_client()
        prompt = (
            f"From this earnings call transcript for {sym}, extract the 3 most material "
            f"quotes that a trader would care about. Focus on: forward guidance, segment "
            f"growth, demand commentary, margin trends, or specific risks/catalysts called "
            f"out by management. Each quote must be verbatim from the transcript.\n\n"
            f"Return JSON only — no markdown:\n"
            '{"quotes": [{"topic": "<2-3 word label>", "quote": "<verbatim quote, max 30 words>"}, ...]}\n\n'
            f"Transcript:\n{excerpt}"
        )
        msg = client.messages.create(
            model=_EARNINGS_AI_MODEL,
            max_tokens=600,
            metadata={"user_id": "earnings_enrichment:global"},
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()
        import json as _json
        parsed = _json.loads(raw)
        quotes = parsed.get("quotes") or []
        out = []
        for q in quotes[:3]:
            if isinstance(q, dict) and q.get("quote"):
                out.append({
                    "topic": str(q.get("topic", ""))[:40],
                    "quote": str(q.get("quote", ""))[:300],
                })
        return out or None
    except Exception as e:
        _logger.warning("AI key-quotes extraction failed for %s: %s", sym, e)
        return None


# ─── Convenience: run all enrichers in parallel ───────────────────────────────

def enrich_earnings_response(sym: str, av_quarters: list, earnings_date: Optional[str] = None) -> dict:
    """Run all enrichment helpers in parallel; merge into a single dict.

    Returns dict with keys present (None or value) for each enrichment field.
    Never raises — each helper is wrapped.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed
    out = {}
    funcs = {
        "pre_earnings":     lambda: get_pre_earnings_context(sym),
        "hist_moves":       lambda: get_historical_earnings_moves(sym, av_quarters),
        "revisions":        lambda: get_estimate_revisions(sym),
        "beat_surprises":   lambda: extract_beat_surprises(av_quarters),
        "implied_move":     lambda: get_implied_move(sym, earnings_date),
        "key_quotes":       lambda: get_key_quotes(sym),
    }
    with ThreadPoolExecutor(max_workers=6, thread_name_prefix="earnings-enrich") as pool:
        futs = {pool.submit(fn): name for name, fn in funcs.items()}
        for fut in as_completed(futs, timeout=25):
            name = futs[fut]
            try:
                out[name] = fut.result()
            except Exception as e:
                _logger.warning("enrichment helper %s for %s failed: %s", name, sym, e)
                out[name] = None
    return out
