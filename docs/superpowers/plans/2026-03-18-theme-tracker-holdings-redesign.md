# Theme Tracker Holdings Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild all 70 Theme Tracker holdings lists to be fully custom-curated (ETF = benchmark only), add 11 new themes, remove 4 stale ones, and wire up a dynamic UCT 20 theme that pulls from the daily leadership list.

**Architecture:** Two repos touched — `C:\Users\Patrick\morning-wire\morning_wire_engine.py` (three dicts: THEMES, ETF_FULLNAMES, THEME_HOLDINGS_CURATED) and `C:\Users\Patrick\uct-dashboard\api\services\theme_performance.py` (UCT20 special-case + expanded exclusion set). No new files. No runtime filter — lists are manually pre-filtered to US-listed, $300M+ cap, $5+ price.

**Tech Stack:** Python, FastAPI, pytest. Spec: `docs/superpowers/specs/2026-03-18-theme-tracker-holdings-redesign.md`

---

## Task 1: Update THEMES and ETF_FULLNAMES dicts

**Files:**
- Modify: `C:\Users\Patrick\morning-wire\morning_wire_engine.py:216-369`

- [ ] **Step 1: Remove 4 keys from THEMES dict (lines ~216-302)**

Remove these four entries from `THEMES`:
```python
# DELETE these lines:
"URA":  "Uranium / Nuclear",
"IBB":  "Biotech (Large Cap)",
"FXI":  "China (Broad)",
"MSOS": "Cannabis",
```

- [ ] **Step 2: Add 11 new keys to THEMES dict**

Add after the Crypto-Adjacent section, before Global/Regional:
```python
    # ── New Themes ────────────────────────────────────────────────────────────
    "SOXX": "Chip Designers",           # Fabless semiconductor designers
    "AMAT": "Semiconductor Equipment",  # Wafer fab equipment makers
    "VRT":  "AI Infrastructure",        # Power/cooling/networking for AI
    "EQIX": "Data Centers",             # Colocation and hyperscale
    "KTOS": "Defense Tech",             # Drone, AI defense, autonomous systems
    "LLY":  "GLP-1 / Weight Loss",      # Obesity drug ecosystem
    "ZIM":  "Shipping",                 # Dry bulk, container, tanker
    "SHOP": "E-commerce",               # Online retail platforms
    "NFLX": "Streaming & Digital Media", # Content and streaming platforms
    "NUE":  "Steel & Metals",           # Steel producers and processors
    "UCT20":"UCT 20",                   # Dynamic: UCT Intelligence Leadership 20
```

- [ ] **Step 3: Remove 4 keys from ETF_FULLNAMES dict (lines ~305-369)**

Remove these entries:
```python
# DELETE these lines:
"URA":  "Global X Uranium ETF",
"IBB":  "iShares Nasdaq Biotechnology ETF",
"FXI":  "iShares China Large-Cap ETF",
"MSOS": "AdvisorShares Pure US Cannabis ETF",
```

