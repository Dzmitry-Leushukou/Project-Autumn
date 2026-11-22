from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal
from data_io.network import validate, apply_overrides, read_network
from core.physics import allocate_fleet
from optimizer.train_count import train_count
from .service import service

app = FastAPI(title="Metro Lab", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


class NetworkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    network: dict
    overrides: dict | None = None


class OptimizeRequest(NetworkRequest):
    fleet_assignment_locked: bool = False


class CountRequest(NetworkRequest):
    line_id: str
    period_index: int = Field(ge=0)
    mode: Literal["by_headway", "by_fleet"]
    headway_s: int | None = Field(default=None, gt=0)
    trains: int | None = Field(default=None, gt=0)


def error_report(path, message):
    return {
        "errors": [{"path": path, "message": message}],
        "warnings": [],
        "missing": [],
        "assumptions": [],
        "sources": {},
    }


@app.exception_handler(RequestValidationError)
async def request_validation_error(request: Request, exc: RequestValidationError):
    report = error_report("request", "Некорректный запрос")
    report["errors"] = [
        {"path": ".".join(map(str, e["loc"])), "message": e["msg"]}
        for e in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": report})


def prepare(request):
    try:
        document = apply_overrides(request.network, request.overrides)
    except ValueError as exc:
        raise HTTPException(422, detail=error_report("overrides", str(exc))) from exc
    network, report = validate(document)
    if network is None:
        raise HTTPException(422, detail=report)
    if network.fleet_assignment is None:
        report["assumptions"].append(
            {
                "path": "fleet_assignment",
                "message": "Рассчитано по времени оборота, метод наибольших остатков",
                "value": allocate_fleet(network),
                "source": "assumption",
            }
        )
        report["sources"]["fleet_assignment"] = "assumption"
    return network, report


@app.get("/networks")
def networks():
    return [
        {"id": key, **{k: read_network(path)["meta"][k] for k in ("name", "synthetic")}}
        for key, path in service.networks().items()
    ]


@app.get("/networks/{network_id}")
def network(network_id: str):
    path = service.networks().get(network_id)
    if path is None:
        raise HTTPException(404, "Сеть не найдена")
    return read_network(path)


@app.post("/validate")
def validate_network(request: NetworkRequest):
    try:
        document = apply_overrides(request.network, request.overrides)
    except ValueError as exc:
        return error_report("overrides", str(exc))
    network, report = validate(document)
    if network is not None and network.fleet_assignment is None:
        report["assumptions"].append(
            {
                "path": "fleet_assignment",
                "message": "Распределено по формуле оборота",
                "value": allocate_fleet(network),
                "source": "assumption",
            }
        )
        report["sources"]["fleet_assignment"] = "assumption"
    return report


@app.post("/simulate")
def simulate(request: NetworkRequest):
    network, report = prepare(request)
    return {**service.simulate(network), "validation": report}


@app.get("/runs/{run_id}/trajectory")
def trajectory(run_id: str):
    run = service.run(run_id)
    if run is None:
        raise HTTPException(404, "Прогон не найден или вытеснен из памяти")
    return Response(content=run["trajectory"], media_type="application/json")


@app.get("/runs/{run_id}/metrics")
def metrics(run_id: str):
    run = service.run(run_id)
    if run is None:
        raise HTTPException(404, "Прогон не найден или вытеснен из памяти")
    return run["metrics"]


@app.post("/optimize")
def optimize_network(request: OptimizeRequest):
    network, _ = prepare(request)
    return service.submit(network, request.fleet_assignment_locked)


@app.get("/jobs/{job_id}")
def job(job_id: str):
    job = service.job(job_id)
    if job is None:
        raise HTTPException(404, "Задача не найдена")
    return job


@app.post("/jobs/{job_id}/cancel")
def cancel(job_id: str):
    result = service.cancel(job_id)
    if result is None:
        raise HTTPException(404, "Задача не найдена")
    return result


@app.post("/train-count")
def count(request: CountRequest):
    network, _ = prepare(request)
    try:
        return train_count(
            network,
            request.line_id,
            request.period_index,
            request.mode,
            request.headway_s,
            request.trains,
            workers=service.workers,
        )
    except ValueError as exc:
        raise HTTPException(422, detail=error_report("train_count", str(exc))) from exc
