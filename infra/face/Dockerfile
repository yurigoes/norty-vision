# yugo-face — verificação facial gratuita (DeepFace) self-hosted.
FROM python:3.11-slim

# deps de sistema do OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

ENV PIP_NO_CACHE_DIR=1 \
    DEEPFACE_HOME=/weights \
    TF_CPP_MIN_LOG_LEVEL=3

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app.py .

# weights dos modelos ficam num volume (baixados 1x no 1º uso)
RUN mkdir -p /weights
EXPOSE 8080

# 1 worker (modelo na memória), timeout alto p/ o 1º load em CPU
CMD ["gunicorn", "-w", "1", "-b", "0.0.0.0:8080", "--timeout", "120", "--preload", "app:app"]
