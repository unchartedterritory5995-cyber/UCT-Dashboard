# Academic & Algorithmic Chart-Pattern Detection

Research file 12 of the multi-bar / base-structure corpus. Scope: **methods for machine detection of multi-bar price
structures, and the peer-reviewed evidence on whether those structures carry information.** Single-candle patterns are
out of scope.

## Sources actually retrieved (full text unless noted)

| # | Paper | Authors | Year | Venue | URL | What I got |
|---|---|---|---|---|---|---|
| S1 | Foundations of Technical Analysis: Computational Algorithms, Statistical Inference, and Empirical Implementation | Andrew W. Lo, Harry Mamaysky, Jiang Wang | 2000 | *Journal of Finance* 55(4), 1705–1765 | https://www.cis.upenn.edu/~mkearns/teaching/cis700/lo.pdf (JoF typeset); https://www.nber.org/system/files/working_papers/w7613/w7613.pdf (NBER w7613) | **Full text.** Definition pages 1716–1718 read by rendering the PDF pages to image, because `pdftotext` silently drops the math-font `<`/`>` glyphs. |
| S2 | Identifying Noise Traders: The Head-and-Shoulders Pattern in U.S. Equities | Carol L. Osler | 1998 | Federal Reserve Bank of New York Staff Report No. 42 | https://www.newyorkfed.org/medialibrary/media/research/staff_reports/sr42.pdf | Full text incl. Appendix (zigzag algorithm) |
| S3 | Data-Snooping, Technical Trading Rule Performance, and the Bootstrap | Ryan Sullivan, Allan Timmermann, Halbert White | 1999 (JoF); LSE FMG DP303, Oct 1998 | *Journal of Finance* 54(5) / LSE Financial Markets Group DP 303 | https://researchonline.lse.ac.uk/id/eprint/119144/1/dp303.pdf | Full text (working-paper version, "Journal of Finance, Forthcoming") |
| S4 | The Profitability of Technical Analysis: A Review | Cheol-Ho Park, Scott H. Irwin | 2004 | AgMAS Project Research Report 2004-04, Univ. of Illinois (working-paper version of the 2007 *Journal of Economic Surveys* article) | https://ageconsearch.umn.edu/record/37487/files/AgMAS04_04.pdf | Full text |
| S5 | Time Series Shapelets: A New Primitive for Data Mining | Lexiang Ye, Eamonn Keogh | 2009 | KDD '09 | https://www.cs.ucr.edu/~eamonn/shaplet.pdf | Full text |
| S6 | Exact indexing of dynamic time warping | Eamonn Keogh, Chotirat Ann Ratanamahatana | 2005 | *Knowledge and Information Systems* 7(3) | https://www.cs.ucr.edu/~eamonn/KAIS_2004_warping.pdf | Full text |
| S7 | Everything you know about Dynamic Time Warping is Wrong | Chotirat Ann Ratanamahatana, Eamonn Keogh | 2004 | 3rd Workshop on Mining Temporal and Sequential Data (KDD) | https://www.cs.ucr.edu/~eamonn/DTW_myths.pdf | Full text |
| S8 | Clustering of Time Series Subsequences is Meaningless: Implications for Previous and Future Research | Eamonn Keogh, Jessica Lin | 2003/2005 | ICDM 2003 / *KAIS* 8(2) | https://www.cs.ucr.edu/~eamonn/meaningless.pdf | Full text |
| S9 | Interpretable image-based deep learning for price trend prediction in ETF markets | Ruixun Zhang, Chaoyi Zhao, Guanglian Lin | 2023 | *The European Journal of Finance* (DOI 10.1080/1351847X.2023.2275567) | https://ruixunzhang.com/paper/2023_EJF_ImageML.pdf | Full text |
| S10 | Stock Chart Pattern recognition with Deep Learning | Marc Velay, Fabrice Daniel | 2018 | arXiv:1808.00418 (Lusis AI) | https://arxiv.org/pdf/1808.00418 | Full text |
| S11 | Index Financial Time Series Based on Zigzag-Perceptually Important Points | C. Phetchanchai, A. Selamat, A. Rehman, T. Saba | 2010 | *Journal of Computer Science* 6(12), 1389–1395 | https://thescipub.com/pdf/jcssp.2010.1389.1395.pdf | Full text. **Secondary source** for the PIP algorithm — it reproduces Fu et al.'s PIP-ED/PD/VD scheme. |
| S12 | Pattern recognition through perceptually important points in financial time series | G. Zaib, U. Ahmed, A. Ali | 2004 | *Computational Finance and its Applications* (WIT Press), 253–262 | https://www.witpress.com/Secure/elibrary/papers/CF04/CF04024FU.pdf | Full text. Weak/secondary; no measured benchmark. |

**Abstract-only** (paywalled; abstract text is verbatim from the publisher page or from OpenAlex, and is labelled as such
everywhere it is used):

| # | Paper | Authors | Year | Venue | Source of abstract |
|---|---|---|---|---|---|
| A1 | Stock time series pattern matching: Template-based vs. rule-based approaches | Tak-chung Fu, Fu-Lai Chung, Robert Luk, Chak-man Ng | 2007 | *Engineering Applications of Artificial Intelligence* 20(3), 347–364, DOI 10.1016/j.engappai.2006.07.003 | https://research.polyu.edu.hk/en/publications/stock-time-series-pattern-matching-template-based-vs-rule-based-a/ |
| A2 | Flexible time series pattern matching based on perceptually important points | F.-L. Chung, T.-C. Fu, R. Luk, V. Ng | 2001 | IJCAI-01 Workshop on Learning from Temporal and Spatial Data | Title/year/authors only, via OpenAlex. **PDF not obtained.** |
| A3 | The Predictive Power of "Head-and-Shoulders" Price Patterns in the U.S. Stock Market | G. Savin, P. Weller, J. Zvingelis | 2007 | *Journal of Financial Econometrics* 5(2), 243–265, DOI 10.1093/jjfinec/nbl012 | https://academic.oup.com/jfec/article-abstract/5/2/243/785044 |
| A4 | (Re-)Imag(in)ing Price Trends | Jingwen Jiang, Bryan Kelly, Dacheng Xiu | 2023 | *The Journal of Finance* 78(6), DOI 10.1111/jofi.13268 | OpenAlex abstract. Wiley PDF returned HTTP 403. |
| A5 | A new recognition algorithm for "head-and-shoulders" price patterns | Terence Tai-Leung Chong, Ka-Ho Poon | 2017 | *Studies in Nonlinear Dynamics and Econometrics*, DOI 10.1515/snde-2015-0066 | OpenAlex abstract |
| A6 | What makes trading strategies based on chart pattern recognition profitable? | Prodromos E. Tsinaslanidis, Francisco Guijarro | 2020 | *Expert Systems* 37(2), DOI 10.1111/exsy.12596 | OpenAlex abstract |
| A7 | On the Existence of Visual Technical Patterns in the UK Stock Market | Edward R. Dawson, James M. Steeley | 2003 | *Journal of Business Finance & Accounting*, DOI 10.1111/1468-5957.00492 | Bibliographic record only; **findings quoted second-hand from Park & Irwin (S4)** |
| A8 | Technical trading revisited: False discoveries, persistence tests, and transaction costs | Pierre Bajgrowicz, Olivier Scaillet | 2012 | *Journal of Financial Economics*, DOI 10.1016/j.jfineco.2012.06.001 | Bibliographic record only. **No numbers reported below.** |

