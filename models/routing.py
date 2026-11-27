"""Граф маршрутов и отбор разумных путей.

Узел — (станция, ветка); езда стоит run_time + base_dwell прибытия.
Пересадка стоит gamma + walk_s; пути ограничены C <= (1+margin)*C_min
и max_routes. Точные дубли объединяются, общие услуги веток учитываются
по всей последовательности станций. Вероятности вынесены в route_choice.py,
направления поездок — в gravity.py, предпочтения классов — в passenger_classes.py.
"""

from dataclasses import dataclass
import math
import networkx as nx
from .movement import run_time
from .station_dwell import base_dwell
from .gravity import destination_probabilities
from .passenger_classes import passenger_classes
from .route_choice import route_probabilities


@dataclass(frozen=True, slots=True)
class Leg:
    kind: str
    path: tuple[str, ...]
    lines: tuple[str, ...] = ()
    walk_s: float = 0


@dataclass(frozen=True, slots=True)
class Route:
    legs: tuple[Leg, ...]
    ride_s: float
    transfers: int
    walk_s: float


class Router:
    def __init__(self, network, assignment, streams):
        self.network = network
        self.settings = network.settings.routes
        self.active = [l for l in network.lines if assignment[l.id] > 0]
        self.graph = nx.DiGraph()
        self.stations = {s.id: s for s in network.stations}
        self.station_ids = list(self.stations)
        segments = {frozenset((s.origin, s.destination)): s for s in network.segments}
        membership = {s: [] for s in self.stations}
        for line in self.active:
            for s in line.stations:
                membership[s].append(line.id)
                self.graph.add_edge(
                    ("source", s), (s, line.id), weight=0, kind="endpoint"
                )
                self.graph.add_edge(
                    (s, line.id), ("target", s), weight=0, kind="endpoint"
                )
            for a, b in zip(
                line.stations,
                line.stations[1:] + (line.stations[:1] if line.is_loop else []),
            ):
                t = run_time(segments[frozenset((a, b))], network.train)
                for u, v in ((a, b), (b, a)):
                    self.graph.add_edge(
                        (u, line.id),
                        (v, line.id),
                        weight=t + base_dwell(self.stations[v]),
                        kind="ride",
                    )
        gamma = self.settings.transfer_penalty_s
        for s, lines in membership.items():
            for a in lines:
                for b in lines:
                    if a != b:
                        self.graph.add_edge(
                            (s, a), (s, b), weight=gamma, kind="transfer", walk_s=0
                        )
        for transfer in network.transfers:
            for a, b in (
                (transfer.origin, transfer.destination),
                (transfer.destination, transfer.origin),
            ):
                for la in membership[a]:
                    for lb in membership[b]:
                        if la != lb:
                            self.graph.add_edge(
                                (a, la),
                                (b, lb),
                                weight=gamma + transfer.walk_time_s,
                                kind="transfer",
                                walk_s=transfer.walk_time_s,
                            )
        self.thetas, self.gammas = passenger_classes(self.settings, streams.classes)
        self.routes = {}
        self.distances = {}
        self.probabilities_cache = {}
        self.destination_weights = {s: 0.0 for s in self.stations}
        for row in network.demand:
            self.destination_weights[row.station] += row.entries

    def serving(self, path):
        services = []
        for line in self.active:
            for order in (line.stations, list(reversed(line.stations))):
                if path[0] not in order:
                    continue
                start = order.index(path[0])
                extended = order + order if line.is_loop else order
                if tuple(extended[start : start + len(path)]) == tuple(path):
                    services.append(line.id)
                    break
        return tuple(services)

    def _route(self, states):
        legs = []
        ride = []
        ride_s = 0.0
        transfers = 0
        walk_s = 0.0

        def flush():
            if len(ride) > 1:
                legs.append(Leg("ride", tuple(ride), self.serving(ride)))
            ride.clear()

        for a, b in zip(states, states[1:]):
            edge = self.graph[a][b]
            if edge["kind"] == "ride":
                if not ride:
                    ride.append(a[0])
                ride.append(b[0])
                ride_s += edge["weight"]
            elif edge["kind"] == "transfer":
                flush()
                transfers += 1
                walk_s += edge["walk_s"]
                legs.append(Leg("walk", (a[0], b[0]), walk_s=edge["walk_s"]))
        flush()
        return Route(tuple(legs), ride_s, transfers, walk_s)

    def candidates(self, origin, destination):
        key = (origin, destination)
        if key in self.routes:
            return self.routes[key]
        source, target = ("source", origin), ("target", destination)
        candidates = []
        seen = set()
        try:
            paths = nx.shortest_simple_paths(
                self.graph, source, target, weight="weight"
            )
            shortest = None
            for states in paths:
                cost = sum(
                    self.graph[a][b]["weight"] for a, b in zip(states, states[1:])
                )
                if shortest is None:
                    shortest = cost
                    self.distances[key] = cost
                if cost > shortest * (1 + self.settings.margin) + 1e-9:
                    break
                route = self._route(states)
                signature = tuple((leg.kind, leg.path) for leg in route.legs)
                if signature not in seen:
                    seen.add(signature)
                    candidates.append(route)
                if (
                    len(candidates) >= self.settings.max_routes
                    or self.settings.margin == 0
                ):
                    break
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            self.distances[key] = math.inf
        self.routes[key] = tuple(candidates)
        return self.routes[key]

    def probabilities(self, origin, destination, period):
        key = (origin, destination, period)
        if key not in self.probabilities_cache:
            routes = self.candidates(origin, destination)
            probabilities = route_probabilities(
                routes, self.network.schedule.headways, period, self.thetas, self.gammas
            )
            if routes:
                self.probabilities_cache[key] = probabilities
            else:
                return probabilities
        return self.probabilities_cache[key]

    def destinations(self, origin):
        destinations, distances = [], []
        for dest in self.station_ids:
            if dest == origin:
                continue
            self.candidates(origin, dest)
            distance = self.distances[(origin, dest)]
            if math.isfinite(distance):
                destinations.append(dest)
                distances.append(distance)
        return destination_probabilities(
            destinations,
            distances,
            self.destination_weights,
            self.network.settings.od_beta,
        )
