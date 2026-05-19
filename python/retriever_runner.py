"""
python/retriever_runner.py

Called by main.js as:
    python retriever_runner.py "<question>" "<db_name>" "<config_path>" "<free_mode>"

db_name   = "__all__"  → search every collection
            <name>     → search only that collection
config_path = absolute path to storage/api_config.json
free_mode   = "true" | "false"  (optional, default "false")
              When "true" the LLM is called directly without RAG retrieval.
"""

import sys
import json
import os
import warnings

# Silence all non-JSON output — everything goes to stderr
actual_stdout = sys.stdout
sys.stdout = sys.stderr

warnings.filterwarnings("ignore")
os.environ["TRANSFORMERS_VERBOSITY"] = "error"

# Path setup
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT_DIR)

from rag.retriever import retrieve_and_answer

# Argument validation
if len(sys.argv) < 4:
    print(json.dumps({
        "error": "Missing arguments: question db_name config_path [free_mode]"
    }), file=actual_stdout)
    sys.exit(1)

question    = sys.argv[1]
db_name     = sys.argv[2]
config_path = sys.argv[3]

# free_mode is optional — defaults to False
free_mode = False
if len(sys.argv) >= 5:
    free_mode = sys.argv[4].strip().lower() == "true"

# Load API config (may be None)
api_config = None
if os.path.isfile(config_path):
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            api_config = json.load(f)
    except Exception:
        api_config = None

# Run retrieval (or free-mode LLM call)
try:
    result = retrieve_and_answer(
        user_id    = "user_1",
        question   = question,
        db_name    = db_name,
        api_config = api_config,
        free_mode  = free_mode
    )
    print(json.dumps(result), file=actual_stdout)
except Exception as e:
    print(json.dumps({"error": str(e)}), file=actual_stdout)