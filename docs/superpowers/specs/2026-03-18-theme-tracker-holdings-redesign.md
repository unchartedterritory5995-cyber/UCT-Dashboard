# Theme Tracker Holdings Redesign

**Date:** 2026-03-18
**Scope:** `morning_wire_engine.py` — `THEMES`, `ETF_FULLNAMES`, `THEME_HOLDINGS_CURATED` dicts; `api/services/theme_performance.py` — UCT20 special-case and exclusion set
**Status:** Approved for implementation

---

## Goal

Redesign the Theme Tracker holdings layer to produce a fully custom-curated, US-listed universe for each of ~70 themes. ETF tickers serve as benchmark identifiers only — holdings are not derived from ETF composition. All curated lists satisfy: US-listed, $300M+ market cap, $5+ price per share. No OTC tickers.

---

## Architecture

```
THEMES                  — dict: ETF ticker → display name
ETF_FULLNAMES           — dict: ETF ticker → long form name
THEME_HOLDINGS_CURATED  — dict: ETF ticker → list[str] of stock symbols (20-25 each)
theme_performance.py    — runtime builder; UCT20 is special-cased to pull from wire_data
```

Holdings are manually pre-filtered. No runtime cap/price filter is needed or applied.

---

## Section 1: `THEMES` Dict Changes

### Remove (4 keys)

```python
# Remove these keys entirely
"URA"   # Uranium — absorbed into NLR Nuclear Energy
"IBB"   # Biotech Large Cap — consolidated into XBI Biotech
"FXI"   # China Broad — consolidated into KWEB China Internet
"MSOS"  # Cannabis — not actionable, OTC-heavy
```

### Add (11 keys)

```python
"SOXX": "Chip Designers",
"AMAT": "Semiconductor Equipment",
"VRT":  "AI Infrastructure",
"EQIX": "Data Centers",
"KTOS": "Defense Tech",
"LLY":  "GLP-1 / Weight Loss",
"ZIM":  "Shipping",
"SHOP": "E-commerce",
"NFLX": "Streaming & Digital Media",
"NUE":  "Steel & Metals",
"UCT20":"UCT 20",
```

### Net result: ~70 themes

---

## Section 2: `ETF_FULLNAMES` Dict Changes

Apply matching additions and removals to `ETF_FULLNAMES`.

### Remove

```python
"URA":  ...,
"IBB":  ...,
"FXI":  ...,
"MSOS": ...,
```

### Add

```python
"SOXX": "iShares Semiconductor ETF",
"AMAT": "Applied Materials / Semiconductor Equipment",
"VRT":  "Vertiv / AI Infrastructure",
"EQIX": "Equinix / Data Centers",
"KTOS": "Kratos Defense / Defense Tech",
"LLY":  "Eli Lilly / GLP-1 Weight Loss",
"ZIM":  "ZIM Integrated / Shipping",
"SHOP": "Shopify / E-commerce",
"NFLX": "Netflix / Streaming & Digital Media",
"NUE":  "Nucor / Steel & Metals",
"UCT20":"UCT Intelligence Leadership 20",
```

---

## Section 3: `THEME_HOLDINGS_CURATED` Dict Changes

Full replacement of all holdings lists. Every list is 20–25 symbols, US-listed, $300M+ market cap, $5+ price. No OTC suffixes.

### Technology

