FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements.lock.txt ./
RUN pip install --no-cache-dir -r requirements.lock.txt

RUN useradd --create-home --uid 10001 metro
COPY core/ ./core/
COPY data_io/ ./data_io/
COPY optimizer/ ./optimizer/
COPY api/ ./api/
COPY datasets/ ./datasets/
USER metro

EXPOSE 8000
# One ASGI process owns the in-memory runs/jobs; the optimizer spawns its own pool.
CMD ["python", "-m", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--root-path", "/api"]
