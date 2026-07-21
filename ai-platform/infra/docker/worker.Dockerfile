# ============================================================================
# FALLBACK worker image — ingestion-workers AND agents-runtime.
# Used if ai-platform/ingestion/ (or agents/) ships no Dockerfile of its own.
#   build: docker build -f infra/docker/worker.Dockerfile -t ai-worker ./ingestion
#
# These are long-running Python workers (ingestion pipeline / agent runtime)
# that consume Redis job queues — no HTTP port. WORKER_ROLE selects the entry.
# ============================================================================
# syntax=docker/dockerfile:1
FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl git \
 && rm -rf /var/lib/apt/lists/*

# ---- deps ----
COPY requirements.txt ./
RUN pip install -r requirements.txt

# ---- app ----
COPY . .

RUN useradd --create-home --uid 10002 worker && chown -R worker:worker /app
USER worker

# Liveness: the worker writes /tmp/worker-alive heartbeats; fall back to a python probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import os,time,sys; f='/tmp/worker-alive'; sys.exit(0 if (os.path.exists(f) and time.time()-os.path.getmtime(f) < 120) else 1)" || exit 1

# WORKER_ROLE=ingestion|agents|chain_indexer — the module dispatches on it.
ENV WORKER_ROLE=ingestion
CMD ["python", "-m", "app.workers.run"]