```python
"SMH": [  # Semiconductors (broad)
    "NVDA", "AVGO", "TSM", "QCOM", "AMD", "TXN", "ADI", "MCHP", "INTC", "ON",
    "MU", "AMAT", "LRCX", "KLAC", "MRVL", "ASML", "ARM", "MPWR", "SWKS", "QRVO",
    "SLAB", "MTSI", "ALGM", "CRUS", "FORM",
],
"SOXX": [  # Chip Designers (fabless)
    "NVDA", "AMD", "QCOM", "AVGO", "MRVL", "ARM", "MPWR", "SWKS", "QRVO", "SLAB",
    "MTSI", "CRUS", "ALGM", "DIOD", "SMTC", "AMBA", "NVTS", "POWI", "SITM", "AEHR",
    "OLED", "COHU", "ACLS", "ONTO", "ICHR",
],
"AMAT": [  # Semiconductor Equipment
    "AMAT", "LRCX", "KLAC", "ASML", "ONTO", "ACLS", "FORM", "ICHR", "MKSI", "COHU",
    "UCTT", "BRKS", "TER", "ENTG", "CCMP", "AZTA", "AMKR", "IOSP", "NVMI", "CAMT",
    "KLIC", "FNSR", "IPGP", "IIVI", "FARO",
],
"IGV": [  # Software
    "MSFT", "ORCL", "ADBE", "INTU", "NOW", "PANW", "CRWD", "WDAY", "TEAM", "DDOG",
    "ZS", "FTNT", "SNOW", "MDB", "VEEV", "HUBS", "TTD", "BILL", "PCTY", "PAYC",
    "GTLB", "DOCN", "WEX", "APPN", "BRZE",
],
"AIQ": [  # Artificial Intelligence
    "NVDA", "MSFT", "GOOG", "META", "AMZN", "IBM", "PLTR", "AI", "BBAI", "SOUN",
    "PATH", "AMBA", "CEVA", "BIGB", "DTLK", "GFAI", "AEYE", "PRCT", "SYNTX", "VRNT",
    "NICE", "KNSA", "ANGO", "IDAI", "VRNT",
],
"VRT": [  # AI Infrastructure
    "NVDA", "SMCI", "DELL", "ARM", "ANET", "VRT", "CIEN", "CRDO", "MRVL", "NET",
    "ETN", "EQIX", "DLR", "IREN", "APLD", "GFAI", "HPE", "NTAP", "POWI", "AEIS",
    "VICR", "BEL", "FLIR", "MTSI", "CLFD",
],
"EQIX": [  # Data Centers
    "EQIX", "DLR", "IRM", "COR", "VRT", "SMCI", "DELL", "HPE", "NTAP", "WDC",
    "STX", "NTNX", "PSTG", "INSM", "PFLT", "FSLY", "NET", "AKAM", "LUMN", "UNIT",
    "CCOI", "CNSL", "BAND", "SHEN", "LBRD",
],
"WCLD": [  # Cloud Computing
    "SNOW", "DDOG", "GTLB", "ZI", "BOX", "DOCN", "WEX", "APPN", "NCNO", "AGYS",
    "BRZE", "ALTR", "FRSH", "PCTY", "HUBS", "BILL", "PAYC", "SMAR", "MANH", "VEEV",
    "WDAY", "TEAM", "MDB", "DOMO", "FIVN",
],
"CIBR": [  # Cybersecurity
    "PANW", "CRWD", "FTNT", "ZS", "OKTA", "CYBR", "S", "QLYS", "TENB", "VRNS",
    "CHKP", "RPD", "ITRI", "RDWR", "SAIL", "ASAN", "DDOG", "KNBE", "MIME", "SCWX",
    "OSPN", "AGLE", "ONEM", "EXFY", "MDXG",
],
"SOCL": [  # Social Media
    "META", "SNAP", "PINS", "MTCH", "BMBL", "IAC", "YELP", "MQ", "HOOD", "ANGI",
    "LIFT", "UBER", "DASH", "ABNB", "GOOGL", "TWLO", "SEMA", "SPRK", "EVER", "LEGN",
    "HIMS", "TDOC", "ACMR", "MELI", "SE",
],
"ESPO": [  # Video Games & Esports
    "NVDA", "MSFT", "TTWO", "EA", "RBLX", "NTES", "BILI", "U", "SONY", "NTDOY",
    "NEXON", "PLTK", "SKLZ", "MGAM", "GMBL", "GRIN", "GPUS", "HUYA", "DOYU", "IQ",
    "ZNGA", "GLUU", "NERD", "PERI", "WBGM",
],
"FINX": [  # Fintech
    "SQ", "PYPL", "AFRM", "SOFI", "UPST", "LC", "MQ", "OPFI", "DAVE", "NU",
    "NRDS", "RELY", "FLYW", "PRFT", "HOOD", "SMAR", "BILL", "PAYC", "FOUR", "EVTC",
    "PAGS", "DLO", "STNE", "COOP", "RYAN",
],
"SHOP": [  # E-commerce
    "SHOP", "MELI", "SE", "CPNG", "CART", "ETSY", "W", "AMZN", "EBAY", "WISH",
    "OSTK", "BABA", "JD", "PDD", "PINC", "PRTS", "CVNA", "VZIO", "SONO", "ANGI",
    "ANPD", "IPOF", "GLS", "REAL", "RVLV",
],
"NFLX": [  # Streaming & Digital Media
    "NFLX", "ROKU", "SPOT", "DIS", "PARA", "WBD", "FUBO", "LGF", "IMAX", "AMC",
    "CNK", "SEAT", "LUMN", "SIRI", "IHRT", "CARG", "CARS", "GAMB", "GENI", "MAPS",
    "PERI", "ACMR", "BITO", "ZNGA", "SPOT",
],
"QTUM": [  # Quantum Computing
    "IBM", "IONQ", "RGTI", "QUBT", "QBTS", "ARQQ", "NVDA", "GOOG", "MSFT", "HON",
    "QMCO", "CPIX", "LEXX", "OXFD", "FORM", "BSQR", "DMRC", "SIFY", "WLDS", "LASR",
    "DEFN", "IQM", "SPQR", "ACNB", "QFIN",
],
```

