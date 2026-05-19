"""
rag/direct_answer.py

Direct LLM answering — no RAG retrieval.
Called when the user enables "Advanced Control" mode.
Supports all providers: OpenAI, Anthropic, Gemini, Cohere,
Mistral, Groq, xAI Grok, Custom/OSS, Local GGUF, Local HuggingFace.
"""

import os
import json

# ──────────────────────────────────────────────
# Expected api_config shapes per provider
# ──────────────────────────────────────────────
# openai:    { provider, api_key, model }
# anthropic: { provider, api_key, model }
# gemini:    { provider, api_key, model }
# cohere:    { provider, api_key, model }
# mistral:   { provider, api_key, model }          (openai-compat)
# groq:      { provider, api_key, model }          (openai-compat)
# grok:      { provider, api_key, model }          (openai-compat, xAI)
# custom:    { provider, base_url, model, api_key? }
# local:     { provider, local_type, model_path, n_ctx?, max_tokens? }
#              local_type: "gguf" | "hf"
# ──────────────────────────────────────────────

SYSTEM_PROMPT = (
    "You are a knowledgeable and helpful AI assistant. "
    "Answer the user's question clearly and accurately. "
    "If you are unsure, say so honestly."
)


def _build_messages(question: str, history: list) -> list:
    """Convert history + current question into a messages list."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for turn in (history or []):
        role = turn.get("role", "user")
        content = turn.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": question})
    return messages


# ──────────────────────────────────────────────
# Provider implementations
# ──────────────────────────────────────────────

def _call_openai_compat(api_key: str, base_url: str, model: str, messages: list,
                         max_tokens: int = 1024) -> str:
    """Generic OpenAI-compatible call (works for OpenAI, Mistral, Groq, xAI, Custom)."""
    try:
        from openai import OpenAI
    except ImportError:
        raise RuntimeError("openai package not installed. Run: pip install openai")

    kwargs = {"api_key": api_key or "none", "max_retries": 2}
    if base_url:
        kwargs["base_url"] = base_url

    client = OpenAI(**kwargs)
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        max_tokens=max_tokens,
        temperature=0.7,
    )
    return response.choices[0].message.content.strip()


def _call_anthropic(api_key: str, model: str, messages: list, max_tokens: int = 1024) -> str:
    try:
        import anthropic
    except ImportError:
        raise RuntimeError("anthropic package not installed. Run: pip install anthropic")

    client = anthropic.Anthropic(api_key=api_key)

    # Separate system from messages
    system_msg = next((m["content"] for m in messages if m["role"] == "system"), SYSTEM_PROMPT)
    chat_messages = [m for m in messages if m["role"] != "system"]

    response = client.messages.create(
        model=model,
        system=system_msg,
        messages=chat_messages,
        max_tokens=max_tokens,
    )
    return response.content[0].text.strip()


def _call_gemini(api_key: str, model: str, messages: list, max_tokens: int = 1024) -> str:
    try:
        import google.generativeai as genai
    except ImportError:
        raise RuntimeError("google-generativeai not installed. Run: pip install google-generativeai")

    genai.configure(api_key=api_key)
    gem_model = genai.GenerativeModel(model)

    # Flatten messages into a single prompt (Gemini free-tier doesn't support multi-turn well)
    combined = "\n".join(
        f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content']}"
        for m in messages if m["role"] != "system"
    )
    response = gem_model.generate_content(
        combined,
        generation_config=genai.types.GenerationConfig(max_output_tokens=max_tokens)
    )
    return response.text.strip()


def _call_cohere(api_key: str, model: str, messages: list, max_tokens: int = 1024) -> str:
    try:
        import cohere
    except ImportError:
        raise RuntimeError("cohere package not installed. Run: pip install cohere")

    client = cohere.Client(api_key)
    # Cohere uses chat_history + message format
    chat_history = []
    for m in messages:
        if m["role"] == "system":
            continue
        role = "USER" if m["role"] == "user" else "CHATBOT"
        chat_history.append({"role": role, "message": m["content"]})

    # Last user message is the query
    if chat_history and chat_history[-1]["role"] == "USER":
        last_msg = chat_history.pop()["message"]
    else:
        last_msg = messages[-1]["content"]

    response = client.chat(
        model=model,
        message=last_msg,
        chat_history=chat_history,
        max_tokens=max_tokens,
    )
    return response.text.strip()


def _call_local_gguf(model_path: str, messages: list,
                      n_ctx: int = 4096, max_tokens: int = 1024) -> str:
    try:
        from llama_cpp import Llama
    except ImportError:
        raise RuntimeError(
            "llama-cpp-python not installed. Run: pip install llama-cpp-python"
        )

    if not os.path.isfile(model_path):
        raise RuntimeError(f"GGUF model file not found: {model_path}")

    llm = Llama(
        model_path=model_path,
        n_ctx=n_ctx,
        n_threads=os.cpu_count() or 4,
        verbose=False,
    )
    response = llm.create_chat_completion(
        messages=messages,
        max_tokens=max_tokens,
        temperature=0.7,
        stop=["</s>", "<|im_end|>"],
    )
    return response["choices"][0]["message"]["content"].strip()


def _call_local_hf(model_path: str, messages: list, max_tokens: int = 512) -> str:
    try:
        from transformers import pipeline, AutoTokenizer, AutoModelForCausalLM
        import torch
    except ImportError:
        raise RuntimeError(
            "transformers/torch not installed. Run: pip install transformers torch"
        )

    if not os.path.exists(model_path):
        raise RuntimeError(f"HuggingFace model path not found: {model_path}")

    # Build a single prompt string from messages
    prompt_parts = []
    for m in messages:
        if m["role"] == "system":
            prompt_parts.append(f"System: {m['content']}")
        elif m["role"] == "user":
            prompt_parts.append(f"User: {m['content']}")
        else:
            prompt_parts.append(f"Assistant: {m['content']}")
    prompt_parts.append("Assistant:")
    prompt = "\n".join(prompt_parts)

    pipe = pipeline(
        "text-generation",
        model=model_path,
        tokenizer=model_path,
        device_map="auto",
        torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
    )
    output = pipe(
        prompt,
        max_new_tokens=max_tokens,
        do_sample=True,
        temperature=0.7,
        pad_token_id=pipe.tokenizer.eos_token_id,
    )
    full_text = output[0]["generated_text"]
    # Return only the new tokens after the prompt
    return full_text[len(prompt):].strip()


# ──────────────────────────────────────────────
# Public entry point
# ──────────────────────────────────────────────

def direct_answer(question: str, api_config: dict, history: list = None) -> dict:
    """
    Answer a question directly via the configured LLM, without RAG retrieval.

    Returns:
        {
            "answer": str,
            "sources": [],           # always empty — no RAG
            "mode": "direct_llm"
        }
    """
    if not api_config:
        return {
            "answer": "No LLM is configured. Please set up an API provider first.",
            "sources": [],
            "mode": "direct_llm",
        }

    provider    = api_config.get("provider", "").lower()
    api_key     = api_config.get("api_key", "")
    model       = api_config.get("model", "")
    max_tokens  = int(api_config.get("max_tokens", 1024))
    messages    = _build_messages(question, history or [])

    try:
        # ── OpenAI ───────────────────────────────────
        if provider == "openai":
            answer = _call_openai_compat(
                api_key=api_key,
                base_url=None,
                model=model or "gpt-4o",
                messages=messages,
                max_tokens=max_tokens,
            )

        # ── Anthropic ────────────────────────────────
        elif provider == "anthropic":
            answer = _call_anthropic(
                api_key=api_key,
                model=model or "claude-3-5-sonnet-20241022",
                messages=messages,
                max_tokens=max_tokens,
            )

        # ── Google Gemini ────────────────────────────
        elif provider == "gemini":
            answer = _call_gemini(
                api_key=api_key,
                model=model or "gemini-1.5-pro",
                messages=messages,
                max_tokens=max_tokens,
            )

        # ── Cohere ───────────────────────────────────
        elif provider == "cohere":
            answer = _call_cohere(
                api_key=api_key,
                model=model or "command-r-plus",
                messages=messages,
                max_tokens=max_tokens,
            )

        # ── Mistral (OpenAI-compat) ───────────────────
        elif provider == "mistral":
            answer = _call_openai_compat(
                api_key=api_key,
                base_url="https://api.mistral.ai/v1",
                model=model or "mistral-large-latest",
                messages=messages,
                max_tokens=max_tokens,
            )

        # ── Groq (OpenAI-compat) ─────────────────────
        elif provider == "groq":
            answer = _call_openai_compat(
                api_key=api_key,
                base_url="https://api.groq.com/openai/v1",
                model=model or "llama3-70b-8192",
                messages=messages,
                max_tokens=max_tokens,
            )

        # ── xAI Grok (OpenAI-compat) ─────────────────
        elif provider == "grok":
            answer = _call_openai_compat(
                api_key=api_key,
                base_url="https://api.x.ai/v1",
                model=model or "grok-3",
                messages=messages,
                max_tokens=max_tokens,
            )

        # ── Custom / OSS (OpenAI-compat) ─────────────
        elif provider == "custom":
            base_url = api_config.get("base_url", "http://localhost:11434/v1")
            answer = _call_openai_compat(
                api_key=api_key or "ollama",
                base_url=base_url,
                model=model,
                messages=messages,
                max_tokens=max_tokens,
            )

        # ── Local GGUF ───────────────────────────────
        elif provider == "local" and api_config.get("local_type") == "gguf":
            model_path = api_config.get("model_path", "")
            n_ctx = int(api_config.get("n_ctx", 4096))
            answer = _call_local_gguf(
                model_path=model_path,
                messages=messages,
                n_ctx=n_ctx,
                max_tokens=max_tokens,
            )

        # ── Local HuggingFace ────────────────────────
        elif provider == "local" and api_config.get("local_type") == "hf":
            model_path = api_config.get("model_path", "")
            answer = _call_local_hf(
                model_path=model_path,
                messages=messages,
                max_tokens=max_tokens,
            )

        else:
            answer = (
                f"Unknown provider '{provider}'. "
                "Supported: openai, anthropic, gemini, cohere, mistral, groq, grok, custom, local."
            )

    except Exception as exc:
        return {
            "answer": f"[LLM Error] {str(exc)}",
            "sources": [],
            "mode": "direct_llm",
            "error": str(exc),
        }

    return {
        "answer": answer,
        "sources": [],
        "mode": "direct_llm",
    }