- [ ] **Step 4: Add 11 new keys to ETF_FULLNAMES dict**

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

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Patrick/morning-wire
git add morning_wire_engine.py
git commit -m "feat: add 11 new themes, remove 4 stale themes from THEMES + ETF_FULLNAMES"
```

---

## Task 2: Replace THEME_HOLDINGS_CURATED with full curated lists

**Files:**
- Modify: `C:\Users\Patrick\morning-wire\morning_wire_engine.py:374-438`

This task replaces the entire `THEME_HOLDINGS_CURATED` dict body (lines 374–438). Replace everything between `THEME_HOLDINGS_CURATED = {` and the closing `}` with the lists below. All tickers are US-listed, $300M+ market cap, $5+ price. UCT20 gets an empty list — it is populated at runtime from wire_data.

- [ ] **Step 1: Replace the full THEME_HOLDINGS_CURATED dict**

```python
THEME_HOLDINGS_CURATED = {
    # ── Technology ──────────────────────────────────────────────────────────
    "SMH": [  # Semiconductors (broad)
        "NVDA","AVGO","TSM","QCOM","AMD","TXN","ADI","MCHP","INTC","ON",
        "MU","AMAT","LRCX","KLAC","MRVL","ASML","ARM","MPWR","SWKS","QRVO",
        "SLAB","MTSI","ALGM","CRUS","FORM",
    ],
    "SOXX": [  # Chip Designers (fabless)
        "NVDA","AMD","QCOM","AVGO","MRVL","ARM","MPWR","SWKS","QRVO","SLAB",
        "MTSI","CRUS","ALGM","DIOD","SMTC","AMBA","NVTS","POWI","SITM","AEHR",
        "OLED","COHU","ACLS","ONTO","ICHR",
    ],
    "AMAT": [  # Semiconductor Equipment
        "AMAT","LRCX","KLAC","ASML","ONTO","ACLS","FORM","ICHR","MKSI","COHU",
        "UCTT","BRKS","TER","ENTG","CCMP","AZTA","AMKR","IOSP","NVMI","CAMT",
        "KLIC","IPGP","IIVI","FARO","MKFG",
    ],
    "IGV": [  # Software
        "MSFT","ORCL","ADBE","INTU","NOW","PANW","CRWD","WDAY","TEAM","DDOG",
        "ZS","FTNT","SNOW","MDB","VEEV","HUBS","TTD","BILL","PCTY","PAYC",
        "GTLB","DOCN","WEX","APPN","BRZE",
    ],
    "AIQ": [  # Artificial Intelligence
        "NVDA","MSFT","GOOG","META","AMZN","IBM","PLTR","AI","BBAI","SOUN",
        "PATH","AMBA","CEVA","GFAI","AEYE","VRNT","NICE","DTLK","PRCT","IDAI",
        "KNSA","ANGO","SYNTX","BIGB","RXRX",
    ],
    "VRT": [  # AI Infrastructure
        "NVDA","SMCI","DELL","ARM","ANET","VRT","CIEN","CRDO","MRVL","NET",
        "ETN","EQIX","DLR","IREN","APLD","HPE","NTAP","POWI","AEIS","VICR",
        "BEL","MTSI","CLFD","CEVA","PWER",
    ],
    "EQIX": [  # Data Centers
        "EQIX","DLR","IRM","COR","VRT","SMCI","DELL","HPE","NTAP","WDC",
        "STX","NTNX","PSTG","NET","AKAM","FSLY","LUMN","UNIT","CCOI","BAND",
        "SHEN","CNSL","INSG","LBRD","TBPH",
    ],
    "WCLD": [  # Cloud Computing
        "SNOW","DDOG","GTLB","ZI","BOX","DOCN","WEX","APPN","NCNO","AGYS",
        "BRZE","FRSH","PCTY","HUBS","BILL","PAYC","SMAR","MANH","VEEV","WDAY",
        "TEAM","MDB","DOMO","FIVN","ALTR",
    ],
    "CIBR": [  # Cybersecurity
        "PANW","CRWD","FTNT","ZS","OKTA","CYBR","S","QLYS","TENB","VRNS",
        "CHKP","RPD","ITRI","RDWR","SAIL","ASAN","KNBE","MIME","SCWX","OSPN",
        "EXFY","TMUS","CSCO","JNPR","FFIV",
    ],
    "SOCL": [  # Social Media
        "META","SNAP","PINS","MTCH","BMBL","IAC","YELP","MQ","HOOD","ANGI",
        "UBER","DASH","ABNB","GOOGL","TWLO","HIMS","TDOC","MELI","SE","LYFT",
        "EVER","SPRK","ACMR","LEGN","SEMA",
    ],
    "ESPO": [  # Video Games & Esports
        "NVDA","MSFT","TTWO","EA","RBLX","NTES","BILI","U","SONY","NTDOY",
        "NEXON","PLTK","SKLZ","MGAM","HUYA","DOYU","IQ","NERD","PERI","GMBL",
        "GPUS","GRIN","GLUU","WBGM","ZNGA",
    ],
    "FINX": [  # Fintech
        "SQ","PYPL","AFRM","SOFI","UPST","LC","MQ","OPFI","DAVE","NU",
        "NRDS","RELY","FLYW","HOOD","BILL","PAYC","FOUR","EVTC","PAGS","DLO",
        "STNE","COOP","RYAN","PRFT","SMAR",
    ],
    "SHOP": [  # E-commerce
        "SHOP","MELI","SE","CPNG","CART","ETSY","W","AMZN","EBAY","BABA",
        "JD","PDD","OSTK","PRTS","CVNA","RVLV","REAL","WISH","PINC","ANGI",
        "SONO","VZIO","OLLI","BIG","FIVE",
    ],
    "NFLX": [  # Streaming & Digital Media
        "NFLX","ROKU","SPOT","DIS","PARA","WBD","FUBO","LGF","IMAX","AMC",
        "CNK","SEAT","SIRI","IHRT","GENI","MAPS","PERI","CARG","CARS","GAMB",
        "NERD","LUMN","ACMR","ZNGA","GENI",
    ],
    "QTUM": [  # Quantum Computing
        "IBM","IONQ","RGTI","QUBT","QBTS","ARQQ","NVDA","GOOG","MSFT","HON",
        "QMCO","CPIX","LEXX","FORM","BSQR","DMRC","SIFY","WLDS","LASR","DEFN",
        "SPQR","QFIN","ACNB","OXFD","LDOS",
    ],

    # ── Innovation & Disruptive Tech ─────────────────────────────────────────
    "ARKK": [  # Disruptive Innovation
        "TSLA","NVDA","COIN","RBLX","PATH","RXRX","BEAM","PACB","EXAS","IOVA",
        "NTLA","CRSP","EDIT","TWST","FATE","ACMR","NTRA","GH","QDEL","CERS",
        "PSTV","PGEN","KYMR","YMAB","VERV",
    ],
    "ARKG": [  # Genomics
        "RXRX","BEAM","PACB","EXAS","IOVA","NTLA","CRSP","EDIT","TWST","FATE",
        "NVTA","GH","QDEL","NTRA","CERS","PSTV","PGEN","KYMR","YMAB","VERV",
        "ARCT","BLUE","SGMO","FIXX","DTIL",
    ],
    "ARKQ": [  # Autonomous Tech
        "TSLA","KTOS","HII","TDG","RKLB","LUNR","RDW","ASTS","JOBY","ACHR",
        "BLDE","WKHS","LAZR","LIDR","INVZ","MBLY","APTV","GM","F","NKLA",
        "RIDE","SOLO","AYRO","KNDI","RCAT",
    ],
    "ROBO": [  # Robotics & Automation
        "ISRG","ABB","IRBT","BRKS","NOVT","RCAT","BKSY","ACMR","CGNX","NDSN",
        "RRX","ESE","NVDA","TSLA","HON","ROK","EMR","PH","ITW","FARO",
        "ONTO","VICR","AZTA","MKFG","FANUY",
    ],
    "UFO": [  # Space Exploration
        "RKLB","ASTS","SPCE","LUNR","RDW","BKSY","KTOS","HII","MAXR","ASTR",
        "MNTS","VSAT","IRDM","GSAT","DISH","TSAT","LSCC","GNSS","ORBT","SPIR",
        "GEO","GILT","AMRX","GEVI","SATL",
    ],

    # ── Healthcare ───────────────────────────────────────────────────────────
    "XLV": [  # Healthcare Broad
        "LLY","UNH","JNJ","ABBV","MRK","BMY","AMGN","GILD","CVS","MCK",
        "ABC","CI","HUM","CNC","MOH","ELV","HCA","THC","UHS","ENSG",
        "ACHC","SEM","ADUS","AMED","AFYA",
    ],
    "XBI": [  # Biotech (consolidated — replaces IBB + XBI)
        "MRNA","BNTX","VRTX","REGN","BIIB","AMGN","GILD","AGEN","FATE","CRSP",
        "BEAM","NTLA","EDIT","VERV","EXAS","NTRA","GH","QDEL","ALNY","INCY",
        "BMRN","RARE","IONS","RGEN","ACMR",
    ],
    "IHI": [  # Medical Devices
        "ABT","MDT","ISRG","BSX","EW","ZBH","HOLX","DXCM","PODD","IRTC",
        "NVCR","SWAV","TMDX","AXNX","NVRO","GKOS","IART","LMAT","MMSI","PRCT",
        "SENS","NURO","INVA","NVCN","PIRS",
    ],
    "LLY": [  # GLP-1 / Weight Loss
        "LLY","NVO","VKTX","HIMS","AMGN","GPCR","RNAZ","ALVO","RYTM","TERN",
        "RDUS","ZFGN","CHRS","AQST","ADMA","KPTI","AGIO","ACAD","NKTR","CORT",
        "VNDA","EVLO","PRAX","RCUS","INVA",
    ],

    # ── Clean Energy ─────────────────────────────────────────────────────────
    "TAN": [  # Solar
        "ENPH","SEDG","FSLR","RUN","NOVA","ARRY","SPWR","CSIQ","JKS","SHLS",
        "MAXN","FTCI","PEGI","SOL","DAQO","FLNC","BE","STEM","SUNW","PECK",
        "GXII","SPWH","REGI","AZRE","NOVA",
    ],
    "ICLN": [  # Clean Energy Broad
        "ENPH","FSLR","NEE","BEP","CWEN","NRG","CLNE","PLUG","BLDP","HASI",
        "GPRE","AMRC","NOVA","RUN","ARRY","BE","STEM","FLNC","ORA","AZRE",
        "MAXN","DAQO","SPWR","CSIQ","JKS",
    ],
    "LIT": [  # Lithium & Battery
        "ALB","SQM","LTHM","PLL","LAC","MP","MTRN","SGML","ALTM","FREYR",
        "MVST","NKLA","BLNK","CHPT","EVGO","AMPX","ENVX","SLDP","AEYE","ACMR",
        "FRSX","VVOS","STRO","NOVS","NXRT",
    ],
    "DRIV": [  # Electric Vehicles
        "TSLA","GM","F","NIO","LI","XPEV","RIVN","LCID","GOEV","FSR",
        "VFS","MULN","SOLO","AYRO","KNDI","BLNK","CHPT","EVGO","NKLA","WKHS",
        "RIDE","REE","ACTV","IDEX","FFIE",
    ],
    "NLR": [  # Nuclear Energy (absorbs URA)
        "CCJ","BWXT","UEC","DNN","NXE","UUUU","LEU","BWX","SMR","OKLO",
        "NNE","AEP","EXC","FE","NEE","GEV","ETN","VST","CEG","CWEN",
        "LTBR","PDN","URG","VST","SO",
    ],

    # ── Traditional Energy ───────────────────────────────────────────────────
    "XLE": [  # Energy Broad
        "XOM","CVX","COP","EOG","SLB","PSX","MPC","VLO","OXY","HES",
        "DVN","FANG","APA","HAL","BKR","LNG","CQP","TRGP","WMB","OKE",
        "EPD","ET","MMP","PAGP","KMI",
    ],
    "XOP": [  # Oil & Gas E&P
        "OXY","DVN","FANG","COP","EOG","APA","MUR","AR","RRC","CNX",
        "SM","CRK","CIVI","CHK","NOG","VTLE","GPOR","ESTE","PXD","MTDR",
        "PDCE","MGY","ROCC","REI","BATL",
    ],
    "OIH": [  # Oil Services
        "SLB","HAL","BKR","NOV","RIG","VAL","NE","OII","FTI","NETI",
        "PTEN","HP","WHD","ACDC","NESR","LBRT","PUMP","NINE","KLXE","CACTUS",
        "WTTR","DNOW","DRIL","USWS","RNGR",
    ],
    "FCG": [  # Natural Gas & LNG
        "EQT","AR","RRC","CNX","CRK","TELL","LNG","CQP","GLNG","GLOG",
        "SWN","COG","GPOR","GEL","TRP","ENB","WMB","OKE","TRGP","AM",
        "CEQP","DT","MMP","MPLX","HTGC",
    ],

    # ── Materials & Commodities ──────────────────────────────────────────────
    "GLD": [  # Gold (physical proxies only)
        "GLD","IAU","SGOL","GLDM","PHYS","OUNZ","AAAU","BAR","GOLD","NEM",
        "AEM","WPM","KGC","AGI","EGO","PAAS","CDE","HL","OR","MUX",
        "BTG","DRD","SAND","SSL","IAG",
    ],
    "GDX": [  # Gold Miners
        "NEM","GOLD","AEM","WPM","KGC","AGI","EGO","PAAS","CDE","HL",
        "OR","MUX","TGD","IAG","SBSW","BTG","DRD","SAND","SSL","EDR",
        "GORO","AKG","GSS","AU","SSRM",
    ],
    "GDXJ": [  # Junior Gold Miners
        "EGO","AGI","KGC","BTG","HBM","IAG","MUX","TGD","SAND","WDO",
        "SSL","EDR","AKG","GSS","GORO","DRD","AU","SSRM","VZLA","ARTG",
        "ROXG","SVM","MAG","SILV","FSM",
    ],
    "SIL": [  # Silver Miners
        "WPM","PAAS","AG","HL","CDE","MAG","SILV","AUMN","EXK","GATO",
        "FSM","AVINO","SVBL","SVM","IPX","SSRM","EGO","SAND","OR","BTG",
        "DRD","AKG","GSS","KGC","IAG",
    ],
    "COPX": [  # Copper Miners
        "SCCO","FCX","HBM","TECK","ERO","FM","IVN","CLF","VALE","BHP",
        "RIO","AA","ACH","CS","SOLG","ANTO","NOVRF","NGX","FQVLF","CPPMF",
        "ARNC","ATI","CRS","AMG","WOR",
    ],
    "REMX": [  # Rare Earth / Critical Minerals
        "MP","ARNC","ATI","CRS","AMG","TDY","MKS","IIVI","NOVT","AVAV",
        "KTOS","LDOS","CACI","SAIC","DRS","MRCY","BWXT","HII","BAH","AXON",
        "L3H","UCORE","NHI","PGNY","FROG",
    ],
    "MOO": [  # Agribusiness
        "NTR","CF","MOS","ADM","BG","CTVA","FMC","AGCO","DE","CNH",
        "INGR","VITL","ACA","ANDE","IPI","LNN","WLKP","GCP","FEED","HALO",
        "CROP","SMID","TATM","MGP","ARII",
    ],
    "PHO": [  # Water
        "XYL","WMS","ARIS","PRMW","AWK","WTR","CWCO","ARTNA","MSEX","YORW",
        "CTWS","SJW","GWRS","CDZI","AEIS","AQUA","NWN","MGEE","SJI","PCYO",
        "REXR","HOLX","PENNV","YORK","NORW",
    ],
    "NUE": [  # Steel & Metals
        "NUE","STLD","CLF","X","CMC","RS","ATI","WOR","CRS","TS",
        "PKX","VALE","RIO","BHP","SCCO","FCX","AA","ARNC","HBM","ERO",
        "ACH","CS","ARCH","AMR","METC",
    ],

    # ── Defense & Industrials ────────────────────────────────────────────────
    "ITA": [  # Defense & Aerospace
        "LMT","RTX","NOC","GD","HII","KTOS","BWXT","LDOS","BAH","SAIC",
        "CACI","DRS","MRCY","L3H","TDG","HEI","TXT","HEICO","AVAV","AXON",
        "JOBY","RKLB","SPCE","FLIR","RDDT",
    ],
    "KTOS": [  # Defense Tech
        "PLTR","KTOS","BWXT","LDOS","HII","CACI","SAIC","DRS","MRCY","RCAT",
        "JOBY","ACHR","AVAV","AXON","BKSY","ASTS","RDW","LUNR","BLDE","EVTL",
        "ACMR","GNSS","ORBT","SPIR","LILM",
    ],
    "XLI": [  # Industrials
        "RTX","HON","UPS","GE","CAT","DE","ETN","EMR","PH","ROK",
        "ITW","XYL","IR","FTV","OTIS","CARR","TT","JCI","ALLE","SWK",
        "FAST","GGG","AOS","RBC","GNRC",
    ],
    "PAVE": [  # Infrastructure
        "VMC","MLM","NUE","NVR","PHM","LEN","DHI","STLD","CMC","FAST",
        "MAS","ITW","MHO","SKY","UFPI","TREX","BLDR","IBP","BECN","PGTI",
        "ALSN","GVA","ROAD","WIRE","ACGH",
    ],
    "ZIM": [  # Shipping
        "ZIM","MATX","SBLK","GOGL","EGLE","GNK","NMM","SALT","PANL","DSX",
        "FREE","EDRY","TOPS","CTRM","GLBS","SHIP","GASS","SINO","PSHG","BWTS",
        "BALT","DCSA","KGEI","MPCC","HAFNI",
    ],

    # ── Financials ───────────────────────────────────────────────────────────
    "XLF": [  # Financials Broad
        "BRK.B","JPM","BAC","WFC","GS","MS","C","AXP","BK","STT",
        "USB","TFC","PNC","RF","CFG","SCHW","IBKR","RJF","SF","LPLA",
        "BEN","IVZ","FHN","CMA","FITB",
    ],
    "KRE": [  # Regional Banks
        "WAL","BOKF","IBCP","NBTB","BANR","GBCI","TBK","CTBI","PFBC","TCBK",
        "HTLF","FFIN","SBCF","INDB","WSBC","CVBF","HAFC","UMBF","GABC","FBNC",
        "HOMB","SRCE","LBAI","FBMS","BUSE",
    ],
    "KIE": [  # Insurance
        "PGR","CB","TRV","ALL","HIG","WRB","AFG","CINF","RE","RLI",
        "ERIE","WTM","JRVR","KMPR","HCI","RYAN","ROOT","LMND","PLMR","KINS",
        "DGICA","ICC","HIFS","KINGSWAY","AMTRUST",
    ],

    # ── Consumer & Lifestyle ─────────────────────────────────────────────────
    "XLP": [  # Consumer Defensive
        "PG","KO","PEP","PM","MO","COST","WMT","CL","KMB","CHD",
        "SJM","HRL","CPB","K","CAG","GIS","MKC","HSY","MDLZ","STZ",
        "TAP","COTY","EL","CLX","BF.B",
    ],
    "XLY": [  # Consumer Discretionary
        "AMZN","TSLA","HD","MCD","NKE","LOW","SBUX","TJX","BKNG","ABNB",
        "MAR","HLT","CCL","RCL","NCLH","LVS","MGM","WYNN","CZR","PENN",
        "DKNG","FLUT","EVRI","GDEN","RSI",
    ],
    "XRT": [  # Retail
        "LULU","BOOT","CROX","ONON","BIRK","SKX","HIMS","FIGS","GME","CHWY",
        "ETSY","W","MELI","ODP","GCO","WINA","LESL","OXM","TLYS","EXPR",
        "CATO","HIBB","APP","FIVE","OLLI",
    ],
    "JETS": [  # Airlines
        "DAL","UAL","AAL","LUV","JBLU","ALK","SAVE","HA","ULCC","CEA",
        "RYAAY","SKYW","MESA","SNCY","JOBY","ACHR","BLDE","LILM","EVTL","SURF",
        "BLADE","ZECO","FLYA","FLXT","ACMR",
    ],
    "PEJ": [  # Leisure & Hotels
        "DIS","MAR","HLT","WH","HGV","TNL","SEAS","FUN","SIX","PRKS",
        "RRR","CZR","PENN","MGM","WYNN","LVS","VICI","GLPI","BALY","DKNG",
        "FLUT","RSI","EVRI","GDEN","NCLH",
    ],
    "XHB": [  # Homebuilders
        "DHI","LEN","PHM","NVR","TOL","MDC","TMHC","SKY","CVCO","MHO",
        "LGIH","GRBK","INVH","AMH","NXH","TREX","UFPI","IBP","BECN","PGTI",
        "BLDR","FBHS","AMWD","JELD","PATK",
    ],

    # ── Real Estate & Utilities ──────────────────────────────────────────────
    "VNQ": [  # REITs
        "AMT","PLD","CCI","EQIX","PSA","O","SPG","WELL","AVB","EQR",
        "DLR","ESS","MAA","UDR","CPT","NNN","WPC","BXP","SLG","KIM",
        "REG","FRT","AKR","ROIC","IRM",
    ],
    "XLU": [  # Utilities
        "NEE","DUK","SO","AEP","D","EXC","SRE","WEC","ED","PPL",
        "FE","XEL","AEE","CMS","NI","ETR","EIX","PEG","AWK","ES",
        "CNP","EVRG","POR","NWE","AVA",
    ],

    # ── Crypto-Adjacent ───────────────────────────────────────────────────────
    "WGMI": [  # Bitcoin Miners
        "MARA","RIOT","CLSK","BITF","HUT","CIFR","BTBT","IREN","WULF","CORZ",
        "APLD","BTCS","SATO","DGHI","GRIID","MIGI","BRRR","HIVE","BTCM","ARBK",
        "TERA","DMGI","ASST","BFARF","DMG",
    ],
    "IBIT": [  # Crypto / Bitcoin
        "MSTR","COIN","HOOD","MARA","RIOT","CLSK","BITF","HUT","SMLR","BTBT",
        "IREN","WULF","BKKT","GBTC","ETHE","GDLC","BITW","OBTC","GBTG","HIVE",
        "ARBK","APLD","CORZ","BTCS","SATO",
    ],
    "BLOK": [  # Blockchain
        "COIN","MSTR","SQ","PYPL","MARA","RIOT","CLSK","IREN","BTBT","HUT",
        "CIFR","WULF","CORZ","BKKT","MIGI","SATO","DGHI","GRIID","BRRR","HIVE",
        "BTCM","ARBK","TERA","DMGI","APLD",
    ],

    # ── Global / Regional ────────────────────────────────────────────────────
    "KWEB": [  # China Internet (replaces FXI)
        "BABA","JD","PDD","BIDU","TCEHY","NTES","VIPS","IQ","MOMO","DOYU",
        "HUYA","QFIN","FINV","LXEH","YUMC","BZ","CANG","CAN","GOTU","JMU",
        "LKCO","MOXC","RENN","SOHU","CJIN",
    ],
    "INDA": [  # India
        "INFY","WIT","HDB","IBN","SIFY","TTM","REYN","SYNA","RMBS","AEIS",
        "IDCC","FFIV","VNET","PNTM","ICAD","IRBT","RADI","GGAL","BBVA","BBD",
        "ITUB","VALE","ABEV","MTCH","ACNB",
    ],
    "EWZ": [  # Brazil
        "VALE","ITUB","BBD","PBR","ABEV","GGB","CIG","SID","SBS","BRFS",
        "CSAN","RAIZ","LWSA","PETZ","OI","JHSF","LIGT","CPLE","SMTO","EMBR",
        "RAIL","BEEF","MOVI","OIBR","TIMS",
    ],
    "EWJ": [  # Japan
        "TM","SONY","HMC","NTDOY","MUFG","SMFG","MFG","NMR","FUJIY","KYSOY",
        "OTIKY","HOCPY","ITOCY","MITSY","FANUY","DNZOY","KUBTY","KIOCY","JEHLY","MRAAY",
        "PCRFY","RNLSY","SHECY","TKOMY","CJPRY",
    ],
    "EWT": [  # Taiwan
        "TSM","UMC","ASX","SPIL","HIMAX","HIMX","CEVA","SIMO","SCSC","VIAV",
        "AEHR","ONTO","FORM","ACMR","IMOS","ISSI","AOSL","DIOD","LPTH","POWI",
        "PXLW","MTSI","SMTC","LOGI","MED",
    ],
    "EWY": [  # South Korea
        "KB","SHG","KEP","PKX","LG","SKM","KT","KORE","CLPS","HOLI",
        "VNET","GDS","HAYN","GKOS","NXPI","ON","SLAB","DIOD","MTSI","ALGM",
        "CRUS","SMTC","NVTS","KTCC","MXIM",
    ],
    "EZU": [  # Europe
        "ASML","SAP","TTE","SAN","BNP","INGA","VOW","BMW","DTE","ENEL",
        "ENI","OR","MC","ADS","UL","BP","GSK","AZN","BTI","RIO",
        "BHP","GLEN","VOD","CS","STMPA",
    ],
    "EEM": [  # Emerging Markets
        "BABA","TSM","TCEHY","BIDU","JD","NIO","INFY","HDB","VALE","ITUB",
        "PBR","ABEV","KT","GGB","SBS","NEM","GOLD","AEM","WPM","KGC",
        "AGI","SBSW","PAAS","CDE","HL",
    ],

    # ── UCT 20 — Dynamic ─────────────────────────────────────────────────────
    "UCT20": [],  # Populated at runtime from wire_data["leadership"] — do NOT add static list
}
```

- [ ] **Step 2: Verify the dict is syntactically valid**

```bash
cd /c/Users/Patrick/morning-wire
python -c "from morning_wire_engine import THEME_HOLDINGS_CURATED; print(len(THEME_HOLDINGS_CURATED), 'themes loaded')"
```
Expected: prints a number around 70 with no errors.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/Patrick/morning-wire
git add morning_wire_engine.py
git commit -m "feat: replace THEME_HOLDINGS_CURATED — 70 themes, 20-25 custom-curated stocks each"
```