> **Method note / honesty caveat.** The instruction asked for ≥12 distinct WebSearch calls. This session's web-search
> budget (200 calls) was exhausted after my 4th search, so the remaining ~25 retrievals were done by direct URL fetch
> plus the OpenAlex and Crossref metadata APIs. Every PDF above was downloaded and text-extracted locally; where
> `pdftotext` lost mathematical glyphs (Lo/Mamaysky/Wang's inequality signs), I rendered the page to a raster image and
> read it, so the reproduced inequalities are read off the typeset page, not reconstructed.

---

## Kernel-regression smoothing with extremum-inequality pattern definitions (Lo, Mamaysky & Wang)

- **source**: S1 — Lo, Mamaysky & Wang, 2000, *Journal of Finance* 55(4), 1705–1765. This is the reference
  implementation for the whole field; almost every later paper (S9, A3, A5) either uses it or modifies it.

- **what it does**: three stages, strictly separated.
  1. **Smooth.** Fit a Nadaraya–Watson kernel regression of price on time inside a rolling fixed-length window, to get
     a differentiable curve `m̂_h(t)` that stands in for the "systematic component" of price.
  2. **Extract extrema.** Find sign changes in the derivative of the *smoothed* curve, then snap each one back to the
     actual high/low in the raw price series within ±1 bar.
  3. **Test inequalities.** Feed the resulting alternating maxima/minima sequence `E1, E2, …` into ten purely
     ordinal/ratio predicates. No template, no distance metric, no training.

  The key architectural idea worth stealing: **the smoother only picks *where* the pivots are; the pattern test runs on
  raw prices at those pivots.** Verbatim (p. 1720): *"we proceed to identify a maximum or minimum in the original price
  series {P_t} in the range [τ − 1, τ + 1], and the extrema in the original price series are used to determine whether
  or not a pattern has occurred according to the definitions of Section II.A."*

- **formal_definition**:

  Setup, verbatim (p. 1716): *"Consider the systematic component m(·) of a price history {P_t} and suppose we have
  identified n local extrema, that is, the local maxima and minima, of {P_t}. Denote by E_1, E_2, …, E_n the n extrema
  and t*_1, t*_2, …, t*_n the dates on which these extrema occur."*

  Extrema always alternate, so a "three-peak" shape is exactly five extrema. Verbatim (p. 1717): *"Because consecutive
  extrema must alternate between maxima and minima for smooth functions, the three-peaks pattern corresponds to a
  sequence of five local extrema: maximum, minimum, highest maximum, minimum, and maximum."*

  **Definition 1 (Head-and-Shoulders)** — *"Head-and-shoulders (HS) and inverted head-and-shoulders (IHS) patterns are
  characterized by a sequence of five consecutive local extrema E_1, …, E_5 such that"*

  ```
          ⎧ E1 is a maximum
          ⎪ E3 > E1,  E3 > E5
  HS   ≡  ⎨ E1 and E5 are within 1.5 percent of their average
          ⎩ E2 and E4 are within 1.5 percent of their average,

          ⎧ E1 is a minimum
          ⎪ E3 < E1,  E3 < E5
  IHS  ≡  ⎨ E1 and E5 are within 1.5 percent of their average
          ⎩ E2 and E4 are within 1.5 percent of their average.
  ```

  **Definition 2 (Broadening)** — *"Broadening tops (BTOP) and bottoms (BBOT) are characterized by a sequence of five
  consecutive local extrema E_1, …, E_5 such that"*

  ```
           ⎧ E1 is a maximum                      ⎧ E1 is a minimum
  BTOP  ≡  ⎨ E1 < E3 < E5        ,     BBOT   ≡   ⎨ E1 > E3 > E5      .
           ⎩ E2 > E4                              ⎩ E2 < E4
  ```

  **Definition 3 (Triangle)** — *"Triangle tops (TTOP) and bottoms (TBOT) are characterized by a sequence of five
  consecutive local extrema E_1, …, E_5 such that"*

  ```
           ⎧ E1 is a maximum                      ⎧ E1 is a minimum
  TTOP  ≡  ⎨ E1 > E3 > E5        ,     TBOT   ≡   ⎨ E1 < E3 < E5      .
           ⎩ E2 < E4                              ⎩ E2 > E4
  ```

  **Definition 4 (Rectangle)** — *"Rectangle tops (RTOP) and bottoms (RBOT) are characterized by a sequence of five
  consecutive local extrema E_1, …, E_5 such that"*

  ```
           ⎧ E1 is a maximum
           ⎪ tops are within 0.75 percent of their average
  RTOP  ≡  ⎨ bottoms are within 0.75 percent of their average
           ⎩ lowest top > highest bottom,

           ⎧ E1 is a minimum
           ⎪ tops are within 0.75 percent of their average
  RBOT  ≡  ⎨ bottoms are within 0.75 percent of their average
           ⎩ lowest top > highest bottom.
  ```

  **Definition 5 (Double Top and Bottom)** — *"Double tops (DTOP) and bottoms (DBOT) are characterized by an initial
  local extremum E_1 and subsequent local extrema E_a and E_b such that"*

  ```
  E_a ≡ sup{ P*_{t_k} : t*_k > t*_1, k = 2, …, n }
  E_b ≡ inf{ P*_{t_k} : t*_k > t*_1, k = 2, …, n }

  and

           ⎧ E1 is a maximum
  DTOP  ≡  ⎨ E1 and E_a are within 1.5 percent of their average
           ⎩ t*_a − t*_1 > 22

           ⎧ E1 is a minimum
  DBOT  ≡  ⎨ E1 and E_b are within 1.5 percent of their average
           ⎩ t*_a − t*_1 > 22
  ```

  Two things to note, because they are load-bearing and easy to get wrong when re-implementing:
  - The rectangle test is on **"tops"** and **"bottoms"** as groups (the maxima among E1..E5 and the minima among
    E1..E5), not on named pairs — the paper does not enumerate which indices; it says "tops"/"bottoms".
  - **DBOT's third clause literally reads `t*_a − t*_1 > 22`, not `t*_b − t*_1`.** That is what is printed on p. 1718.
    It is almost certainly a typo in the published paper (the DBOT construction uses `E_b`), but I am reproducing it as
    printed rather than silently repairing it. Any re-implementation has to make a decision here and should record it.
  - The DTOP/DBOT `E_a`/`E_b` are the *global* subsequent extremum in the whole set of extrema — inside the 38-day
    window, in practice.

  Prose gloss for the double top, verbatim (p. 1718): *"Starting at a local maximum E_1, we locate the highest local
  maximum E_a occurring after E_1 in the set of all local extrema in the sample. We require that the two tops, E_1 and
  E_a, be within 1.5 percent of their average. Finally, following Edwards and Magee (1966), we require that the two tops
  occur at least a month, or 22 trading days, apart."*

  **Smoothing and extremum extraction, formally.** The estimator (their eq. 14) is

  ```
                 Σ_{s=t}^{t+l+d−1}  K_h(t − s) · P_s
  m̂_h(t)  =  ─────────────────────────────────────────── ,   t = 1, …, T − l − d + 1
                 Σ_{s=t}^{t+l+d−1}  K_h(t − s)
  ```

  with the Gaussian kernel (their eq. 10) `K_h(x) = (1 / (h√(2π))) · exp(−x² / (2h²))`.

  Extrema: *"Once the function m̂_h(τ) has been computed, its local extrema can be readily identified by finding times τ
  such that Sgn(m̂′_h(τ)) = −Sgn(m̂′_h(τ + 1))"*, disambiguated on the next page: *"If the signs of m̂′_h(τ) and
  m̂′_h(τ + 1) are +1 and −1, respectively, then we have found a local maximum, and if they are −1 and +1, respectively,
  then we have found a local minimum."* Flat-price handling: *"If m̂′_h(τ) = 0 for a given τ, which occurs if closing
  prices stay the same for several consecutive days … We look for the date s such that s = inf{s > τ : m̂′_h(s) ≠ 0}. We
  then apply the same method as discussed above, except here we compare Sgn(m̂′_h(τ − 1)) and Sgn(m̂′_h(s))."*

- **parameters**:

  | parameter | value used | verbatim quote | confidence |
  |---|---|---|---|
  | kernel `K` | Gaussian | *"for the remainder of this paper we shall use the most popular choice of kernel, the Gaussian kernel"* (p. 1711) | high |
  | window length `l` | 35 trading days | *"we set l = 35 and d = 3; hence each window consists of 38 trading days"* (p. 1718) | high |
  | detection lag `d` | 3 trading days | same quote as above; and *"d is the number of days following the completion of a pattern that must pass before the pattern is detected"* (p. 1719) | high |
  | total window `l + d` | 38 trading days | same quote | high |
  | bandwidth `h` | `0.3 × h*`, where `h*` minimizes the leave-one-out CV function `CV(h) = (1/T) Σ_t (P_t − m̂_{h,t})²` | *"we have found that an acceptable solution to this problem is to use a bandwidth of 0.3 × h*, where h* minimizes CV(h). Admittedly, this is an ad hoc approach"* (p. 1714) | high |
  | how `0.3` was chosen | by eye, before the statistics were run | *"we produced fitted curves for various bandwidths and compared their extrema to the original price series visually to see if we were fitting more 'noise' than 'signal,' and we asked several professional technical analysts to do the same. Through this informal process, we settled on the bandwidth of 0.3 × h* … This procedure was followed before we performed the statistical analysis of Section III, and we made no revision to the choice of bandwidth afterward."* (fn. 5, p. 1714) | high — and note this is the paper's own defence against a data-snooping charge on `h` |
  | shoulder/top tolerance (HS, IHS, DTOP, DBOT) | 1.5 percent of their average | see Definitions 1 and 5 | high |
  | rectangle tolerance | 0.75 percent of their average | see Definition 4 | high |
  | double-top minimum separation | 22 trading days | *"at least a month, or 22 trading days, apart"* (p. 1718) | high |
  | extremum snap window in raw prices | ±1 bar, i.e. `[τ − 1, τ + 1]` | p. 1720 | high |
  | volume-trend threshold | 1.2× | *"If τ1 > 1.2 × τ2, we categorize this as a 'decreasing volume' event; if τ2 > 1.2 × τ1, we categorize this as an 'increasing volume' event"* — comparing mean share turnover in the first vs. second half of each 5-year subperiod (p. 1729) | high |
  | bandwidth sensitivity | value: null | The paper reports **no** sensitivity analysis of results to `h`, `l`, `d`, 1.5% or 0.75%. `missing:` there is no table varying any of these; the only robustness check on the pattern side is re-drawing the stock sample once (*"we perform this sampling procedure twice to construct two samples … the results of the second sample are qualitatively consistent with the first and are available upon request"*, p. 1728). | high that it is absent |

- **measured_results**:
  - **Sample.** CRSP daily returns, **NYSE/AMEX and Nasdaq, 1962–1996**, split into **seven five-year subperiods**
    (1962–66, 1967–71, …). In each subperiod they *"randomly select 10 stocks from each of five market-capitalization
    quintiles"* → **50 stocks per subperiod × 7 subperiods = 350 securities per exchange group**. Note an internal
    inconsistency: the body text says *"at least 75 percent of the price observations must be nonmissing"* (p. 1728)
    while the Table I caption says *"at least 80% nonmissing prices"*. I am reporting both rather than picking one.
  - **Pattern frequency.** Verbatim (p. 1730–1731): *"the most common patterns across all stocks and over the entire
    sample period are double tops and bottoms … with over 2,000 occurrences of each. The second most common patterns
    are the head-and-shoulders and inverted head-and-shoulders, with over 1,600 occurrences of each. These total counts
    correspond roughly to four to six occurrences of each of these patterns for each stock during each five-year
    subperiod (divide the total number of occurrences by 7 × 50)."* Nasdaq is much sparser: *"the Nasdaq sample yields
    only 919 head-and-shoulders patterns, whereas the NYSE/AMEX sample contains 1,611."*
  - **Benchmark.** They ran the same detector on **simulated geometric Brownian motion calibrated to each stock's mean
    and standard deviation in each subperiod**. This is the base-rate control, and it is the single best design feature
    of the paper. (The extracted Table I row is too garbled for me to quote individual GBM counts reliably, so I quote
    none.)
  - **Test 1 — goodness of fit (χ², eqs. 16–17).** They bin conditional returns into the deciles of the *unconditional*
    return distribution and test whether the relative frequencies differ. Verbatim (p. 1731): *"Table V shows that in
    the NYSE/AMEX sample, the relative frequencies of the conditional returns are significantly different from those of
    the unconditional returns for seven of the 10 patterns considered. The three exceptions are the conditional returns
    from the BBOT, TTOP, and DBOT patterns, for which the p-values of the test statistics Q are 5.1 percent, 21.2
    percent, and 16.6 percent, respectively."* And: *"the results of Table VI tell a different story: there is
    overwhelming significance for all 10 indicators"* (Nasdaq).
  - **Test 2 — Kolmogorov–Smirnov.** Verbatim (p. 1752): *"Table VII shows that for NYSE/AMEX stocks, five of the 10
    patterns — HS, BBOT, RTOP, RBOT, and DTOP — yield statistically significant test statistics, with p-values ranging
    from 0.000 for RBOT to 0.021 for DTOP patterns. However, for the other five patterns, the p-values range from 0.104
    for IHS to 0.393 for TTOP, which implies an inability to distinguish between the conditional and unconditional
    distributions of normalized returns."* Nasdaq: *"here all the patterns are statistically significant at the 5
    percent level."*
  - **Volume.** Verbatim: *"The difference between the increasing and decreasing volume-trend conditional distributions
    is statistically insignificant for almost all the patterns (the sole exception is the TBOT pattern)."* Frequency
    asymmetry, however, is large: *"there are 143 occurrences of a broadening top with decreasing volume trend but 409
    occurrences of a broadening top with increasing volume trend."*
  - **Bootstrap check.** 1,000 bootstrap resamples show *"the bootstrap distribution of the Kolmogorov–Smirnov
    statistic is well approximated by its asymptotic distribution."*
  - **⚠ Distribution difference, NOT tradeable profit.** This distinction is the single most-abused thing in the
    downstream literature. The conditional return the paper measures is *one single day's* return, starting `d = 3`
    days after the pattern completes: *"conditional returns are defined as the one-day return starting three days
    following the conclusion of an occurrence of a pattern."* The authors state the limit themselves, verbatim
    (p. 1753): *"We find that certain technical patterns, when applied to many stocks over many time periods, do
    provide incremental information, especially for Nasdaq stocks. Although this does not necessarily imply that
    technical analysis can be used to generate 'excess' trading profits, it does raise the possibility that technical
    analysis can add value to the investment process."* **There is no P&L, no transaction cost, no position sizing and
    no benchmark strategy anywhere in this paper.** Anyone citing LMW as evidence that chart patterns are profitable is
    misciting it.
  - Additional caveat the authors flag: the sampling distributions of both statistics *"are derived under the
    assumption that returns are IID"*, which daily equity returns are not; they pool 50 stocks per subperiod, which
    *"does not eliminate the dependence or heterogeneity."*

- **failure_modes**:
  - **Bandwidth is the whole detector.** `0.3 × h*` was set by *"trial and error, and by polling professional technical
    analysts"*. Nothing in the paper shows the results survive a different multiplier. This is a hand-tuned free
    parameter sitting directly upstream of every reported p-value.
  - **The 38-day window silently bounds pattern duration.** *"for any fixed window, we can only find patterns that are
    completed within l + d trading days."* A 12-week base cannot be found by this configuration at all. Multi-scale
    detection requires running the whole pipeline at several `l`.
  - **The predicates are extremely permissive at short horizons.** S9 applied LMW's own definitions to rolling 20-day
    candlestick windows of SPY and found, verbatim: *"for SPY, out of all 1,463 candlestick charts in the test set,
    almost half contains the HS (718) and IHS (707) patterns"* — and a footnote confirms *"A single chart may contain
    more than one technical pattern."* Roughly half of all 20-day windows "are" a head-and-shoulders. Whatever that is,
    it is not a rare, selective signal.
  - **Kernel smoothing is non-causal inside the window.** `m̂_h(t)` at the middle of a window is a two-sided weighted
    average using bars *after* `t`. LMW handle this correctly by (a) only evaluating a *completed* window and (b)
    requiring the final extremum at `t + l − 1` and computing returns from `t + l + d` — *"the lag d ensures that we are
    computing our conditional returns completely out-of-sample and without any 'look-ahead' bias."* A naive
    re-implementation that smooths the whole series once and then scans it **will repaint and will leak**.
  - **Simple raw-price extrema do not substitute.** Verbatim (p. 1720): *"a simpler alternative is to identify local
    extrema from the raw price data directly … The problem with this approach is that it identifies too many extrema
    and also yields patterns that are not visually consistent with the kind of patterns that technical analysts find
    compelling."*
  - **Validation of the detector itself is anecdotal.** *"Casual inspection by several professional technical analysts
    seems to confirm the ability of our automated procedure to match human judgment … Of course, this is merely
    anecdotal evidence and not meant to be conclusive."* There is no labelled ground-truth set and therefore **no
    reported precision or recall for the detector**.
  - **Data-snooping exposure**: ten patterns × two exchanges × seven subperiods × five size quintiles × three volume
    conditions, tested at the 5% level with no multiple-testing adjustment. S3 and S4 (below) are the direct
    counterweight.

- **implementability**: **High**, and this is the cheapest of all the methods surveyed here.
  - Cost per symbol: for each of ~T rolling windows of 38 bars, a 38×38 Gaussian weight matrix and a derivative sign
    scan. That is `O(T · (l+d)²)` ≈ 250 × 1,444 ≈ 3.6e5 flops per symbol-year, i.e. milliseconds. Across 3,700 symbols
    × 1 year of daily bars this is seconds of CPU, single-threaded, in NumPy. **The rolling-window kernel fit is fully
    vectorisable** — the weight vector `K_h(t − s)` is identical for every window once `h` is fixed per window, so the
    smoother reduces to a convolution.
  - The real cost is the **per-window cross-validation for `h*`**, which is a 1-D optimisation with a leave-one-out
    kernel fit inside it. Two practical outs: (a) compute `h*` once per symbol per quarter rather than per window, or
    (b) fix `h` as a constant fraction of window length and treat `0.3 × h*` as a calibration target rather than a
    per-window computation. Neither is what the paper did; both should be recorded as a deviation.
  - **Needs only close prices.** LMW smooth closes and snap to extrema in `{P_t}`. Volume is used only as a
    conditioning variable, not in detection.
  - **Causal if and only if you keep their window discipline**: evaluate a window only after all `l + d` of its bars
    exist, and require the completing extremum at `t + l − 1`. Done that way it is strictly non-repainting.
  - Yes, it needs a smoothing pass — that is the method.

---

## Perceptually Important Points (PIP)

- **source**: A2 — Chung, Fu, Luk & Ng, 2001, IJCAI-01 workshop (the origin; **PDF not obtained**). A1 — Fu, Chung, Luk
  & Ng, 2007, *Engineering Applications of Artificial Intelligence* 20(3), 347–364 (abstract only). S11 —
  Phetchanchai et al., 2010, *J. Computer Science* 6(12) (**full text; this is where I take the algorithm from, and it
  is a secondary reproduction**). S12 — Zaib, Ahmed & Ali, 2004, WIT Press (full text; an independent, weaker
  implementation).

- **what it does**: a **top-down, importance-ranked compression** of a series into a small ordered set of points that a
  human eye would say "carry the shape". Unlike a zigzag (which is threshold-driven and left-to-right), PIP is
  recursive and global: you start with the endpoints and repeatedly insert the single point that is currently furthest
  from the polyline you already have. Because the output is *ranked*, one pass gives you every resolution at once —
  you just truncate the list at `k` points.

- **formal_definition**:

  Algorithm, verbatim from S11 (p. 1390): *"For a given time series T, all the data points, t1, t2, t3 … tm in T will go
  through the PIP identification process. Initially, the first two PIPs are collected from the first and the last points
  of T. The next PIP will be the point in T with the greatest distance to the first two PIPs. Subsequently, the fourth
  PIP will be the point in T with the greatest distance to its two adjacent PIPs, either between the first and second
  PIPs or between the second and the last PIPs. The process of locating the PIPs continues until all the points in T are
  attached to a list."*

  Three importance measures, verbatim from S11 (p. 1391), attributed there to Fu et al. (2008):
  *"PIP-ED (p1p3, p3p2) calculates the sum of the Euclidean distance of the test point to its adjacent important points;
  PIP-PD (p3pv) calculates the perpendicular distance between the test point and the line connecting the two adjacent
  PIPs and PIP-VD (p3pv) calculates the vertical distance between the test point and the line connecting the two
  adjacent PIPs."*

  Only the **vertical distance** is given as an equation in an open-access source I could obtain. S11 states it (with
  the absolute value deliberately removed so the sign encodes turn direction):

  ```
  VD(p3, pv) = | y_v − y_3 |
             = | ( y_1 + (y_2 − y_1) · (x_v − x_1)/(x_2 − x_1) ) − y_3 |
  ```

  where `(x_1, y_1)` and `(x_2, y_2)` are the coordinates of the points at the start and end of the segment, `p_3 =
  (x_3, y_3)` is the candidate, and `p_v = (x_v, y_v)` is the projection of `p_3` onto the line joining `p_1` and `p_2`.
  S11's variant drops the absolute value so it can read off a **Zigzag Turning Signal**: *"'+' if VD is less than 0 or
  '−' if VD is more than 0."*

  `missing:` the closed-form expressions for PIP-ED and PIP-PD are **not** reproduced in any open-access source I could
  retrieve; both are described in words only. They are elementary (sum of two Euclidean norms; point-to-line distance)
  but I am not going to write formulas the sources did not print.

  **PIP gives you points, not patterns.** A1's abstract makes the two downstream routes explicit: *"Following this
  process, both template-based and rule-based matching approaches are presented."* See the Template/rule-based section
  below.

- **parameters**:

  | parameter | value used | verbatim quote | confidence |
  |---|---|---|---|
  | number of PIPs `k` | value: null | `missing:` A1's abstract does not state a value and I could not obtain the body. S11 uses a 17-point synthetic example. The literature convention (7 points for a head-and-shoulders: start, LS, trough, head, trough, RS, end) is **not** something I could verify from a primary source. | low |
  | distance measure | all three compared (ED, PD, VD) | A1 abstract: *"The study compares three distance measurement methods—Euclidean, perpendicular, and vertical distance—for PIP identification."* | high |
  | which measure won | value: null | `missing:` the comparison result is in the body of A1, which I could not obtain. S11 chose VD without a comparative justification: *"The selected data point importance evaluation is based on the Vertical Distance (VD)."* | high that it is unreported here |
  | S12's segmentation factor | 1.5 % for stock data | *"The segmentation factor is fixed for time series belonging to each domain for example it is 1.5 % for stock data."* | high, but S12 is a weak source |
  | S12's HS point count | at least eight points | *"for Head and Shoulder Pattern there must exist at least eight points"* | high, but S12 is a weak source |

- **measured_results**: **effectively none that are usable.**
  - A1 (Fu et al. 2007) reports, per its abstract, only that *"the two matching approaches"* are complementary. No
    accuracy, no benchmark, no financial result is stated in the abstract, and I could not read the body.
  - S11's measured results are about **indexing**, not pattern detection: *"The errors of the tree building and
    retrieving compared to the original time series increased when the important points increased. The dimensionality
    reduction using ZM-Tree based on tree pruning and number of retrieved points techniques performed better when the
    number of important points increased."* Its comparison is against a Specialized Binary Tree (SB-Tree), i.e. against
    another index structure — **not against a base rate of pattern occurrence and not against any return benchmark.**
  - S12 reports no accuracy number against any base rate at all. It claims the system "provides accuracy measurements
    of discovered patterns" but publishes no confusion matrix, no random baseline, and no market test.
  - **Net: the PIP literature I could reach has no evidence that PIP-based chart-pattern detection predicts anything.**
    It is a representation/compression result, evaluated as compression.

- **failure_modes**:
  - **Non-causal by construction.** The very first step is *"the first two PIPs are collected from the first and the
    last points of T"* — the algorithm needs the end of the window before it can rank anything. Applied to a rolling
    window this is fine (the window is complete). Applied to a growing "so-far" window it **repaints on every new bar**,
    because adding a bar moves the right anchor and re-ranks everything downstream of it.
  - **No scale invariance in raw price space.** S12 names this explicitly as an open problem: *"varying scales of y
    values across and even within domains"* — Microsoft at \$50–150 vs. a \$5–10 stock. Any PIP pipeline needs
    per-window normalisation before distances mean anything.
  - **The claim that PIP removes the need for smoothing is asserted, not measured.** S12: *"No need of a smoothing
    function: When using PIPs there is no need of a smoothing function, as highly noisy data does not affect accuracy."*
    No experiment supports this in that paper. Treat it as an assertion.
  - **Fixed `k` is a shape prior.** Choosing `k = 7` for a head-and-shoulders *guarantees* every window yields seven
    points, i.e. yields a candidate. Selectivity then lives entirely in the downstream distance threshold, which is
    exactly where the false-positive rate hides.

- **implementability**: **Very high, cheapest of all.** Naive PIP is `O(k · n)` per window (each insertion scans the
  affected segment); with a heap it is `O(n log n)` for a full ranking. On 3,700 symbols × 38–120-bar windows this is
  negligible. Needs only closes (or closes + highs/lows if you want the pivots to sit on extremes). **It is not
  incremental** — you cannot update a PIP ranking as a bar arrives without recomputing, so budget one recompute per
  symbol per night, which is fine. Requires nothing beyond OHLCV.

---

## Zigzag / swing / fractal segmentation with a threshold

- **source**: S2 — Osler, 1998, FRBNY Staff Report 42 (the most rigorous academic use of a zigzag I found, including a
  disciplined answer to the threshold-selection problem). S11 — Phetchanchai et al., 2010 (zigzag ⨯ PIP hybrid).
  Contrast case: S1's kernel smoother, which is the alternative to a zigzag.

- **what it does**: convert bars into an alternating sequence of confirmed peaks and troughs by requiring a minimum
  *retracement* before a swing is accepted. A local maximum only becomes a "peak" once price has fallen by the
  threshold from it. This is the practitioner default (ZigZag indicator, Williams fractals, N-bar pivots) and it is the
  only segmenter in this file that is **causal by construction** — at the cost of a confirmation lag.

- **formal_definition**: verbatim, S2 Appendix (p. 49): *"The algorithm first transforms the price series into a zig-zag
  pattern, which comprises a series of peaks and troughs separated by a minimum required movement or 'cutoff.' For
  example, if the 'cutoff' is 5 percent, then a local maximum is labeled a peak once prices have declined by 5 percent
  from that local maximum. Similarly, a local minimum is labeled a trough once prices have risen by 5 percent from that
  local minimum."*

  Osler's head-and-shoulders predicate on top of the zigzag, verbatim (p. 49–50), which is a strictly stronger
  definition than LMW's:
  - *"It is first required that, in a series of three consecutive peaks, the second peak must be higher than either the
    first or third."*
  - **Prior trend requirement** (LMW has none): *"it is required that the peak preceding a head-and-shoulders top (LL
    peak in Figure 1) be lower than the left shoulder, and the trough preceding the pattern (LL trough) be lower than
    the first trough (left trough)."*
  - **Horizontal symmetry**: *"the number of days between the left shoulder and head is required to fall between 2.5 and
    1/2.5 times the number of days between the head and right shoulder."*
  - **Vertical symmetry**: *"the right shoulder must exceed, and the right trough must not exceed, the midpoint between
    the left shoulder and left trough. Similarly, the left shoulder must exceed, and the left trough must not exceed,
    the midpoint between the right shoulder and right trough."*

  The prior-trend requirement is the same gap that A5 (Chong & Poon 2017) later attacked in both LMW and Savin et al.,
  verbatim from its abstract: *"The algorithms in both studies ignored the relative position of the HS pattern in a
  price trend. In this paper, a filter that removes invalid HS patterns is proposed. It is found that the risk-adjusted
  excess returns for the HST pattern generally improve through the use of our filter."*

