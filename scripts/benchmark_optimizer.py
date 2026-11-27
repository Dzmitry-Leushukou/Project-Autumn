"""Full-day optimizer timing and complete-result reproducibility fingerprints."""

import argparse
import hashlib
import json
from pathlib import Path
import platform
from time import perf_counter

from data_io.network import read_network, require_network
from models.nsga2 import optimize


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--network", choices=("medium", "london"), default="medium")
    parser.add_argument("--repeat", type=int, default=2)
    args = parser.parse_args()
    if args.repeat < 1:
        parser.error("--repeat must be positive")
    root = Path(__file__).resolve().parents[1]
    relative = (
        "synthetic/e_medium.json"
        if args.network == "medium"
        else "london/london_subset.json"
    )
    network = require_network(read_network(root / "datasets" / relative))
    output = {
        "network": relative,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "settings": network.settings.optimizer.model_dump(),
        "day_start_s": network.settings.day_start_s,
        "day_end_s": network.settings.day_end_s,
        "runs": [],
    }
    for _ in range(args.repeat):
        start = perf_counter()
        result = optimize(network)
        elapsed = perf_counter() - start
        digest = hashlib.sha256(
            json.dumps(result, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        row = {
            "seconds": elapsed,
            "result_sha256": digest,
            "stop_reason": result["stop_reason"],
            "reproducible": result["reproducible"],
            "generations_completed": result["generations_completed"],
            "evaluations": result["evaluations"],
            "front_points": len(result["front"]),
            "options": [
                {
                    "name": o["name"],
                    "f_A": o["f_A"],
                    "f_B": o["f_B"],
                    "W": o["metrics"]["W"],
                    "seeds": o["seeds"],
                }
                for o in result["options"]
            ],
        }
        output["runs"].append(row)
        output["identical_results"] = (
            len({r["result_sha256"] for r in output["runs"]}) == 1
        )
        (root / f"docs/{args.network}_optimizer_verified.json").write_text(
            json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(json.dumps(row, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