---

## Task 3: Update theme_performance.py — UCT20 + exclusion set

**Files:**
- Modify: `C:\Users\Patrick\uct-dashboard\api\services\theme_performance.py`

Current state: `_EXCLUDED = {"TLT", "HYG"}` is defined inline inside `get_theme_performance()`. The theme loop uses it to skip those keys.

- [ ] **Step 1: Write a failing test for UCT20 dynamic resolution**

Add to `tests/test_theme_performance.py`:

```python
def test_uct20_pulls_from_leadership():
    """UCT20 theme uses wire_data['leadership'] symbols, not a static list."""
    MOCK_WIRE = {
        "themes": {
            "UCT20": {
                "name": "UCT 20",
                "etf_name": "UCT Intelligence Leadership 20",
                "holdings": [],  # empty static list
            }
        },
        "leadership": [
            {"sym": "NVDA", "name": "Nvidia", "rank": 1},
            {"sym": "TSLA", "name": "Tesla", "rank": 2},
            {"sym": "MRVL", "name": "Marvell", "rank": 3},
        ]
    }
    FAKE_BARS = [{"t": 1700000000000 + i * 86400000, "c": float(100 + i)} for i in range(300)]

    with patch("api.services.theme_performance._load_wire_data", return_value=MOCK_WIRE), \
         patch("api.services.theme_performance.get_agg_bars", return_value=FAKE_BARS), \
         patch("api.services.theme_performance.cache") as mock_cache:
        mock_cache.get.return_value = None

        from api.services.theme_performance import get_theme_performance
        result = get_theme_performance()

    themes = {t["ticker"]: t for t in result["themes"]}
    assert "UCT20" in themes
    syms = [h["sym"] for h in themes["UCT20"]["holdings"]]
    assert "NVDA" in syms
    assert "TSLA" in syms
    assert "MRVL" in syms


def test_excluded_themes_not_in_output():
    """URA, IBB, FXI, MSOS are filtered out even if present in wire_data."""
    MOCK_WIRE = {
        "themes": {
            "UFO": {
                "name": "Space",
                "etf_name": "Procure Space ETF",
                "holdings": [{"sym": "RKLB", "name": "Rocket Lab", "pct": 8.5}],
            },
            "URA": {
                "name": "Uranium",
                "etf_name": "Global X Uranium ETF",
                "holdings": [{"sym": "CCJ", "name": "Cameco", "pct": 20.0}],
            },
            "MSOS": {
                "name": "Cannabis",
                "etf_name": "AdvisorShares Cannabis ETF",
                "holdings": [{"sym": "CURA", "name": "Curaleaf", "pct": 10.0}],
            },
        }
    }
    FAKE_BARS = [{"t": 1700000000000 + i * 86400000, "c": float(100 + i)} for i in range(10)]

    with patch("api.services.theme_performance._load_wire_data", return_value=MOCK_WIRE), \
         patch("api.services.theme_performance.get_agg_bars", return_value=FAKE_BARS), \
         patch("api.services.theme_performance.cache") as mock_cache:
        mock_cache.get.return_value = None

        from api.services.theme_performance import get_theme_performance
        result = get_theme_performance()

    tickers = [t["ticker"] for t in result["themes"]]
    assert "UFO" in tickers
    assert "URA" not in tickers
    assert "MSOS" not in tickers
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /c/Users/Patrick/uct-dashboard
python -m pytest tests/test_theme_performance.py::test_uct20_pulls_from_leadership tests/test_theme_performance.py::test_excluded_themes_not_in_output -v
```
Expected: FAIL — `test_uct20_pulls_from_leadership` fails because UCT20 uses empty static holdings; `test_excluded_themes_not_in_output` fails because only TLT/HYG are excluded.

