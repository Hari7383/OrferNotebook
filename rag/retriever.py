"""
rag/retriever.py

Pure logic module — NO model loading on import.
All heavy objects (_embeddings, _cross_encoder, _chroma_cache)
are injected by server.py AFTER it loads them once at startup.

Importing this file costs ~0ms. Models are never loaded more
than once per process lifetime.
"""

import os
from typing import List, Dict, Any, Optional
from rank_bm25 import BM25Okapi
import chromadb
from chromadb.config import Settings

# Import caching layer
try:
    from caching import get_cached_result, set_cached_result, invalidate_user_cache
    CACHING_ENABLED = True
except ImportError:
    CACHING_ENABLED = False

# ── Injected by server.py before first request ────────────────────────────────
# server.py does:
#   import rag.retriever as _ret
#   _ret._embeddings    = <HuggingFaceEmbeddings already loaded>
#   _ret._cross_encoder = <CrossEncoder already loaded>
_embeddings:    Any = None
_cross_encoder: Any = None
_chroma_cache: Dict[str, Any] = {}  # { persist_path: (client, collection) }

# ── Silence chromadb telemetry ────────────────────────────────────────────────
os.environ["ANONYMIZED_TELEMETRY"]         = "False"
os.environ["CHROMA_TELEMETRY"]             = "False"
os.environ["CHROMA_SERVER_AUTHN_PROVIDER"] = ""

# ── Constants ─────────────────────────────────────────────────────────────────
BASE_DIR    = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
STORAGE_DIR = os.path.join(BASE_DIR, "storage", "users")
TOP_K = 10

# ── Path helpers ──────────────────────────────────────────────────────────────
def _persist_dir(user_id: str, db_name: str) -> str:
    return os.path.join(STORAGE_DIR, user_id, db_name)

def _all_db_names(user_id: str) -> List[str]:
    user_dir = os.path.join(STORAGE_DIR, user_id)
    if not os.path.isdir(user_dir):
        return []
    return [d for d in os.listdir(user_dir)
            if os.path.isdir(os.path.join(user_dir, d))]

# ── Embed (uses injected model) ───────────────────────────────────────────────
def _embed_query(question: str) -> List[float]:
    if _embeddings is None:
        raise RuntimeError("retriever._embeddings not set. server.py must inject it before use.")
    return _embeddings.embed_query(question)

# ── ChromaDB query (cached client) ───────────────────────────────────────────
def _query_single_db(
    user_id: str, db_name: str,
    query_embedding: List[float], top_k: int = TOP_K
) -> List[Dict[str, Any]]:
    persist = _persist_dir(user_id, db_name)
    if not os.path.isdir(persist):
        return []

    cached = _chroma_cache.get(persist)
    if cached is None:
        client = chromadb.PersistentClient(
            path=persist,
            settings=Settings(anonymized_telemetry=False)
        )
        try:
            col = client.get_collection(name=db_name)
        except Exception:
            cols = client.list_collections()
            if not cols:
                return []
            col = client.get_collection(name=cols[0].name)
        _chroma_cache[persist] = (client, col)
    else:
        _, col = cached

    n = min(top_k, col.count())
    if n == 0:
        return []

    res = col.query(
        query_embeddings=[query_embedding],
        n_results=n,
        include=["documents", "metadatas", "distances"]
    )
    chunks = []
    for doc, meta, dist in zip(
        res.get("documents", [[]])[0],
        res.get("metadatas",  [[]])[0],
        res.get("distances",  [[]])[0]
    ):
        chunks.append({
            "text": f"{meta.get('source','')} {doc}",
            "source":   meta.get("source", "unknown"),
            "distance": round(dist, 4),
            "db":       db_name
        })
    return chunks

