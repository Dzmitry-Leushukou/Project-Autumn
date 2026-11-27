import json
from pathlib import Path
from time import perf_counter
from models.discrete_events import Simulator
from data_io.network import require_network, read_network
from models.nsga2 import optimize


def main():
    root = Path(__file__).resolve().parents[1]
    n = require_network(read_network(root / "datasets/london/london_subset.json"))
    t = perf_counter()
    run = Simulator(n).run()
    simulation_s = perf_counter() - t
    t = perf_counter()
    result = optimize(n)
    optimization_s = perf_counter() - t
    summary = {
        "simulation_s": simulation_s,
        "optimization_s": optimization_s,
        "synthetic": n.meta.synthetic,
        "network": n.meta.name,
        "baseline": {
            k: run["metrics"][k]
            for k in ("W", "D", "LF", "appeared", "transported", "unfinished")
        },
        "od_source": "model",
        "options": [
            {
                "name": o["name"],
                "W": o["metrics"]["W"],
                "E": o["metrics"]["E"],
                "f_A": o["f_A"],
                "f_B": o["f_B"],
            }
            for o in result["options"]
        ],
    }
    (root / "docs/london_benchmark.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
