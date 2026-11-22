import time
import importlib
from threading import Event
import pytest
from fastapi.testclient import TestClient
from api.main import app
from api.service import service
from scripts.generate_demos import build


@pytest.fixture
def client():
    previous = service.workers
    service.workers = 1
    yield TestClient(app)
    service.workers = previous


@pytest.fixture
def doc():
    d = build("API", [["A", "B", "C"]], duration=600)
    d["settings"]["optimizer"] = {
        "population": 4,
        "generations": 1,
        "seeds_search": 1,
        "seeds_final": 1,
    }
    return d


def test_network_catalogue(client):
    catalogue = client.get("/networks").json()
    assert len(catalogue) >= 6
    for item in catalogue:
        assert (
            client.get(f'/networks/{item["id"]}').json()["meta"]["name"] == item["name"]
        )
    assert client.get("/networks/missing").status_code == 404


def test_validation_and_overrides(client, doc):
    report = client.post("/validate", json={"network": doc}).json()
    assert not report["errors"]
    assert any(r["path"] == "fleet_assignment" for r in report["assumptions"])
    invalid = {**doc, "fleet": -1}
    assert client.post("/validate", json={"network": invalid}).json()["errors"]
    r = client.post("/simulate", json={"network": invalid})
    assert r.status_code == 422 and r.json()["detail"]["errors"]
    r = client.post(
        "/simulate", json={"network": doc, "overrides": {"settings": {"seed": 123}}}
    )
    assert r.status_code == 200
    trajectory = client.get(f'/runs/{r.json()["run_id"]}/trajectory').json()
    assert trajectory["meta"]["seed"] == 123
    assert (
        client.post(
            "/simulate", json={"network": doc, "overrides": {"unsupported": 1}}
        ).status_code
        == 422
    )
    assert client.post("/simulate", json={}).json()["detail"]["errors"]


def test_run_storage_and_eviction(client, doc):
    ids = []
    for _ in range(21):
        response = client.post("/simulate", json={"network": doc})
        assert response.status_code == 200, response.text
        ids.append(response.json()["run_id"])
    assert len(service.runs) == 20
    assert client.get(f"/runs/{ids[0]}/metrics").status_code == 404
    assert client.get(f"/runs/{ids[-1]}/metrics").json()["od_source"] == "model"
    assert client.get(f"/runs/{ids[-1]}/trajectory").json()["trips"]
    assert client.get("/runs/missing/trajectory").status_code == 404


def test_job_complete_and_cancel(client, doc, monkeypatch):
    job = client.post("/optimize", json={"network": doc}).json()["job_id"]
    for _ in range(100):
        result = client.get(f"/jobs/{job}").json()
        if result["status"] in ("done", "failed"):
            break
        time.sleep(0.02)
    assert result["status"] == "done", result
    assert len(result["result"]["options"]) == 4
    assert result["progress"] == 1
    module = importlib.import_module("api.service")
    actual = module.optimize
    gate = Event()

    def held(*args, **kwargs):
        gate.wait(timeout=2)
        return actual(*args, **kwargs)

    monkeypatch.setattr(module, "optimize", held)
    job = client.post("/optimize", json={"network": doc}).json()["job_id"]
    assert client.post(f"/jobs/{job}/cancel").json()["status"] == "cancelled"
    assert client.get(f"/jobs/{job}").json()["status"] == "cancelled"
    gate.set()
    assert client.get("/jobs/missing").status_code == 404
    assert client.post("/jobs/missing/cancel").status_code == 404


def test_train_count_api(client, doc):
    request = {
        "network": doc,
        "line_id": "L1",
        "period_index": 0,
        "mode": "by_headway",
        "headway_s": 300,
    }
    result = client.post("/train-count", json=request)
    assert result.status_code == 200, result.text
    assert "formula_trains" in result.json()
    request.update(mode="by_fleet", trains=4)
    assert client.post("/train-count", json=request).status_code == 200
    request["period_index"] = 100
    assert client.post("/train-count", json=request).status_code == 422
