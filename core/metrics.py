"""Definitions from the specification, independent of optimizer/UI."""

from collections import defaultdict
import numpy as np
from .physics import cycle_time, trains_needed


def calculate_metrics(sim):
    capacity = sim.network.train.capacity
    total = sim.appeared
    wait = sim.wait_sum
    for ids in sim.queues.values():
        if ids:
            rows = sim.groups.values[ids]
            wait += float(np.dot(rows["size"], sim.now - rows["arrived"]))
    passages = sum(v[1] for v in sim.trip_totals.values())
    load = sum(v[0] for v in sim.trip_totals.values())
    lf = load / (capacity * passages) if passages else 0.0
    releases = defaultdict(list)
    for release in sim.releases:
        p = min(
            len(sim.network.schedule.headways[release["line"]]) - 1,
            int(
                (release["time"] - sim.start)
                // (sim.network.schedule.period_len_min * 60)
            ),
        )
        releases[(release["line"], release["direction"], p)].append(release)
    actual = []
    for (line, direction, period), values in sorted(releases.items()):
        times = [v["time"] for v in values]
        actual.append(
            {
                "line": line,
                "direction": direction,
                "period": period,
                "headway_s": float(np.diff(times).mean()) if len(times) > 1 else None,
                "release_delay_s": float(np.mean([v["delay_s"] for v in values])),
                "releases": len(values),
            }
        )
    line_periods = []
    for line in sim.network.lines:
        for period, h in enumerate(sim.network.schedule.headways[line.id]):
            rel = [r for r in actual if r["line"] == line.id and r["period"] == period]
            key = (line.id, period)
            denied = sim.boarding_denied[key]
            boarded = sim.boarded_totals[key]
            a = sim.start + period * sim.network.schedule.period_len_min * 60
            b = min(sim.end, a + sim.network.schedule.period_len_min * 60)
            # Exact presence across period boundaries, not a sample-based count.
            used = set()
            for tid, intervals in sim.active_intervals.items():
                if sim.train_lines[tid] == line.id and any(
                    start < b and (end is None or end > a) for start, end in intervals
                ):
                    used.add(tid)
            line_periods.append(
                {
                    "line": line.id,
                    "period": period,
                    "formula_trains": trains_needed(sim.network, line, h),
                    "cycle_s": cycle_time(sim.network, line),
                    "assigned": sim.assignment[line.id],
                    "used_trains": len(used),
                    "release_delay_s": sum(
                        r["release_delay_s"] * r["releases"] for r in rel
                    )
                    / max(1, sum(r["releases"] for r in rel)),
                    "denied_share": denied / max(1e-12, boarded),
                    "boarded": boarded,
                    "denied": denied,
                    "releases": sum(r["releases"] for r in rel),
                    **{
                        name: sim.period_factors[key][name]
                        for name in (
                            "boarding_s",
                            "random_delay_s",
                            "blocking_s",
                            "shared_blocking_s",
                            "passenger_exchange",
                        )
                    },
                }
            )
    duration = sim.end - sim.start
    blocking = {
        "|".join(map(str, k)): min(1, v / duration)
        for k, v in sorted(sim.blocking.items(), key=lambda p: str(p[0]))
    }
    return {
        "W": wait / total if total else 0.0,
        "D": sim.denied / total if total else 0.0,
        "LF": lf,
        "E": 1 - lf,
        "Qn": max(sim.peak_queues.values(), default=0) / capacity,
        "U": (
            int(np.count_nonzero(sim.state["used"])) / sim.network.fleet
            if sim.network.fleet
            else 0.0
        ),
        "appeared": total,
        "transported": sim.completed,
        "unfinished": max(0, total - sim.completed),
        "waiting": max(0, sum(sim.waiting.values())),
        "riding": float(sim.state["load"].sum()),
        "walking": sim.walking,
        "used_trains": int(np.count_nonzero(sim.state["used"])),
        "peak_active": sim.peak_active,
        "release_delay_s": (
            float(np.mean([r["delay_s"] for r in sim.releases]))
            if sim.releases
            else 0.0
        ),
        "actual_headways": actual,
        "line_periods": line_periods,
        "heatmap": {
            "stations": {s: q / capacity for s, q in sim.peak_queues.items()},
            "segments": {
                "|".join(k): v[0] / (capacity * v[1])
                for k, v in sim.trip_totals.items()
            },
            "blocking": blocking,
        },
        "od_source": "data" if sim.network.od_matrix is not None else "model",
        "assignment_source": (
            "user" if sim.network.fleet_assignment is not None else "assumption"
        ),
        "fleet_assignment": sim.assignment,
        "deadlock": sim.deadlock,
        "end_time": sim.now,
        "events": sim.events_processed,
    }
