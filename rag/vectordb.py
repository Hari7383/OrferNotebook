import os
from langchain_community.vectorstores import Chroma
from .embeddings import get_embeddings

embeddings = get_embeddings()

def get_vector_db(user_id, dataset_name):
    base_path = f"storage/users/{user_id}/{dataset_name}"
    os.makedirs(base_path, exist_ok=True)

    db = Chroma(
        persist_directory=base_path,
        embedding_function=embeddings
    )
    # print("DB PATH:", base_path)
    return db


def store_chunks(user_id, dataset_name, chunks):
    db = get_vector_db(user_id, dataset_name)
    db.add_documents(chunks)
    # db.persist()
    return len(chunks)