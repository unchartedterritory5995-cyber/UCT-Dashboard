# TERM-069 chain parity — retired yfinance/Black-Scholes leg vs Massive, 2026-09-28 (after hours)

Command: `python tools/term069_chain_parity.py SPY AAPL NVDA --strikes 4` (MASSIVE_API_KEY from the engine .env, never printed). Exit 0.

- **Transport family** (polygon_options vs massive_adapter.get_pages): **0 disagreements**.
- **Vendor family** (retired leg vs Massive): the retired leg returned **delta = 0.0 on every contract** and IVs far from the market (e.g. NVDA 237.5P legacy 0.75 vs Massive 2.51 on an expiring chain); Massive returns real greeks. Retiring the leg removes broken numbers.

## Ruling recorded (owner-delegated, 2026-09-28)
TERM-069 is subsumed by BRK-01 as its precondition: ONE licensed options chain, on Massive (owner approved Massive 2026-09-26). Resolves roadmap §8 item 3.

## Raw (tail)
```
  AAPL   2026-09-28 C     342.5 delta         legacy=         0.0  massive=0.019821433417239537
  AAPL   2026-09-28 C     345.0 iv            legacy=      0.1602  massive=0.5225319883219965
  AAPL   2026-09-28 C     345.0 delta         legacy=         0.0  massive=0.013788638487221644
  AAPL   2026-09-28 C     347.5 iv            legacy=      0.2109  massive=0.6864563278203789
  AAPL   2026-09-28 C     347.5 delta         legacy=         0.0  massive=0.010803772548150532
  AAPL   2026-09-28 P     330.0 iv            legacy=      0.2031  massive=0.6563135436044378
  AAPL   2026-09-28 P     330.0 delta         legacy=         0.0  massive=-0.01121665565233842
  AAPL   2026-09-28 P     332.5 iv            legacy=      0.1484  massive=0.4774094912545613
  AAPL   2026-09-28 P     332.5 delta         legacy=         0.0  massive=-0.014820726983776188
  AAPL   2026-09-28 P     335.0 iv            legacy=      0.0918  massive=0.2948437307911716
  AAPL   2026-09-28 P     335.0 delta         legacy=         0.0  massive=-0.02282576431499464
  AAPL   2026-09-28 P     335.0 bid           legacy=         0.0  massive=        0.01
  AAPL   2026-09-28 P     335.0 ask           legacy=        0.01  massive=        0.02
  AAPL   2026-09-28 P     337.5 iv            legacy=      0.0303  massive=0.09801456107298094
  AAPL   2026-09-28 P     337.5 delta         legacy=         0.0  massive=-0.060292000724146005
  AAPL   2026-09-28 P     340.0 iv            legacy=      0.1145  massive=        None
  AAPL   2026-09-28 P     340.0 delta         legacy=         0.0  massive=        None
  AAPL   2026-09-28 P     342.5 iv            legacy=      0.1616  massive=        None
  AAPL   2026-09-28 P     342.5 delta         legacy=         0.0  massive=        None
  AAPL   2026-09-28 P     345.0 iv            legacy=      0.3193  massive=        None
  AAPL   2026-09-28 P     345.0 delta         legacy=         0.0  massive=        None
  AAPL   2026-09-28 P     347.5 iv            legacy=       0.415  massive=        None
  AAPL   2026-09-28 P     347.5 delta         legacy=         0.0  massive=        None
  NVDA   2026-09-28 C     220.0 iv            legacy=      0.5703  massive=        None
  NVDA   2026-09-28 C     220.0 delta         legacy=         0.0  massive=        None
  NVDA   2026-09-28 C     222.5 iv            legacy=      0.5332  massive=1.2603099888060152
  NVDA   2026-09-28 C     222.5 delta         legacy=         0.0  massive=0.9169605623334183
  NVDA   2026-09-28 C     225.0 iv            legacy=      0.2749  massive=        None
  NVDA   2026-09-28 C     225.0 delta         legacy=         0.0  massive=        None
  NVDA   2026-09-28 C     227.5 iv            legacy=      0.1816  massive=        None
  NVDA   2026-09-28 C     227.5 delta         legacy=         0.0  massive=        None
  NVDA   2026-09-28 C     227.5 ask           legacy=        1.71  massive=        1.65
  NVDA   2026-09-28 C     230.0 iv            legacy=      0.0527  massive=0.1373409437481864
  NVDA   2026-09-28 C     230.0 delta         legacy=         0.0  massive=0.06318983007932501
  NVDA   2026-09-28 C     232.5 iv            legacy=      0.1406  massive=0.44878957692753835
  NVDA   2026-09-28 C     232.5 delta         legacy=         0.0  massive=0.0290341491939017
  NVDA   2026-09-28 C     235.0 iv            legacy=      0.2188  massive=0.6844365074778713
  NVDA   2026-09-28 C     235.0 delta         legacy=         0.0  massive=0.01530420747356234
  NVDA   2026-09-28 C     237.5 iv            legacy=      0.2969  massive=0.9347519553353689
  NVDA   2026-09-28 C     237.5 delta         legacy=         0.0  massive=0.01167732861397916
  NVDA   2026-09-28 P     220.0 iv            legacy=      0.3125  massive=1.0537580531000454
  NVDA   2026-09-28 P     220.0 delta         legacy=         0.0  massive=-0.010342747964240987
  NVDA   2026-09-28 P     222.5 iv            legacy=      0.2344  massive=0.7963425568691764
  NVDA   2026-09-28 P     222.5 delta         legacy=         0.0  massive=-0.013316134580060634
  NVDA   2026-09-28 P     222.5 bid           legacy=         0.0  massive=        0.01
  NVDA   2026-09-28 P     222.5 ask           legacy=        0.01  massive=        0.02
  NVDA   2026-09-28 P     225.0 iv            legacy=      0.1524  massive=0.5238039275525743
  NVDA   2026-09-28 P     225.0 delta         legacy=         0.0  massive=-0.019273436644288527
  NVDA   2026-09-28 P     227.5 iv            legacy=      0.0625  massive=0.24440468441308313
  NVDA   2026-09-28 P     227.5 delta         legacy=         0.0  massive=-0.037992570031793446
  NVDA   2026-09-28 P     230.0 iv            legacy=      0.0547  massive=0.39946858225213766
  NVDA   2026-09-28 P     230.0 delta         legacy=         0.0  massive=-0.6967970442230366
  NVDA   2026-09-28 P     232.5 iv            legacy=      0.3945  massive=0.958204385684017
  NVDA   2026-09-28 P     232.5 delta         legacy=         0.0  massive=-0.8064805142569779
  NVDA   2026-09-28 P     235.0 iv            legacy=      0.4512  massive=0.9649718871276188
  NVDA   2026-09-28 P     235.0 delta         legacy=         0.0  massive=-0.9363176230424946
  NVDA   2026-09-28 P     237.5 iv            legacy=      0.7461  massive=2.506532037800505
  NVDA   2026-09-28 P     237.5 delta         legacy=         0.0  massive=-0.7905312787640227

transport (polygon_options vs massive_adapter; should agree): 0
```