- **parameters**:

  | parameter | value used | verbatim quote | confidence |
  |---|---|---|---|
  | zigzag cutoff | **ten cutoffs, each scaled to the security's own volatility**: *"'cutoffs' used equal 6.0, 5.5, 5.0, 4.5, 4.0, 3.5, 3.0, 2.5, 2.0, and 1.5 times the standard deviation of actual daily returns"* | S2 p. 50 | high |
  | why that range | *"The top limit was chosen to ensure that there was a small but not negligible chance of finding a head-and-shoulders pattern of that size for each firm. The bottom limit was chosen to exceed the daily standard deviation of returns to ensure that upward and downward trends would be distinguished from ordinary daily variation."* | S2 p. 50 | high |
  | multi-scale de-duplication | *"Each time the data are scanned with a new cutoff, duplicate head-and-shoulders signals are eliminated. In particular, if a head-and-shoulders pattern using one cutoff implied entering a position two days before or after a previously identified entry date, the new position was not included."* | S2 p. 50 | high |
  | horizontal symmetry ratio | base case (2.5, 1/2.5); sensitivity runs at (3.5, 1/3.5) and (1.5, 1/1.5) | S2 p. 53 | high |
  | stop loss | 1 percent | *"A 'stop loss' of one percent is established, consistent with general market practice."* | high |
  | bounce tolerance | 25 percent of the measuring objective | *"the short position is maintained even after the first trough has been identified, if that trough occurs before the price has declined by at least 25 percent of the measuring objective"* | high |
  | pivots on close vs. high/low | base case uses closes; a sensitivity run uses highs/lows: *"To identify head-and-shoulders tops the basic algorithm is modified to require that the peaks in the pattern be found in the highs, and that between each peak in the highs there be at least one trough in the lows. The neckline is constructed from the troughs in the lows."* | S2 p. 54 | high |
  | sensitivity reported? | **yes** — seven baseline modifications plus three more, and *"These modifications leave the central results essentially unchanged (Table 3)."* | S2 p. 24 | high |

