"""
backend/metrics.py

Performance monitoring and profiling module.
Tracks query times, cache performance, and system metrics.
"""

import time
import json
from collections import defaultdict
from typing import Dict, List, Any, Optional


class PerformanceMetrics:
    """Track performance metrics for queries and operations."""

    def __init__(self):
        self._query_times: List[float] = []
        self._operation_times: Dict[str, List[float]] = defaultdict(list)
        self._slow_queries: List[Dict[str, Any]] = []
        self._cache_stats = {"hits": 0, "misses": 0}
        self.slow_query_threshold_ms = 2000

    def record_query(self, question: str, duration_ms: float, from_cache: bool = False) -> None:
        """Record query execution time."""
        self._query_times.append(duration_ms)

        if from_cache:
            self._cache_stats["hits"] += 1
        else:
            self._cache_stats["misses"] += 1

        if duration_ms > self.slow_query_threshold_ms:
            self._slow_queries.append({
                "question": question[:100],
                "duration_ms": round(duration_ms, 2),
                "timestamp": time.time()
            })

    def record_operation(self, operation_name: str, duration_ms: float) -> None:
        """Record generic operation timing (embedding, reranking, etc)."""
        self._operation_times[operation_name].append(duration_ms)

    def get_stats(self) -> Dict[str, Any]:
        """Get aggregated performance statistics."""
        if not self._query_times:
            return {}

        query_times = sorted(self._query_times)
        n = len(query_times)

        cache_total = self._cache_stats["hits"] + self._cache_stats["misses"]
        hit_rate = (
            (self._cache_stats["hits"] / cache_total * 100)
            if cache_total > 0
            else 0
        )

        return {
            "queries": {
                "total": n,
                "avg_ms": round(sum(query_times) / n, 2),
                "min_ms": round(query_times[0], 2),
                "max_ms": round(query_times[-1], 2),
                "p50_ms": round(query_times[n // 2], 2),
                "p95_ms": round(query_times[int(n * 0.95)], 2),
                "p99_ms": round(query_times[int(n * 0.99)], 2),
            },
            "cache": {
                "hits": self._cache_stats["hits"],
                "misses": self._cache_stats["misses"],
                "hit_rate_percent": round(hit_rate, 2),
            },
            "slow_queries": {
                "count": len(self._slow_queries),
                "threshold_ms": self.slow_query_threshold_ms,
                "recent": self._slow_queries[-5:],  # Last 5 slow queries
            },
            "operations": {
                name: {
                    "count": len(times),
                    "avg_ms": round(sum(times) / len(times), 2),
                    "min_ms": round(min(times), 2),
                    "max_ms": round(max(times), 2),
                }
                for name, times in self._operation_times.items()
            }
        }

    def reset(self) -> None:
        """Clear all metrics."""
        self._query_times.clear()
        self._operation_times.clear()
        self._slow_queries.clear()
        self._cache_stats = {"hits": 0, "misses": 0}


# Global metrics instance
_metrics = PerformanceMetrics()


def record_query(question: str, duration_ms: float, from_cache: bool = False) -> None:
    """Public API: Record a query execution."""
    _metrics.record_query(question, duration_ms, from_cache)


def record_operation(operation_name: str, duration_ms: float) -> None:
    """Public API: Record operation timing."""
    _metrics.record_operation(operation_name, duration_ms)


def get_performance_stats() -> Dict[str, Any]:
    """Public API: Get current performance statistics."""
    return _metrics.get_stats()


def reset_metrics() -> None:
    """Public API: Reset all metrics."""
    _metrics.reset()


class Timer:
    """Context manager for timing operations."""

    def __init__(self, operation_name: Optional[str] = None):
        self.operation_name = operation_name
        self.start_time = None
        self.duration_ms = None

    def __enter__(self):
        self.start_time = time.time()
        return self

    def __exit__(self, *args):
        self.duration_ms = (time.time() - self.start_time) * 1000
        if self.operation_name:
            record_operation(self.operation_name, self.duration_ms)
