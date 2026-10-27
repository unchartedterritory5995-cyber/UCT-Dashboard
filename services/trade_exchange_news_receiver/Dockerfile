# trade-exchange-news-receiver -- the Trade Exchange webhook door. Stateless:
# NO VOLUME, on purpose (a volume would make Railway refuse overlapping deploys
# and give this service the dead window it exists to avoid). Durable state is
# the R2 journal; see txn_journal.py.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ⚠️ FILES ARE COPIED INDIVIDUALLY (the chart-renderer rule): a new module not
# listed here is an ImportError at boot. tests/test_trade_exchange_news_receiver.py
# asserts every sibling .py is listed.
COPY txn_app.py .
COPY txn_forwarder.py .
COPY txn_journal.py .
COPY txn_receiver.py .
COPY txn_redaction.py .
COPY txn_serve.py .

RUN useradd --system --uid 10001 txn && chown -R txn /app
USER txn

ENV PORT=8080
CMD ["python", "-u", "txn_serve.py"]