# ── Hybrid BM25 + vector fusion ───────────────────────────────────────────────
def _hybrid_ensemble(query: str, chunks: List[Dict[str, Any]], top_k: int) -> List[Dict[str, Any]]:
    if not chunks:
        return []

    tokenized = [(c["text"] + " " + c["source"]).split() for c in chunks]
    bm25 = BM25Okapi(tokenized)
    bm25_scores = bm25.get_scores(query.split())
    max_bm25 = float(max(bm25_scores)) if bm25_scores.any() and max(bm25_scores) > 0 else 1.0
    bm25_norm = bm25_scores / max_bm25

    vec_scores = [1.0 - c["distance"] for c in chunks]
    max_vec = max(vec_scores) if vec_scores else 1.0
    vec_norm = [v / max_vec for v in vec_scores]

    query_lower = query.lower()

    boosted = []
    for c, v, b in zip(chunks, vec_norm, bm25_norm):
        score = 0.6 * v + 0.4 * b
        boost = 0.0

        # 🔥 source match boost
        if c["source"].lower() in query_lower:
            boost += 0.3

        # 🔥 db match boost
        if c["db"].lower() in query_lower:
            boost += 0.2

        # 🔥 keyword overlap boost
        if any(word in c["text"].lower() for word in query_lower.split()):
            boost += 0.1

        boosted.append((c, score + boost))

    # sort AFTER boosting
    fused = sorted(boosted, key=lambda x: x[1], reverse=True)

    return [c for c, _ in fused[:min(top_k * 2, 10)]]

# ── Cross-encoder rerank (uses injected model) ────────────────────────────────
def _rerank_cross_encoder(query: str, chunks: List[Dict[str, Any]], top_k: int) -> List[Dict[str, Any]]:
    if not chunks:
        return []
    if _cross_encoder is None:
        raise RuntimeError("retriever._cross_encoder not set. server.py must inject it.")
    pairs  = [[query, c["text"]] for c in chunks]
    scores = _cross_encoder.predict(pairs)
    return [c for c, _ in sorted(zip(chunks, scores), key=lambda x: x[1], reverse=True)[:top_k]]

# ── Prompt builders ───────────────────────────────────────────────────────────
def _build_rag_prompt(question: str, chunks: List[Dict[str, Any]]) -> str:
    context = "\n\n".join(
        f"[Source: {c['source']}]\n{c['text'].strip()}" for c in chunks
    )
    return (
        "You are a document assistant. Your ONLY job is to answer questions "
        "strictly from the document context provided below.\n\n"
        "STRICT RULES — you MUST follow all of these without exception:\n"
        "1. Use ONLY information that appears explicitly in the context below.\n"
        "2. Do NOT use your training data, general knowledge, or any outside information.\n"
        "3. If the context does not contain enough information to answer the question, "
        "respond with exactly: "
        "\"The provided documents do not contain information about this topic.\"\n"
        "4. Never guess, infer, or assume facts not present in the context.\n"
        "5. If you are uncertain whether the context supports your answer, say so.\n\n"
        f"--- DOCUMENT CONTEXT START ---\n{context}\n--- DOCUMENT CONTEXT END ---\n\n"
        f"Question: {question}\n\n"
        "Answer (based strictly on the document context above):"
    )

def _build_free_prompt(question: str) -> str:
    return (
        "You are a helpful AI assistant. Answer the question directly and accurately.\n\n"
        f"Question: {question}\n\nAnswer:"
    )

def _extractive_answer(question: str, chunks: List[Dict[str, Any]]) -> str:
    if not chunks:
        return ("No relevant information found. "
                "Try rephrasing or selecting a different collection.")
    parts = [f"[{i}] {c['text'].strip()}\n   — {c['source']}"
             for i, c in enumerate(chunks, 1)]
    return "Retrieved context (no LLM configured):\n\n" + "\n\n".join(parts)

# ── PDF text extraction (for non-vision providers) ───────────────────────────
def _extract_pdf_text(base64_data: str, max_chars: int = 8000) -> str:
    """Extract text from a base64-encoded PDF."""
    try:
        import base64 as _b64
        import io
        pdf_bytes = _b64.b64decode(base64_data)
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
                text = "\n".join(p.extract_text() or "" for p in pdf.pages)
                return text[:max_chars].strip()
        except ImportError:
            pass
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(pdf_bytes))
            text = "\n".join(p.extract_text() or "" for p in reader.pages)
            return text[:max_chars].strip()
        except ImportError:
            pass
        return ""
    except Exception:
        return ""

