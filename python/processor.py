import os
from rag.chunker import chunk_documents
from rag.vectordb import store_chunks
from langchain_community.document_loaders import PyPDFLoader

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
UPLOAD_DIR = os.path.join(BASE_DIR, "storage/uploads")

os.makedirs(UPLOAD_DIR, exist_ok=True)

def process_pdf(file_path, chunk_size=500, overlap=100, dataset_name="default_db"):
    loader = PyPDFLoader(file_path)
    docs = loader.load()

    chunks = chunk_documents(docs, chunk_size=chunk_size, chunk_overlap=overlap)

    for chunk in chunks:
        chunk.metadata["source"] = os.path.basename(file_path)

    # Use the user-provided dataset_name here
    stored = store_chunks(
        user_id="user_1",
        dataset_name=dataset_name, 
        chunks=chunks
    )

    return {
        "message": f"Successfully added to {dataset_name}",
        "chunks": stored
    }