"""Дискретно-событийная модель движения, выпуска и ресурсов.

Одна направленная труба/платформа вмещает один поезд; занятость задерживает
следующее событие. t_plan_next = t_actual_previous + h(period_previous).
После конца работы новые входы и выпуски прекращаются, доезд ограничен 2 часами.
При каждом событии можно проверять баланс:
appeared = waiting + riding + walking + completed.
Физика и вероятности импортируются из соседних файлов models/.
"""

from collections import defaultdict
import heapq
import math
import numpy as np
from .fleet import allocate_fleet, cycle_time
from .movement import run_time
from .station_dwell import dwell_time
from .random_streams import RandomStreams
from .delays import stop_delay
from .demand import expected_entries, sample_entries
from .boarding import fifo_boarding
from .passenger_groups import GroupStore, cohort_sizes
from .routing import Router
from .metrics import calculate_metrics

PRIORITY = {
    "generate": 0,
    "transfer": 1,
    "depart": 2,
    "arrive": 3,
    "dispatch": 4,
    "period": 5,
    "sample": 6,
    "watchdog": 7,
}
POOL, PLATFORM, TUBE = 0, 1, 2


class Simulator:
    def __init__(
        self, network, *, passengers=True, record=True, check_invariants=False
    ):
        self.network = network
        self.start = network.settings.day_start_s
        self.end = network.settings.day_end_s
        self.horizon = self.end + 7200
        self.now = self.start
        self.assignment = allocate_fleet(network)
        self.record = record
        self.check = check_invariants
        self.passengers = passengers
        self.stations = {s.id: s for s in network.stations}
        self.lines = {l.id: l for l in network.lines}
        self.segment_times = {
            (a, b): run_time(s, network.train)
            for s in network.segments
            for a, b in [(s.origin, s.destination), (s.destination, s.origin)]
        }
        self.events = []
        self.serial = 0
        self.platforms = {}
        self.tubes = {}
        self.waiters = defaultdict(set)
        self.dispatch_pending = set()
        self.train_pending = set()
        self.pools = defaultdict(list)
        self.planned = {}
        self.routes = {}
        self.train_lines = []
        self.train_roster = []
        self.train_paths = []
        self.pool_keys = []
        self.orientations = self._platform_corridors()
        for line in network.lines:
            for direction, count in (
                (1, (self.assignment[line.id] + 1) // 2),
                (-1, self.assignment[line.id] // 2),
            ):
                path = list(
                    line.stations if direction == 1 else reversed(line.stations)
                )
                if line.is_loop:
                    k = path.index(line.depot_station)
                    path = path[k:] + path[:k]
                key = (line.id, direction)
                self.routes[key] = path
                self.planned[key] = self.start
                for _ in range(count):
                    tid = len(self.train_lines)
                    self.train_lines.append(line.id)
                    self.train_roster.append(
                        {
                            "train": tid,
                            "line": line.id,
                            "station": path[0],
                            "direction": direction,
                        }
                    )
                    self.train_paths.append(path)
                    self.pool_keys.append(key)
                    heapq.heappush(self.pools[key], (self.start, tid))
        count = len(self.train_lines)
        self.state = np.zeros(
            count,
            dtype=[
                ("phase", "i1"),
                ("direction", "i1"),
                ("pos", "i4"),
                ("ready", "f8"),
                ("used", "?"),
                ("load", "f8"),
            ],
        )
        self.stop_records = {}
        self.trip_records = {}
        self.trips = []
        self.stops = []
        self.series = []
        self.releases = []
        self.active_intervals = defaultdict(list)
        self.blocked_since = {}
        self.blocking = defaultdict(float)
        self.period_factors = defaultdict(lambda: defaultdict(float))
        self.shared_stations = {
            s
            for s in self.stations
            if len([l for l in network.lines if s in l.stations]) > 1
        }
        self.peak_active = 0
        self.deadlock = False
        self.last_departure = self.start
        self.departures = 0
        self.period = 0
        self.events_processed = 0
        self._init_passengers()
        for key in self.routes:
            if self.assignment[key[0]]:
                self._dispatch_event(key, self.start)
        self.push(self.start, "sample")
        self.push(self.start + 3600, "watchdog")
        t = self.start + network.schedule.period_len_min * 60
        while t < self.end:
            self.push(t, "period")
            t += network.schedule.period_len_min * 60

    def _platform_corridors(self):
        # Lines sharing an actual segment share platform resources. Crossing-only
        # lines have distinct physical platform pairs at an interchange station.
        edges = {}
        for line in self.network.lines:
            path = line.stations
            edges[line.id] = {
                (a, b)
                for a, b in zip(path, path[1:] + (path[:1] if line.is_loop else []))
            }
        result = {}
        for root in self.network.lines:
            if root.id in result:
                continue
            result[root.id] = (root.id, 1)
            todo = [root.id]
            while todo:
                a = todo.pop(0)
                for b in edges:
                    if b in result:
                        continue
                    same = edges[a] & edges[b]
                    opposite = edges[a] & {(v, u) for u, v in edges[b]}
                    if same or opposite:
                        result[b] = (root.id, result[a][1] * (1 if same else -1))
                        todo.append(b)
        return result

    def push(self, time, kind, tid=-1, payload=None):
        if time <= self.horizon:
            self.serial += 1
            heapq.heappush(
                self.events,
                (float(time), PRIORITY[kind], tid, self.serial, kind, payload),
            )

    def headway(self, line, time=None):
        index = min(
            len(self.network.schedule.headways[line]) - 1,
            max(
                0,
                int(
                    ((self.now if time is None else time) - self.start)
                    // (self.network.schedule.period_len_min * 60)
                ),
            ),
        )
        return self.network.schedule.headways[line][index]

    def _platform(self, tid, station=None):
        row = self.state[tid]
        station = station or self.train_paths[tid][row["pos"]]
        corridor, orientation = self.orientations[self.train_lines[tid]]
        return ("platform", station, corridor, int(row["direction"]) * orientation)

    def _dispatch_event(self, key, time):
        if key not in self.dispatch_pending and time < self.end:
            self.dispatch_pending.add(key)
            self.push(time, "dispatch", payload=key)

    def _train_event(self, kind, tid, time):
        key = (kind, tid)
        if key not in self.train_pending:
            self.train_pending.add(key)
            self.push(time, kind, tid)

    def _release(self, resource, table):
        table.pop(resource, None)
        for kind, target in sorted(
            self.waiters.pop(resource, set()), key=lambda x: (PRIORITY[x[0]], str(x[1]))
        ):
            if kind == "dispatch":
                self._dispatch_event(target, self.now)
            else:
                self._train_event(kind, target, self.now)

    def _block(self, tid, resource, kind):
        self.waiters[resource].add((kind, tid))
        self.blocked_since.setdefault(tid, (self.now, resource))

    def _unblock(self, tid):
        if tid in self.blocked_since:
            since, resource = self.blocked_since.pop(tid)
            self.blocking[resource] += max(
                0, min(self.now, self.end) - max(self.start, since)
            )
            period_s = self.network.schedule.period_len_min * 60
            cursor, end = max(self.start, since), min(self.now, self.end)
            while cursor < end:
                p = int((cursor - self.start) // period_s)
                boundary = min(end, self.start + (p + 1) * period_s)
                factors = self.period_factors[(self.train_lines[tid], p)]
                factors["blocking_s"] += boundary - cursor
                if resource[1] in self.shared_stations:
                    factors["shared_blocking_s"] += boundary - cursor
                cursor = boundary

    def _dispatch(self, key):
        self.dispatch_pending.discard(key)
        if self.now >= self.end:
            return
        pool = self.pools[key]
        if not pool:
            return  # A returning train wakes this dispatcher.
        ready, tid = pool[0]
        time = max(ready, self.planned[key])
        if time > self.now:
            self._dispatch_event(key, time)
            return
        line, direction = key
        self.state[tid]["direction"] = direction
        self.state[tid]["pos"] = 0
        self.train_paths[tid] = self.routes[key]
        resource = self._platform(tid)
        if resource in self.platforms:
            self.waiters[resource].add(("dispatch", key))
            return
        heapq.heappop(pool)
        self.state[tid]["phase"] = PLATFORM
        self.state[tid]["used"] = True
        self.active_intervals[tid].append([self.now, None])
        self.platforms[resource] = tid
        self.releases.append(
            {
                "train": tid,
                "line": line,
                "direction": direction,
                "time": self.now,
                "planned": self.planned[key],
                "delay_s": self.now - self.planned[key],
            }
        )
        self.planned[key] = self.now + self.headway(line)
        self._dispatch_event(key, self.planned[key])
        self._serve(tid)

    def _serve(self, tid):
        row = self.state[tid]
        path = self.train_paths[tid]
        line = self.lines[self.train_lines[tid]]
        station = self.stations[path[row["pos"]]]
        terminal = not line.is_loop and row["pos"] == len(path) - 1
        at_depot = line.is_loop and row["pos"] == 0 and tid in self.trip_records
        active_direction = (
            sum(
                1
                for i, l in enumerate(self.train_lines)
                if l == line.id
                and self.state[i]["phase"] != POOL
                and self.state[i]["direction"] == row["direction"]
            )
            if at_depot
            else 0
        )
        retire = bool(
            terminal
            or (
                at_depot
                and (
                    self.now >= self.end
                    or active_direction
                    > math.ceil(cycle_time(self.network, line) / self.headway(line.id))
                )
            )
        )
        off, on, delay = self._exchange(tid, station, retire)
        duration = dwell_time(station, off, on, delay)
        if self.now < self.end:
            p = int(
                (self.now - self.start) // (self.network.schedule.period_len_min * 60)
            )
            factors = self.period_factors[(line.id, p)]
            factors["boarding_s"] += (off + on) / station.boarding_rate_pps
            factors["random_delay_s"] += delay
            factors["passenger_exchange"] += off + on
        row["ready"] = self.now + duration
        stop = {
            "train": tid,
            "line": line.id,
            "direction": int(row["direction"]),
            "station": station.id,
            "arrival": self.now,
            "ready": float(row["ready"]),
            "departure": None,
            "alighted": off,
            "boarded": on,
            "load": float(row["load"]),
            "delay_s": delay,
            "retire": retire,
        }
        self.stop_records[tid] = stop
        if self.record:
            self.stops.append(stop)
        self._train_event("depart", tid, row["ready"])

    def _depart(self, tid):
        self.train_pending.discard(("depart", tid))
        row = self.state[tid]
        if row["phase"] != PLATFORM:
            return
        path = self.train_paths[tid]
        line = self.lines[self.train_lines[tid]]
        stop = self.stop_records[tid]
        platform = self._platform(tid)
        if stop["retire"]:
            self._unblock(tid)
            stop["departure"] = self.now
            self._release(platform, self.platforms)
            row["phase"] = POOL
            self.active_intervals[tid][-1][1] = self.now
            direction = (
                int(row["direction"]) if line.is_loop else -int(row["direction"])
            )
            key = (line.id, direction)
            ready = self.now + (0 if line.is_loop else self.network.train.turnaround_s)
            heapq.heappush(self.pools[key], (ready, tid))
            self._dispatch_event(key, max(self.planned[key], ready))
            return
        a, b = path[row["pos"]], path[(row["pos"] + 1) % len(path)]
        tube = ("tube", a, b)
        if tube in self.tubes:
            self._block(tid, tube, "depart")
            return
        self._unblock(tid)
        self._release(platform, self.platforms)
        self.tubes[tube] = tid
        row["phase"] = TUBE
        stop["departure"] = self.now
        ready = self.now + self.segment_times[(a, b)]
        trip = {
            "train": tid,
            "line": line.id,
            "direction": int(row["direction"]),
            "from": a,
            "to": b,
            "departure": self.now,
            "ready": ready,
            "arrival": None,
            "load": float(row["load"]),
        }
        self.trip_records[tid] = trip
        if self.record:
            self.trips.append(trip)
        self._record_trip(trip)
        self.last_departure = self.now
        self.departures += 1
        self._train_event("arrive", tid, ready)

    def _arrive(self, tid):
        self.train_pending.discard(("arrive", tid))
        row = self.state[tid]
        if row["phase"] != TUBE:
            return
        trip = self.trip_records[tid]
        platform = self._platform(tid, trip["to"])
        if platform in self.platforms:
            self._block(tid, platform, "arrive")
            return
        self._unblock(tid)
        self._release(("tube", trip["from"], trip["to"]), self.tubes)
        self.platforms[platform] = tid
        trip["arrival"] = self.now
        row["phase"] = PLATFORM
        row["pos"] = (row["pos"] + 1) % len(self.train_paths[tid])
        self._serve(tid)

    def _init_passengers(self):
        self.streams = RandomStreams(self.network.settings.seed)
        self.groups = GroupStore()
        self.queues = {s: [] for s in self.stations}
        self.queued_index = {}
        self.queued_time = None
        self.onboard = [{} for _ in self.train_lines]
        self.station_index = {s: i for i, s in enumerate(self.stations)}
        self.station_ids = list(self.stations)
        self.ride_codes = {}
        self.ride_pairs = [(-1, 0)]
        self.ride_targets = np.full(4096, -1, dtype=np.int32)
        self.ride_next = np.full(4096, -1, dtype=np.int32)
        self.ride_allowed = {key: np.zeros(4096, dtype=bool) for key in self.routes}
        self.waiting = {s: 0.0 for s in self.stations}
        self.peak_queues = {s: 0.0 for s in self.stations}
        self.appeared = 0.0
        self.completed = 0.0
        self.walking = 0.0
        self.wait_sum = 0.0
        self.denied = 0.0
        self.transferred = 0.0
        self.route_registry = []
        self.route_ids = {}
        self.demand_rows = defaultdict(list)
        self.od_rows = defaultdict(list)
        self.od_distributions = {}
        self.generation_plans = {}
        self.station_plans = {}
        self.boarding_denied = defaultdict(float)
        self.boarding_eligible = defaultdict(float)
        self.trip_totals = defaultdict(lambda: [0.0, 0])
        self.queue_events = []
        self.queue_event_index = {}
        self.queue_event_time = None
        self.direction_events = []
        self.direction_event_index = {}
        self.direction_event_time = None
        self.boarded_totals = defaultdict(float)
        if self.passengers:
            self.router = Router(self.network, self.assignment, self.streams)
            for row in self.network.demand:
                self.demand_rows[row.station].append(row)
            for row in self.network.od_matrix or []:
                self.od_rows[row.origin].append(row)
            self.push(self.start, "generate")

    def _enqueue(self, route, leg_index, size, station):
        if size < 1e-9:
            return
        legs = self.route_registry[route].legs if route >= 0 else ()
        if route >= 0 and leg_index >= len(legs):
            self.completed += size
            return
        if route >= 0 and legs[leg_index].kind == "walk":
            leg = legs[leg_index]
            self.transferred += size
            if leg.walk_s == 0:
                self._enqueue(route, leg_index + 1, size, leg.path[-1])
            else:
                self.walking += size
                self.push(
                    self.now + leg.walk_s,
                    "transfer",
                    payload=(route, leg_index + 1, size, leg.path[-1]),
                )
            return
        key = (station, route, leg_index, self.now)
        if self.queued_time != self.now:
            self.queued_time = self.now
            self.queued_index.clear()
        existing = self.queued_index.get(key)
        if existing is not None and self.groups.values[existing]["size"] > 1e-9:
            self.groups.values[existing]["size"] += size
        else:
            ride = self._ride_code(route, leg_index)
            group = self.groups.add(route, leg_index, self.now, size, ride)
            self.queues[station].append(group)
            self.queued_index[key] = group
        self.waiting[station] += size
        self._queue_change(station, size)
        if self.record:
            self._direction_changes(
                station, [self._ride_code(route, leg_index)], [size]
            )
        self.peak_queues[station] = max(
            self.peak_queues[station], self.waiting[station]
        )

    def _ride_code(self, route, leg):
        key = (route, leg)
        if key not in self.ride_codes:
            code = len(self.ride_pairs)
            self.ride_codes[key] = code
            self.ride_pairs.append(key)
            if code >= len(self.ride_targets):
                self.ride_targets = np.pad(
                    self.ride_targets, (0, len(self.ride_targets)), constant_values=-1
                )
                self.ride_next = np.pad(
                    self.ride_next, (0, len(self.ride_next)), constant_values=-1
                )
                self.ride_allowed = {
                    l: np.pad(v, (0, len(v))) for l, v in self.ride_allowed.items()
                }
            if route >= 0:
                ride = self.route_registry[route].legs[leg]
                self.ride_targets[code] = self.station_index[ride.path[-1]]
                self.ride_next[code] = self.station_index[ride.path[1]]
                for line in ride.lines:
                    for direction in (1, -1):
                        path = self.routes[(line, direction)]
                        start = path.index(ride.path[0])
                        extended = path + path if self.lines[line].is_loop else path
                        self.ride_allowed[(line, direction)][code] = (
                            tuple(extended[start : start + len(ride.path)]) == ride.path
                        )
        return self.ride_codes[key]

    def _queue_change(self, station, delta):
        if not self.record:
            return
        if self.queue_event_time != self.now:
            self.queue_event_time = self.now
            self.queue_event_index = {}
        if station in self.queue_event_index:
            self.queue_events[self.queue_event_index[station]]["delta"] += delta
        else:
            self.queue_event_index[station] = len(self.queue_events)
            self.queue_events.append(
                {"time": self.now, "station": station, "delta": delta}
            )

    def _direction_changes(self, station, rides, deltas):
        """Record each cohort once by its next station, including shared services."""
        if not self.record:
            return
        if self.direction_event_time != self.now:
            self.direction_event_time = self.now
            self.direction_event_index = {}
        totals = np.bincount(self.ride_next[rides] + 1, weights=deltas)
        for index in np.flatnonzero(np.abs(totals) > 1e-12):
            towards = self.station_ids[index - 1] if index else None
            key = (station, towards)
            if key in self.direction_event_index:
                self.direction_events[self.direction_event_index[key]]["delta"] += float(
                    totals[index]
                )
            else:
                self.direction_event_index[key] = len(self.direction_events)
                self.direction_events.append(
                    {
                        "time": self.now,
                        "station": station,
                        "towards": towards,
                        "delta": float(totals[index]),
                    }
                )

    def _generate(self):
        settings = self.network.settings
        if self.now >= self.end:
            return
        step = min(settings.group_step_s, self.end - self.now)
        period = min(
            len(next(iter(self.network.schedule.headways.values()))) - 1,
            int((self.now - self.start) // (self.network.schedule.period_len_min * 60)),
        )
        for station in self.stations:
            if self.network.od_matrix is not None:
                for row in self.od_rows[station]:
                    if (
                        row.start_min * 60
                        <= self.now
                        < (row.start_min + row.len_min) * 60
                    ):
                        size = row.trips * step / (row.len_min * 60)
                        size = sample_entries(
                            self.streams.demand, size, settings.demand_noise
                        )
                        self.appeared += size
                        self._generate_pair(station, row.destination, size, period)
            else:
                mean = expected_entries(self.demand_rows[station], self.now, step)
                size = sample_entries(self.streams.demand, mean, settings.demand_noise)
                self.appeared += size
                if size < 1e-9:
                    continue
                if station not in self.od_distributions:
                    self.od_distributions[station] = self.router.destinations(station)
                dests, probs = self.od_distributions[station]
                if not dests:
                    self._enqueue(-1, 0, size, station)
                else:
                    self._generate_station(station, dests, probs, size, period)
        self.push(self.now + settings.group_step_s, "generate")

    def _generate_station(self, station, destinations, probabilities, size, period):
        key = (station, period)
        if key not in self.station_plans:
            routes, dest_probs, route_probs, rides = [], [], [], []
            for destination, dp in zip(destinations, probabilities):
                candidates = self.router.candidates(station, destination)
                rp = self.router.probabilities(station, destination, period)
                for route, probability in zip(candidates, rp):
                    if route not in self.route_ids:
                        self.route_ids[route] = len(self.route_registry)
                        self.route_registry.append(route)
                    rid = self.route_ids[route]
                    routes.append(rid)
                    dest_probs.append(dp)
                    route_probs.append(probability)
                    rides.append(
                        self._ride_code(rid, 0) if route.legs[0].kind == "ride" else 0
                    )
            self.station_plans[key] = (
                np.asarray(routes, dtype=np.int32),
                np.asarray(dest_probs),
                np.asarray(route_probs),
                np.asarray(rides, dtype=np.int32),
            )
        routes, dp, rp, rides = self.station_plans[key]
        sizes = cohort_sizes(size, dp, rp)
        keep = sizes >= 1e-9
        routes, sizes, rides = routes[keep], sizes[keep], rides[keep]
        # Walk-first routes keep their ordinary transfer events. Fresh demand
        # events precede transfers/arrivals, so all newly created FIFO keys are unique.
        direct = rides != 0
        for route, count in zip(routes[~direct].tolist(), sizes[~direct].tolist()):
            self._enqueue(route, 0, count, station)
        routes, sizes, rides = routes[direct], sizes[direct], rides[direct]
        if not len(sizes):
            return
        indices = self.groups.add_many(routes, self.now, sizes, rides)
        self.queues[station].extend(indices)
        if self.queued_time != self.now:
            self.queued_time = self.now
            self.queued_index.clear()
        for route, index in zip(routes.tolist(), indices):
            self.queued_index[(station, route, 0, self.now)] = index
        added = float(sizes.sum())
        self.waiting[station] += added
        self._queue_change(station, added)
        self._direction_changes(station, rides, sizes)
        self.peak_queues[station] = max(
            self.peak_queues[station], self.waiting[station]
        )

    def _generate_pair(self, origin, destination, size, period):
        if size < 1e-9:
            return
        key = (origin, destination, period)
        if key not in self.generation_plans:
            routes = self.router.candidates(origin, destination)
            probabilities = self.router.probabilities(origin, destination, period)
            plan = []
            for route, probability in zip(routes, probabilities):
                if route not in self.route_ids:
                    self.route_ids[route] = len(self.route_registry)
                    self.route_registry.append(route)
                plan.append((self.route_ids[route], float(probability)))
            self.generation_plans[key] = plan
        plan = self.generation_plans[key]
        if not plan:
            self._enqueue(-1, 0, size, origin)
        for route, probability in plan:
            self._enqueue(route, 0, size * probability, origin)

    def _exchange(self, tid, station, retire):
        off = on = 0.0
        line_id = self.train_lines[tid]
        if self.passengers:
            kept = {}
            for code, size in self.onboard[tid].items():
                route_id, leg_index = self.ride_pairs[code]
                route = self.route_registry[route_id]
                leg = route.legs[leg_index]
                if leg.path[-1] == station.id or retire:
                    off += size
                    if leg.path[-1] == station.id:
                        self._enqueue(route_id, leg_index + 1, size, station.id)
                    else:
                        start = (
                            leg.path.index(station.id) if station.id in leg.path else 0
                        )
                        replacement = type(leg)("ride", leg.path[start:], leg.lines)
                        changed = type(route)(
                            (replacement,) + route.legs[leg_index + 1 :],
                            route.ride_s,
                            route.transfers,
                            route.walk_s,
                        )
                        if changed not in self.route_ids:
                            self.route_ids[changed] = len(self.route_registry)
                            self.route_registry.append(changed)
                        self._enqueue(self.route_ids[changed], 0, size, station.id)
                else:
                    kept[code] = size
            self.onboard[tid] = kept
            self.state[tid]["load"] -= off
            queue = self.queues[station.id]
            if not retire and queue:
                free = max(
                    0, self.network.train.capacity - float(self.state[tid]["load"])
                )
                ids = np.asarray(queue, dtype=np.int64)
                rows = self.groups.values[ids]
                rides = rows["ride"]
                suitable = self.ride_allowed[
                    (line_id, int(self.state[tid]["direction"]))
                ][rides]
                selected = np.flatnonzero(suitable)
                sizes = rows["size"][selected]
                boarded = fifo_boarding(sizes, free)
                on = float(boarded.sum())
                denied = float((sizes - boarded).sum())
                self.denied += denied
                period = min(
                    len(self.network.schedule.headways[line_id]) - 1,
                    int(
                        (self.now - self.start)
                        // (self.network.schedule.period_len_min * 60)
                    ),
                )
                metric_key = (line_id, period)
                self.boarding_eligible[metric_key] += float(sizes.sum())
                self.boarding_denied[metric_key] += denied
                self.boarded_totals[metric_key] += on
                self.wait_sum += float(
                    np.dot(boarded, self.now - rows["arrived"][selected])
                )
                self.waiting[station.id] -= on
                self._queue_change(station.id, -on)
                self._direction_changes(station.id, rides[selected], -boarded)
                remaining = rows["size"].copy()
                remaining[selected] -= boarded
                self.groups.values["size"][ids] = remaining
                positive = boarded > 1e-9
                if positive.any():
                    codes = rides[selected][positive]
                    totals = np.bincount(codes, weights=boarded[positive])
                    unique = np.flatnonzero(totals)
                    for code, size in zip(unique.tolist(), totals[unique].tolist()):
                        kept[code] = kept.get(code, 0) + size
                done = remaining <= 1e-9
                # Only cohorts created at the current event time can merge.
                # Old FIFO keys are discarded on time change, not one by one.
                self.queues[station.id] = ids[~done].tolist()
                self.state[tid]["load"] += on
        delay = stop_delay(
            self.streams.delays,
            self.network.settings.delays,
            off,
            on,
            self.network.train.capacity,
        )
        return off, on, delay

    def _record_trip(self, trip):
        total = self.trip_totals[(trip["from"], trip["to"])]
        total[0] += trip["load"]
        total[1] += 1

    def _sample(self):
        active = int(np.count_nonzero(self.state["phase"]))
        self.peak_active = max(self.peak_active, active)
        if self.record:
            self.series.append(
                {
                    "time": self.now,
                    "waiting": dict(self.waiting),
                    "trains_active": active,
                    "appeared": self.appeared,
                    "completed": self.completed,
                    "riding": float(self.state["load"].sum()),
                    "walking": self.walking,
                }
            )
        self.push(self.now + 60, "sample")

    def assert_invariants(self):
        assert len(set(self.tubes.values())) == len(self.tubes)
        assert len(set(self.platforms.values())) == len(self.platforms)
        assert set(self.tubes.values()).isdisjoint(self.platforms.values())
        assert len(self.tubes) == np.count_nonzero(self.state["phase"] == TUBE)
        assert len(self.platforms) == np.count_nonzero(self.state["phase"] == PLATFORM)
        assert sum(len(p) for p in self.pools.values()) + len(self.tubes) + len(
            self.platforms
        ) == len(self.state)
        assert abs(
            self.appeared
            - sum(self.waiting.values())
            - float(self.state["load"].sum())
            - self.completed
            - self.walking
        ) < 1e-6 * max(1, self.appeared)
        assert np.all(self.state["load"] >= -1e-6)
        assert np.all(self.state["load"] <= self.network.train.capacity + 1e-6)

    def run(self, should_stop=None):
        while self.events:
            if (
                should_stop is not None
                and self.events_processed % 128 == 0
                and should_stop()
            ):
                raise TimeoutError("Simulation interrupted by its execution deadline")
            self.now, _, tid, _, kind, payload = heapq.heappop(self.events)
            self.events_processed += 1
            if kind == "dispatch":
                self._dispatch(payload)
            elif kind == "depart":
                self._depart(tid)
            elif kind == "arrive":
                self._arrive(tid)
            elif kind == "sample":
                self._sample()
            elif kind == "period":
                self.period += 1
            elif kind == "watchdog":
                if self.now - self.last_departure >= 3600 and np.any(
                    self.state["phase"]
                ):
                    self.deadlock = True
                    break
                self.push(max(self.now + 1, self.last_departure + 3600), "watchdog")
            else:
                self._passenger_event(kind, payload)
            if self.check:
                self.assert_invariants()
            if (
                self.now >= self.end
                and not np.any(self.state["phase"])
                and self._queues_empty()
            ):
                break
        for tid in list(self.blocked_since):
            self._unblock(tid)
        return self.result()

    def _passenger_event(self, kind, payload):
        if kind == "generate":
            self._generate()
        elif kind == "transfer":
            route, leg, size, station = payload
            self.walking -= size
            self._enqueue(route, leg, size, station)

    def _queues_empty(self):
        return sum(self.waiting.values()) < 1e-8 and self.walking < 1e-8

    def result(self):
        return {
            "deadlock": self.deadlock,
            "end_time": self.now,
            "assignment": self.assignment,
            "departures": self.departures,
            "used_trains": int(np.count_nonzero(self.state["used"])),
            "peak_active": self.peak_active,
            "releases": self.releases,
            "blocking_s": sum(self.blocking.values()),
            "metrics": calculate_metrics(self),
            "trajectory": {
                "meta": {
                    "name": self.network.meta.name,
                    "seed": self.network.settings.seed,
                    "day_start_s": self.start,
                    "day_end_s": self.end,
                    "simulation_end_s": self.now,
                    "od_source": (
                        "data" if self.network.od_matrix is not None else "model"
                    ),
                },
                "trips": self.trips,
                "stops": self.stops,
                "series": self.series,
                "queue_events": self.queue_events,
                "queue_directions": self.direction_events,
                "trains": self.train_roster,
            },
        }
