import copy
import pytest
from data_io.network import require_network
from data_io.schema import Segment, Train
from core.physics import run_time, cycle_time, allocate_fleet, trains_needed
from core.simulation import Simulator
from scripts.generate_demos import build


def small(paths=None, loops=(), fleet=12, headway=180):
    d = build("Test",paths or [["A","B","C"]],loops,duration=3600)
    d.update(fleet=fleet, fleet_assignment={f"L{i+1}":fleet//len(d["lines"]) for i in range(len(d["lines"]))})
    d["schedule"] = {"headways":{l["id"]:[headway] for l in d["lines"]}}
    return require_network(d)


def test_kinematics():
    train = Train(max_speed_mps=10,acceleration_mps2=1,deceleration_mps2=1)
    assert run_time(Segment(**{"from":"a","to":"b","length_m":200}),train) == 30
    assert run_time(Segment(**{"from":"a","to":"b","length_m":25}),train) == 10
    assert run_time(Segment(**{"from":"a","to":"b","run_time_s":17}),train) == 17


@pytest.mark.parametrize("net", [small(),small(headway=1),small([["A","B","C","D"],["A","B","E"]],fleet=24,headway=40),small([["A","B","C","D"]],(0,),fleet=4)])
def test_safety_and_determinism(net):
    a = Simulator(net,passengers=False,check_invariants=True).run()
    b = Simulator(net,passengers=False,check_invariants=True).run()
    assert a == b
    assert a["departures"] > 0
    assert a["used_trains"] <= net.fleet


def test_free_dispatch_exact_headway():
    result = Simulator(small(),passengers=False).run()
    releases = [r["time"] for r in result["releases"] if r["direction"] == 1]
    assert all(b-a == 180 for a,b in zip(releases,releases[1:]))
    assert not result["deadlock"]


def test_congestion_and_shared_branch():
    crowded = Simulator(small(headway=1),passengers=False).run()
    free = Simulator(small(headway=180),passengers=False).run()
    assert crowded["blocking_s"] > free["blocking_s"]
    shared = Simulator(small([["A","B","C","D"],["A","B","E"]],fleet=24,headway=40),passengers=False,check_invariants=True).run()
    assert shared["blocking_s"] > 0
    trips = [t for t in shared["trajectory"]["trips"] if t["from"] == "A" and t["to"] == "B"]
    for a,b in zip(trips,trips[1:]):
        assert b["departure"] >= a["arrival"]


def test_ring_deadlock_and_no_turnaround():
    net = small([["A","B","C"]],(0,),fleet=12,headway=1)
    assert Simulator(net,passengers=False,check_invariants=True).run()["deadlock"]
    net = small([["A","B","C"]],(0,),fleet=2,headway=180)
    a = Simulator(net,passengers=False).run()
    net.train.turnaround_s = 10000
    assert a == Simulator(net,passengers=False).run()


def test_cycle_and_allocation():
    net = small()
    assert cycle_time(net,net.lines[0]) == 2*(sum(run_time(s,net.train) for s in net.segments)+60+120)
    net.fleet_assignment = None
    assert sum(allocate_fleet(net).values()) == min(net.fleet,trains_needed(net,net.lines[0],180))
    assert all(v >= 1 for v in allocate_fleet(net).values())


def test_ring_recall_after_period_change():
    net = small([["A","B","C"]],(0,),fleet=8,headway=60)
    net.schedule.period_len_min = 30
    net.schedule.headways = {"L1":[60,1200]}
    result = Simulator(net,passengers=False,check_invariants=True).run()
    retired = [s for s in result["trajectory"]["stops"] if s["retire"] and 19800 < s["arrival"] < 21600]
    assert retired
