"""Ordered multiprocessing results; the core never imports this layer."""

import multiprocessing
from time import perf_counter
import os
import numpy as np
from core.simulation import Simulator
from .objectives import objectives

_worker_network = None


def average_metrics(samples):
    """Average every measured value; align sparse records by physical identity.

    Absent heatmap resources contribute zero (no passage/blocking). Absent
    headways contribute no observation: a missing release interval is not 0 s.
    Boolean infeasibility is the union across seeds, never the first seed.
    """
    result = dict(samples[0])
    identity_fields = {"line", "direction", "period"}

    def rows(name, keys):
        grouped = {}
        for sample in samples:
            for row in sample[name]:
                key = tuple(row[k] for k in keys)
                grouped.setdefault(key, []).append(row)
        output = []
        for key, values in sorted(grouped.items()):
            row = dict(zip(keys, key))
            for field in values[0]:
                if field in identity_fields:
                    continue
                observed = [v[field] for v in values if v[field] is not None]
                divisor = len(observed) if field == "headway_s" else len(samples)
                row[field] = float(sum(observed) / divisor) if observed else None
            output.append(row)
        return output

    constants = {"od_source", "assignment_source", "fleet_assignment"}
    nested = {"actual_headways", "line_periods", "heatmap"}
    for name in result.keys() - constants - nested:
        result[name] = (
            any(m[name] for m in samples)
            if name == "deadlock"
            else float(np.mean([m[name] for m in samples]))
        )
    result["actual_headways"] = rows("actual_headways", ("line", "direction", "period"))
    result["line_periods"] = rows("line_periods", ("line", "period"))
    result["heatmap"] = {
        layer: {
            key: float(np.mean([m["heatmap"][layer].get(key, 0) for m in samples]))
            for key in sorted(set().union(*(m["heatmap"][layer] for m in samples)))
        }
        for layer in samples[0]["heatmap"]
    }
    return result


def _initialize(network):
    global _worker_network
    _worker_network = network


def evaluate_seed(network, headways, assignment, seed, deadline=None, cancelled=None):
    n = network.model_copy(deep=False)
    n.settings = network.settings.model_copy(update={"seed": seed})
    n.schedule = network.schedule.model_copy(update={"headways": headways})
    n.fleet_assignment = assignment

    def stopped():
        return (deadline is not None and perf_counter() >= deadline) or (
            cancelled is not None and cancelled()
        )

    result = Simulator(n, record=False).run(
        should_stop=stopped if deadline is not None or cancelled is not None else None
    )
    metrics = result["metrics"]
    return metrics, objectives(metrics, n.settings.optimizer)


def _task(args):
    return evaluate_seed(_worker_network, *args)


class Cancelled(Exception):
    pass


class DeadlineExceeded(TimeoutError):
    pass


class Evaluator:
    def __init__(self, network, workers=None, cancelled=lambda: False, deadline=None):
        self.network = network
        self.workers = workers or os.cpu_count() or 1
        self.pool = (
            multiprocessing.get_context("spawn").Pool(
                processes=self.workers, initializer=_initialize, initargs=(network,)
            )
            if self.workers > 1
            else None
        )
        self.cache = {}
        self.cancelled = cancelled
        self.deadline = deadline
        self.aborted = False

    def close(self):
        if self.pool:
            if self.aborted:
                self.pool.terminate()
            else:
                self.pool.close()
            self.pool.join()

    def check_stop(self):
        if self.cancelled():
            self.aborted = True
            raise Cancelled()
        if self.deadline is not None and perf_counter() >= self.deadline:
            self.aborted = True
            raise DeadlineExceeded("Время поиска истекло")

    def many(self, candidates, seeds):
        self.check_stop()
        pending = []
        for headways, assignment in candidates:
            for seed in seeds:
                key = (
                    tuple((k, tuple(v)) for k, v in sorted(headways.items())),
                    tuple(sorted(assignment.items())),
                    seed,
                )
                if key not in self.cache and key not in [k for k, _ in pending]:
                    args = (headways, assignment, seed, self.deadline)
                    pending.append(
                        (
                            key,
                            (
                                self.pool.apply_async(_task, (args,))
                                if self.pool
                                else args
                            ),
                        )
                    )
        for key, job in pending:
            self.check_stop()
            try:
                if self.pool:
                    while True:
                        try:
                            value = job.get(timeout=0.05)
                            break
                        except multiprocessing.TimeoutError:
                            self.check_stop()
                else:
                    value = evaluate_seed(self.network, *job, cancelled=self.cancelled)
            except TimeoutError as exc:
                self.aborted = True
                if self.cancelled():
                    raise Cancelled() from exc
                raise DeadlineExceeded(str(exc)) from exc
            self.cache[key] = value
        return self.cached(candidates, seeds)

    def complete(self, candidate, seeds):
        headways, assignment = candidate
        return all(
            (
                tuple((k, tuple(v)) for k, v in sorted(headways.items())),
                tuple(sorted(assignment.items())),
                seed,
            )
            in self.cache
            for seed in seeds
        )

    def cached(self, candidates, seeds):
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
            metrics = average_metrics([m for m, _ in samples])
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
