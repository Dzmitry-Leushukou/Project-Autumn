"""Время оборота, оценка парка и его распределение по веткам.

Обычная ветка: T = 2*(sum(run) + sum(base_dwell) + turnaround), N=ceil(T/h).
Кольцо: T = sum(run) + sum(base_dwell), N=2*ceil(T/h) для двух направлений.
Оценка не включает пассажирообмен, случайные задержки и блокировки.
При отсутствии явного назначения парк распределяется методом наибольших
остатков с резервом одного поезда на ветку, если общий парк позволяет.
"""

import math
from data_io.network import pairs
from .movement import run_time
from .station_dwell import base_dwell


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
