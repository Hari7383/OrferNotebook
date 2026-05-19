from langchain_text_splitters import RecursiveCharacterTextSplitter

def get_text_splitter(chunk_size=500, chunk_overlap=100):
    return RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n", ".", " ", ""]
    )


def chunk_documents(docs, chunk_size=500, chunk_overlap=100):
    splitter = get_text_splitter(chunk_size, chunk_overlap)
    chunks = splitter.split_documents(docs)
    # print("Storing chunks...")
    # print("Chunks:", len(chunks))
    return chunks