"""Entirely synthetic, deliberately varied network topologies."""
import math
from pathlib import Path
from data_io.network import write_network
from data_io.schema import Network

ROOT = Path(__file__).resolve().parents[1]
COLORS = ["#C65B49", "#397DAD", "#B49135", "#9670AA"]


def build(name, paths, loops=(), duration=72000):
    ids = list(dict.fromkeys(s for path in paths for s in path))
    stations = []
    for i, sid in enumerate(ids):
        angle = 2 * math.pi * i / len(ids)
        stations.append({"id": sid, "name": f"Станция {sid}", "x": round(500 + 380 * math.cos(angle), 2), "y": round(500 + 380 * math.sin(angle), 2)})
    lines = [{"id": f"L{i+1}", "name": f"Линия {i+1}", "color": COLORS[i], "is_loop": i in loops, "stations": path} for i, path in enumerate(paths)]
    edges = set()
    for i, path in enumerate(paths):
        edges.update(tuple(sorted(p)) for p in zip(path, path[1:] + (path[:1] if i in loops else [])))
    demand = []
    for i, sid in enumerate(ids):
        for minute in range(300, 300 + math.ceil(duration / 60), 15):
            t = minute + 7.5
            multiplier = 0.25 + 0.75 * math.exp(-(t-510)**2/(2*75**2)) + 0.9 * math.exp(-(t-1080)**2/(2*90**2))
            demand.append({"station": sid, "start_min": minute, "len_min": 15, "entries": {"value": round((90 + i % 5 * 10) * multiplier, 4), "source": "assumption"}})
    return {"meta": {"name": name, "format_version": "1.0", "synthetic": True, "description": "Синтетическая учебная сеть. Спрос и физические параметры — модельные допущения."},
            "stations": stations, "lines": lines, "segments": [{"from": a, "to": b, "length_m": {"value": 700 + i % 4 * 100, "source": "assumption"}} for i, (a, b) in enumerate(sorted(edges))],
            "transfers": [], "train": {}, "fleet": 60 if len(ids) >= 20 else max(12, len(paths)*8), "demand": demand,
            "settings": {"day_start_s": 18000, "day_end_s": 18000+duration}}


def main():
    demos = {
        "a_simple": build("01 · Простая линия", [[f"A{i}" for i in range(6)]]),
        "b_transfer": build("02 · Две линии и пересадка", [["A", "B", "X", "C"], ["D", "E", "X", "F"]]),
        "c_ring": build("03 · Линия и кольцо", [["A", "B", "X", "C"], ["X", "D", "E", "F"]], loops=(1,)),
        "d_branch": build("04 · Общий участок", [["A", "B", "C", "D", "E"], ["A", "B", "C", "F", "G"]]),
        "e_medium": build("05 · 25 станций / 3 линии", [[f"A{i}" for i in range(9)], ["A4"]+[f"B{i}" for i in range(8)], ["B3"]+[f"C{i}" for i in range(8)]]),
        "f_star": build("06 · Четыре луча", [["X"]+[f"{c}{i}" for i in range(3)] for c in "ABCD"]),
    }
    for name, doc in demos.items():
        write_network(doc, ROOT / "datasets" / "synthetic" / f"{name}.json")
    write_network(Network.model_json_schema(by_alias=True), ROOT / "data_io" / "network.schema.json")


if __name__ == "__main__":
    (ROOT / "datasets" / "synthetic").mkdir(parents=True, exist_ok=True)
    main()
