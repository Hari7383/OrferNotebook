import sys
import json
import os
import warnings

# ---------------------------
# SILENCE ALL LOGS (YOUR LOGIC)
# ---------------------------
actual_stdout = sys.stdout
sys.stdout = sys.stderr

warnings.filterwarnings("ignore")
os.environ["TRANSFORMERS_VERBOSITY"] = "error"

# ---------------------------
# PATH SETUP (COMMON)
# ---------------------------
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT_DIR)

from processor import process_pdf

# ---------------------------
# ARGUMENT VALIDATION
# ---------------------------
if len(sys.argv) < 5:
    print(json.dumps({
        "error": "Missing arguments: file_path chunk_size overlap dataset_name"
    }), file=actual_stdout)
    sys.exit(1)

file_input = sys.argv[1]
chunk_size = int(sys.argv[2])
overlap = int(sys.argv[3])
dataset_name = sys.argv[4]

# ---------------------------
# HANDLE SINGLE / MULTIPLE FILES (TEAM LOGIC)
# ---------------------------
try:
    file_paths = json.loads(file_input)
    if not isinstance(file_paths, list):
        file_paths = [file_paths]
except:
    file_paths = [file_input]

results = []

# ---------------------------
# PROCESS LOOP (MERGED)
# ---------------------------
try:
    for file_path in file_paths:
        result = process_pdf(file_path, chunk_size, overlap, dataset_name)

        results.append({
            "file": file_path,
            "chunks": result.get("chunks", 0)
        })

    # ---------------------------
    # FINAL OUTPUT (CLEAN JSON ONLY)
    # ---------------------------
    print(json.dumps({
        "message": "Processing complete",
        "dataset": dataset_name,
        "files_processed": len(results),
        "details": results
    }), file=actual_stdout)

except Exception as e:
    print(json.dumps({
        "error": str(e)
    }), file=actual_stdout)

