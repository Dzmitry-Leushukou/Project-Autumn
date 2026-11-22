"""Free-running kinematics and the explicit, demand-free fleet estimate."""

import math
from data_io.network import pairs


def run_time(segment, train):
    if segment.run_time_s is not None:
        return segment.run_time_s
    length = segment.length_m
    speed = min(train.max_speed_mps, segment.max_speed_mps or train.max_speed_mps)
    a, b = train.acceleration_mps2, train.deceleration_mps2
    if length >= speed**2 / (2 * a) + speed**2 / (2 * b):
        return length / speed + speed / (2 * a) + speed / (2 * b)
    peak = math.sqrt(2 * length / (1 / a + 1 / b))
    return peak / a + peak / b


def base_dwell(station):
    return station.dwell_base_s + (
        station.door_open_s + station.door_close_s if station.platform_doors else 0
    )


def cycle_time(network, line):
    segments = {frozenset((s.origin, s.destination)): s for s in network.segments}
    stations = {s.id: s for s in network.stations}
    travel = sum(run_time(segments[frozenset(p)], network.train) for p in pairs(line))
    dwell = sum(base_dwell(stations[s]) for s in line.stations)
    return (
        travel + dwell
        if line.is_loop
        else 2 * (travel + dwell + network.train.turnaround_s)
    )


def trains_needed(network, line, headway):
    return (2 if line.is_loop else 1) * math.ceil(cycle_time(network, line) / headway)


def allocate_fleet(network):
    if network.fleet_assignment is not None:
        return dict(network.fleet_assignment)
    needs = [
        max(trains_needed(network, l, h) for h in network.schedule.headways[l.id])
        for l in network.lines
    ]
    total = min(network.fleet, sum(needs))
    n = len(needs)
    result = [1 if total >= n else 0 for _ in needs]
    remaining = total - sum(result)
    # Reserve one per line first, then largest remainders against residual need.
    weights = [max(0, need - result[i]) for i, need in enumerate(needs)]
    weight_sum = sum(weights)
    raw = [remaining * w / weight_sum if weight_sum else 0 for w in weights]
    floors = [math.floor(x) for x in raw]
    for i in range(n):
        result[i] += floors[i]
    for i in sorted(range(n), key=lambda i: (-(raw[i] - floors[i]), i))[
        : total - sum(result)
    ]:
        result[i] += 1
    return {l.id: result[i] for i, l in enumerate(network.lines)}