# ── Unified LLM dispatcher (text + optional multimodal attachments) ───────────
def _call_llm(prompt: str, cfg: dict, max_tokens: int,
              attachments: list = None) -> str:
    """
    attachments: list of { name, mimeType, base64 } dicts
    - Images → sent inline to vision-capable providers (OpenAI, Anthropic, Gemini)
    - PDFs   → text extracted and injected into prompt for ALL providers
    """
    provider    = cfg.get("provider", "")
    api_key     = cfg.get("api_key", "")
    model       = cfg.get("model", "")
    attachments = attachments or []

    images = [a for a in attachments if a.get("mimeType", "").startswith("image/")]
    pdfs   = [a for a in attachments if a.get("mimeType", "") == "application/pdf"
              or a.get("name", "").lower().endswith(".pdf")]
    others = [a for a in attachments
              if a not in images and a not in pdfs]

    # ── Extract PDF text and inject into prompt (works for ALL providers) ──────
    if pdfs:
        pdf_texts = []
        for pdf in pdfs:
            extracted = _extract_pdf_text(pdf.get("base64", ""))
            if extracted:
                pdf_texts.append(f"[PDF: {pdf['name']}]\n{extracted}")
            else:
                pdf_texts.append(f"[PDF: {pdf['name']} — could not extract text]")
        prompt = prompt + "\n\n--- Attached PDF Content ---\n" + "\n\n".join(pdf_texts)

    # ── Note non-PDF, non-image files ─────────────────────────────────────────
    if others:
        prompt += "\n\n[Also attached: " + ", ".join(a["name"] for a in others) + \
                  " — these file types are not yet readable; answer based on text context.]"

    # ── OpenAI (vision: gpt-4o, gpt-4-turbo, gpt-4o-mini) ────────────────────
    if provider == "openai":
        from openai import OpenAI
        # Images FIRST, then text — required by OpenAI vision API
        content: list = []
        for img in images:
            content.append({
                "type": "image_url",
                "image_url": {
                    "url":    f"data:{img['mimeType']};base64,{img['base64']}",
                    "detail": "auto"
                }
            })
        content.append({"type": "text", "text": prompt})
        r = OpenAI(api_key=api_key).chat.completions.create(
            model=model or "gpt-4o",   # default to gpt-4o which has vision
            messages=[{"role": "user", "content": content}],
            max_tokens=max_tokens, temperature=0.2
        )
        return r.choices[0].message.content.strip()

    # ── Anthropic (vision: claude-3+) ─────────────────────────────────────────
    if provider == "anthropic":
        import anthropic
        # Images first (Anthropic requirement), then text
        content: list = []
        for img in images:
            content.append({
                "type": "image",
                "source": {
                    "type":       "base64",
                    "media_type": img["mimeType"],
                    "data":       img["base64"]
                }
            })
        content.append({"type": "text", "text": prompt})
        r = anthropic.Anthropic(api_key=api_key).messages.create(
            model=model or "claude-3-5-haiku-20241022",
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": content}]
        )
        return r.content[0].text.strip()

    # ── Gemini (vision: gemini-1.5-flash, gemini-1.5-pro, gemini-2.0) ─────────
    if provider == "gemini":
        import google.generativeai as genai
        import base64 as _b64
        genai.configure(api_key=api_key)
        # Gemini uses Part objects for images
        parts: list = []
        for img in images:
            parts.append({
                "inline_data": {
                    "mime_type": img["mimeType"],
                    "data":      img["base64"]   # Gemini accepts base64 string directly
                }
            })
        parts.append({"text": prompt})
        r = genai.GenerativeModel(model or "gemini-1.5-flash").generate_content(
            {"parts": parts}
        )
        return r.text.strip()

    # ── All other providers — text only (images noted in prompt) ──────────────
    if images:
        prompt += (f"\n\n[Note: {len(images)} image(s) were attached. "
                   f"This provider ({provider}) does not support vision. "
                   f"Switch to OpenAI (gpt-4o), Anthropic (claude-3+), or Gemini for image analysis.]")

    if provider == "cohere":
        import cohere
        r = cohere.Client(api_key=api_key).chat(
            model=model or "command-r-plus", message=prompt
        )
        return r.text.strip()

    if provider == "mistral":
        from mistralai.client import MistralClient
        from mistralai.models.chat_completion import ChatMessage
        r = MistralClient(api_key=api_key).chat(
            model=model or "mistral-large-latest",
            messages=[ChatMessage(role="user", content=prompt)]
        )
        return r.choices[0].message.content.strip()

    if provider == "groq":
        from openai import OpenAI
        r = OpenAI(api_key=api_key,
                   base_url="https://api.groq.com/openai/v1").chat.completions.create(
            model=model or "llama3-70b-8192",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens, temperature=0.2
        )
        return r.choices[0].message.content.strip()

    if provider == "grok":
        from openai import OpenAI
        r = OpenAI(api_key=api_key,
                   base_url="https://api.x.ai/v1").chat.completions.create(
            model=model or "grok-3",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens, temperature=0.2
        )
        return r.choices[0].message.content.strip()

    # ── Custom (OpenAI-compatible endpoint — vLLM, LM Studio, Ollama API, etc.) ─
    # Vision models served here (Qwen-VL, LLaVA, InternVL, etc.) use the
    # same image_url multimodal format as the OpenAI vision API.
    if provider == "custom":
        from openai import OpenAI
        url = cfg.get("custom_url", "").rstrip("/")
        if not url:
            raise ValueError("custom_url required for Custom provider")
        base_url = url if url.endswith("/v1") else url + "/v1"
        client = OpenAI(api_key=api_key or "no-key-required", base_url=base_url)
        if images:
            vision_content: list = []
            for img in images:
                vision_content.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{img['mimeType']};base64,{img['base64']}"}
                })
            vision_content.append({"type": "text", "text": prompt})
            user_msg = vision_content
        else:
            user_msg = prompt
        r = client.chat.completions.create(
            model=cfg.get("custom_model", model),
            messages=[
                {"role": "system", "content": "Answer strictly from document context."},
                {"role": "user",   "content": user_msg}
            ],
            max_tokens=max_tokens, temperature=0.2
        )
        return r.choices[0].message.content.strip()

    if provider == "local":
        return _call_local_model(prompt, cfg, max_tokens, attachments=attachments)

    raise ValueError(f"Unknown provider: '{provider}'")