- **measured_results** (S2):
  - Sample: **100 U.S. firms, daily prices, from 2 July 1962** (period stated in the Table 1 caption); the split-sample
    robustness test cuts at 30 June 1977, described as *"roughly the midpoint of the entire sample period."*
  - Detection rate: *"The head-and-shoulders identification algorithm finds about 27 confirmed head-and-shoulders"*
    per firm across the sample, i.e. *"the head-and-shoulders identification algorithm locates only about one confirmed
    pattern per year per firm."* Compare LMW's four-to-six per stock per five years — different definitions, similar
    order of magnitude, both far below S9's "half of all 20-day windows."
  - **Volume result (positive):** neckline-crossing days carry abnormal volume — *"unusual trading volume averages 11
    percent of a day's trading volume on neckline-crossing days"*, statistically significant *"lower than 1.0E-4"*, and
    *"Unusual trading activity is positive and statistically significant on the neckline-crossing day itself and the two
    subsequent days."* So the pattern is real in the sense that **people trade it**.
  - **Profit result (negative):** verbatim (p. 23): *"The results uniformly suggests that head-and-shoulders trading is
    not profitable. Average profits per position are actually negative, at −0.24 percent (on positions held for an
    average of 10 business days). Average profits in the simulated data are −0.03 percent."* Under Test One the
    difference is not significant: *"the marginal significance of the actual profit value, shown in Table 3, is 0.12."*
    Under Test Two: *"the set of 100 p-values generated for this test are not concentrated at low values, as they would
    be if the pattern successfully predicts trend reversals … there is no suggestion here that the pattern produces
    positive profits if used according to the recommendations of technical analysts."*
  - **Benchmark used**: 10,000 bootstrap-simulated price series per firm (plus AR(1) and AR(1)+GARCH(1,1) variants and a
    volume-autocorrelation model), with the *same* identification and profit-taking algorithms run on each. This is a
    correctly-specified base rate, and it produces the file's most useful warning: *"average simulated profits are
    negative about 80 percent of the time, a proportion that would be extremely unlikely in such a large sample if the
    probability of negative profits were 50 percent."* **A pattern-triggered strategy has a negative expected P&L even
    on data where the pattern is definitionally meaningless.** Any backtest without this control will mistake a
    mechanical drag for a signal — with the sign pointing the wrong way.

- **failure_modes**:
  - **Repainting is *not* a property of the zigzag definition — it is a property of a bad implementation.** Osler's
    definition is explicitly forward-confirming: a peak exists only *after* price has retraced the cutoff. Charting
    packages repaint because they draw the *provisional* last leg. The engineering rule follows directly: **the last
    pivot is never confirmed; only pivots with a completed opposite move are usable.**
  - **The confirmation lag is the cutoff.** A 5% cutoff means you learn about the peak somewhere between 1 bar and many
    bars after it occurred, and the lag is state-dependent (it depends on how fast price retraced). This is a real,
    unavoidable information delay that must be modelled in any backtest.
  - **Threshold selection is the whole game and there is no principled answer.** Osler's response — scale the cutoff to
    the security's own daily return standard deviation and sweep ten of them — is the best-argued answer I found in the
    literature. It also multiplies your detection count by up to ten, hence his explicit de-duplication rule.
  - **Sweeping thresholds is data-snooping unless the sweep is inside the test.** Osler avoids this by running *every*
    cutoff on *every* simulated series too, so the multiplicity is priced into the null.
  - **Pivot-on-close vs. pivot-on-high/low changes the pattern set.** Osler treats this as a sensitivity axis, not a
    detail. Decide once and rail it.
  - The arXiv note *Data mining and time series segmentation via extrema* (arXiv:2009.09895, 2020, in French) makes the
    same point independently: its abstract concludes that the illustrations *"underline the importance of the choice of
    a threshold for the extrema detection."* I did not read the body.

- **implementability**: **Highest of any method here.** A zigzag is a single left-to-right `O(n)` pass with two state
  variables (current direction, current extreme). Ten cutoffs = ten passes = still `O(n)`. Across 3,700 symbols ×
  ~5,000 daily bars this is well under a second of Python-with-NumPy and trivial in a compiled loop. **Fully incremental
  and fully causal**: you can update it one bar at a time and never revise a confirmed pivot. Needs no smoothing pass.
  Needs only OHLC (closes suffice; highs/lows optional and better). This is the primitive to build first.

---

## Dynamic Time Warping (DTW)

- **source**: S6 — Keogh & Ratanamahatana, 2005, *KAIS* 7(3) (formal definition, constraints, lower bound). S7 —
  Ratanamahatana & Keogh, 2004 (the myth-busting empirical study). A6 — Tsinaslanidis & Guijarro, 2020, *Expert
  Systems* (abstract only; the best financial application I located).

- **what it does**: an elastic distance between two sequences that allows non-linear alignment on the time axis, so a
  6-week and a 10-week version of the same shape can score as similar. In chart-pattern terms it turns "does this window
  match my head-and-shoulders template?" into a number.

- **formal_definition** (S6, §2.1, verbatim structure):

  Build an `n × m` matrix whose `(i, j)` element is `d(q_i, c_j) = (q_i − c_j)²`. A warping path `W` is a contiguous set
  of matrix elements:

  ```
  W = w_1, w_2, …, w_k, …, w_K        with   max(m, n) ≤ K < m + n − 1        (eq. 3)
  ```

  subject to, verbatim:
  - *"**Boundary conditions**: w_1 = (1, 1) and w_K = (m, n). This requires the warping path to start and finish in
    diagonally opposite corner cells of the matrix."*
  - *"**Continuity**: Given w_k = (a, b), then w_{k−1} = (a′, b′), where a − a′ ≤ 1 and b − b′ ≤ 1. This restricts the
    allowable steps in the warping path to adjacent cells (including diagonally adjacent cells)."*
  - *"**Monotonicity**: Given w_k = (a, b), then w_{k−1} = (a′, b′), where a − a′ ≥ 0 and b − b′ ≥ 0. This forces the
    points in W to be monotonically spaced in time."*

  ```
  DTW(Q, C) = min  { sqrt( Σ_{k=1..K} w_k ) }        (eq. 4)
  ```

  solved by the standard dynamic-programming recurrence `γ(i, j) = d(i, j) + min{ γ(i−1, j−1), γ(i−1, j), γ(i, j−1) }`.

  Global constraints: the **Sakoe–Chiba Band** (a fixed-width diagonal corridor) and the **Itakura Parallelogram**.
  The band width `r` also supplies the exact lower bound: S6 states the guarantee holds *"given a constraint on the
  warping path of the form j − r ≤ i ≤ j + r"* (this is `LB_Keogh`, which is what makes DTW indexable).

