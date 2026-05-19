# OrferNotebook

<div align="center">

![OrferNotebook Banner](https://img.shields.io/badge/OrferNotebook-Advanced%20RAG%20Platform-blue?style=for-the-badge)

### Powerful Multi-Model AI Workspace for Advanced RAG, Local LLMs, Cloud APIs, and Smart Knowledge Management

</div>

---

## 🚀 Overview

OrferNotebook is an advanced AI-powered RAG (Retrieval-Augmented Generation) platform designed to simplify working with:

- Local LLMs
- Cloud AI APIs
- Vector Databases
- Multi-Agent AI Systems
- Document Processing
- Intelligent Knowledge Retrieval

The platform provides a clean UI to create, manage, visualize, and interact with AI knowledge bases efficiently.

---

## ✨ Features

### 🧠 AI Model Support
- OpenAI Models
- Gemini Models
- Claude Models
- Groq Models
- Ollama Local Models
- LM Studio Models
- OpenRouter APIs
- Custom API Integration

### 📚 Advanced RAG System
- Smart document ingestion
- Chunking and embeddings
- Semantic search
- Context-aware retrieval
- Multi-document querying

### 🗂 Database Management
- Easy vector database creation
- Database visualization UI
- Collection management
- Metadata inspection
- Fast indexing

### 🔍 File Processing
Supports:
- PDF
- DOCX
- TXT
- CSV
- JSON
- Markdown
- Images (OCR/VLM Ready)

### ⚡ Performance
- Optimized retrieval pipeline
- Fast response generation
- Local + cloud hybrid execution
- Streaming responses

### 🎨 Modern UI
- Clean notebook-style interface
- Interactive chat workspace
- AI workflow management
- Simple configuration setup

---

# 🏗 Architecture

```text
                ┌────────────────────┐
                │     User UI        │
                └─────────┬──────────┘
                          │
                          ▼
                ┌────────────────────┐
                │  OrferNotebook     │
                │  Core Engine       │
                └─────────┬──────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
 ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
 │ Vector DB   │   │ Local LLMs  │   │ Cloud APIs  │
 └─────────────┘   └─────────────┘   └─────────────┘
```

---

# 📦 Installation

## 1️⃣ Clone Repository

```bash
git clone https://github.com/Hari7383/OrferNotebook.git
cd OrferNotebook
```

---

## 2️⃣ Create Virtual Environment

### Windows

```bash
python -m venv venv
venv\Scripts\activate
```

### Linux / macOS

```bash
python3 -m venv venv
source venv/bin/activate
```

---

## 3️⃣ Install Dependencies

```bash
pip install -r requirements.txt
```

---

# ▶️ Run Project

```bash
python app.py
```

or

```bash
streamlit run app.py
```

---

# ⚙️ Environment Variables

Create a `.env` file:

```env
OPENAI_API_KEY=your_key
GEMINI_API_KEY=your_key
GROQ_API_KEY=your_key
OPENROUTER_API_KEY=your_key
```

---

# 📁 Project Structure

```text
OrferNotebook/
│
├── app.py
├── requirements.txt
├── README.md
├── LICENSE
├── data/
├── database/
├── models/
├── embeddings/
├── uploads/
├── utils/
└── assets/
```

---

# 🧩 Supported Use Cases

- Enterprise RAG Systems
- AI Chat Applications
- AI Research Assistant
- Document Intelligence
- Multi-Agent AI Workflows
- AI Knowledge Base
- Offline AI Workspace
- AI Notebook Platform

---

# 🔥 Why OrferNotebook?

✅ Beginner Friendly  
✅ Advanced RAG Pipeline  
✅ Multi-LLM Support  
✅ Local + Cloud AI  
✅ Extendable Architecture  
✅ Fast Setup  
✅ UI-Based Database Management  

---

# 🛠 Tech Stack

- Python
- FastAPI / Flask
- Streamlit
- LangChain
- ChromaDB
- FAISS
- Ollama
- Transformers
- OpenAI APIs
- Gemini APIs

---

# 🤝 Contributing

Contributions are welcome.

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

---

# 📜 License

This project is licensed under the MIT License.

---

# 🌟 Support

If you like this project:

- Star the repository
- Share the project
- Contribute improvements

---

<div align="center">

### Built for the next generation of AI applications 🚀

</div>
