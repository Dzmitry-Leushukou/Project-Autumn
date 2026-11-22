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


def test_all_reported_metrics_average_seeds_by_identity():
    from optimizer.evaluation import Evaluator, evaluate_seed

    net = small()
    evaluator = Evaluator(net, workers=1)
    try:
        point = evaluator.many(
            [(net.schedule.headways, net.fleet_assignment)], [42, 43]
        )[0]
    finally:
        evaluator.close()
    samples = [
        evaluate_seed(net, net.schedule.headways, net.fleet_assignment, seed)[0]
        for seed in [42, 43]
    ]
    for station in point["metrics"]["heatmap"]["stations"]:
        assert point["metrics"]["heatmap"]["stations"][station] == pytest.approx(
            sum(m["heatmap"]["stations"][station] for m in samples) / 2
        )
    for row in point["metrics"]["actual_headways"]:
        matching = [
            next(
                r
                for r in m["actual_headways"]
                if (r["line"], r["direction"], r["period"])
                == (row["line"], row["direction"], row["period"])
            )
            for m in samples
        ]
        assert row["headway_s"] == pytest.approx(
            sum(r["headway_s"] for r in matching) / 2
        )
    assert point["metrics"]["events"] == pytest.approx(
        sum(m["events"] for m in samples) / 2
    )


def test_sparse_metrics_keep_identity_and_missing_headways_are_not_zero():
    from optimizer.evaluation import average_metrics, evaluate_seed

    net = small()
    first = evaluate_seed(net, net.schedule.headways, net.fleet_assignment, 42)[0]
    second = copy.deepcopy(first)
    first["actual_headways"] = [
        {
            "line": "L1",
            "direction": 1,
            "period": 0,
            "headway_s": 180,
            "release_delay_s": 2,
            "releases": 3,
        },
        {
            "line": "L1",
            "direction": -1,
            "period": 0,
            "headway_s": 300,
            "release_delay_s": 4,
            "releases": 2,
        },
    ]
    second["actual_headways"] = [
        {
            "line": "L1",
            "direction": -1,
            "period": 0,
            "headway_s": None,
            "release_delay_s": 8,
            "releases": 1,
        },
    ]
    first["heatmap"]["segments"] = {"A|B": 0.25}
    second["heatmap"]["segments"] = {}
    second["deadlock"] = True
    metrics = average_metrics([first, second])
    forward = next(r for r in metrics["actual_headways"] if r["direction"] == 1)
    reverse = next(r for r in metrics["actual_headways"] if r["direction"] == -1)
    assert forward["headway_s"] == 180
    assert forward["releases"] == 1.5
    assert reverse["headway_s"] == 300
    assert reverse["release_delay_s"] == 6
    assert metrics["heatmap"]["segments"]["A|B"] == 0.125
    assert metrics["deadlock"] is True


def test_deadline_returns_only_candidates_with_complete_final_seeds(monkeypatch):
    import optimizer.nsga2 as module
    from optimizer.evaluation import Evaluator, DeadlineExceeded

    class StopAfterBaseline(Evaluator):
        def many(self, candidates, seeds):
            if self.cache:
                self.aborted = True
                raise DeadlineExceeded()
            return super().many(candidates, seeds)

    monkeypatch.setattr(module, "Evaluator", StopAfterBaseline)
    result = optimize(example(), workers=1)
    assert result["stop_reason"] == "time_budget"
    assert result["reproducible"] is False
    assert len(result["evaluated_candidates"]) == 1
    assert len(result["options"]) == 4
    assert all(o["seeds"] == [42, 43] for o in result["options"])


def test_train_count_both_modes_and_limits():
    net = small(fleet=12)
    net.settings.demand_noise = False
    net.settings.delays.p0 = 0
    net.settings.optimizer.seeds_final = 1
    a = train_count(net, "L1", 0, "by_headway", headway_s=300, workers=1)
    assert a["formula_trains"] >= 1
    assert a["status"] == "found"
    assert a["diagnostics"]["boarding_s"] > 0
    assert str(a["available_fleet"]) in a["explanation"]
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


def test_fixed_work_budget_reproducible_across_processes():
    net = example()
    net.settings.optimizer.population = 40
    net.settings.optimizer.generations = 30
    net.settings.optimizer.evaluation_budget = 8
    a = optimize(net, workers=1)
    assert a["stop_reason"] == "evaluation_budget"
    assert a["reproducible"]
    assert a == optimize(net, workers=2)


@pytest.mark.parametrize("workers", [1, 2])
def test_deadline_interrupts_simulations_and_pool_shutdown(workers):
    from time import perf_counter
    from optimizer.evaluation import DeadlineExceeded
    from data_io.network import require_network, read_network

    net = require_network(read_network("datasets/synthetic/e_medium.json"))
    net.settings.optimizer.time_budget_s = 0.1
    start = perf_counter()
    with pytest.raises(DeadlineExceeded):
        optimize(net, workers=workers)
    assert perf_counter() - start < 2


@pytest.mark.parametrize("workers", [1, 2])
def test_cancel_interrupts_an_inflight_day(workers):
    from time import perf_counter
    from data_io.network import require_network, read_network

    net = require_network(read_network("datasets/synthetic/e_medium.json"))
    start = perf_counter()
    with pytest.raises(Cancelled):
        optimize(net, workers=workers, cancelled=lambda: perf_counter() - start > 0.1)
    assert perf_counter() - start < 2