- **parameters**:

  | parameter | value used | verbatim quote | confidence |
  |---|---|---|---|
  | warping-window width | **measured optimum is very small: 1–10%**, per dataset | S7 Table 2 reports the window size giving max accuracy per dataset: Face 3%, Gun 3%, Leaf 10%, Syn_contrl_chrt 8%, Trace 1%, TwoPatterns 3%, Wordspotting 3%. Text: *"All accuracies peak at very small window sizes."* | high |
  | the conventional 10% band | S7 flags it as inherited without evidence: *"the 10% constraint on warping inherited blindly"* | high |
  | is more warping better? | **No.** *"wider warping constraints do not always improve the accuracy, as commonly believed. More often, the accuracy peaks very early at much smaller window size … In essence, the results can be summarized by noting that a little warping is a good thing, but too much warping is a bad thing."* | high |
  | window depends on dataset size | *"As the database size decreases, the classification accuracy also declines and the peak appears at larger warping window size … we should find the best warping window size on realistic (for the task at hand) database sizes, and not try to generalize from toy problems."* | high |
  | variable-length handling | reinterpolate to equal length; **no measurable penalty**: *"comparing sequences of different lengths and reinterpolating them to equal length produce no statistically significant difference in accuracy or precision/recall."* | high |

- **measured_results**:
  - S7's evidence base: seven classification datasets, 1-NN with leave-one-out, warping window swept 0%→100%. The
    strongest negative claim, verbatim: *"While it is possible that there exist some datasets somewhere that could
    benefit from wider constraints, we found no evidence for this in a survey of more than 500 papers on the topic. More
    tellingly, in spite of extensive efforts, we could not even create a large synthetic dataset for classification that
    needs more than 10% warping."*
  - Speed: *"the amortized CPU cost of DTW is essentially O(n) if we use the trivial 4S technique"* (lower-bounding with
    the warping-window envelope), and *"with the introduction of lower bounding based on warping constraints (i.e. 4S),
    the speedup is now highly nonlinear in the size of the warping window."*
  - **Financial application, A6 (abstract only, verbatim)**: Tsinaslanidis & Guijarro use *"A fast version of dynamic
    time warping, the University College Riverside subsequence search suite (called the UCR suite)"* over *"560 NYSE
    stocks"*, reporting *"results obtained by the different parameter configurations … controlling for both
    data-snooping and transaction costs. On average, the proposed system dominates the market index in the mean–variance
    sense. Although transaction costs reduce the profitability of the proposed trading system, 92.5% of the experiments
    are profitable if the analysis is reduced to the parameter values aligned with the technical analysis."* Note the
    conditional in that last clause: 92.5% is *after* restricting to the parameter subset the authors judged
    "aligned with technical analysis" — that restriction is itself a selection, and the abstract does not state the
    unrestricted figure. **This is an abstract-only citation; I did not verify the body.**
  - **⚠ None of the DTW literature above reports a base rate for chart-pattern detection.** S6/S7 report classification
    accuracy on labelled UCR benchmarks (where the base rate is `1/#classes` and known); they say nothing about how
    often a "head-and-shoulders template" matches random data.

- **failure_modes**:
  - **DTW will always return a nearest match.** It is a distance, not a detector. Selectivity comes entirely from a
    threshold you choose, and there is no principled way to set it. A random-data null (Osler-style) is mandatory.
  - **Pathological alignment.** Without a band constraint, DTW can map one point of `Q` onto a long run of `C`, matching
    a flat base to a spike. This is precisely why the measured optimum band is 1–10%, and why unconstrained DTW is
    both slower and *less* accurate.
  - **Amplitude and level.** DTW warps time, not price. Two windows at different price levels or volatilities need
    z-normalisation first, and z-normalisation of a flat window amplifies noise into apparent shape.
  - **Template provenance.** DTW needs reference series. S10 puts the objection plainly: *"To use this algorithm, we must
    use reference time series, which have to be selected by a human. The references must generalize well when compared
    with signals similar to the pattern in order to capture the whole range."* Hand-picked templates are a snooping
    surface.
  - **Non-causality is in how you slide it, not in DTW itself.** Subsequence DTW over a completed trailing window is
    causal. Subsequence DTW that is allowed to choose its own endpoint inside the window is not.

- **implementability**: **Medium-to-poor at this scale, and almost certainly not worth it for a base scanner.**
  - Raw cost: `O(n·m)` per (window, template) pair. Sliding a 60-bar template over 5,000 bars for 3,700 symbols with,
    say, 12 templates = 3,700 × 5,000 × 12 × 3,600 cell evaluations ≈ 8e11. That is hours-to-days in NumPy.
  - With a Sakoe–Chiba band of `r = 5%` and `LB_Keogh` cascade pruning (the UCR suite, which A6 uses precisely for this
    reason — *"in an effort to produce trading signals in realistic timescales"*) the amortized cost drops toward `O(n)`
    per comparison and it becomes feasible overnight in a compiled implementation. In pure Python it will not be.
  - Needs z-normalised closes; nothing beyond OHLCV. Needs no smoothing pass (DTW is itself noise-tolerant in the time
    axis but *not* in the amplitude axis).
  - **Verdict: use DTW only as a second-stage scorer on candidates already produced by a cheap structural filter, never
    as the first-stage scan.**

---

## Shapelets (learned discriminative subsequences)

- **source**: S5 — Ye & Keogh, 2009, KDD.

- **what it does**: instead of matching a whole series against a template, **learn** the single short subsequence whose
  *distance profile* best splits the classes, and classify by "how close does this series get to that subsequence?".
  In chart terms: instead of asserting "a head-and-shoulders predicts a decline", let the data find whatever 15-bar
  fragment most separates future-up from future-down.

- **formal_definition**: the shapelet is chosen to maximise information gain. S5's Definition 7: *"**Information Gain.**
  Given a certain split strategy"* the algorithm computes the entropy reduction of partitioning the dataset by
  `Dist(T, S) < split_dist`. The full brute-force procedure: generate every subsequence of every length in `[MINLEN,
  MAXLEN]` from every training series as a candidate; for each candidate compute its distance to every training series
  (`Dist(T, S) = min over all subsequences of T of the Euclidean distance`); build the distance histogram; take the
  `split_dist` maximising information gain; keep the best-so-far. Two accelerations: **subsequence distance early
  abandon** and **admissible entropy pruning** (an upper bound on achievable information gain lets you abandon a
  candidate mid-scan).

- **parameters**:

  | parameter | value used | verbatim quote | confidence |
  |---|---|---|---|
  | candidate length range | `MINLEN`…`MAXLEN`, user-set | S5 §3.1 pseudocode | high |
  | split criterion | information gain (entropy) | *"We adopted the entropy evaluation for two reasons. First, it is easily generalized to the multi-class problem. Second … we can use a novel idea called early entropy pruning to avoid a large fraction of distance calculations required when finding the shapelet."* | high |
  | brute-force complexity | `O(m³k²)` for `k` series of average length `m` | *"the size of the candidate set is O(m²k). Checking the utility of one candidate takes O(mk). Hence, the overall time complexity of the algorithm is O(m³k²), which makes the real-world problems intractable."* | high |
  | speedup achieved | *"Both ideas combined almost linearly to produce three orders of magnitude speedup."* | high |

- **measured_results**: **all on non-financial UCR-style benchmarks with a stated 1-NN benchmark** — which is exactly
  the right way to report and exactly what the financial pattern literature does not do:
  - Projectile points: *"The shapelet decision tree classifier achieves an accuracy of 80.0%, whereas the accuracy of
    rotation invariant one-nearest-neighbor Euclidean distance classifier … is only 82.9%"*, but *"the classification
    result 3×10³ times faster than the rotation invariant"* baseline.
  - Heraldic shields: *"The holdout accuracy for the decision tree is 93.3%"* against a 1-NN baseline of *"91.3%"*.
  - Another dataset reports *"0.85 accuracy 91.1%"* and a wheat-spectrography result of *"The accuracy of the decision
    tree is 72.6%"*. (The two-column PDF interleaves these; I am reporting only the pairs I could read unambiguously.)
  - **No financial data, and no chart-pattern result of any kind, appears in S5.** Applying shapelets to price is an
    extrapolation, not a replication.

- **failure_modes**:
  - **Shapelets are a supervised method and therefore inherit every label-leakage risk.** If your label is "next 20-day
    return" and your candidate subsequences are drawn from overlapping windows across the same period, the same bars
    appear in both the feature and the label neighbourhood.
  - **Massive multiple comparisons.** `O(m²k)` candidates each evaluated for information gain, with the best kept. This
    is White's Reality Check problem (S3) in its purest form — the shapelet *is* the "best rule chosen from a large
    universe" — and S5 does not correct for it, because on UCR benchmarks it does not need to (there is a held-out set
    and a real class structure). On financial data there is no comparable held-out structure.
  - **Overlapping-window trivial matches.** See the next section: on a sliding-window financial series, the candidate
    pool is dominated by near-duplicates of smooth regions, which biases *which* shapelet wins.
  - **Interpretability is the selling point but not a guarantee of validity.** A shapelet that "looks like a flag" and
    splits the training set is still just the argmax over `O(m²k)` candidates.

- **implementability**: **Low for a nightly full-universe scan.** Even with three orders of magnitude of speedup, the
  training step is a batch offline job, not a nightly one. *Inference* is cheap (`Dist(T, S)` for a handful of learned
  shapelets is `O(n·|S|)` per symbol, i.e. milliseconds). The realistic shape is: learn shapelets offline, quarterly,
  on a strict train/validation/test time split; score nightly. Needs z-normalised closes. Needs no smoothing.

---

## Sliding-window subsequence extraction (the trivial-match trap)

- **source**: S8 — Keogh & Lin, 2003/2005. This is not a detection method; it is the **failure mode that sits under**
  every method in this file that extracts overlapping windows and then clusters, mines, or ranks them.

- **what it does / what it breaks**: if you take a price series, cut every overlapping `w`-bar window with a sliding
  window, and then cluster or mine those windows for "recurring shapes", the result is an artefact of the sliding window
  itself, not of the data.

- **formal_definition**:
  - *"**Definition 3. Sliding Windows**: Given a time series T of length m, and a user-defined subsequence length of w"*
    — extract all `C_p = t_p, …, t_{p+w−1}` for `1 ≤ p ≤ m − w + 1`.
  - *"**Definition 4. Trivial Match**: Given a subsequence C beginning at position p, a matching subsequence M beginning
    at q, and a distance R, we say that M is a trivial match to C of order R, if either p = q or there does not exist a
    subsequence M′ beginning at q′ such that D(C, M′) > R, and either q < q′ < p or p < q′ < q."*
  - *"**Theorem 1**: For any time series dataset T with an overall trend of zero, if T is clustered using sliding
    windows, and w << m, then the mean of all the data (i.e. the special case of k = 1), will be an approximately
    constant vector."*
  - Consequence, verbatim: *"In fact, for w << m, we get approximate sine waves with STS clustering regardless of the
    clustering algorithm, the number of clusters, or the dataset used!"* and the headline: *"clusters extracted from
    these time series are forced to obey a certain constraint that is pathologically unlikely to be satisfied by any
    dataset, and because of this, the clusters extracted by any clustering algorithm are essentially random."*
  - The bias mechanism, verbatim: *"smooth, slowly changing subsequences tend to have many trivial matches, whereas
    subsequences with rapidly changing features and/or noise tend to have very few trivial matches."* So density in
    `w`-space is a function of local smoothness, not of pattern recurrence.
  - The repair they propose is **motifs with a non-trivial-match requirement**: *"**Definition 5. K-Motifs**: Given a
    time series T and a distance range R, the most significant motif in T (called 1-Motif) is the subsequence C1 that
    has the highest count of non-trivial matches"*, with successive motifs required to satisfy `D(C_J, C_i) > 2R`.