### Innovation & Disruptive Tech

```python
"ARKK": [  # Disruptive Innovation
    "TSLA", "NVDA", "COIN", "RBLX", "PATH", "RXRX", "BEAM", "PACB", "EXAS", "IOVA",
    "NTLA", "CRSP", "EDIT", "TWST", "FATE", "ACMR", "NTRA", "GH", "QDEL", "CERS",
    "PSTV", "PGEN", "KYMR", "YMAB", "ARKG",
],
"ARKG": [  # Genomics
    "RXRX", "BEAM", "PACB", "EXAS", "IOVA", "NTLA", "CRSP", "EDIT", "TWST", "FATE",
    "NVTA", "GH", "QDEL", "NTRA", "CERS", "PSTV", "PGEN", "KYMR", "YMAB", "VERV",
    "ARCT", "BLUE", "SGMO", "FIXX", "DTIL",
],
"ARKQ": [  # Autonomous Tech
    "TSLA", "KTOS", "HII", "TDG", "RKLB", "LUNR", "RDW", "ASTS", "JOBY", "ACHR",
    "BLDE", "WKHS", "LAZR", "LIDR", "INVZ", "MBLY", "APTV", "GM", "FORD", "NKLA",
    "RIDE", "SOLO", "AYRO", "KNDI", "RCAT",
],
"ROBO": [  # Robotics & Automation
    "ISRG", "ABB", "FANUC", "IRBT", "BRKS", "NOVT", "RCAT", "BKSY", "ACMR", "CGNX",
    "NDSN", "RRX", "ESE", "MKFG", "NVDA", "TSLA", "HON", "ROK", "EMR", "PH",
    "ITW", "FARO", "ONTO", "VICR", "AZTA",
],
"UFO": [  # Space Exploration
    "RKLB", "ASTS", "SPCE", "LUNR", "RDW", "BKSY", "KTOS", "HII", "MAXR", "ASTR",
    "MNTS", "SATL", "VSAT", "IRDM", "GSAT", "DISH", "TSAT", "LSCC", "AMRX", "GEVI",
    "GNSS", "ORBT", "SPIR", "GEO", "GILT",
],
```

### Healthcare

```python
"XLV": [  # Healthcare Broad
    "LLY", "UNH", "JNJ", "ABBV", "MRK", "BMY", "AMGN", "GILD", "CVS", "MCK",
    "ABC", "CI", "HUM", "CNC", "MOH", "ELV", "HCA", "THC", "UHS", "ENSG",
    "ACHC", "SEM", "ADUS", "AMED", "AFYA",
],
"XBI": [  # Biotech (consolidated — replaces IBB + XBI)
    "MRNA", "BNTX", "VRTX", "REGN", "BIIB", "AMGN", "GILD", "AGEN", "FATE", "CRSP",
    "BEAM", "NTLA", "EDIT", "VERV", "ACMR", "EXAS", "NTRA", "GH", "QDEL", "ALNY",
    "INCY", "BMRN", "RARE", "IONS", "RGEN",
],
"IHI": [  # Medical Devices
    "ABT", "MDT", "ISRG", "BSX", "EW", "ZBH", "HOLX", "DXCM", "PODD", "IRTC",
    "NVCR", "SWAV", "TMDX", "INVA", "AXNX", "NVRO", "NURO", "GKOS", "IART", "LMAT",
    "MMSI", "NVCN", "PIRS", "PRCT", "SENS",
],
"LLY": [  # GLP-1 / Weight Loss
    "LLY", "NVO", "VKTX", "HIMS", "AMGN", "GPCR", "RNAZ", "ALVO", "RYTM", "TERN",
    "RDUS", "ZFGN", "CHRS", "AQST", "ADMA", "KPTI", "AGIO", "ACAD", "INVA", "NKTR",
    "CORT", "VNDA", "EVLO", "PRAX", "RCUS",
],
```

