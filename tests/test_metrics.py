import pytest
import json
from data_io.schema import OD
from core.simulation import Simulator
from core.trajectory import state_at
from tests.test_movement import small


def test_hand_calculated_metrics():
    net = small([["A", "B"]], fleet=2, headway=180)
    net.settings.demand_noise = False
    net.settings.delays.p0 = 0
    net.settings.group_step_s = 60
    net.train.capacity = 100
    net.od_matrix = [
        OD(origin="A", destination="B", start_min=300, len_min=1, trips=10)
    ]
    result = Simulator(net, check_invariants=True).run()
    m = result["metrics"]
    assert m["W"] == 0
    assert m["D"] == 0
    assert m["Qn"] == pytest.approx(0.1)
    assert m["transported"] == 10
    assert m["unfinished"] == 0
    assert m["U"] == 1
    trips = result["trajectory"]["trips"]
    assert m["LF"] == pytest.approx(10 / (100 * len(trips)))
    assert m["E"] == 1 - m["LF"]


def test_trajectory_recovers_live_sample_points():
    sim = Simulator(
        small([["A", "X", "B"], ["C", "X", "D"]], fleet=16), check_invariants=True
    )
    result = sim.run()
    trajectory = result["trajectory"]
    assert json.loads(json.dumps(result))
    for sample in trajectory["series"]:
        reconstructed = state_at(trajectory, sample["time"])
        assert len(reconstructed["trains"]) == sample["trains_active"]
        for station, value in sample["waiting"].items():
            assert reconstructed["waiting"].get(station, 0) == pytest.approx(
                value, abs=1e-7
            )
        assert sum(
            t["load"] for t in reconstructed["trains"].values()
        ) == pytest.approx(sample["riding"], abs=1e-7)


def test_waiting_until_horizon_and_metric_only_equivalence():
    net = small(fleet=0)
    net.settings.demand_noise = False
    a = Simulator(net).run()
    b = Simulator(net, record=False).run()
    assert a["metrics"] == b["metrics"]
    assert a["metrics"]["W"] > 7200
    assert a["metrics"]["unfinished"] == a["metrics"]["appeared"]
    assert b["trajectory"]["trips"] == []
