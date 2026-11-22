"""Cross-cutting regressions: provenance, zero flow, pool formula, period boundary."""

import json
from data_io.network import validate
from core.physics import trains_needed
from core.simulation import Simulator
from tests.test_movement import small


def test_formula_sufficient_on_unloaded_path():
    net = small(headway=180)
    count = trains_needed(net, net.lines[0], 180)
    net.fleet_assignment = {"L1": count}
    net.fleet = count
    result = Simulator(net, passengers=False, check_invariants=True).run()
    assert not result["deadlock"]
    assert all(r["delay_s"] == 0 for r in result["releases"])


def test_no_demand_metrics_are_finite():
    net = small()
    net.demand = []
    result = Simulator(net, check_invariants=True).run()
    json.dumps(result, allow_nan=False)
    assert result["metrics"]["W"] == 0
    assert result["metrics"]["transported"] == 0


def test_period_dispatch_uses_actual_previous_release():
    net = small(headway=180)
    net.schedule.period_len_min = 30
    net.schedule.headways = {"L1": [180, 360]}
    result = Simulator(net, passengers=False).run()
    forward = [r for r in result["releases"] if r["direction"] == 1]
    for a, b in zip(forward, forward[1:]):
        assert b["time"] - a["time"] == (180 if a["time"] < 19800 else 360)


def test_every_default_is_reported_and_sources_survive():
    net = small()
    doc = net.model_dump(by_alias=True)
    doc.pop("settings")
    doc.pop("schedule")
    doc["stations"][0]["door_open_s"] = {"value": 7, "source": "data"}
    parsed, report = validate(doc)
    assert parsed
    assert report["sources"]["stations.0.door_open_s"] == "data"
    assert any(r["path"] == "settings.routes.diversity" for r in report["assumptions"])
