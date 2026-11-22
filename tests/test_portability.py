from pathlib import Path
import pytest
from data_io.network import read_network,require_network
from core.simulation import Simulator


@pytest.mark.parametrize("relative",["synthetic/f_star.json","london/london_subset.json"])
def test_independent_topologies_without_core_changes(relative):
    root=Path(__file__).resolve().parents[1]
    network=require_network(read_network(root / "datasets" / relative))
    result=Simulator(network).run()
    assert not result["deadlock"]
    assert result["metrics"]["transported"] > 0
    assert result["metrics"]["od_source"] == "model"
    assert result["trajectory"]["trips"]


def test_core_has_no_city_adapter_imports():
    root=Path(__file__).resolve().parents[1]
    for file in (root / "core").glob("*.py"):
        text=file.read_text(encoding="utf-8").lower()
        assert "london" not in text
        assert "tfl" not in text
