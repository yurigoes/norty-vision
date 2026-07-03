"""
yugo-face — micro-serviço gratuito de verificação facial (self-hosted).

Implementa o contrato que o módulo de Ponto espera:
    POST /verify
      headers: x-api-key: <opcional, se FACE_API_KEY setado>
      body:    { "reference": "<base64|dataURL>", "probe": "<base64|dataURL>" }
      200:     { "similarity": 0.0–1.0 }   (o backend normaliza p/ 0–100)

Usa DeepFace (open-source, modelos grátis) por baixo. Sem mensalidade.
Modelo configurável por env FACE_MODEL (padrão SFace — leve e rápido em CPU).
"""
import base64
import hashlib
import os

import cv2
import numpy as np
from deepface import DeepFace
from flask import Flask, jsonify, request

MODEL = os.environ.get("FACE_MODEL", "SFace")          # SFace (leve) | Facenet | Facenet512 | ArcFace
DETECTOR = os.environ.get("FACE_DETECTOR", "opencv")   # opencv (leve) | retinaface (preciso, +pesado)
API_KEY = os.environ.get("FACE_API_KEY", "")

app = Flask(__name__)


def _decode(b64: str):
    if not b64:
        return None
    s = b64.strip()
    if s.startswith("data:") and "," in s:
        s = s.split(",", 1)[1]
    raw = base64.b64decode(s)
    arr = np.frombuffer(raw, np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def _embed(img):
    reps = DeepFace.represent(
        img_path=img, model_name=MODEL, detector_backend=DETECTOR, enforce_detection=True,
    )
    return np.asarray(reps[0]["embedding"], dtype=np.float32)


# cache de embeddings das referências (chave = hash do base64) — acelera o identify 1:N
_emb_cache: dict[str, np.ndarray] = {}


def _embed_cached(b64: str):
    h = hashlib.sha1(b64.encode("utf-8")).hexdigest()
    e = _emb_cache.get(h)
    if e is None:
        e = _embed(_decode(b64))
        if len(_emb_cache) > 5000:
            _emb_cache.clear()
        _emb_cache[h] = e
    return e


def _cos(a, b):
    return float(np.dot(a, b) / ((np.linalg.norm(a) * np.linalg.norm(b)) + 1e-9))


@app.get("/health")
def health():
    return jsonify({"ok": True, "model": MODEL, "detector": DETECTOR})


@app.post("/verify")
def verify():
    if API_KEY and request.headers.get("x-api-key") != API_KEY:
        return jsonify({"error": "unauthorized"}), 401
    data = request.get_json(force=True, silent=True) or {}
    ref = _decode(data.get("reference"))
    probe = _decode(data.get("probe"))
    if ref is None or probe is None:
        return jsonify({"error": "reference e probe obrigatorios (base64)"}), 400
    try:
        a, b = _embed(ref), _embed(probe)
    except Exception as e:  # rosto não detectado em uma das imagens
        return jsonify({"similarity": 0.0, "match": False, "error": "face_not_detected", "detail": str(e)[:200]}), 200
    cos = _cos(a, b)
    sim = max(0.0, min(1.0, cos))  # similaridade do cosseno (0..1)
    return jsonify({"similarity": round(sim, 4)})


@app.post("/identify")
def identify():
    """1:N — acha o melhor candidato pro probe.
    body: { probe: <base64>, candidates: [{ id, image(base64) }] } -> { id, similarity }"""
    if API_KEY and request.headers.get("x-api-key") != API_KEY:
        return jsonify({"error": "unauthorized"}), 401
    data = request.get_json(force=True, silent=True) or {}
    probe = data.get("probe")
    candidates = data.get("candidates") or []
    if not probe or not candidates:
        return jsonify({"error": "probe e candidates obrigatorios"}), 400
    try:
        pe = _embed(_decode(probe))
    except Exception as e:
        return jsonify({"id": None, "similarity": 0.0, "error": "face_not_detected", "detail": str(e)[:200]}), 200
    best_id, best = None, -1.0
    for c in candidates:
        try:
            ce = _embed_cached(c["image"])
        except Exception:
            continue
        s = _cos(pe, ce)
        if s > best:
            best, best_id = s, c.get("id")
    return jsonify({"id": best_id, "similarity": round(max(0.0, min(1.0, best)), 4)})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
