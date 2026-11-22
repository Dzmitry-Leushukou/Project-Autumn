"""Ordered multiprocessing results; the core never imports this layer."""

from concurrent.futures import ProcessPoolExecutor
import os
import numpy as np
from core.simulation import Simulator
from .objectives import objectives

_worker_network = None


def _initialize(network):
    global _worker_network
    _worker_network = network


def evaluate_seed(network, headways, assignment, seed):
    n = network.model_copy(deep=False)
    n.settings = network.settings.model_copy(update={"seed": seed})
    n.schedule = network.schedule.model_copy(update={"headways": headways})
    n.fleet_assignment = assignment
    result = Simulator(n, record=False).run()
    metrics = result["metrics"]
    return metrics, objectives(metrics, n.settings.optimizer)


def _task(args):
    return evaluate_seed(_worker_network, *args)


class Cancelled(Exception):
    pass


class Evaluator:
    def __init__(self, network, workers=None, cancelled=lambda: False):
        self.network = network
        self.workers = workers or os.cpu_count() or 1
        self.pool = (
            ProcessPoolExecutor(
                max_workers=self.workers, initializer=_initialize, initargs=(network,)
            )
            if self.workers > 1
            else None
        )
        self.cache = {}
        self.cancelled = cancelled

    def close(self):
        if self.pool:
            self.pool.shutdown(wait=True, cancel_futures=True)

    def many(self, candidates, seeds):
        pending = []
        for headways, assignment in candidates:
            for seed in seeds:
                key = (
                    tuple((k, tuple(v)) for k, v in sorted(headways.items())),
                    tuple(sorted(assignment.items())),
                    seed,
                )
                if key not in self.cache and key not in [k for k, _ in pending]:
                    args = (headways, assignment, seed)
                    pending.append(
                        (key, self.pool.submit(_task, args) if self.pool else args)
                    )
        for key, job in pending:
            if self.cancelled():
                for _, future in pending:
                    if self.pool:
                        future.cancel()
                raise Cancelled()
            self.cache[key] = (
                job.result() if self.pool else evaluate_seed(self.network, *job)
            )
        points = []
        for headways, assignment in candidates:
            samples = [
                self.cache[
                    (
                        tuple((k, tuple(v)) for k, v in sorted(headways.items())),
                        tuple(sorted(assignment.items())),
                        seed,
                    )
                ]
                for seed in seeds
            ]
            metrics = dict(samples[0][0])
            for name in (
                "W",
                "D",
                "LF",
                "E",
                "Qn",
                "U",
                "appeared",
                "transported",
                "unfinished",
                "waiting",
                "riding",
                "walking",
                "used_trains",
                "peak_active",
                "release_delay_s",
            ):
                metrics[name] = float(np.mean([m[name] for m, _ in samples]))
            metrics["line_periods"] = [
                {
                    **row,
                    **{
                        name: float(
                            np.mean([m["line_periods"][i][name] for m, _ in samples])
                        )
                        for name in (
                            "release_delay_s",
                            "denied_share",
                            "boarded",
                            "denied",
                            "releases",
                            "used_trains",
                        )
                    },
                }
                for i, row in enumerate(samples[0][0]["line_periods"])
            ]
            values = np.array([o for _, o in samples])
            invalid = bool(np.any(values >= 1e9))
            points.append(
                {
                    "headways": headways,
                    "fleet_assignment": assignment,
                    "metrics": metrics,
                    "f_A": 1e9 if invalid else float(values[:, 0].mean()),
                    "f_B": 1e9 if invalid else float(values[:, 1].mean()),
                    "std": {
                        "f_A": float(values[:, 0].std()),
                        "f_B": float(values[:, 1].std()),
                        "W": float(np.std([m["W"] for m, _ in samples])),
                    },
                    "seeds": list(seeds),
                    "feasible": not invalid,
                }
            )
        return points
