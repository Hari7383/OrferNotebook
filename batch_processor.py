"""
backend/batch_processor.py

Batch processing utilities for efficient document embedding and processing.
Replaces sequential processing with concurrent operations.
"""

import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Any, Callable, Optional


class BatchProcessor:
    """Process items in parallel batches."""

    def __init__(self, max_workers: int = 4, batch_size: int = 32):
        """
        Initialize batch processor.

        Args:
            max_workers: Number of concurrent threads
            batch_size: Items per batch
        """
        self.max_workers = max(1, min(max_workers, os.cpu_count() or 4))
        self.batch_size = batch_size

    def process_batch(
        self,
        items: List[Any],
        processor_func: Callable,
        show_progress: bool = False
    ) -> List[Any]:
        """
        Process items in parallel batches.

        Args:
            items: Items to process
            processor_func: Function that processes one item
            show_progress: Whether to print progress

        Returns:
            List of processed results in original order
        """
        if not items:
            return []

        results = [None] * len(items)

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {}

            for idx, item in enumerate(items):
                future = executor.submit(processor_func, item)
                futures[future] = idx

            completed = 0
            for future in as_completed(futures):
                idx = futures[future]
                try:
                    results[idx] = future.result()
                except Exception as e:
                    print(f"Error processing item {idx}: {e}")
                    results[idx] = None

                completed += 1
                if show_progress and completed % max(1, len(items) // 10) == 0:
                    print(f"  Progress: {completed}/{len(items)}")

        return results

    def process_batches(
        self,
        items: List[Any],
        batch_processor: Callable,
        show_progress: bool = False
    ) -> List[Any]:
        """
        Process items in sequential batches (for memory efficiency).

        Args:
            items: Items to process
            batch_processor: Function that processes a batch
            show_progress: Whether to print progress

        Returns:
            Aggregated results
        """
        if not items:
            return []

        results = []

        for i in range(0, len(items), self.batch_size):
            batch = items[i:i + self.batch_size]
            batch_results = batch_processor(batch)
            results.extend(batch_results)

            if show_progress:
                processed = min(i + self.batch_size, len(items))
                print(f"  Progress: {processed}/{len(items)}")

        return results


class EmbeddingBatcher:
    """Batch embedding generation for multiple texts."""

    def __init__(self, embedding_func: Callable, batch_size: int = 32):
        """
        Initialize embedding batcher.

        Args:
            embedding_func: Function that embeds a single text
            batch_size: Texts per batch
        """
        self.embedding_func = embedding_func
        self.batch_size = batch_size

    def embed_batch(self, texts: List[str], show_progress: bool = False) -> List[List[float]]:
        """
        Generate embeddings for multiple texts efficiently.

        Args:
            texts: List of texts to embed
            show_progress: Whether to print progress

        Returns:
            List of embeddings
        """
        embeddings = []

        for i in range(0, len(texts), self.batch_size):
            batch = texts[i:i + self.batch_size]
            batch_embeddings = [self.embedding_func(text) for text in batch]
            embeddings.extend(batch_embeddings)

            if show_progress and (i + self.batch_size) % (self.batch_size * 5) == 0:
                print(f"  Embedded: {min(i + self.batch_size, len(texts))}/{len(texts)}")

        return embeddings


# Helper functions
def parallel_map(
    items: List[Any],
    func: Callable,
    max_workers: int = 4
) -> List[Any]:
    """
    Map a function over items in parallel.

    Args:
        items: Input items
        func: Function to apply
        max_workers: Number of threads

    Returns:
        Results in original order
    """
    processor = BatchProcessor(max_workers=max_workers)
    return processor.process_batch(items, func, show_progress=False)


def batch_embeddings(
    texts: List[str],
    embedding_func: Callable,
    batch_size: int = 32
) -> List[List[float]]:
    """
    Generate embeddings in batches (more memory efficient).

    Args:
        texts: Texts to embed
        embedding_func: Embedding function
        batch_size: Batch size

    Returns:
        List of embeddings
    """
    batcher = EmbeddingBatcher(embedding_func, batch_size)
    return batcher.embed_batch(texts, show_progress=False)