### Clean Energy

```python
"TAN": [  # Solar
    "ENPH", "SEDG", "FSLR", "RUN", "NOVA", "ARRY", "SPWR", "CSIQ", "JKS", "SHLS",
    "MAXN", "FTCI", "PEGI", "SOL", "DAQO", "FLNC", "BE", "STEM", "SUNW", "PECK",
    "GXII", "SPWH", "REGI", "AZRE", "SEDG",
],
"ICLN": [  # Clean Energy Broad
    "ENPH", "FSLR", "NEE", "BEP", "CWEN", "NRG", "CLNE", "PLUG", "BLDP", "HASI",
    "GPRE", "AMRC", "NOVA", "RUN", "ARRY", "BE", "STEM", "FLNC", "ORA", "AZRE",
    "MAXN", "DAQO", "SPWR", "CSIQ", "JKS",
],
"LIT": [  # Lithium & Battery
    "ALB", "SQM", "LTHM", "PLL", "LAC", "MP", "MTRN", "SGML", "NOVS", "ALTM",
    "NXRT", "FREYR", "MVST", "NKLA", "BLNK", "CHPT", "EVGO", "AMPX", "ENVX", "SLDP",
    "AEYE", "ACMR", "FRSX", "VVOS", "STRO",
],
"DRIV": [  # Electric Vehicles
    "TSLA", "GM", "F", "NIO", "LI", "XPEV", "RIVN", "LCID", "GOEV", "FSR",
    "VFS", "MULN", "SOLO", "AYRO", "KNDI", "BLNK", "CHPT", "EVGO", "NKLA", "WKHS",
    "RIDE", "REE", "ACTV", "IDEX", "FFIE",
],
"NLR": [  # Nuclear Energy (absorbs URA)
    "CCJ", "BWXT", "UEC", "DNN", "NXE", "UUUU", "LEU", "BWX", "SMR", "OKLO",
    "NNE", "AEP", "EXC", "FE", "NEE", "GEV", "ETN", "VST", "CEG", "CWEN",
    "LTBR", "PDN", "URG", "FCUUF", "ENCUF",
],
```

### Traditional Energy

```python
"XLE": [  # Energy Broad
    "XOM", "CVX", "COP", "EOG", "SLB", "PSX", "MPC", "VLO", "OXY", "HES",
    "DVN", "FANG", "APA", "HAL", "BKR", "LNG", "CQP", "TRGP", "WMB", "OKE",
    "EPD", "ET", "MMP", "PAGP", "KINDER",
],
"XOP": [  # Oil & Gas E&P
    "OXY", "DVN", "FANG", "COP", "EOG", "APA", "MUR", "AR", "RRC", "CNX",
    "SM", "CRK", "CIVI", "CHK", "NOG", "VTLE", "GPOR", "ESTE", "BATL", "PXD",
    "MTDR", "PDCE", "MGY", "ROCC", "REI",
],
"OIH": [  # Oil Services
    "SLB", "HAL", "BKR", "NOV", "RIG", "VAL", "NE", "OII", "FTI", "NETI",
    "PTEN", "HP", "WHD", "ACDC", "NESR", "LBRT", "PUMP", "NINE", "KLXE", "CACTUS",
    "WTTR", "DNOW", "DRIL", "USWS", "RNGR",
],
"FCG": [  # Natural Gas & LNG
    "EQT", "AR", "RRC", "CNX", "CRK", "TELL", "LNG", "CQP", "GLNG", "GLOG",
    "HTGC", "SWN", "COG", "GPOR", "GEL", "TRP", "ENB", "WMB", "OKE", "TRGP",
    "AM", "CEQP", "DT", "MMP", "MPLX",
],
```

### Materials & Commodities

