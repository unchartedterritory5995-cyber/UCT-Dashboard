"""2026-10-02 final adjudication goldens: double split, missing split, ADS ratio, historical >= 10x disagreement with
production (production wrong, V1 proven), and intentional holds. Bands are the issuer's own disclosed counts times the
contemporaneous price -- never production or Massive."""
from __future__ import annotations


def adjudication_goldens(g) -> None:
    def band(case, t, d, lo, hi, why):
        c = g.cik(t)
        v = g.cap(c, d) if c else None
        g.check(case, f"{t} {d}: {why} -> within ${lo / 1e9:g}-{hi / 1e9:g}B", v is not None and lo <= v <= hi, v)

    def held(case, t, d, reasons, why):
        c = g.cik(t)
        v = g.cap(c, d) if c else None
        r = g.db.execute("SELECT reason FROM gap_run WHERE cik=? AND start<=? AND end>=?",
                         (c, int(d.replace("-", "")), int(d.replace("-", "")))).fetchone() if c else None
        g.check(case, f"{t} {d}: {why} -> withheld with {'/'.join(sorted(reasons))}", v is None and r is not None and r[0] in reasons,
                {"value": v, "reason": r and r[0]})

    def continuous(case, t, d0, d1, why, tol=0.25):
        c = g.cik(t)
        a, b = (g.cap(c, d0), g.cap(c, d1)) if c else (None, None)
        g.check(case, f"{t} {d0}->{d1}: {why} -> continuous within {tol:.0%}", a and b and abs(b / a - 1) <= tol, (a, b))

    # DOUBLE SPLIT ADJUSTMENT (evidence split duplicating the ledger; anticipatory post-split counts)
    band("DOUBLE_SPLIT", "OTEX", "2010-06-01", 1.8e9, 3.0e9, "2014 2-for-1 applied ONCE (evidence date replaces the ledger's)")
    continuous("DOUBLE_SPLIT", "FFIN", "2011-05-27", "2011-06-01", "2011 3-for-2: the anticipatory 04-29 cover is not transformed again")
    continuous("DOUBLE_SPLIT", "HBNC", "2012-11-08", "2012-11-12", "3-for-2: anticipatory post-split cover")
    # MISSING SPLIT ADJUSTMENT (ledger split wrongly dropped as 'contradicted' by an anticipatory count; price-only factor)
    band("MISSING_SPLIT", "INTC", "1998-06-01", 100e9, 145e9, "1999 2-for-1 kept: 1,667M shares x ~$72")
    band("MISSING_SPLIT", "TER", "1998-06-01", 1.8e9, 3.2e9, "1999 2-for-1 kept")
    band("MISSING_SPLIT", "EBAY", "2014-06-03", 50e9, 75e9, "2015 PayPal distribution factor x2.376 carried by the bars")
    band("MISSING_SPLIT", "SYK", "2003-06-02", 9e9, 20e9, "2004 2-for-1 kept (the 2004-03 cover was already post-split)")
    # ADS RATIO (production prices ORDINARY shares at the ADS price; V1 converts by the issuer's stated ratio)
    band("ADR_RATIO", "EC", "2020-06-01", 15e9, 40e9, "Ecopetrol ADS = 20 ordinary shares")
    band("ADR_RATIO", "BSAC", "2020-06-01", 5e9, 14e9, "Banco Santander-Chile ADS = 400 shares")
    band("ADR_RATIO", "RCEL", "2022-06-01", 100e6, 900e6, "US common after the 2020 redomicile: no ADS division")
    # HISTORICAL >= 10x DISAGREEMENT (production placeholder / stale counts; V1 proven by issuer counts)
    band("HIST_10X", "CTVA", "2019-09-03", 18e9, 26e9, "748.9M shares (10-Q cover) -- production used 100 shares")
    band("HIST_10X", "FOXA", "2019-06-03", 18e9, 28e9, "class A at FOXA + class B at FOX -- production 1 share")
    band("HIST_10X", "BRK-B", "2011-09-01", 140e9, 200e9, "A at BRK-A + B at BRK-B -- production class A count at the B price")
    band("HIST_10X", "GENI", "2022-06-08", 0.5e9, 1.0e9, "205.6M ordinary shares (F-3) -- production 18.5M")
    band("HIST_10X", "SBET", "2025-08-11", 2.0e9, 4.5e9, "129.0M shares after the 2025 issuance (424B5) -- production stale 0.66M")
    # INTENTIONAL HOLDS
    held("HOLD", "SGRX", "2019-12-20", {"HISTORICAL_SPLIT_EVIDENCE_UNRESOLVED"},
         "issuer-stated 2026 reverse splits no ledger carries (renamed ticker): every earlier day")
    held("HOLD", "PBM", "2025-07-01", {"LEDGER_SPLIT_UNRESOLVED"}, "counts neither confirm nor contradict the 2026 1-for-6.25")
    held("HOLD", "IFBD", "2022-06-01", {"LEDGER_SPLIT_UNRESOLVED"}, "counts 143 days before the 2023 1-for-20")
    held("HOLD", "WY", "2002-06-03", {"PRICE_BASIS_INCONSISTENT_WITH_CORPORATE_ACTION"},
         "bars spliced on another basis before 2003-09-10 (price-only factor not carried past it)")
    held("HOLD", "LEA", "2010-03-01", {"TRADING_BREAK_RECOUNT_PENDING", "SHARE_STATE_STALE", "IPO_CAPITALIZATION_UNRESOLVED"},
         "the pre-petition count is never carried onto the common relisted 2009-11-20 after Chapter 11")
    # TICKER HISTORY (the issuer traded under another symbol; the symbol's earlier bars are another issuer's)
    held("TICKER_HISTORY", "COR", "2015-06-01", {"TICKER_REUSE_DIFFERENT_ISSUER"}, "Cencora was ABC until 2023-08-30")
    held("TICKER_HISTORY", "WM", "2005-06-01", {"TICKER_REUSE_DIFFERENT_ISSUER"}, "Waste Management was WMI until 2009-08-06")
    held("TICKER_HISTORY", "DDD", "2010-06-01", {"TICKER_REUSE_DIFFERENT_ISSUER"}, "3D Systems was TDSC until 2011-05-27")
    # CAP-STEP PASS (the 52 V1-specific day-to-day steps and the second-order scan)
    held("CAP_STEP", "HR", "2007-01-03", {"SUSPICIOUS_SHARE_COUNT", "TICKER_REUSE_DIFFERENT_ISSUER", "SHARE_COUNT_SCALE_UNRESOLVED"},
         "15,200 shares of a non-traded REIT priced at another security's HR bars")
    held("CAP_STEP", "HR", "2015-06-01", {"TICKER_REUSE_DIFFERENT_ISSUER"}, "the registrant reported HTA until 2022")
    band("CAP_STEP", "HR", "2024-06-03", 4e9, 12e9, "Healthcare Realty after the 2022 combination")
    held("CAP_STEP", "LIN", "2018-06-01", {"SUCCESSOR_ISSUER_RELATIONSHIP_UNRESOLVED", "PRE_FIRST_AUTHORITATIVE_SHARE_EVIDENCE"},
         "Linde plc's pre-combination shell (25,000 shares) is not the listed security")
    band("CAP_STEP", "LIN", "2020-06-01", 80e9, 140e9, "Linde plc after the combination")
    held("CAP_STEP", "RJF", "1995-06-01", {"SHARE_COUNT_SCALE_UNRESOLVED", "PRE_EDGAR_NO_AUTHORITATIVE_SHARE_EVIDENCE"},
         "'1,249,014 shares' (a truncated parse) is uncorroborated")
    held("CAP_STEP", "ALT", "2007-06-01", {"LEDGER_SPLIT_UNRESOLVED", "SHARE_COUNT_SCALE_UNRESOLVED"},
         "a 1:50 ledger split inside a trading break")
    held("CAP_STEP", "GNLN", "2025-01-02", {"SHARE_COUNT_SCALE_UNRESOLVED", "REGISTERED_ISSUANCE_EXCEEDS_SHARE_STATE"},
         "an uncorroborated extreme state (223 split-adjusted shares)")
    held("CAP_STEP", "VTRS", "2020-06-01", {"SUSPICIOUS_SHARE_COUNT", "PRE_FIRST_AUTHORITATIVE_SHARE_EVIDENCE"},
         "'100 shares' is below the listed-security minimum")
    band("CAP_STEP", "VTRS", "2022-06-01", 8e9, 22e9, "Viatris after the combination")
    band("CAP_STEP", "HON", "2025-06-02", 110e9, 180e9, "the issuer-stated 2026-06-29 1-for-2 the bars carry")
    band("CAP_STEP", "HCM", "2020-06-01", 1.0e9, 6e9, "each count converted by its own filing's ADS ratio (was 10x)")
    band("CAP_STEP", "SIRI", "2003-06-02", 0.8e9, 6e9, "the 2003 debt-for-equity recapitalization is a real capital change")
    held("CAP_STEP", "AMGN", "1999-06-01", {"HISTORICAL_SPLIT_EVIDENCE_UNRESOLVED"}, "the 1999 2-for-1 splits the ledger lacks")