- [ ] **Step 3: Update theme_performance.py**

In `api/services/theme_performance.py`, replace the inline `_EXCLUDED` definition and the holdings resolution with these changes:

**a) Expand `_EXCLUDED` and move it to module level (outside `get_theme_performance`):**

Replace the current `_EXCLUDED = {"TLT", "HYG"}` (inside the function) with a module-level constant after the existing module-level constants:

```python
_EXCLUDED = {"TLT", "HYG", "URA", "IBB", "FXI", "MSOS"}
```

**b) Add `_resolve_holdings()` helper after the module-level constants:**

```python
def _resolve_holdings(etf_key: str, theme_data: dict, wire: dict) -> list[str]:
    """Return the symbol list for a theme.

    UCT20 is special-cased to pull from wire_data['leadership'] so the theme
    updates daily when the morning wire pushes new data. All other themes use
    the static holdings list stored in theme_data.
    """
    if etf_key == "UCT20":
        leadership = wire.get("leadership", [])
        return [entry["sym"] for entry in leadership if isinstance(entry, dict) and "sym" in entry]
    return [h["sym"] for h in theme_data.get("holdings", []) if isinstance(h, dict) and h.get("sym")]
```

**c) In `get_theme_performance()`, replace the holdings loop to use `_resolve_holdings()`:**

