"""Агрегированные пассажиры: хранение дробных групп.

G_ijr = N_i * P(j|i) * P(r|i,j), без объекта на каждого человека.
В явной OD размер по паре задан входом, остаётся распределение по маршрутам.
Группа хранит маршрут, этап, время прихода, массу и код поездки.
FIFO-посадка — в boarding.py, переходы и учёт массы — в discrete_events.py.
"""

import numpy as np

GROUP_DTYPE = [
    ("route", "i4"),
    ("leg", "i4"),
    ("arrived", "f8"),
    ("size", "f8"),
    ("ride", "i4"),
]


class GroupStore:
    def __init__(self):
        self.values = np.empty(4096, dtype=GROUP_DTYPE)
        self.count = 0

    def add(self, route, leg, arrived, size, ride=0):
        if self.count == len(self.values):
            expanded = np.empty(len(self.values) * 2, dtype=GROUP_DTYPE)
            expanded[: self.count] = self.values
            self.values = expanded
        idx = self.count
        self.values[idx] = (route, leg, arrived, size, ride)
        self.count += 1
        return idx

    def add_many(self, routes, arrived, sizes, rides):
        count = len(sizes)
        end = self.count + count
        if end > len(self.values):
            expanded = np.empty(max(end, len(self.values) * 2), dtype=GROUP_DTYPE)
            expanded[: self.count] = self.values[: self.count]
            self.values = expanded
        rows = self.values[self.count : end]
        rows["route"] = routes
        rows["leg"] = 0
        rows["arrived"] = arrived
        rows["size"] = sizes
        rows["ride"] = rides
        indices = list(range(self.count, end))
        self.count = end
        return indices


def cohort_sizes(size, destination_probabilities, route_probabilities):
    return (size * destination_probabilities) * route_probabilities