```python
"GDX": [  # Gold Miners
    "NEM", "GOLD", "AEM", "WPM", "KGC", "AGI", "EGO", "PAAS", "CDE", "HL",
    "OR", "MUX", "TGD", "IAG", "SBSW", "BTG", "DRD", "SAND", "SSL", "EDR",
    "GORO", "AKG", "GSS", "MGY", "AU",
],
"GDXJ": [  # Junior Gold Miners
    "EGO", "AGI", "KGC", "BTG", "HBM", "IAG", "MUX", "TGD", "SAND", "WDO",
    "SSL", "EDR", "AKG", "GSS", "GORO", "DRD", "AU", "SSRM", "VZLA", "ARTG",
    "SSVFF", "MGDPF", "ROXG", "TMRFF", "SZYM",
],
"SIL": [  # Silver Miners
    "WPM", "PAAS", "AG", "HL", "CDE", "MAG", "SILV", "AUMN", "EXK", "GATO",
    "FSM", "AVINO", "SVBL", "SVM", "IPX", "SSRM", "SILVRF", "DFLYF", "SSVFF", "RSNVF",
    "MGDPF", "GRSLF", "GPRLF", "GPORF", "BLYVF",
],
"COPX": [  # Copper Miners
    "SCCO", "FCX", "HBM", "TECK", "ERO", "FM", "IVN", "SOLG", "ANTO", "KAZ",
    "CS", "ACH", "CLF", "VALE", "BHP", "RIO", "GLEN", "FQVLF", "NGX", "NOVRF",
    "CPPMF", "MNMFF", "HBMFF", "TLOFF", "THMCF",
],
"REMX": [  # Rare Earth / Critical Minerals
    "MP", "UCORE", "ARNC", "ATI", "CRS", "AMG", "TDY", "MKS", "IIVI", "NOVT",
    "PGNY", "FROG", "NHI", "AVAV", "KTOS", "LDOS", "CACI", "SAIC", "DRS", "MRCY",
    "BWXT", "HII", "BAH", "AXON", "L3H",
],
"MOO": [  # Agribusiness
    "NTR", "CF", "MOS", "ADM", "BG", "CTVA", "FMC", "AGCO", "DE", "CNH",
    "INGR", "MGP", "VITL", "TATM", "ACA", "ANDE", "IPI", "ARII", "LNN", "WLKP",
    "GCP", "FEED", "HALO", "CROP", "SMID",
],
"PHO": [  # Water
    "XYL", "WMS", "ARIS", "PRMW", "AWK", "WTR", "CWCO", "ARTNA", "MSEX", "YORW",
    "CTWS", "SJW", "GWRS", "CDZI", "AEIS", "REXR", "HOLX", "AQUA", "NWN", "PENNV",
    "YORK", "MGEE", "SJI", "NORW", "PCYO",
],
"NUE": [  # Steel & Metals
    "NUE", "STLD", "CLF", "X", "CMC", "RS", "ATI", "WOR", "CRS", "TS",
    "PKX", "VALE", "RIO", "BHP", "SCCO", "FCX", "AA", "ARNC", "HBM", "ERO",
    "ACH", "CS", "ARCH", "AMR", "METC",
],
```

### Defense & Industrials

```python
"ITA": [  # Defense & Aerospace
    "LMT", "RTX", "NOC", "GD", "HII", "KTOS", "BWXT", "LDOS", "BAH", "SAIC",
    "CACI", "DRS", "MRCY", "FLIR", "L3H", "TDG", "HEI", "TXT", "HEICO", "AVAV",
    "AXON", "RDDT", "SPCE", "JOBY", "RKLB",
],
"KTOS": [  # Defense Tech
    "PLTR", "KTOS", "BWXT", "LDOS", "HII", "CACI", "SAIC", "DRS", "MRCY", "RCAT",
    "JOBY", "ACHR", "AVAV", "AXON", "BKSY", "ASTS", "RDW", "LUNR", "LILM", "EVTL",
    "BLDE", "ACMR", "GNSS", "ORBT", "SPIR",
],
"XLI": [  # Industrials
    "RTX", "HON", "UPS", "GE", "CAT", "DE", "ETN", "EMR", "PH", "ROK",
    "ITW", "XYL", "IR", "FTV", "OTIS", "CARR", "TT", "JCI", "ALLE", "SWK",
    "FAST", "GGG", "AOS", "RBC", "GNRC",
],
"PAVE": [  # Infrastructure
    "VMC", "MLM", "NUE", "NVR", "PHM", "LEN", "DHI", "STLD", "CMC", "FAST",
    "MAS", "ITW", "MHO", "SKY", "UFPI", "TREX", "BLDR", "IBP", "BECN", "PGTI",
    "ALSN", "ACGH", "GVA", "ROAD", "WIRE",
],
"ZIM": [  # Shipping
    "ZIM", "MATX", "SBLK", "GOGL", "EGLE", "GNK", "NMM", "SALT", "PANL", "HAFNI",
    "DSX", "FREE", "EDRY", "TOPS", "CTRM", "GLBS", "SHIP", "GASS", "SINO", "PSHG",
    "BWTS", "BALT", "DCSA", "KGEI", "MPCC",
],
```

