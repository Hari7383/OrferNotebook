"""
python/server.py  —  Persistent RAG HTTP Server
================================================
Launched ONCE by main.js when the Electron app starts.
Keeps all heavy models in memory between requests:
  • BAAI/bge-base-en-v1.5   (embedding model  ~400 MB)
  • cross-encoder/ms-marco-MiniLM-L-6-v2  (reranker)
  • ChromaDB clients (cached per collection)

Without this server every question re-loads all models from
disk (8–20 s cold start). With it, queries take 1–3 s.

Usage (called by main.js):
    python server.py <port> <config_path>
"""

import sys
import os
import json
import warnings
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
from huggingface_hub import snapshot_download

os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_OFFLINE"] = "0" # 1
os.environ["TRANSFORMERS_OFFLINE"] = "0" # 1


# ── Silence all noise ──────────────────────────────────────
warnings.filterwarnings("ignore")
os.environ["TRANSFORMERS_VERBOSITY"]    = "error"
os.environ["ANONYMIZED_TELEMETRY"]      = "False"
os.environ["CHROMA_TELEMETRY"]          = "False"
os.environ["CHROMA_SERVER_AUTHN_PROVIDER"] = ""

# ── Path setup ─────────────────────────────────────────────
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT_DIR)

PORT        = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
CONFIG_PATH = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT_DIR, "storage", "api_config.json")

# ══════════════════════════════════════════════════════════
#  Load heavy models ONCE on startup
# ══════════════════════════════════════════════════════════
print("[RAG-Server] Starting — loading models (one-time cost)…", flush=True)

# ── Local model paths (relative to project root) ──────────
# If the folder exists and is non-empty → load from disk (no download).
# If missing or empty → fall back to HuggingFace Hub download.
_MODELS_DIR      = os.path.join(ROOT_DIR, "models")
# _EMBED_LOCAL     = os.path.join(_MODELS_DIR, "sentence_transformers")
# _RERANK_LOCAL    = os.path.join(_MODELS_DIR, "xet")

_EMBED_LOCAL = os.path.join(_MODELS_DIR, "bge-base-en-v1.5")
_RERANK_LOCAL = os.path.join(_MODELS_DIR, "ms-marco-MiniLM-L-6-v2")

os.makedirs(_MODELS_DIR, exist_ok=True)


def _is_valid_model_dir(path: str) -> bool:
    """
    Check if a folder contains a valid HF model.
    """
    required_files = [
        "config.json",
    ]

    if not os.path.isdir(path):
        return False

    return all(
        os.path.isfile(os.path.join(path, f))
        for f in required_files
    )


def _download_model(repo_id: str, local_dir: str):
    """
    Download model from HuggingFace into stable local folder.
    """

    print(f"[RAG-Server] Downloading model: {repo_id}")
    print(f"[RAG-Server] Saving to: {local_dir}")

    snapshot_download(
        repo_id=repo_id,
        local_dir=local_dir,
        local_dir_use_symlinks=False,
        resume_download=True
    )

    print(f"[RAG-Server] Download complete: {repo_id}")


# ─────────────────────────────────────────────────────────────
# Ensure embedding model exists
# ─────────────────────────────────────────────────────────────

if not _is_valid_model_dir(_EMBED_LOCAL):

    print(
        "[RAG-Server] Embedding model not found locally."
    )

    _download_model(
        repo_id="BAAI/bge-base-en-v1.5",
        local_dir=_EMBED_LOCAL
    )

else:

    print(
        f"[RAG-Server] Embedding model found: {_EMBED_LOCAL}"
    )


# ─────────────────────────────────────────────────────────────
# Ensure reranker model exists
# ─────────────────────────────────────────────────────────────

if not _is_valid_model_dir(_RERANK_LOCAL):

    print(
        "[RAG-Server] Cross-encoder model not found locally."
    )

    _download_model(
        repo_id="cross-encoder/ms-marco-MiniLM-L-6-v2",
        local_dir=_RERANK_LOCAL
    )

else:

    print(
        f"[RAG-Server] Cross-encoder found: {_RERANK_LOCAL}"
    )


# ─────────────────────────────────────────────────────────────
# Load models
# ─────────────────────────────────────────────────────────────

from langchain_huggingface import HuggingFaceEmbeddings
from sentence_transformers import CrossEncoder

_embeddings = HuggingFaceEmbeddings(
    model_name=_EMBED_LOCAL,
    model_kwargs={"device": "cpu"},
    encode_kwargs={"normalize_embeddings": True}
)

print("[RAG-Server] Embedding model ready")


_cross_encoder = CrossEncoder(_RERANK_LOCAL)

print("[RAG-Server] Cross-encoder ready")

# print("ROOT_DIR =", ROOT_DIR)
# print("\n_MODELS_DIR =", _MODELS_DIR)
# print("\n_EMBED_LOCAL =", _EMBED_LOCAL)
# print("\n_RERANK_LOCAL =", _RERANK_LOCAL)

# def _dir_has_files(dirpath: str) -> bool:
#     """Return True when dirpath exists and contains at least one file (searches recursively)."""
#     if not os.path.isdir(dirpath):
#         return False
#     for _, _, files in os.walk(dirpath):
#         if files:
#             return True
#     return False

# # ── Embedding model ────────────────────────────────────────
# from langchain_huggingface import HuggingFaceEmbeddings

# if _dir_has_files(_EMBED_LOCAL):
#     _embed_source = _EMBED_LOCAL
#     print(f"[RAG-Server]  Embedding model — loading from local path: {_EMBED_LOCAL}", flush=True)
# else:
#     _embed_source = "BAAI/bge-base-en-v1.5"
#     print("[RAG-Server]  Embedding model — local folder not found, downloading from HuggingFace Hub…", flush=True)

