"""Reproducible timings. No timing thresholds in correctness tests."""
import json
from pathlib import Path
from time import perf_counter
import platform
from core.simulation import Simulator
from data_io.network import read_network,require_network


def main():
    root = Path(__file__).resolve().parents[1]
    rows = []
    for name in ("a_simple","e_medium","f_star"):
        network = require_network(read_network(root / f"datasets/synthetic/{name}.json"))
        start = perf_counter()
        result = Simulator(network).run()
        elapsed = perf_counter()-start
        start = perf_counter()
        payload = json.dumps(result["trajectory"],separators=(",",":"))
        serialization = perf_counter()-start
        rows.append({"network":name,"stations":len(network.stations),"seconds":round(elapsed,3),"serialize_s":round(serialization,3),"trajectory_MB":round(len(payload.encode())/1e6,2),"passengers":result["metrics"]["appeared"]})
    output = {"python":platform.python_version(),"platform":platform.platform(),"results":rows}
    print(json.dumps(output,indent=2))
    (root / "docs/benchmark.json").write_text(json.dumps(output,indent=2)+"\n",encoding="utf-8")


if __name__ == "__main__":
    main()
