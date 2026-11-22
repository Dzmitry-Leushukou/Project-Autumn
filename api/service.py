"""Bounded in-memory run storage and cancellable background jobs."""

from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
from threading import Event, Lock
from time import perf_counter
from uuid import uuid4
from core.simulation import Simulator
from data_io.network import read_network
from optimizer.nsga2 import optimize
from optimizer.evaluation import Cancelled

ROOT = Path(__file__).resolve().parents[1]


class Service:
    def __init__(self):
        self.runs = OrderedDict()
        self.jobs = OrderedDict()
        self.lock = Lock()
        self.executor = ThreadPoolExecutor(
            max_workers=2, thread_name_prefix="metro-job"
        )
        self.workers = None

    def networks(self):
        result = {}
        for directory in ("synthetic", "london"):
            for path in sorted((ROOT / "datasets" / directory).glob("*.json")):
                result[path.stem] = path
        return result

    def simulate(self, network):
        start = perf_counter()
        result = Simulator(network).run()
        trajectory = json.dumps(
            result["trajectory"],
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
        run_id = uuid4().hex
        metrics = {**result["metrics"], "compute_seconds": perf_counter() - start}
        with self.lock:
            self.runs[run_id] = {"metrics": metrics, "trajectory": trajectory}
            while len(self.runs) > 20:
                self.runs.popitem(last=False)
        return {"run_id": run_id, "metrics": metrics, "deadlock": result["deadlock"]}

    def run(self, run_id):
        with self.lock:
            return self.runs.get(run_id)

    def submit(self, network, locked):
        job_id = uuid4().hex
        job = {"status": "queued", "progress": 0.0, "cancel": Event()}
        with self.lock:
            # Bound retained terminal jobs. Active jobs are never silently evicted.
            terminal = [
                k
                for k, v in self.jobs.items()
                if v["status"] in ("done", "failed", "cancelled")
            ]
            for key in terminal[: max(0, len(self.jobs) - 19)]:
                self.jobs.pop(key)
            self.jobs[job_id] = job
        self.executor.submit(self._execute, job, network, locked)
        return {"job_id": job_id}

    def _execute(self, job, network, locked):
        if job["cancel"].is_set():
            return
        job["status"] = "running"
        start = perf_counter()
        try:

            def progress(value):
                job["progress"] = value

            result = optimize(
                network,
                fleet_assignment_locked=locked,
                workers=self.workers,
                progress=progress,
                cancelled=job["cancel"].is_set,
            )
            if not job["cancel"].is_set():
                job.update(
                    status="done",
                    progress=1.0,
                    result={**result, "compute_seconds": perf_counter() - start},
                )
        except Cancelled:
            job["status"] = "cancelled"
        except Exception as exc:
            if not job["cancel"].is_set():
                job.update(status="failed", error=str(exc))

    def job(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            return {k: v for k, v in job.items() if k != "cancel"} if job else None

    def cancel(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            if job is None:
                return None
            if job["status"] not in ("done", "failed", "cancelled"):
                job["cancel"].set()
                job["status"] = "cancelled"
            return {"status": job["status"]}


service = Service()