def _call_local_model(prompt: str, cfg: dict, max_tokens: int = 1024, attachments: list = None) -> str:
    local_type = cfg.get("local_type", "ollama")
    local_path = cfg.get("local_path", "")
    model      = cfg.get("model", "")

    if local_type == "ollama":
        from openai import OpenAI
        url = cfg.get("ollama_url", "http://localhost:11434").rstrip("/") + "/v1"
        client = OpenAI(api_key="ollama", base_url=url)
        # Ollama vision models (LLaVA, Qwen-VL, etc.) support image_url format
        if attachments:
            imgs = [a for a in attachments if a.get("mimeType", "").startswith("image/")]
            if imgs:
                ollama_content: list = []
                for img in imgs:
                    ollama_content.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:{img['mimeType']};base64,{img['base64']}"}
                    })
                ollama_content.append({"type": "text", "text": prompt})
            else:
                ollama_content = prompt
        else:
            ollama_content = prompt
        r = client.chat.completions.create(
            model=cfg.get("ollama_model", model),
            messages=[{"role": "user", "content": ollama_content}],
            max_tokens=max_tokens, temperature=0.2
        )
        return r.choices[0].message.content.strip()

    if local_type == "llama_cpp":
        try:
            from llama_cpp import Llama
        except ImportError:
            raise RuntimeError("llama-cpp-python not installed.")
        if not local_path or not os.path.isfile(local_path):
            raise ValueError(f"GGUF file not found: {local_path}")
        llm = Llama(model_path=local_path, n_ctx=4096, verbose=False)
        r = llm.create_chat_completion(
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens, temperature=0.2
        )
        return r["choices"][0]["message"]["content"].strip()

    if local_type == "transformers":
        try:
            from transformers import pipeline
        except ImportError:
            raise RuntimeError("transformers not installed.")
        if not local_path or not os.path.isdir(local_path):
            raise ValueError(f"Model directory not found: {local_path}")
        pipe = pipeline("text-generation", model=local_path, device_map="auto")
        r    = pipe(prompt, max_new_tokens=max_tokens, temperature=0.2,
                    do_sample=True, truncation=True)
        out  = r[0]["generated_text"]
        return out[len(prompt):].strip() if out.startswith(prompt) else out.strip()

    raise ValueError(f"Unknown local_type: '{local_type}'")

