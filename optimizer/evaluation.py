"""Ordered multiprocessing results; the core never imports this layer."""

import multiprocessing
from time import perf_counter
import os
from models.discrete_events import Simulator
from models.objectives import objectives
from models.replications import average_metrics, summarize_candidate

_worker_network = None


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
            points.append(summarize_candidate(samples, headways, assignment, seeds))
        return points