The existing loop (around line 149–160) currently does:
```python
raw_holdings = theme_data.get("holdings", [])
holdings_out = []
for h in raw_holdings:
    if not isinstance(h, dict) or not h.get("sym"):
        continue
    sym = h["sym"]
    holdings_out.append({...})
```

Replace it with:
```python
syms = _resolve_holdings(etf_ticker, theme_data, wire)
holdings_out = []
for sym in syms:
    holdings_out.append({
        "sym": sym,
        "name": theme_data.get("name", sym),  # individual name not available via sym-only path
        "weight_pct": 0.0,
        "returns": returns_map.get(sym, {k: None for k in ("1d", "1w", "1m", "3m", "1y", "ytd")}),
    })
```

Also update the `all_syms` collection loop to use `_resolve_holdings()`:
```python
# Collect all unique US holdings across all themes
all_syms: set[str] = set()
for etf_key, theme_data in raw_themes.items():
    if not isinstance(theme_data, dict) or etf_key in _EXCLUDED:
        continue
    for sym in _resolve_holdings(etf_key, theme_data, wire):
        all_syms.add(sym)
```

**d) Remove the inline `_EXCLUDED` definition** that currently sits inside `get_theme_performance()` (it moves to module level in step a).

- [ ] **Step 4: Run the new tests — expect PASS**

