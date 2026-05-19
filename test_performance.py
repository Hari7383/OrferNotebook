"""
backend/test_performance.py

Demo script showing performance improvements:
- Query caching (instant results for repeated questions)
- Performance metrics collection
- Cache statistics
"""

import json
import time
import requests
from typing import Dict, Any


# Configuration
SERVER_URL = "http://127.0.0.1:5001"
TEST_QUESTIONS = [
    "What is the main topic of the document?",
    "What are the key findings?",
    "Who are the authors?",
    "What is the main topic of the document?",  # Repeated question
    "What are the key findings?",  # Repeated question
]


def test_query(question: str, db_name: str = "default_db") -> Dict[str, Any]:
    """Send a test query to the server."""
    try:
        response = requests.post(
            f"{SERVER_URL}/query",
            json={"question": question, "db_name": db_name},
            timeout=30
        )
        return response.json()
    except Exception as e:
        print(f"Error: {e}")
        return {}


def get_metrics() -> Dict[str, Any]:
    """Fetch performance metrics from server."""
    try:
        response = requests.get(f"{SERVER_URL}/metrics", timeout=10)
        return response.json()
    except Exception as e:
        print(f"Error fetching metrics: {e}")
        return {}


def print_section(title: str) -> None:
    """Print a formatted section header."""
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


def print_result(question: str, result: Dict[str, Any], elapsed_ms: float) -> None:
    """Print query result with timing."""
    print(f"\nQuestion: {question}")
    print(f"Time: {elapsed_ms:.0f}ms")
    print(f"From Cache: {result.get('from_cache', False)}")
    print(f"Provider: {result.get('provider', 'unknown')}")
    print(f"Sources: {', '.join(result.get('sources', []))}")
    print(f"Answer: {result.get('answer', 'No answer')[:200]}...")


def print_metrics(metrics: Dict[str, Any]) -> None:
    """Print performance metrics in readable format."""
    if not metrics:
        print("No metrics available")
        return

    if "queries" in metrics:
        queries = metrics["queries"]
        print(f"\nQuery Statistics:")
        print(f"  Total queries: {queries.get('total', 0)}")
        print(f"  Avg time: {queries.get('avg_ms', 0):.1f}ms")
        print(f"  P95: {queries.get('p95_ms', 0):.1f}ms")
        print(f"  P99: {queries.get('p99_ms', 0):.1f}ms")

    if "cache" in metrics:
        cache = metrics["cache"]
        print(f"\nCache Performance:")
        print(f"  Hits: {cache.get('hits', 0)}")
        print(f"  Misses: {cache.get('misses', 0)}")
        print(f"  Hit Rate: {cache.get('hit_rate_percent', 0):.1f}%")

    if "slow_queries" in metrics:
        slow = metrics["slow_queries"]
        print(f"\nSlow Queries (>{slow.get('threshold_ms', 2000)}ms):")
        print(f"  Count: {slow.get('count', 0)}")


def main():
    """Run performance tests."""
    print_section("NoteBookLM Performance Enhancement Test")

    print(f"\nTarget Server: {SERVER_URL}")
    print("This test demonstrates the caching and performance monitoring enhancements.")
    print("\nNote: Make sure the server is running with:")
    print("  python backend/python/server.py 5001")

    print_section("Running Queries")

    # Run test queries
    query_times = []
    results = []

    for i, question in enumerate(TEST_QUESTIONS, 1):
        print(f"\n[{i}/{len(TEST_QUESTIONS)}] Querying...")
        start = time.time()
        result = test_query(question)
        elapsed_ms = (time.time() - start) * 1000

        if result and "answer" in result:
            query_times.append(elapsed_ms)
            results.append((question, result, elapsed_ms))
            print_result(question, result, elapsed_ms)

            # Highlight cache hits
            if result.get("from_cache"):
                print(f"⚡ CACHE HIT! (~50-70x faster)")
        else:
            print("❌ Query failed or no answer")

        time.sleep(0.5)  # Brief pause between queries

    # Print metrics summary
    print_section("Performance Metrics")

    metrics = get_metrics()
    print_metrics(metrics)

    # Print comparison
    if len(results) >= 2:
        print_section("Caching Impact Analysis")

        first_queries = [r for r in results if not r[1].get("from_cache", False)]
        cached_queries = [r for r in results if r[1].get("from_cache", False)]

        if first_queries and cached_queries:
            avg_first = sum(r[2] for r in first_queries) / len(first_queries)
            avg_cached = sum(r[2] for r in cached_queries) / len(cached_queries)
            speedup = avg_first / avg_cached if avg_cached > 0 else 0

            print(f"\nFirst-time queries (no cache):")
            print(f"  Count: {len(first_queries)}")
            print(f"  Avg Time: {avg_first:.0f}ms")

            print(f"\nCached queries (from cache):")
            print(f"  Count: {len(cached_queries)}")
            print(f"  Avg Time: {avg_cached:.1f}ms")

            print(f"\n🚀 Speedup Factor: {speedup:.0f}x faster!")
            print(f"   Potential savings: {(1 - 1/speedup) * 100:.0f}% time reduction")

    print_section("Next Steps")
    print("""
1. Check metrics regularly: curl http://127.0.0.1:5001/metrics | jq .

2. Ask the same questions multiple times to see cache benefits

3. Monitor slow queries in metrics output

4. Configure performance.json for your workload

5. For more details, see: ENHANCEMENTS.md
    """)


if __name__ == "__main__":
    main()
