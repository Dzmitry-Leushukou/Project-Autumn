"""Resource-driven discrete events; no movement tick and no busy-wait polling."""
from collections import defaultdict
import heapq
import math
import numpy as np
from .physics import allocate_fleet, base_dwell, cycle_time, run_time

PRIORITY = {"generate": 0, "transfer": 1, "depart": 2, "arrive": 3, "dispatch": 4, "period": 5, "sample": 6, "watchdog": 7}
POOL, PLATFORM, TUBE = 0, 1, 2


class Simulator:
    def __init__(self, network, *, passengers=False, record=True, check_invariants=False):
        self.network = network
        self.start = network.settings.day_start_s
        self.end = network.settings.day_end_s
        self.horizon = self.end+7200
        self.now = self.start
        self.assignment = allocate_fleet(network)
        self.record = record
        self.check = check_invariants
        self.passengers = passengers
        self.stations = {s.id:s for s in network.stations}
        self.lines = {l.id:l for l in network.lines}
        self.segment_times = {(a,b):run_time(s,network.train) for s in network.segments for a,b in [(s.origin,s.destination),(s.destination,s.origin)]}
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
        self.train_paths = []
        self.pool_keys = []
        self.orientations = self._platform_corridors()
        for line in network.lines:
            for direction, count in ((1, (self.assignment[line.id]+1)//2), (-1,self.assignment[line.id]//2)):
                path = list(line.stations if direction == 1 else reversed(line.stations))
                if line.is_loop:
                    k = path.index(line.depot_station)
                    path = path[k:]+path[:k]
                key = (line.id, direction)
                self.routes[key] = path
                self.planned[key] = self.start
                for _ in range(count):
                    tid = len(self.train_lines)
                    self.train_lines.append(line.id)
                    self.train_paths.append(path)
                    self.pool_keys.append(key)
                    heapq.heappush(self.pools[key], (self.start,tid))
        count = len(self.train_lines)
        self.state = np.zeros(count, dtype=[("phase","i1"),("direction","i1"),("pos","i4"),("ready","f8"),("used","?"),("load","f8")])
        self.stop_records = {}
        self.trip_records = {}
        self.trips = []
        self.stops = []
        self.series = []
        self.releases = []
        self.blocked_since = {}
        self.blocking = defaultdict(float)
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
        self.push(self.start+3600, "watchdog")
        t = self.start + network.schedule.period_len_min*60
        while t < self.end:
            self.push(t, "period")
            t += network.schedule.period_len_min*60

    def _platform_corridors(self):
        # Lines sharing an actual segment share platform resources. Crossing-only
        # lines have distinct physical platform pairs at an interchange station.
        edges = {}
        for line in self.network.lines:
            path = line.stations
            edges[line.id] = {(a,b) for a,b in zip(path,path[1:]+(path[:1] if line.is_loop else []))}
        result = {}
        for root in self.network.lines:
            if root.id in result:
                continue
            result[root.id] = (root.id,1)
            todo = [root.id]
            while todo:
                a = todo.pop(0)
                for b in edges:
                    if b in result:
                        continue
                    same = edges[a] & edges[b]
                    opposite = edges[a] & {(v,u) for u,v in edges[b]}
                    if same or opposite:
                        result[b] = (root.id,result[a][1]*(1 if same else -1))
                        todo.append(b)
        return result

    def push(self, time, kind, tid=-1, payload=None):
        if time <= self.horizon:
            self.serial += 1
            heapq.heappush(self.events,(float(time),PRIORITY[kind],tid,self.serial,kind,payload))

    def headway(self, line, time=None):
        index = min(len(self.network.schedule.headways[line])-1,max(0,int(((self.now if time is None else time)-self.start)//(self.network.schedule.period_len_min*60))))
        return self.network.schedule.headways[line][index]

    def _platform(self, tid, station=None):
        row = self.state[tid]
        station = station or self.train_paths[tid][row["pos"]]
        corridor, orientation = self.orientations[self.train_lines[tid]]
        return ("platform",station,corridor,int(row["direction"])*orientation)

    def _dispatch_event(self, key, time):
        if key not in self.dispatch_pending and time < self.end:
            self.dispatch_pending.add(key)
            self.push(time,"dispatch",payload=key)

    def _train_event(self, kind, tid, time):
        key = (kind,tid)
        if key not in self.train_pending:
            self.train_pending.add(key)
            self.push(time,kind,tid)

    def _release(self, resource, table):
        table.pop(resource, None)
        for kind, target in sorted(self.waiters.pop(resource,set()),key=lambda x:(PRIORITY[x[0]],str(x[1]))):
            if kind == "dispatch":
                self._dispatch_event(target,self.now)
            else:
                self._train_event(kind,target,self.now)

    def _block(self, tid, resource, kind):
        self.waiters[resource].add((kind,tid))
        self.blocked_since.setdefault(tid,(self.now,resource))

    def _unblock(self, tid):
        if tid in self.blocked_since:
            since, resource = self.blocked_since.pop(tid)
            self.blocking[resource] += self.now-since

    def _dispatch(self, key):
        self.dispatch_pending.discard(key)
        if self.now >= self.end:
            return
        pool = self.pools[key]
        if not pool:
            return  # A returning train wakes this dispatcher.
        ready, tid = pool[0]
        time = max(ready,self.planned[key])
        if time > self.now:
            self._dispatch_event(key,time)
            return
        line, direction = key
        self.state[tid]["direction"] = direction
        self.state[tid]["pos"] = 0
        self.train_paths[tid] = self.routes[key]
        resource = self._platform(tid)
        if resource in self.platforms:
            self.waiters[resource].add(("dispatch",key))
            return
        heapq.heappop(pool)
        self.state[tid]["phase"] = PLATFORM
        self.state[tid]["used"] = True
        self.platforms[resource] = tid
        self.releases.append({"train":tid,"line":line,"direction":direction,"time":self.now,"planned":self.planned[key],"delay_s":self.now-self.planned[key]})
        self.planned[key] = self.now+self.headway(line)
        self._dispatch_event(key,self.planned[key])
        self._serve(tid)

    def _serve(self, tid):
        row = self.state[tid]
        path = self.train_paths[tid]
        line = self.lines[self.train_lines[tid]]
        station = self.stations[path[row["pos"]]]
        terminal = not line.is_loop and row["pos"] == len(path)-1
        at_depot = line.is_loop and row["pos"] == 0 and tid in self.trip_records
        active_direction = sum(1 for i,l in enumerate(self.train_lines) if l == line.id and self.state[i]["phase"] != POOL and self.state[i]["direction"] == row["direction"])
        retire = terminal or (at_depot and (self.now >= self.end or active_direction > math.ceil(cycle_time(self.network,line)/self.headway(line.id))))
        off, on, delay = self._exchange(tid,station,retire)
        duration = base_dwell(station)+(off+on)/station.boarding_rate_pps+delay
        row["ready"] = self.now+duration
        stop = {"train":tid,"line":line.id,"direction":int(row["direction"]),"station":station.id,"arrival":self.now,"departure":None,"alighted":off,"boarded":on,"load":float(row["load"]),"delay_s":delay,"retire":retire}
        self.stop_records[tid] = stop
        if self.record:
            self.stops.append(stop)
        self._train_event("depart",tid,row["ready"])

    def _depart(self, tid):
        self.train_pending.discard(("depart",tid))
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
            self._release(platform,self.platforms)
            row["phase"] = POOL
            direction = int(row["direction"]) if line.is_loop else -int(row["direction"])
            key = (line.id,direction)
            ready = self.now+(0 if line.is_loop else self.network.train.turnaround_s)
            heapq.heappush(self.pools[key],(ready,tid))
            self._dispatch_event(key,max(self.planned[key],ready))
            return
        a, b = path[row["pos"]],path[(row["pos"]+1)%len(path)]
        tube = ("tube",a,b)
        if tube in self.tubes:
            self._block(tid,tube,"depart")
            return
        self._unblock(tid)
        self._release(platform,self.platforms)
        self.tubes[tube] = tid
        row["phase"] = TUBE
        stop["departure"] = self.now
        ready = self.now+self.segment_times[(a,b)]
        trip = {"train":tid,"line":line.id,"direction":int(row["direction"]),"from":a,"to":b,"departure":self.now,"ready":ready,"arrival":None,"load":float(row["load"])}
        self.trip_records[tid] = trip
        if self.record:
            self.trips.append(trip)
        self._record_trip(trip)
        self.last_departure = self.now
        self.departures += 1
        self._train_event("arrive",tid,ready)

    def _arrive(self, tid):
        self.train_pending.discard(("arrive",tid))
        row = self.state[tid]
        if row["phase"] != TUBE:
            return
        trip = self.trip_records[tid]
        platform = self._platform(tid,trip["to"])
        if platform in self.platforms:
            self._block(tid,platform,"arrive")
            return
        self._unblock(tid)
        self._release(("tube",trip["from"],trip["to"]),self.tubes)
        self.platforms[platform] = tid
        trip["arrival"] = self.now
        row["phase"] = PLATFORM
        row["pos"] = (row["pos"]+1)%len(self.train_paths[tid])
        self._serve(tid)

    def _init_passengers(self):
        pass

    def _exchange(self, tid, station, retire):
        return 0.0,0.0,0.0

    def _record_trip(self, trip):
        pass

    def _sample(self):
        active = int(np.count_nonzero(self.state["phase"]))
        self.peak_active = max(self.peak_active,active)
        if self.record:
            self.series.append({"time":self.now,"waiting":{},"trains_active":active})
        self.push(self.now+60,"sample")

    def assert_invariants(self):
        assert len(set(self.tubes.values())) == len(self.tubes)
        assert len(set(self.platforms.values())) == len(self.platforms)
        assert set(self.tubes.values()).isdisjoint(self.platforms.values())
        assert len(self.tubes) == np.count_nonzero(self.state["phase"] == TUBE)
        assert len(self.platforms) == np.count_nonzero(self.state["phase"] == PLATFORM)
        assert sum(len(p) for p in self.pools.values())+len(self.tubes)+len(self.platforms) == len(self.state)

    def run(self):
        while self.events:
            self.now,_,tid,_,kind,payload = heapq.heappop(self.events)
            self.events_processed += 1
            if kind == "dispatch": self._dispatch(payload)
            elif kind == "depart": self._depart(tid)
            elif kind == "arrive": self._arrive(tid)
            elif kind == "sample": self._sample()
            elif kind == "period": self.period += 1
            elif kind == "watchdog":
                if self.now-self.last_departure >= 3600 and np.any(self.state["phase"]):
                    self.deadlock = True
                    break
                self.push(max(self.now+1,self.last_departure+3600),"watchdog")
            else: self._passenger_event(kind,payload)
            if self.check:
                self.assert_invariants()
            if self.now >= self.end and not np.any(self.state["phase"]) and self._queues_empty():
                break
        for tid in list(self.blocked_since):
            self._unblock(tid)
        return self.result()

    def _passenger_event(self, kind, payload):
        pass

    def _queues_empty(self):
        return True

    def result(self):
        return {"deadlock":self.deadlock,"end_time":self.now,"assignment":self.assignment,"departures":self.departures,"used_trains":int(np.count_nonzero(self.state["used"])),"peak_active":self.peak_active,"releases":self.releases,"blocking_s":sum(self.blocking.values()),"trajectory":{"meta":{"name":self.network.meta.name,"seed":self.network.settings.seed,"day_start_s":self.start,"day_end_s":self.end},"trips":self.trips,"stops":self.stops,"series":self.series}}