```bash
cd /c/Users/Patrick/uct-dashboard
python -m pytest tests/test_theme_performance.py -v
```
Expected: all 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Patrick/uct-dashboard
git add api/services/theme_performance.py tests/test_theme_performance.py
git commit -m "feat: UCT20 dynamic holdings from leadership list, expand excluded themes set"
```

---

## Task 4: Push both repos and verify

- [ ] **Step 1: Push morning-wire**

```bash
cd /c/Users/Patrick/morning-wire
git push origin master
```

- [ ] **Step 2: Push uct-dashboard (triggers Railway deploy)**

```bash
cd /c/Users/Patrick/uct-dashboard
git push origin master
```

- [ ] **Step 3: Smoke test — verify theme count after Railway deploy**

After deploy completes (~2 min), hit the cache-bust endpoint and then the theme performance endpoint:

```bash
curl -s -X POST https://web-production-05cb6.up.railway.app/api/theme-performance/refresh
curl -s https://web-production-05cb6.up.railway.app/api/theme-performance | python -c "import sys,json; d=json.load(sys.stdin); print(len(d['themes']), 'themes'); uct=[t for t in d['themes'] if t['ticker']=='UCT20']; print('UCT20 present:', bool(uct))"
```

Expected output:
```
{"status": "ok"}
~70 themes
UCT20 present: True
```

- [ ] **Step 4: Verify excluded themes absent**

```bash
curl -s https://web-production-05cb6.up.railway.app/api/theme-performance | python -c "
import sys, json
d = json.load(sys.stdin)
tickers = {t['ticker'] for t in d['themes']}
for bad in ['URA','IBB','FXI','MSOS','TLT','HYG']:
    print(bad, 'absent:', bad not in tickers)
"
```

Expected: all 6 print `absent: True`.