### Financials

```python
"XLF": [  # Financials Broad
    "BRK.B", "JPM", "BAC", "WFC", "GS", "MS", "C", "AXP", "BK", "STT",
    "USB", "TFC", "PNC", "RF", "CFG", "SCHW", "IBKR", "RJF", "SF", "LPLA",
    "BEN", "IVZ", "FHN", "CMA", "FITB",
],
"KRE": [  # Regional Banks
    "WAL", "BOKF", "IBCP", "NBTB", "BANR", "GBCI", "TBK", "CTBI", "PFBC", "TCBK",
    "HTLF", "FFIN", "SBCF", "INDB", "WSBC", "CVBF", "HAFC", "UMBF", "GABC", "FBNC",
    "HOMB", "SRCE", "LBAI", "FBMS", "BUSE",
],
"KIE": [  # Insurance
    "PGR", "CB", "TRV", "ALL", "HIG", "WRB", "AFG", "CINF", "RE", "RLI",
    "ERIE", "WTM", "JRVR", "KMPR", "HCI", "RYAN", "ROOT", "LMND", "HIFS", "DGICA",
    "ICC", "AMTRUST", "PLMR", "KINS", "KINGSWAY",
],
```

### Consumer & Lifestyle

```python
"XLP": [  # Consumer Defensive
    "PG", "KO", "PEP", "PM", "MO", "COST", "WMT", "CL", "KMB", "CHD",
    "SJM", "HRL", "CPB", "K", "CAG", "GIS", "MKC", "HSY", "MDLZ", "STZ",
    "TAP", "BF.B", "COTY", "EL", "CLX",
],
"XLY": [  # Consumer Discretionary
    "AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "TJX", "BKNG", "ABNB",
    "MAR", "HLT", "CCL", "RCL", "NCLH", "LVS", "MGM", "WYNN", "CZR", "PENN",
    "DKNG", "FLUT", "EVRI", "GDEN", "RSI",
],
"XRT": [  # Retail
    "GME", "MELI", "ETSY", "CHWY", "W", "ODP", "FLXS", "GCO", "WINA", "DXPE",
    "LESL", "HIMS", "FIGS", "LULU", "SKX", "BOOT", "CROX", "APP", "ONON", "BIRK",
    "OXM", "TLYS", "EXPR", "CATO", "HIBB",
],
"JETS": [  # Airlines
    "DAL", "UAL", "AAL", "LUV", "JBLU", "ALK", "SAVE", "HA", "ULCC", "CEA",
    "RYAAY", "SKYW", "MESA", "SNCY", "FLYA", "FLXT", "JOBY", "ACHR", "BLDE", "LILM",
    "EVTL", "SURF", "BLADE", "ZECO", "ACMR",
],
"PEJ": [  # Leisure & Hotels
    "DIS", "MAR", "HLT", "WH", "HGV", "TNL", "SEAS", "FUN", "SIX", "PRKS",
    "RRR", "CZR", "PENN", "MGM", "WYNN", "LVS", "VICI", "GLPI", "BALY", "DKNG",
    "FLUT", "RSI", "EVRI", "GDEN", "NCLH",
],
"XHB": [  # Homebuilders
    "DHI", "LEN", "PHM", "NVR", "TOL", "MDC", "TMHC", "SKY", "CVCO", "MHO",
    "LGIH", "GRBK", "INVH", "AMH", "NXH", "TREX", "UFPI", "IBP", "BECN", "PGTI",
    "BLDR", "FBHS", "AMWD", "JELD", "PATK",
],
```

### Real Estate & Utilities

```python
"VNQ": [  # REITs
    "AMT", "PLD", "CCI", "EQIX", "PSA", "O", "SPG", "WELL", "AVB", "EQR",
    "DLR", "ESS", "MAA", "UDR", "CPT", "NNN", "WPC", "BXP", "SLG", "KIM",
    "REG", "FRT", "AKR", "ROIC", "RPAI",
],
"XLU": [  # Utilities
    "NEE", "DUK", "SO", "AEP", "D", "EXC", "SRE", "WEC", "ED", "PPL",
    "FE", "XEL", "AEE", "CMS", "NI", "ETR", "EIX", "PEG", "AWK", "ES",
    "CNP", "EVRG", "POR", "NWE", "AVA",
],
```

