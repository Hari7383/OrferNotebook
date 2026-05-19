"""
backend/caching.py

Efficient in-memory query result caching layer with TTL support.
Replaces expensive embedding + reranking operations for repeated queries.

Features:
- Query result caching with configurable TTL (time-to-live)
- Cache invalidation on document updates
- Per-user collection cache isolation
- Memory-efficient with automatic eviction
"""

import hashlib
import time
from typing import Dict, List, Any, Optional, Tuple
from collections import OrderedDict


class QueryCache:
    """In-memory cache for query results with TTL and automatic eviction."""

    def __init__(self, max_entries: int = 500, default_ttl: int = 3600):
        """
        Initialize query cache.

        Args:
            max_entries: Maximum number of cached queries (default 500)
            default_ttl: Default time-to-live in seconds (default 1 hour)
        """
        self.max_entries = max_entries
        self.default_ttl = default_ttl
        self._cache: Dict[str, Tuple[Any, float]] = OrderedDict()
        self._stats = {"hits": 0, "misses": 0, "evictions": 0}

    def _make_key(self, user_id: str, question: str, db_names: List[str]) -> str:
        """Generate cache key from user, question, and db names."""
        key_str = f"{user_id}:{question}:{','.join(sorted(db_names))}"
        return hashlib.md5(key_str.encode()).hexdigest()

    def get(
        self, user_id: str, question: str, db_names: List[str]
    ) -> Optional[Any]:
        """
        Retrieve cached result if exists and not expired.

        Returns:
            Cached result or None if miss/expired
        """
        key = self._make_key(user_id, question, db_names)
        self._cleanup_expired()

        if key not in self._cache:
            self._stats["misses"] += 1
            return None

        result, timestamp = self._cache[key]
        if time.time() - timestamp > self.default_ttl:
            del self._cache[key]
            self._stats["misses"] += 1
            return None

        # Move to end (LRU)
        self._cache.move_to_end(key)
        self._stats["hits"] += 1
        return result

    def set(
        self, user_id: str, question: str, db_names: List[str], result: Any
    ) -> None:
        """
        Store result in cache.

        Args:
            user_id: User identifier
            question: Query string
            db_names: List of collection names queried
            result: Result to cache
        """
        key = self._make_key(user_id, question, db_names)
        self._cache[key] = (result, time.time())
        self._cache.move_to_end(key)

        if len(self._cache) > self.max_entries:
            evicted = self._cache.popitem(last=False)
            self._stats["evictions"] += 1

    def invalidate_user(self, user_id: str) -> int:
        """
        Invalidate all cached results for a user (e.g., after document upload).

        Returns:
            Number of entries invalidated
        """
        prefix = f"{user_id}:"
        keys_to_delete = [k for k in self._cache.keys() if k.startswith(prefix)]
        for k in keys_to_delete:
            del self._cache[k]
        return len(keys_to_delete)

    def invalidate_collection(self, user_id: str, db_name: str) -> int:
        """
        Invalidate cached results for specific collection.

        Returns:
            Number of entries invalidated
        """
        prefix = f"{user_id}:{db_name}"
        keys_to_delete = [
            k for k in self._cache.keys() if prefix in k
        ]
        for k in keys_to_delete:
            del self._cache[k]
        return len(keys_to_delete)

    def clear(self) -> None:
        """Clear entire cache."""
        self._cache.clear()

    def _cleanup_expired(self) -> None:
        """Remove expired entries (lazy cleanup)."""
        current_time = time.time()
        expired = [
            k for k, (_, ts) in self._cache.items()
            if current_time - ts > self.default_ttl
        ]
        for k in expired:
            del self._cache[k]

    def stats(self) -> Dict[str, Any]:
        """Return cache statistics."""
        total = self._stats["hits"] + self._stats["misses"]
        hit_rate = (
            (self._stats["hits"] / total * 100)
            if total > 0
            else 0
        )
        return {
            "hits": self._stats["hits"],
            "misses": self._stats["misses"],
            "evictions": self._stats["evictions"],
            "hit_rate": round(hit_rate, 2),
            "entries": len(self._cache),
            "capacity": self.max_entries,
        }

    def reset_stats(self) -> None:
        """Reset statistics counters."""
        self._stats = {"hits": 0, "misses": 0, "evictions": 0}


# Global cache instance (initialized once on import)
_query_cache = QueryCache()


def get_cached_result(
    user_id: str, question: str, db_names: List[str]
) -> Optional[Any]:
    """Public API: Get cached query result."""
    return _query_cache.get(user_id, question, db_names)


def set_cached_result(
    user_id: str, question: str, db_names: List[str], result: Any
) -> None:
    """Public API: Store query result in cache."""
    _query_cache.set(user_id, question, db_names, result)


def invalidate_user_cache(user_id: str) -> int:
    """Public API: Clear all cache for user."""
    return _query_cache.invalidate_user(user_id)


def invalidate_collection_cache(user_id: str, db_name: str) -> int:
    """Public API: Clear cache for specific collection."""
    return _query_cache.invalidate_collection(user_id, db_name)


def get_cache_stats() -> Dict[str, Any]:
    """Public API: Get cache statistics."""
    return _query_cache.stats()
