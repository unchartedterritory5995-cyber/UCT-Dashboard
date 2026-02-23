"""Chart image endpoint — serves dark-themed candlestick PNGs via yfinance + mplfinance."""
import matplotlib
matplotlib.use('Agg')  # non-interactive backend, must be set before pyplot import

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse, Response
from io import BytesIO

router = APIRouter()

# Timeframe → yfinance period/interval
TF_CONFIG = {
    '5':  {'period': '2d',  'interval': '5m'},
    '30': {'period': '5d',  'interval': '30m'},
    '60': {'period': '1mo', 'interval': '60m'},
    'D':  {'period': '6mo', 'interval': '1d'},
    'W':  {'period': '2y',  'interval': '1wk'},
}

# Internal yfinance ticker overrides
YF_TICKERS = {
    'VIX': '^VIX',
    'BTC': 'BTC-USD',
}

def _make_style():
    import mplfinance as mpf
    mc = mpf.make_marketcolors(
        up='#3cb868', down='#e74c3c',
        edge='inherit', wick='inherit',
        volume={'up': '#3cb86840', 'down': '#e74c3c40'},
    )
    return mpf.make_mpf_style(
        base_mpf_style='nightclouds',
        marketcolors=mc,
        facecolor='#0f1117',
        figcolor='#0f1117',
        gridcolor='#2a2d3a',
        gridstyle='--',
        gridaxis='both',
        rc={
            'axes.labelcolor': '#8a8fa8',
            'xtick.color': '#8a8fa8',
            'ytick.color': '#8a8fa8',
            'font.family': 'monospace',
        },
    )

_STYLE = None  # lazy-init on first request

@router.get("/api/chart/{ticker}")
def chart_image(ticker: str, tf: str = Query(default='D')):
    """Return a dark-themed candlestick chart PNG for the given ticker and timeframe."""
    global _STYLE
    try:
        import yfinance as yf
        import mplfinance as mpf

        if _STYLE is None:
            _STYLE = _make_style()

        yf_sym = YF_TICKERS.get(ticker.upper(), ticker.upper())
        config = TF_CONFIG.get(tf, TF_CONFIG['D'])

        df = yf.Ticker(yf_sym).history(period=config['period'], interval=config['interval'])
        if df.empty:
            return Response(status_code=204)

        # Strip timezone for mplfinance compatibility
        if df.index.tzinfo is not None:
            df.index = df.index.tz_localize(None)

        buf = BytesIO()
        mpf.plot(
            df,
            type='candle',
            style=_STYLE,
            figsize=(9, 4),
            savefig=dict(fname=buf, dpi=110, bbox_inches='tight'),
            volume=True,
        )
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type='image/png',
            headers={'Cache-Control': 'public, max-age=300'},
        )
    except Exception as e:
        return Response(status_code=500, content=str(e))