### Crypto-Adjacent

```python
"WGMI": [  # Bitcoin Miners
    "MARA", "RIOT", "CLSK", "BITF", "HUT", "CIFR", "BTBT", "IREN", "WULF", "CORZ",
    "APLD", "BTCS", "SATO", "DGHI", "GRIID", "MIGI", "BRRR", "HIVE", "BTCM", "BFARF",
    "ARBK", "TERA", "DMGI", "BTCWF", "ASST",
],
"IBIT": [  # Crypto / Bitcoin
    "MSTR", "COIN", "HOOD", "MARA", "RIOT", "CLSK", "BITF", "HUT", "SMLR", "BTBT",
    "IREN", "WULF", "BKKT", "GBTC", "SI", "CXBTF", "ETHE", "GDLC", "BITW", "OBTC",
    "GBTG", "BRPHF", "BTCWF", "ARBK", "HIVE",
],
"BLOK": [  # Blockchain
    "COIN", "MSTR", "SQ", "PYPL", "MARA", "RIOT", "CLSK", "IREN", "BTBT", "HUT",
    "CIFR", "WULF", "CORZ", "BKKT", "ACNB", "MIGI", "SATO", "DGHI", "GRIID", "BRRR",
    "HIVE", "BTCM", "ARBK", "TERA", "DMGI",
],
```

### Global / Regional

```python
"KWEB": [  # China Internet (replaces FXI China Broad)
    "BABA", "JD", "PDD", "BIDU", "TCEHY", "NTES", "VIPS", "IQ", "MOMO", "DOYU",
    "HUYA", "QFIN", "FINV", "LXEH", "YUMC", "BZ", "CANG", "CAN", "GOTU", "JMU",
    "LACO", "LKCO", "MOXC", "RENN", "SOHU",
],
"INDA": [  # India
    "INFY", "WIT", "HDB", "IBN", "SIFY", "REYN", "SYNA", "RMBS", "AEIS", "IDCC",
    "FFIV", "VNET", "TTM", "MTCH", "PNTM", "ICAD", "IRBT", "RADI", "ACNB", "GGAL",
    "BBVA", "BBD", "ITUB", "VALE", "ABEV",
],
"EWZ": [  # Brazil
    "VALE", "ITUB", "BBD", "PBR", "ABEV", "GGB", "CIG", "SID", "SBS", "BRFS",
    "CSAN", "RAIZ", "LWSA", "PETZ", "OI", "JHSF", "LIGT", "CPLE", "SMTO", "EMBR",
    "RAIL", "BEEF", "MOVI", "OIBR", "TIMS",
],
"EWJ": [  # Japan
    "TM", "SONY", "HMC", "NTDOY", "MUFG", "SMFG", "MFG", "NMR", "FUJIY", "KYSOY",
    "OTIKY", "HOCPY", "ITOCY", "MITSY", "FANUY", "DNZOY", "KUBTY", "KIOCY", "JEHLY", "MRAAY",
    "PCRFY", "RNLSY", "SHECY", "TKOMY", "CJPRY",
],
"EWT": [  # Taiwan
    "TSM", "UMC", "ASX", "SPIL", "HIMAX", "HIMX", "CEVA", "SIMO", "SCSC", "VIAV",
    "AEHR", "ONTO", "FORM", "LOGI", "MED", "ACMR", "IMOS", "ISSI", "AOSL", "DIOD",
    "LPTH", "POWI", "PXLW", "MTSI", "SMTC",
],
"EWY": [  # South Korea
    "KB", "SHG", "KEP", "PKX", "LG", "SKM", "KT", "KORE", "CLPS", "KTCC",
    "HOLI", "VNET", "GDS", "HAYN", "GKOS", "NXPI", "MXIM", "ON", "SLAB", "DIOD",
    "MTSI", "ALGM", "CRUS", "SMTC", "NVTS",
],
"EZU": [  # Europe
    "ASML", "SAP", "TTE", "SAN", "BNP", "INGA", "VOW", "BMW", "DTE", "ENEL",
    "ENI", "OR", "MC", "ADS", "STMPA", "UL", "BP", "GSK", "AZN", "BTI",
    "RIO", "BHP", "GLEN", "VOD", "CS",
],
"EEM": [  # Emerging Markets
    "BABA", "TSM", "TCEHY", "BIDU", "JD", "NIO", "INFY", "HDB", "VALE", "ITUB",
    "PBR", "ABEV", "KT", "GGB", "SBS", "NEM", "GOLD", "AEM", "WPM", "KGC",
    "AGI", "SBSW", "PAAS", "CDE", "HL",
],
```