# _embeddings = HuggingFaceEmbeddings(
#     model_name=_embed_source,
#     model_kwargs={"device": "cpu"},
#     encode_kwargs={"normalize_embeddings": True}
# )
# print("[RAG-Server]  Embedding model ready", flush=True)

# # ── Cross-encoder reranker ────────────────────────────────
# from sentence_transformers import CrossEncoder

# if _dir_has_files(_RERANK_LOCAL):
#     _rerank_source = _RERANK_LOCAL
#     print(f"[RAG-Server]  Cross-encoder — loading from local path: {_RERANK_LOCAL}", flush=True)
# else:
#     _rerank_source = "cross-encoder/ms-marco-MiniLM-L-6-v2"
#     print("[RAG-Server]  Cross-encoder — local folder not found, downloading from HuggingFace Hub…", flush=True)

# _cross_encoder = CrossEncoder(_rerank_source)
# print("[RAG-Server]  Cross-encoder ready", flush=True)

# ── Inject pre-loaded models into retriever ───────────────
import rag.retriever as _ret
_ret._embeddings    = _embeddings
_ret._cross_encoder = _cross_encoder

from rag.retriever import retrieve_and_answer
from processor import process_pdf

# ── Import performance monitoring ──────────────────────────────────────
try:
    from metrics import record_query, get_performance_stats, Timer
    from caching import invalidate_user_cache
    METRICS_ENABLED = True
except ImportError:
    METRICS_ENABLED = False

# ── ChromaDB client cache (avoid re-opening per request) ──
_chroma_cache: dict = {}
_ret._chroma_cache  = _chroma_cache

print("[RAG-Server]  All models loaded. Listening on port", PORT, flush=True)

# ══════════════════════════════════════════════════════════
#  HTTP handler
# ══════════════════════════════════════════════════════════
class Handler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        pass  # Suppress request logs

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        # Read in chunks — critical for large base64 image payloads (can be 5–20MB)
        data = b""
        remaining = length
        while remaining > 0:
            chunk = self.rfile.read(min(remaining, 65536))
            if not chunk:
                break
            data += chunk
            remaining -= len(chunk)
        return json.loads(data.decode("utf-8"))

    def _send_json(self, data: dict, status: int = 200):
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/health":
            self._send_json({"status": "ok"})

        elif path == "/metrics":
            if METRICS_ENABLED:
                self._send_json(get_performance_stats())
            else:
                self._send_json({"metrics": "disabled"})

        else:
            self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        path = urlparse(self.path).path

        # ── /query — retrieve + LLM answer ────────────────
        if path == "/query":
            try:
                data        = self._read_json()
                question    = data.get("question", "")
                db_name     = data.get("db_name", "__all__")
                free_mode   = bool(data.get("free_mode", False))
                attachments = data.get("attachments", [])   # [{ name, mimeType, base64 }]

                # Load current api_config on each request
                # (user may change keys without restarting server)
                api_config = None
                if os.path.isfile(CONFIG_PATH):
                    try:
                        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                            api_config = json.load(f)
                    except Exception:
                        pass

                # Time the query
                query_timer = Timer() if METRICS_ENABLED else None
                if query_timer:
                    query_timer.__enter__()

                result = retrieve_and_answer(
                    user_id     = "user_1",
                    question    = question,
                    db_name     = db_name,
                    api_config  = api_config,
                    free_mode   = free_mode,
                    attachments = attachments   # ← forwarded to LLM
                )

                # Record metrics
                if query_timer and METRICS_ENABLED:
                    query_timer.__exit__(None, None, None)
                    record_query(question, query_timer.duration_ms, result.get("from_cache", False))
                    result.pop("from_cache", None)

                self._send_json(result)
            except Exception as e:
                traceback.print_exc()
                self._send_json({"error": str(e)}, 500)

        # ── /process — PDF ingestion ───────────────────────
        elif path == "/process":
            try:
                data         = self._read_json()
                file_paths   = data.get("file_paths", [])
                chunk_size   = int(data.get("chunk_size", 500))
                overlap      = int(data.get("overlap", 100))
                dataset_name = data.get("dataset_name", "default_db")

                results = []
                for fp in file_paths:
                    r = process_pdf(fp, chunk_size, overlap, dataset_name)
                    results.append({"file": fp, "chunks": r.get("chunks", 0)})

                # Clear ChromaDB cache for updated collection
                _chroma_cache.pop(dataset_name, None)

                # Invalidate query cache for user (new documents uploaded)
                if METRICS_ENABLED:
                    invalidate_user_cache("user_1")

                self._send_json({
                    "message":        "Processing complete",
                    "dataset":        dataset_name,
                    "files_processed": len(results),
                    "details":        results
                })
            except Exception as e:
                traceback.print_exc()
                self._send_json({"error": str(e)}, 500)

        else:
            self._send_json({"error": "not found"}, 404)


# ══════════════════════════════════════════════════════════
#  Start server
# ══════════════════════════════════════════════════════════
if __name__ == "__main__":
    # Allow large request bodies (images can be 5–20 MB as base64)
    Handler.max_request_size = 50 * 1024 * 1024  # 50 MB
    httpd = HTTPServer(("127.0.0.1", PORT), Handler)
    httpd.socket.settimeout(120)   # 2 min timeout for slow reads
    print(f"[RAG-Server] READY on http://127.0.0.1:{PORT}", flush=True)
    httpd.serve_forever()