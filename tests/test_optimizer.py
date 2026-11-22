import copy
import pytest
from optimizer.nsga2 import optimize
from optimizer.objectives import dominates, fronts, crowding
from optimizer.train_count import train_count
from optimizer.evaluation import Cancelled
from tests.test_movement import small


def example():
    n = small([["A", "X", "B"], ["C", "X", "D"]], fleet=16, headway=1200)
    n.settings.day_end_s = n.settings.day_start_s + 1800
    n.settings.optimizer.population = 6
    n.settings.optimizer.generations = 2
    n.settings.optimizer.seeds_search = 1
    n.settings.optimizer.seeds_final = 2
    n.settings.optimizer.time_budget_s = 60
    return n


def test_nsga_front_options_constraints_and_repeatability():
    net = example()
    a = optimize(net, workers=1)
    assert a == optimize(net, workers=1)
    assert len(a["options"]) == 4
    wait, empty, balance, baseline = a["options"]
    assert wait["f_A"] <= baseline["f_A"]
    assert empty["f_B"] == min(p["f_B"] for p in a["options"])
    assert not dominates(
        (baseline["f_A"], baseline["f_B"]), (balance["f_A"], balance["f_B"])
    )
    for p in a["front"]:
        assert p["feasible"]
        assert sum(p["fleet_assignment"].values()) <= net.fleet
        assert all(
            60 <= h <= 1200 and h % 15 == 0 for hs in p["headways"].values() for h in hs
        )
        assert len(p["seeds"]) == 2


def test_parallel_identical_and_fleet_locked():
    net = example()
    net.settings.optimizer.generations = 1
    a = optimize(net, workers=1, fleet_assignment_locked=True)
    b = optimize(net, workers=2, fleet_assignment_locked=True)
    assert a == b
    assert all(p["fleet_assignment"] == net.fleet_assignment for p in a["front"])


def test_deadlocked_ring_is_rejected():
    net = small([["A", "B", "C"]], (0,), fleet=12, headway=1)
    net.settings.optimizer.headway_min_s = 1
    net.settings.optimizer.headway_max_s = 1
    net.settings.optimizer.headway_step_s = 1
    net.settings.optimizer.population = 4
    net.settings.optimizer.generations = 1
    net.settings.optimizer.seeds_search = net.settings.optimizer.seeds_final = 1
    assert optimize(net, workers=1, fleet_assignment_locked=True)["front"] == []


def test_cancel():
    with pytest.raises(Cancelled):
        optimize(example(), workers=1, cancelled=lambda: True)


def test_train_count_both_modes_and_limits():
    net = small(fleet=12)
    net.settings.demand_noise = False
    net.settings.delays.p0 = 0
    net.settings.optimizer.seeds_final = 1
    a = train_count(net, "L1", 0, "by_headway", headway_s=300, workers=1)
    assert a["formula_trains"] >= 1
    assert a["status"] == "found"
    b = train_count(
        net, "L1", 0, "by_fleet", trains=a["simulation"]["trains"], workers=1
    )
    assert b["status"] == "found"
    assert b["simulation"]["headway_s"] <= 300
    net.fleet = 0
    assert (
        train_count(net, "L1", 0, "by_headway", headway_s=300, workers=1)["status"]
        == "not_found_in_range"
    )