### UCT 20 — Dynamic (special)

```python
"UCT20": [],  # Populated at runtime — do NOT add a static list here
```

---

## Section 4: `theme_performance.py` Changes

### 4.1 UCT20 Special-Case

When building the per-theme symbol list in `api/services/theme_performance.py`, detect the `UCT20` key and substitute the leadership list from the wire payload:

```python
# In theme_performance.py — theme symbol resolution
def _resolve_theme_symbols(etf_key: str, wire: dict) -> list[str]:
    if etf_key == "UCT20":
        leadership = wire.get("leadership", [])
        return [entry["sym"] for entry in leadership if "sym" in entry]
    return THEME_HOLDINGS_CURATED.get(etf_key, [])
```

The `wire` dict here is the same `wire_data` object already flowing through the morning wire pipeline. The `leadership` list entries each have at minimum a `sym` field.

### 4.2 UCT20 Benchmark Anchor

Use `QQQ` as the benchmark comparison for the UCT20 group return display (same way other themes compare against their ETF). Wire this into the theme return calculation:

```python
UCT20_BENCHMARK = "QQQ"
```

When computing the theme vs. benchmark spread for display, substitute `QQQ` wherever the ETF ticker would normally be used for `UCT20`.

### 4.3 Removed ETFs — `_EXCLUDED` Set

Add the four removed ETF tickers to any exclusion/skip set used in `theme_performance.py` to prevent stale data from surfacing if they remain in older cached payloads:

```python
_EXCLUDED_THEMES = {"URA", "IBB", "FXI", "MSOS"}
```

Guard all theme loops:

```python
for etf_key, symbols in THEME_HOLDINGS_CURATED.items():
    if etf_key in _EXCLUDED_THEMES:
        continue
    ...
```

---

## Section 5: Filter Note

The curated holdings lists in `THEME_HOLDINGS_CURATED` are manually pre-filtered to satisfy:

- **Exchange**: US-listed only (NYSE, NASDAQ, CBOE). No OTC suffixes (`.GLATF`, `LYSCF`, `HSSHF`, etc.).
- **Market cap**: $300M minimum.
- **Price**: $5.00 minimum per share.

**No runtime cap/price filter is applied.** The lists are authoritative as written. If a ticker falls below these thresholds in the future, it should be swapped out during the next manual curation pass — not filtered dynamically.

---

## Section 6: UCT20 Summary

| Property | Value |
|---|---|
| ETF key | `UCT20` |
| Full name | `UCT Intelligence Leadership 20` |
| Holdings source | `wire_data["leadership"]` at runtime |
| Static list | None (empty list in `THEME_HOLDINGS_CURATED`) |
| Benchmark for return display | `QQQ` |
| Number of members | Variable; typically ~20 from daily wire leadership list |

---

## Section 7: Theme Count Summary

| Action | Count |
|---|---|
| Themes removed | 4 (URA, IBB, FXI, MSOS) |
| Themes added | 11 (SOXX, AMAT, VRT, EQIX, KTOS, LLY, ZIM, SHOP, NFLX, NUE, UCT20) |
| Net new | +7 |
| Approximate total | ~70 themes |

---

## Implementation Order

1. Update `THEMES` dict in `morning_wire_engine.py` — add 11, remove 4.
2. Update `ETF_FULLNAMES` dict — matching adds/removes.
3. Replace all holdings lists in `THEME_HOLDINGS_CURATED` with the curated lists above.
4. In `api/services/theme_performance.py`:
   - Add `_EXCLUDED_THEMES` set and guard loop.
   - Add `_resolve_theme_symbols()` helper with UCT20 special-case.
   - Wire `UCT20_BENCHMARK = "QQQ"` into spread calculation.
5. Smoke test: verify UCT20 pulls from wire_data leadership and QQQ is used as its benchmark.
