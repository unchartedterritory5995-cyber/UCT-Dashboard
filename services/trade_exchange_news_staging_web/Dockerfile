# Trade Exchange News STAGING web (Checkpoint D2). Built ONLY from the bundle
# tools/txn_staging_bundle.py assembles (the real News router + services, plus
# staging_auth.py in place of the UCT auth middleware). Never the UCT web image.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/data
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY api ./api
COPY staging_web.py .

ENV PORT=8080
CMD ["python", "-u", "staging_web.py"]
