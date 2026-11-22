import numpy as np
import pytest
from core.randomness import RandomStreams, delay_duration
from core.routing import Router
from core.simulation import Simulator
from data_io.network import require_network
from scripts.generate_demos import build
from tests.test_movement import small


def test_conservation_transfers_and_determinism():
    net = small([["A", "X", "B"], ["C", "X", "D"]], fleet=16)
    net.settings.demand_noise = False
    net.settings.delays.p0 = 0
    s = Simulator(net, check_invariants=True)
    a = s.run()
    assert s.transferred > 0
    assert s.completed > 0
    assert s.appeared == pytest.approx(
        s.completed + sum(s.waiting.values()) + s.state["load"].sum() + s.walking
    )
    assert a == Simulator(net, check_invariants=True).run()


def test_walk_transfer():
    doc = build("Walk", [["A", "B"], ["C", "D"]], duration=1800)
    doc["transfers"] = [{"from": "B", "to": "C", "walk_time_s": 100}]
    doc["od_matrix"] = [
        {
            "origin": "A",
            "destination": "D",
            "start_min": 300,
            "len_min": 10,
            "trips": 60,
        }
    ]
    doc["settings"]["demand_noise"] = False
    sim = Simulator(require_network(doc), check_invariants=True)
    sim.run()
    assert sim.transferred == pytest.approx(60)
    assert sim.completed == pytest.approx(60)


def test_platform_doors_add_exactly_ten():
    net = small()
    a = Simulator(net, passengers=False).run()["trajectory"]["stops"][0]
    for station in net.stations:
        station.platform_doors = True
    b = Simulator(net, passengers=False).run()["trajectory"]["stops"][0]
    assert b["departure"] - b["arrival"] == a["departure"] - a["arrival"] + 10


def test_lognormal_moments_and_stream_independence():
    a, b = RandomStreams(42), RandomStreams(42)
    a.classes.random(10000)
    assert a.delays.random() == b.delays.random()
    values = delay_duration(a.delays, 5, 3, 200000)
    assert values.mean() == pytest.approx(5, rel=0.01)
    assert values.std() == pytest.approx(3, rel=0.02)


def test_logit_probabilities():
    net = small([["A", "B", "D"], ["A", "C", "D"]], fleet=16)
    net.settings.routes.margin = 0.5
    router = Router(net, net.fleet_assignment, RandomStreams(42))
    probs = router.probabilities("A", "D", 0)
    assert len(probs) >= 2
    assert sum(probs) == pytest.approx(1)
    net.settings.routes.theta = 1e6
    net.settings.routes.diversity = 0
    router = Router(net, net.fleet_assignment, RandomStreams(42))
    assert max(router.probabilities("A", "D", 0)) > 0.999
    net.settings.routes.margin = 0
    router = Router(net, net.fleet_assignment, RandomStreams(42))
    assert list(router.probabilities("A", "D", 0)) == [1]


def test_common_section_services_and_fifo_partial_boarding():
    net = small([["A", "B", "C", "D"], ["A", "B", "C", "E"]], fleet=16)
    net.train.capacity = 5
    net.settings.demand_noise = False
    net.od_matrix = []  # Manually queue two cohorts with distinct arrival times.
    sim = Simulator(net, check_invariants=True)
    route = sim.router.candidates("A", "C")[0]
    assert set(route.legs[0].lines) == {"L1", "L2"}
    sim.route_registry.append(route)
    sim.route_ids[route] = 0
    sim._enqueue(0, 0, 4, "A")
    sim.now += 1
    sim._enqueue(0, 0, 4, "A")
    sim.now -= 1
    sim.appeared = 8
    sim.run()
    # First matching train boards oldest cohort in full, then splits the next.
    first = next(s for s in sim.stops if s["station"] == "A" and s["boarded"])
    assert first["boarded"] == 5
    assert sim.groups.values[0]["size"] == 0
    assert sim.completed == pytest.approx(8)


def test_zero_service_keeps_demand_and_excludes_routes():
    net = small(fleet=0)
    net.settings.demand_noise = False
    sim = Simulator(net, check_invariants=True)
    sim.run()
    assert sim.completed == 0
    assert sim.appeared > 0
    assert sum(sim.waiting.values()) == pytest.approx(sim.appeared)


def test_ring_boarding_follows_selected_path_not_first_opposite_train():
    from data_io.schema import OD

    net = small([["A", "B", "C", "D"]], (0,), fleet=2, headway=180)
    net.lines[0].depot_station = "B"
    net.settings.demand_noise = False
    net.settings.delays.p0 = 0
    net.od_matrix = [
        OD(origin="A", destination="B", start_min=300, len_min=2, trips=10)
    ]
    sim = Simulator(net, check_invariants=True)
    result = sim.run()
    assert sim.router.candidates("A", "B")[0].legs[0].path == ("A", "B")
    visits = [s for s in sim.stops if s["station"] == "A"]
    first = min(visits, key=lambda s: s["arrival"])
    assert first["direction"] == -1  # The wrong train really arrives first.
    assert first["boarded"] == 0
    boarded = next(s for s in visits if s["boarded"] > 0)
    assert boarded["direction"] == 1
    trip = next(
        t
        for t in sim.trips
        if t["train"] == boarded["train"] and t["departure"] == boarded["departure"]
    )
    assert (trip["from"], trip["to"]) == ("A", "B")
    assert result["metrics"]["transported"] == pytest.approx(10)


@pytest.mark.parametrize("walking", [False, True])
def test_batched_generation_preserves_fifo_and_conservation(walking):
    class ScalarGeneration(Simulator):
        def _generate_station(self, station, destinations, probabilities, size, period):
            for destination, probability in zip(destinations, probabilities):
                self._generate_pair(station, destination, size * probability, period)

    paths = [["A", "B"], ["C", "D"]] if walking else [["A", "X", "B"], ["C", "X", "D"]]
    doc = build("Batch regression", paths, duration=900)
    if walking:
        doc["transfers"] = [{"from": "B", "to": "C", "walk_time_s": 90}]
    net = require_network(doc)
    net.train.capacity = 20
    net.settings.demand_noise = False
    net.settings.delays.p0 = 0
    a = Simulator(net, check_invariants=True).run()
    b = ScalarGeneration(net, check_invariants=True).run()
    for key in ("W", "D", "LF", "Qn", "appeared", "transported", "unfinished"):
        assert a["metrics"][key] == pytest.approx(b["metrics"][key], abs=1e-7)
    assert a["metrics"]["appeared"] == pytest.approx(
        a["metrics"]["transported"]
        + a["metrics"]["waiting"]
        + a["metrics"]["riding"]
        + a["metrics"]["walking"]
    )