# ── LLM wrappers ─────────────────────────────────────────────────────────────
def _llm_answer(question: str, chunks: List[Dict[str, Any]], cfg: dict,
                attachments: list = None) -> str:
    prompt = _build_rag_prompt(question, chunks)
    return _call_llm(prompt, cfg, max_tokens=768, attachments=attachments)

def _llm_free_answer(question: str, cfg: dict, attachments: list = None) -> str:
    prompt = _build_free_prompt(question)
    return _call_llm(prompt, cfg, max_tokens=1024, attachments=attachments)

# ── Public API ────────────────────────────────────────────────────────────────
def retrieve_and_answer(
    user_id:     str,
    question:    str,
    db_name:     str,
    api_config:  Optional[dict] = None,
    top_k:       int = TOP_K,
    free_mode:   bool = False,
    attachments: list = None      # [{ name, mimeType, base64 }]
) -> Dict[str, Any]:

    attachments = attachments or []

    # ── Check cache for RAG mode (not free mode) ──────────────────────────────
    if CACHING_ENABLED and not free_mode and not attachments:
        db_names_for_cache = _all_db_names(user_id) if db_name == "__all__" else [db_name]
        cached = get_cached_result(user_id, question, db_names_for_cache)
        if cached is not None:
            cached["from_cache"] = True
            return cached

    # ── FREE MODE ─────────────────────────────────────────────────────────────
    if free_mode:
        if not api_config or not api_config.get("provider"):
            return {"answer": "Free Mode requires an LLM. Configure one in the APIs tab.",
                    "sources": [], "chunks": 0, "dbs": [], "provider": "none", "free_mode": True}
        try:
            answer        = _llm_free_answer(question, api_config, attachments)
            provider_used = api_config["provider"] + " (free mode)"
        except Exception as e:
            answer        = f"⚠ LLM error in Free Mode ({type(e).__name__}: {e})."
            provider_used = "error (free mode)"
        return {"answer": answer, "sources": [], "chunks": 0,
                "dbs": [], "provider": provider_used, "free_mode": True}

    # ── RAG MODE ──────────────────────────────────────────────────────────────
    query_vec = _embed_query(question)

    db_names = _all_db_names(user_id) if db_name == "__all__" else [db_name]
    if not db_names:
        return {"answer": "No collections found. Upload and process PDFs first.",
                "sources": [], "chunks": 0, "dbs": [], "provider": "none", "free_mode": False}

    all_chunks: List[Dict[str, Any]] = []
    for name in db_names:
        all_chunks.extend(_query_single_db(user_id, name, query_vec, top_k=top_k))

    hybrid_chunks = _hybrid_ensemble(question, all_chunks, top_k)
    top_chunks    = _rerank_cross_encoder(question, hybrid_chunks, top_k)

    provider_used = "extractive"
    if api_config and api_config.get("provider"):
        try:
            answer        = _llm_answer(question, top_chunks, api_config, attachments)
            provider_used = api_config["provider"]
        except Exception as e:
            answer = (f"⚠ LLM failed ({type(e).__name__}: {e}). Falling back.\n\n"
                      + _extractive_answer(question, top_chunks))
            provider_used = "extractive (fallback)"
    else:
        answer = _extractive_answer(question, top_chunks)

    sources = list(dict.fromkeys(c["source"] for c in top_chunks))
    dbs     = list(dict.fromkeys(c["db"]     for c in top_chunks))

    result = {"answer": answer, "sources": sources, "chunks": len(top_chunks),
            "dbs": dbs, "provider": provider_used, "free_mode": False}

    # ── Cache RAG mode results ────────────────────────────────────────────────
    if CACHING_ENABLED and not free_mode and not attachments:
        set_cached_result(user_id, question, db_names, result)

    return result