- **parameters**: `w` (window length), `R` (match radius). S8 illustrates with *"R = 1, w = 64"*. No universal values;
  the paper's point is that the *method* is broken, not that the constants are wrong.

- **measured_results**: *"a comprehensive set of experiments on reimplementations of previous work"*, concluding *"it
  invalidates the contribution of dozens of previously published papers."* The measured object is cluster-centre
  stability across datasets, not a return.

- **failure_modes**: this section *is* the failure mode. Direct consequences for a chart-pattern scanner:
  1. **Never rank patterns by "how often this shape recurs" over overlapping windows.** The count is dominated by
     trivial matches and therefore by smoothness.
  2. **Overlapping detections of the same structure are near-duplicates, not independent events.** Osler's
     de-duplication rule (*"if a head-and-shoulders pattern using one cutoff implied entering a position two days before
     or after a previously identified entry date, the new position was not included"*) is the correct antidote, and it
     must also be applied across the *bar-offset* axis, not only across the threshold axis.
  3. **Any statistic computed over overlapping windows has an effective `n` far below its nominal `n`.** LMW's IID
     caveat and Osler's independence check on 4,950 pairwise correlations are both responses to this.

- **implementability**: n/a — this is a constraint on design, not a component to build.

---

## Template matching vs. rule-based matching

- **source**: A1 — Fu, Chung, Luk & Ng, 2007, *EAAI* 20(3), 347–364 (**abstract only**). Supporting: S1 (the canonical
  rule-based system), S10 (a rule-based detector used as a label generator).

- **what it does**: the two families that sit downstream of any segmenter.
  - **Template-based**: define an idealised numeric shape (a vector of `k` normalised values), reduce the candidate
    window to the same `k` points (via PIP or resampling), and compute a distance. Membership = distance < threshold.
  - **Rule-based**: define the pattern as a conjunction of ordinal and ratio predicates over the pivots (LMW's ten
    definitions; Osler's symmetry constraints). Membership = all predicates true.

- **formal_definition**: A1 states the design problem verbatim: *"It is necessary to locate the technical patterns in
  the stock price movement charts to analyze the market behavior"* — with two central obstacles, *"defining preferred
  patterns for queries and matching pattern templates across different resolutions"*, solved by *"identif[ying]
  perceptually important points (PIPs) directly from time domain data, enabling comparison of sequences with varying
  lengths."* The two matching families are presented as complementary: *"the experimental results demonstrate that
  these two matching strategies offer complementary pathways for achieving pattern identification objectives."*

  The canonical worked rule-based formalisation is LMW Definitions 1–5, reproduced in full above. I found **no**
  paper that publishes a template-based head-and-shoulders as an explicit numeric vector with a distance threshold and a
  measured false-positive rate.

- **parameters**:

  | parameter | value used | verbatim quote | confidence |
  |---|---|---|---|
  | distance measure for template matching | Euclidean / perpendicular / vertical compared | A1 abstract (see PIP section) | high |
  | acceptance threshold | value: null | `missing:` not stated in A1's abstract; body not obtained. This is the parameter that controls the entire false-positive rate. | high that it is unavailable here |
  | resolution `k` | value: null | `missing:` same | high |

- **measured_results**: A1's abstract reports **no accuracy, no benchmark, no base rate, and no financial outcome** —
  only that the two approaches are complementary and *"distinctive in their intuitiveness."* I am flagging this
  explicitly because A1 is the most-cited paper on this exact comparison and it is routinely cited downstream as if it
  established that PIP+template matching works.

  What *is* measured, elsewhere:
  - **Rule-based (LMW, S1)**: return-distribution differences, no profit. See above.
  - **Rule-based with a stronger trend filter (A5, Chong & Poon 2017, abstract only)**: *"It is found that the
    risk-adjusted excess returns for the HST pattern generally improve through the use of our filter."* No magnitude in
    the abstract.
  - **Rule-based, tested for profit (S2, Osler)**: −0.24% average per position, not significantly different from a
    simulated null of −0.03%.
  - **Rule-based with LMW's algorithm plus analyst-derived filters (A3, Savin/Weller/Zvingelis 2007, abstract
    verbatim)**: *"We use the pattern recognition algorithm of Lo, Mamaysky, and Wang (2000) with some modifications …
    The modifications include the use of filters based on typical price patterns identified by a technical analyst. With
    data from the S&P 500 and the Russell 2000 over the period 1990–1999 we find little or no support for the
    profitability of a stand-alone trading strategy. But we do find strong evidence that the pattern had power to
    predict excess returns. Risk-adjusted excess returns to a trading strategy conditioned on 'head-and-shoulders' price
    patterns are 5–7% per year."* Note the internal tension the abstract itself states: **no stand-alone profitability,
    but 5–7%/yr risk-adjusted excess return when conditioned on the pattern and combined with the market portfolio.**
    That is a conditioning result, not a stand-alone trading result, and the abstract is careful about it.

- **failure_modes**:
  - **Template matching hides its selectivity in one scalar.** Every window has *some* distance to the template; the
    threshold alone decides the hit rate. Without a random-data null you cannot tell a 2% hit rate from a 40% one.
  - **Rule-based systems fail loudly (good) but are brittle at the boundary.** S10 states the objection verbatim: *"If
    the pattern is slightly outside of the defined bounds, it will not be detected, even if a human would have
    classified it otherwise."*
  - **Rule-based tolerances are unaudited free parameters.** LMW's 1.5% and 0.75% have no sensitivity analysis. Osler's
    symmetry ratios do (2.5 → 3.5 → 1.5), and the results held.
  - **Rule sets omit the prior trend.** Both LMW and Savin et al. do; A5 is the correction. For a *base* scanner this is
    the single most important omission — a "cup and handle" that did not follow an advance is not a base.

- **implementability**: **Both are cheap once you have pivots.** Rule-based evaluation over 5 pivots is a handful of
  comparisons per candidate — effectively free. Template matching over `k` normalised points is `O(k)` per candidate.
  Both are causal if the pivots are causal. Both need only OHLCV. **Rule-based is strongly preferred for a production
  scanner** because every rejection is attributable to a named predicate, which makes the detector auditable and makes
  a per-predicate rejection census possible.

---

## Image-based CNN classification of price charts

- **source**: A4 — Jiang, Kelly & Xiu, 2023, *Journal of Finance* 78(6) (**abstract only**, Wiley 403). S9 — Zhang, Zhao
  & Lin, 2023, *The European Journal of Finance* (full text) — which cites and extends JKX and, crucially, **reports its
  own base rate**.

- **what it does**: render the price history as a picture (candlesticks, or a Gramian Angular Field encoding) and train
  a convolutional network to predict the sign of the next period's return directly from pixels — no pattern definitions
  at all. The pattern vocabulary is learned, not declared.

- **formal_definition**: there is none in the pattern-definition sense; the model is the definition. S9 does the one
  useful bridge: it takes **LMW's Definitions 1–3 verbatim** and uses them to label its own windows post hoc, in order
  to interpret what the CNN learned — *"We use the mathematical definitions of the technical patterns given by Lo,
  Mamaysky, and Wang (2000), which we include in Appendix."*

  Image construction (S9): candlesticks converted to binary images, then contour-enhanced by a distance transform —
  for each pixel `p`, `d(p)` is *"the minimum distance between pixel p in the binary candlestick image and all
  foreground (candlestick) pixels"*, then normalised. Second encoding is the Gramian Angular Field: *"We construct a
  GAF image with T × T pixels by considering the trigonometric sum between each"* pair of time points.

- **parameters**:

  | parameter | value used | verbatim quote | confidence |
  |---|---|---|---|
  | window length (S9) | 20 days | *"all candlestick charts of that ETF (i.e. all 20-day periods)"* | high |
  | image size (S9) | 112 × 64 pixels | *"To feed the data into the convolutional neural network, these images are resized and cropped to 112 × 64 pixels."* (endnote 7) | high |
  | split (S9) | 64% / 16% / 20%, chronological | *"we divide the data into a training set (64%), a validation set (16%), and a test set (20%) chronologically"* | high |
  | sample (S9) | 3 ETFs, from 29 Jan 1993 (SPY), 21 Sep 2004 (2833.HK), 23 Feb 2005 (510050.SS) to 10 Feb 2022 | *"February 10, 2022. Specifically, the starting date is January 29, 1993 for SPY, September 21, 2004 for 2833.HK, and February 23, 2005 for 510050.SS."* | high |
  | training cost (S9) | 6.32 h for SPY candlestick model (Table 6), on *"a laptop equipped with an Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz"* | high |
  | transaction costs | **yes, included** | *"the out-of-sample Sharpe ratios range from 1.57 to 3.03 after accounting for transaction costs"* | high |

- **measured_results**:
  - **A4 (JKX), abstract verbatim, no numbers in the abstract**: *"Our predictor data are stock-level price charts,
    allowing us to extract the most predictive price patterns using machine learning image analysis techniques. These
    patterns differ significantly from commonly analyzed trend signals, yield more accurate return predictions, enable
    more profitable investment strategies, and demonstrate robustness across specifications. Remarkably, they exhibit
    context independence, as short-term patterns perform well on longer time scales, and patterns learned from U.S.
    stocks prove effective in international markets."* **I could not obtain the body, so I report no accuracy, Sharpe,
    or cost figure for JKX.** Do not let anyone quote a number from JKX through this file.
  - **S9 (Zhang et al.) — this is the one that reports its base rate, and it is the most important number in this
    section:**
    - Headline accuracy: *"the CS-ACNN using candlestick charts as model input has an out-of-sample accuracy of 0.573
      (Table 4) and a high Sharpe ratio of 1.78 (Table 5) for long-short strategy when investing in SPY"*.
    - **Base rate, verbatim**: *"a naïve buy-and-hold strategy can obtain an accuracy of 0.56215 and a Sharpe ratio of
      only 0.87"*, with the arithmetic spelled out in endnote 15: *"The buy-and-hold strategy is equivalent to
      classifying all samples into 'up'. Table 1 shows that there are 822 'up' days and 641 'down' days for SPY in the
      test set, implying an accuracy of 822/(822 + 641) = 0.562."*
    - **So the model's edge over always-predicting-up is 0.573 − 0.562 = 1.1 percentage points on a test set of 1,463
      days.** The paper is candid about this: *"This comparison implies that a mere 1% increase in accuracy yields an
      improvement of 0.91 in the Sharpe ratio."* Whether 1.1pp on n = 1,463 is distinguishable from noise is **not
      tested in the paper** — no confidence interval on accuracy is reported.
    - Profitability, verbatim: *"the long-short strategies based on the best CS-ACNN models reach an annualized return
      of 33.95%, 51.24%, and 62.12%, for SPY, 2833.HK, and 510050.SS respectively. The Sharpe ratios for these scenarios
      reach as high as 1.78, 2.46, and 3.03 … after accounting for transaction costs."*
    - Honest negative result, verbatim: *"except for the CS-ACNN model, all other models' annual returns underperform
      the buy-and-hold strategy for SPY when accounting for transaction costs."*
    - **The chart-pattern breakdown (Table 7), which is the most useful thing here for a base scanner**: applying LMW's
      definitions to the 1,463 SPY test windows gives HS 718, IHS 707, BTOP 198, BBOT 84, TTOP 123, TBOT 178, with
      per-pattern CS-ACNN accuracies of 0.570, 0.576, 0.551, 0.560, 0.561, 0.573 respectively — against the 0.573 "All"
      accuracy and the 0.562 base rate. **Conditioning on any LMW pattern moves accuracy by less than the base rate's
      own margin.** The paper reads this positively (*"the accuracies for all patterns across all ETFs are above
      0.55"*); read against the 0.562 base rate, several of those per-pattern accuracies are *below* always-predicting-
      up.

- **failure_modes**:
  - **Base-rate blindness is the standard failure of this literature.** S9 is the exception, and only because the labels
    are directional and the "always up" baseline is obvious. When the label is "does a pattern exist", nobody publishes
    the prior.
  - **Rendering is a lossy, arbitrary encoding.** S9 notes CNN inputs from line charts are *"sparse binary matrices with
    few values set to one"* — S10 independently found the same thing kills 2-D CNN performance. Pixel size, axis
    scaling, and whether the y-axis is per-window normalised are all free parameters that change results.
  - **Chronological split is necessary but not sufficient.** S9 does split chronologically (good). But a 20-day image
    ending on day `t` overlaps 19 of the images ending on days `t−19 … t−1`; near the train/test boundary these straddle
    the split. The paper does not describe an embargo/purge gap.
  - **Selection over architectures.** S9 reports six image configurations plus SVM, LSTM, 1-D CNN comparators, and
    picks the best. That is a small Reality Check universe with no adjustment.
  - **Three ETFs is not a cross-section.** SPY, 2833.HK, 510050.SS — a Sharpe of 3.03 on one index ETF's daily
    directional bet over a 20% tail of a 17-year sample is a small-`n` result.

- **implementability**: **Poor as a chart-pattern *detector*, plausible as a separate return-prediction model.**
  - Training: 6.32 GPU-less hours for **one** ETF (S9 Table 6). For 3,700 symbols you would train one pooled model, not
    3,700 — but pooled training on 3,700 × 5,000 daily 112×64 images is a real GPU job, not a nightly cron.
  - Inference: rendering 3,700 images plus a forward pass is seconds. That part is fine.
  - **It does not tell you *what* pattern is present** — you get a probability, not a labelled structure. For a screener
    whose product is "here are the stocks forming a base", a CNN is the wrong output type.
  - Needs OHLCV only (S9 also uses volume in the chart).

---

## CNN/LSTM detectors trained on rule-based labels

- **source**: S10 — Velay & Daniel, 2018, arXiv:1808.00418 (Lusis).

- **what it does**: train neural nets to reproduce the output of a hand-coded pattern detector, in the hope that the net
  generalises to variants the hard rules miss. This is the design most likely to be reached for by an engineering team,
  and it has an instructive circularity problem.

- **formal_definition**: none published — the target pattern is defined by the authors' own undisclosed hard-coded
  detector.

- **parameters**: LSTM: *"a single layer of 10 units"*, sliding window of *"a time-frame of 30 minutes"* on normalised
  OHLCV. Class balance was **forced to 50/50**: *"During training, we downsampled the amount of examples without a
  pattern in order to have a 50% distribution of both negative and positive occurrences."* Validation set: 1,536
  samples.

- **measured_results**, verbatim:
  - LSTM: *"we had a recall of 96.8%, where 50% is the accuracy of randomly picking positive or negative. … When testing
    on 1536 samples, from the validation set, the model only predicted 2 false positives. This is a 0.13% false positive
    rate. The false negative rate was 1.4%."*
  - 2-D CNN on charts: *"Using line charts, the best recall rate we found is 71%. … Using OHLC candlestick … the best
    recall rate we found was 73%."*
  - 1-D CNN: *"we only reached a 64% recall rate."*
  - Their own summary table: LSTM recall 0.97 / generalization 0.3%; 2-D CNN 0.73; 1-D CNN 0.64.
  - Cross-symbol transfer failed outright: *"We attempted to test the model on unrelated data, stock from another
    company. This gave us very poor results, which leads us to believe a trained model from one type of dataset will not
    generalize well to other datasets, even though we are looking for the same pattern and the data has been
    normalized."*
  - Their own verdict on CNNs: *"We must conclude that CNN models do not provide better detection rates than hard-coded
    algorithms."*
  - **Base rate is explicit and it is 50% by construction** — the authors downsampled to make it so. The 96.8% is
    therefore against a 50% coin, but on an artificially balanced set; the *real* prevalence of the pattern in the tape
    is never reported, so the operational false-positive rate is unknown.

- **failure_modes**: this paper is a catalogue of them, stated by its own authors:
  - **Circular labels.** *"There are no pre-existing datasets with labeled patterns that could be found and we had to
    create them. The best way to do this regarding speed and quality was by building an hard-coded detector."* The
    ceiling of such a model is the rule-based detector it imitates. Their measured "generalization" — the fraction of
    detections *beyond* the hard-coded set — was **0.3%**.
  - **Metric contamination.** *"a part of the false positives were in fact true positives, which is most likely due to
    the hard-coded algorithm's parameters … That's why false negative and false positive must be fixed manually before
    to compute the confusion matrix."* Manually correcting the confusion matrix after seeing it is not a clean
    evaluation.
  - **Downsampled class balance destroys the operational error rate.** A 0.13% FPR on a 50/50 set becomes a very
    different number when the true prevalence is 1%.
  - **No transfer across symbols.**

- **implementability**: low value. You must build the rule-based detector first (which is then the thing you should
  ship), and the incremental yield measured here was 0.3%.

---

## Data-snooping adjustment (White's Reality Check)

- **source**: S3 — Sullivan, Timmermann & White, 1999, *Journal of Finance* (LSE FMG DP303 working-paper version read in
  full). Not a detection method — the **statistical discipline that governs whether any detected pattern's backtest
  means anything.**

- **what it does**: when you pick the best rule out of a universe of `l` rules, its apparent performance is the maximum
  of `l` dependent random variables. The Reality Check bootstraps the distribution of that maximum under the null,
  accounting for the dependence between rules, and returns a single p-value for "the best rule does not outperform the
  benchmark."

- **formal_definition**: the null is *"β_k = 0, k = 1, …, l; thus the Reality Check p-value is obtained by"* comparing
  the observed max performance statistic against the bootstrapped distribution of the max, using *"a resampled version
  of f̄ = n⁻¹ Σ f_{t+1}"*. `B` bootstrap resamples give a p-value resolution floor of `1/B`; S3 reports results *"less
  than 1/B = 0.002"*, so `B = 500`.

- **parameters**: universe size **7,846 trading rules** (*"We consider a very large number (7,846) of trading rules"*),
  expanded from Brock/Lakonishok/LeBaron's 26. Data: *"100 years of daily data on the Dow Jones Industrial Average"*,
  1897–1996, plus S&P 500 futures 1984–1996.

- **measured_results** — the numbers that matter for anyone building a pattern backtest:
  - **In-sample, full 100-year DJIA sample**: *"the best trading rule chosen by the mean return criterion is a standard
    five-day moving average rule. The average annual return resulting from this rule is 17.2 percent. The Reality Check
    p-value is effectively zero (i.e., less than 1/B = 0.002)."* Buy-and-hold over the same window: *"the mean annualized
    return on the buy-and-hold strategy is 4.3 percent during this same period."* So the in-sample result survives.
  - **Break-even transaction cost** for that rule: *"the best-performing trading rule for the Dow Jones Industrial
    Average earned a mean annualized return of 17.17 percent resulting from 6,310 trades (63.1 per year), giving a
    break-even transaction cost level of 0.27 percent per trade."* That is the single most useful sanity metric in this
    whole file: **63 trades a year needs sub-27bp round-trip costs merely to break even.**
  - **Adding a one-day implementation delay** collapses the risk-adjusted result: *"The mean return of the best rule is
    7.8 percent with a Reality Check p-value of nearly zero … Note that this is true even though the performance is far
    less than the best from the standard experiment of 17.2 percent. The Sharpe ratio of the best rule is 0.34 with a
    Reality Check p-value of 0.26, suggesting that the best rule, according to the Sharpe ratio criterion, is no longer
    significant."*
  - **Out-of-sample, 1987–1996**: *"The five-day moving average rule selected from the full universe produces a mean
    return of 2.8 percent with a nominal p-value of 0.322 for the period 1987 to 1996, indicating that the best trading
    rule, as of the end of 1986, did not continue to generate valuable economic signals in the subsequent ten-year
    period."*
  - **The headline demonstration**, verbatim: *"Even though a particular trading rule is capable of producing superior
    performance of almost ten percent per year during this sample period and has a p-value of 0.04 when considered in
    isolation, the fact that this trading rule is drawn from a wide universe of rules means that its effective
    data-snooping-adjusted p-value is actually 0.90. An even bigger contrast occurs from using the Sharpe ratio
    criterion: here the snooping-adjusted and unadjusted p-values are 0.99 and 0.000 (below 0.002), respectively."*
  - Note the p-value dynamics that make this non-obvious: *"if the marginal trading rule does not lead to an improvement
    over the previously best performing trading rule, then the p-value for the null hypothesis that the best model does
    not outperform will increase … On the other hand, if the additional trading rule improves on the maximum performance
    statistic, then this can reduce the p-value."*

- **failure_modes** (of ignoring this): a per-pattern, per-parameter, per-market backtest grid *is* a rule universe. If
  you sweep 3 pivot depths × 4 tightness thresholds × 5 volume filters × 10 patterns, you have 600 rules, and the best
  one's nominal p-value is meaningless.

- **implementability**: the Reality Check is `B` bootstrap resamples over the `l × n` matrix of rule returns. For
  `l = 600`, `n = 5,000`, `B = 1,000` that is 3e9 float ops — minutes, not hours. **There is no cost excuse for
  skipping it.**

---

## Replication and refutation

- **source**: S4 — Park & Irwin, 2004 (survey); S2 — Osler, 1998; A3 — Savin/Weller/Zvingelis, 2007 (abstract); A7 —
  Dawson & Steeley, 2003 (**via S4's summary only**); A8 — Bajgrowicz & Scaillet, 2012 (**bibliographic record only, no
  numbers reported here**).

- **what the survey actually counted** (S4, abstract verbatim): *"Among a total of 92 modern studies, 58 studies found
  positive results regarding technical trading strategies, while 24 studies obtained negative results. Ten studies
  indicated mixed results. Despite the positive evidence on the profitability of technical trading strategies, it
  appears that most empirical studies are subject to various problems in their testing procedures, e.g., data snooping,
  ex post selection of trading rules or search technologies, and difficulties in estimation of risk and transaction
  costs."*

- **the chart-pattern-specific verdict** (S4, p. 43, verbatim): *"In general, the results of chart pattern studies
  varied depending on patterns, markets, and sample periods tested, but suggested that some chart patterns might have
  been profitable in stock markets and foreign exchange markets. Nevertheless, all studies in this category, except for
  Leigh, Paz, and Purvis (2002), neither conducted parameter optimization and out-of-sample tests, nor paid much
  attention to data snooping problems."*

- **the direct replication of LMW** (S4's account of A7, verbatim): *"In terms of trading profits, Dawson and Steeley
  (2003) confirmed the argument by applying the same technical patterns as in Lo, Mamaysky, and Wang (2000) to UK data.
  Although they found return distributions conditioned on technical patterns were significantly different from the
  unconditional distributions, an average market adjusted return turned out to be negative across all technical patterns
  and sample periods they considered."* **This is the cleanest statement of the distribution-vs-profit gap in the
  literature: LMW's finding replicated in the UK, and the money still lost.** I did not read A7 directly.

- **the earliest chart-pattern refutation** (S4, p. 41, verbatim): *"Previously, Levy (1971) documented the
  profitability of 32 five-point chart formations for NYSE securities. He found that none of the 32 patterns for any
  holding period generated profits greater than average purchase or short-sale opportunities."* Note "five-point
  formations" — the same 5-extrema vocabulary LMW would formalise 29 years later.

- **the FX head-and-shoulders result and its own authors' caveat** (S4's account of Chang & Osler 1999, verbatim): the
  endogenous-exit HS rule produced *"statistically significant returns of about 13% and 19% per year for the mark and
  yen, respectively, but not for the other exchange rates. Returns from the exogenous exit rule appeared to be
  insignificant in most cases."* Sharpe ratios *"for the mark and yen were 1.00 and 1.47, respectively, while the Sharpe
  ratio for the S&P 500 was 0.32."* But: *"Chang and Osler concluded that, although the head-and-shoulders patterns had
  some predictive power for the mark and yen during the period of floating exchange rates, the use of the
  head-and-shoulders rule did not seem to be rational, because they were easily dominated by simple moving average rules
  and momentum rules and increased risk without adding significant profits when used in combination with the simpler
  rules."* **The comparison that killed it was against a moving-average rule, not against zero.**

- **the noise-trader reading** (S2, abstract verbatim): *"This paper identifies a specific set of agents as noise traders
  in U.S. equity markets … These agents, who speculate using the 'head-and-shoulders' chart pattern, are shown to
  qualify as noise traders because (1) trading volume is exceptionally high when they are active, and (2) their trading
  is unprofitable."* Corroborated later by Bender, Osler & Simon (2012, *Review of Finance*, abstract via OpenAlex):
  *"Our findings indicate that the pattern is associated with a substantial rise in trading volume even though it does
  not profitably predict directional movements."*

- **the counter-evidence worth keeping**: A3 (Savin/Weller/Zvingelis) is the strongest positive result on a five-point
  pattern with a disclosed methodology — *"Risk-adjusted excess returns to a trading strategy conditioned on
  'head-and-shoulders' price patterns are 5–7% per year"* on S&P 500 + Russell 2000, 1990–1999 — but the same abstract
  says *"little or no support for the profitability of a stand-alone trading strategy."* A5 (Chong & Poon) reports the
  filter for prior trend *"generally improve[s]"* those returns. A6 reports DTW-based generic pattern search dominating
  the index in mean–variance terms after costs, on 560 NYSE stocks, with data-snooping control.

- **failure_modes across this literature**: the recurring pattern is (1) statistical significance of a *distribution*
  difference is reported and then read as profit; (2) the benchmark is cash or zero rather than buy-and-hold or a
  moving-average rule; (3) no adjustment for the size of the rule universe; (4) transaction costs added late or not at
  all; (5) no random-data null for the detector itself.

---

## Recommended detection primitives

Read as an engineering brief for a nightly base scanner over ~3,700 symbols of daily OHLCV.

### Build these

1. **Zigzag / swing pivots with a volatility-scaled threshold — build this first, and build it causally.**
   It is `O(n)`, incremental, needs no smoothing, and is the only segmenter in this file that is non-repainting by
   definition. Take Osler's parameterisation literally: **scale the cutoff to the security's own daily-return standard
   deviation rather than using a fixed percentage**, and run several cutoffs (*"6.0, 5.5, 5.0, 4.5, 4.0, 3.5, 3.0, 2.5,
   2.0, and 1.5 times the standard deviation of actual daily returns"*) with an explicit de-duplication rule across
   cutoffs. A fixed 5% zigzag means something completely different on a $400 utility and a $12 biotech; a fixed N-bar
   pivot means something different in a VIX-15 and a VIX-40 regime.
   **The invariant to rail:** *the most recent pivot is provisional and must never enter a signal.* A pivot is confirmed
   only when the opposite move has completed the threshold. This single rule eliminates repainting.

2. **Rule-based predicates over confirmed pivots, in LMW's ordinal style.** The ten definitions above are the reference
   implementation and they are ~15 lines of code each. Prefer them to templates and distances because:
   - every rejection is attributable to a **named** predicate, so you can publish a per-predicate rejection census and
     find out which constraint is actually doing the filtering;
   - there is no distance threshold hiding the false-positive rate;
   - they are trivially extensible to base-specific structures (depth, tightness, duration, prior advance).
   **But do not ship LMW's definitions as written.** They lack a prior-trend requirement, which is exactly the gap A5
   (Chong & Poon) closes and exactly what makes a "base" a base. Add Osler's two prior-trend constraints and his
   horizontal/vertical symmetry ratios, which are the only such tolerances in the literature that come with a published
   sensitivity analysis that held.

3. **Ratio comparisons between pivots, expressed as tolerances of the pair average.** LMW's *"within 1.5 percent of
   their average"* / *"within 0.75 percent of their average"* is the right shape (symmetric, scale-free). Two changes I
   would make on the evidence: (a) express tolerances in **ATR or return-σ units, not raw percent**, for the same
   reason as the zigzag threshold; (b) **run a sensitivity sweep**, because LMW published none and every downstream
   paper inherited their numbers unexamined.

4. **A random-data null, run through the identical detector.** This is the highest-value non-obvious build in the whole
   file. Osler's design — 10,000 bootstrap/GARCH-simulated series per symbol, **same detection algorithm, same entry and
   exit rules** — is what produced the finding that *"average simulated profits are negative about 80 percent of the
   time"* on data where the pattern is meaningless by construction. Without it, a mechanical drag reads as a signal with
   the wrong sign. LMW's calibrated-GBM control is the cheaper version of the same idea and is enough to answer
   "how often would this fire on noise?"
   **Concretely: for every pattern you ship, publish `hits_real / hits_simulated`.** If it is near 1.0, the predicate is
   describing the noise process, not the market.

5. **A Reality Check / bootstrap max-statistic step over your parameter grid.** Your grid *is* a rule universe. S3's
   demonstration — nominal p 0.04 → snooping-adjusted p 0.90; Sharpe nominal p 0.000 → adjusted p 0.99 — is not an
   edge case. `B = 500`–1,000 resamples over a few hundred rules is minutes of compute.

6. **A break-even transaction-cost figure on every strategy.** S3's *"6,310 trades (63.1 per year), giving a break-even
   transaction cost level of 0.27 percent per trade"* is the format. Report trades/year and break-even cost/trade
   alongside every return number; it kills bad strategies faster than any p-value.

### Build these only as a second stage, if at all

7. **Kernel smoothing (LMW).** It is cheap and it does solve a real problem — the paper's own words: raw-price extrema
   *"identifies too many extrema and also yields patterns that are not visually consistent with the kind of patterns
   that technical analysts find compelling."* But a volatility-scaled zigzag solves the same problem, incrementally and
   causally, with one parameter instead of two plus a cross-validation. **If you do use it:** never smooth the whole
   series and scan the result — that leaks and repaints. Use LMW's discipline exactly (rolling completed window; final
   extremum at `t + l − 1`; measure from `t + l + d`), and remember that `l = 35` bounds you to patterns completing
   within 38 days, which is too short for most multi-week bases. Running it at several `l` re-introduces the
   multiple-comparison problem the zigzag sweep already has.

8. **DTW as a scorer, never as a scanner.** Constrain the warping window hard — the measured optimum in S7 is **1–10%**,
   and *"a little warping is a good thing, but too much warping is a bad thing"*. Use `LB_Keogh` cascade pruning (the
   UCR suite) if you use it at all. First-stage cost at full universe scale is hours-to-days; second-stage cost on a few
   thousand candidates is seconds. And note that no paper in this file reports a base rate for DTW-based chart-pattern
   matching.

9. **Shapelets.** Offline quarterly training, nightly inference. Attractive because the learned fragment is inspectable.
   Dangerous because the training procedure is literally "take the argmax over `O(m²k)` candidates" with no
   multiple-testing correction — the exact object S3 was written to police.

### Do not build these

10. **A CNN as your pattern detector.** S10 built exactly this, labelled it from a hard-coded detector, and measured the
    incremental yield at **0.3%**, with total failure to transfer across symbols and their own conclusion that *"CNN
    models do not provide better detection rates than hard-coded algorithms."* If your labels come from your rules, your
    ceiling is your rules. (A CNN as a *separate return predictor* — the JKX/S9 design — is a different product and may
    be worth building, but it outputs a probability, not a labelled structure, so it cannot be the screener.)

11. **Anything that ranks patterns by recurrence frequency over overlapping windows.** S8's Theorem 1 and the
    trivial-match result mean the counts measure local smoothness, not recurrence. If you need a "most common shape"
    statistic, use the K-Motif definition with the explicit non-trivial-match requirement, or don't compute it.

12. **PIP as a standalone pattern detector.** As a *representation* it is excellent, cheap, and multi-resolution for
    free. But the PIP pattern-matching literature I could reach reports **no accuracy against any base rate and no
    financial result** — A1's abstract claims only complementarity and intuitiveness. And the algorithm is anchored on
    the window's last point, so it repaints on a growing window. Use it, if at all, to *summarise* a completed window
    for display or for a similarity index, not to decide whether a base exists.

### On non-repainting causality — what the literature actually says

- **Repainting is not intrinsic to any of these methods; it is intrinsic to evaluating them on incomplete windows.**
  - Zigzag: causal by definition. A peak exists only after a completed opposite move of the cutoff size. The lag is
    real and state-dependent, and it is the price of causality.
  - Kernel regression: non-causal *within* a window (two-sided weights), causal *across* windows if you only evaluate
    completed windows and add a detection lag. LMW's `d = 3` exists for precisely this: *"the lag d ensures that we are
    computing our conditional returns completely out-of-sample and without any 'look-ahead' bias."*
  - PIP: anchored on the window's endpoints, so it repaints on a growing window and is stable on a fixed completed one.
  - DTW / shapelets: causal or not depending entirely on how the subsequence endpoint is chosen.
- **The lag is not free and must be in the backtest.** S3's one-day-delay experiment is the demonstration: the same
  universe, the same data, one day of implementation delay, and the best rule's Sharpe p-value goes from *"below
  0.002"* to **0.26**.
- **Three rails worth writing into the detector, each traceable to a paper:**
  1. *No signal may depend on a pivot whose confirming opposite move has not completed.* (Osler's zigzag definition.)
  2. *Every detection carries the bar index at which it became knowable, and every return is measured from the bar after
     that.* (LMW's `t + l + d`.)
  3. *Overlapping detections of the same structure are one event.* (Osler's ±2-day de-duplication; S8's trivial matches.)
- **And one rail about reporting, which is where this literature fails most often:** an accuracy or hit rate without its
  base rate is not a result. S9 is the model to copy — it prints *"822/(822 + 641) = 0.562"* next to its 0.573, so the
  reader can see the edge is 1.1 points. Most of the papers surveyed here print the 0.573 and omit the 0.562.
