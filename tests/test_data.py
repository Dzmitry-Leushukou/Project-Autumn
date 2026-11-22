import copy
from pathlib import Path
import pytest
from data_io.network import read_network, write_network, validate

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def document():
    return read_network(ROOT / "datasets/synthetic/a_simple.json")


def test_six_demos_and_lossless_roundtrip(tmp_path):
    files = list((ROOT / "datasets/synthetic").glob("*.json"))
    assert len(files) == 6
    for path in files:
        doc = read_network(path)
        network, report = validate(doc)
        assert network, report
        assert doc["meta"]["synthetic"]
        write_network(doc, tmp_path / "copy.json")
        assert read_network(tmp_path / "copy.json") == doc


@pytest.mark.parametrize(
    "change,path",
    [
        (lambda d: d["lines"][0]["stations"].append("missing"), "lines.0.stations"),
        (lambda d: d["segments"][0].update(length_m=-1), "segments.0.length_m"),
        (lambda d: d["segments"][0].pop("length_m"), "segments.0"),
        (
            lambda d: d["stations"].append(
                {"id": "orphan", "name": "Orphan", "x": 0, "y": 0}
            ),
            "stations",
        ),
        (lambda d: d.pop("fleet"), "fleet"),
        (lambda d: d["demand"].append(copy.deepcopy(d["demand"][0])), "demand"),
        (lambda d: d.update(fleet_assignment={"L1": 10000}), "fleet_assignment"),
        (
            lambda d: d.update(schedule={"headways": {"L1": [180]}}),
            "schedule.headways.L1",
        ),
        (lambda d: d["train"].update(capacity=0), "train.capacity"),
        (
            lambda d: d["stations"].append(copy.deepcopy(d["stations"][0])),
            "stations.6.id",
        ),
    ],
)
def test_invalid(document, change, path):
    change(document)
    network, report = validate(document)
    assert network is None
    assert any(row["path"] == path for row in report["errors"]), report


def test_defaults_are_reported(document):
    network, report = validate(document)
    assert network.train.capacity == 800
    assert any(
        r["path"] == "train.capacity" and r["source"] == "assumption"
        for r in report["assumptions"]
    )
    assert report["sources"]["segments.0.length_m"] == "assumption"
    assert network.schedule.headways["L1"] == [180] * 20
    assert any(r["path"] == "fleet_assignment" for r in report["missing"])


def test_invalid_source_and_fractional_integer(document):
    document["fleet"] = {"value": 4.5, "source": "user"}
    assert validate(document)[0] is None
    document["fleet"] = {"value": 12, "source": "invented"}
    assert validate(document)[0] is None
