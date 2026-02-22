from fastapi import APIRouter

router = APIRouter()

TRADERS = [
    {
        "id": "tsdr",
        "name": "TSDR",
        "color": "#3cb868",
        "tickers": ["NVDA", "META", "GOOGL", "AMZN", "MSFT", "AAPL", "AMD", "TSM", "AVGO", "ARM"],
    },
    {
        "id": "bracco",
        "name": "Bracco",
        "color": "#e74c3c",
        "tickers": ["SMCI", "PLTR", "IONQ", "RGTI", "ACHR", "JOBY", "RKLB", "LUNR", "TDW", "PRFX"],
    },
    {
        "id": "qullamaggie",
        "name": "Qullamaggie",
        "color": "#6ba3be",
        "tickers": ["CELH", "AXON", "ANET", "TTD", "MNDY", "DUOL", "IOT", "SMAR", "GTLB", "DDOG"],
    },
    {
        "id": "manrav",
        "name": "Manrav",
        "color": "#c9a84c",
        "tickers": ["CRS", "FIX", "EQIX", "MCK", "TOL", "GLW", "STX", "MU", "SNDK", "LITE"],
    },
]


@router.get("/api/traders")
def get_traders():
    return TRADERS
