"""Многокритериальный поиск расписания методом NSGA-II.

Переменные: интервалы h[line,period] на целочисленной решётке и парк n[line].
Ограничения: h_min<=h<=h_max, h кратен шагу, n>=0, sum(n)<=fleet.
Турнир: ранг Парето, затем crowding distance; скрещивание по веткам;
мутация интервалов на 1–4 шага и перенос поезда; элитистский отбор.
Каждый кандидат оценивается несколькими симуляциями через Evaluator.
Остановка: поколения, лимит оценок или аварийный бюджет времени.
"""

import math
from time import perf_counter
import numpy as np
from .fleet import allocate_fleet, cycle_time
from .random_streams import RandomStreams
from optimizer.evaluation import Evaluator, Cancelled, DeadlineExceeded
from .pareto import fronts, crowding, select, four_options


def optimize(
    network,
    *,
    fleet_assignment_locked=False,
    workers=None,
    progress=lambda p: None,
    cancelled=lambda: False,
):
    opt = network.settings.optimizer
    rng = RandomStreams(network.settings.seed).search
    line_ids = [l.id for l in network.lines]
    periods = len(network.schedule.headways[line_ids[0]])
    low = math.ceil(opt.headway_min_s / opt.headway_step_s)
    high = opt.headway_max_s // opt.headway_step_s
    assignment = allocate_fleet(network)
    start = perf_counter()
    evaluator = Evaluator(
        network, workers, cancelled, deadline=start + opt.time_budget_s
    )
    search_seeds = [network.settings.seed + i for i in range(opt.seeds_search)]
    final_seeds = [network.settings.seed + i for i in range(opt.seeds_final)]

    def encode(headways, allocation):
        h = np.array([headways[l] for l in line_ids], dtype=int)
        return h, np.array([allocation[l] for l in line_ids], dtype=int)

    def repair(genome):
        h, a = genome
        h = (
            np.clip(np.rint(h / opt.headway_step_s), low, high).astype(int)
            * opt.headway_step_s
        )
        a = np.maximum(0, a.astype(int))
        if fleet_assignment_locked:
            a = np.array([assignment[l] for l in line_ids])
        else:
            while a.sum() > network.fleet:
                i = int(np.argmax(a))
                a[i] -= 1
        return h, a

    def decode(genome):
        h, a = genome
        return {l: h[i].tolist() for i, l in enumerate(line_ids)}, {
            l: int(a[i]) for i, l in enumerate(line_ids)
        }

    def mutate(genome):
        h, a = (v.copy() for v in genome)
        for _ in range(max(1, len(line_ids))):
            i = int(rng.integers(len(line_ids)))
            p = int(rng.integers(periods))
            h[i, p] += (
                int(rng.choice([-4, -3, -2, -1, 1, 2, 3, 4])) * opt.headway_step_s
            )
        if not fleet_assignment_locked and len(a) > 1:
            i, j = rng.choice(len(a), 2, replace=False)
            if a[i] > 0:
                a[i] -= 1
                a[j] += 1
        return repair((h, a))

    baseline_genome = encode(network.schedule.headways, assignment)
    current = repair(baseline_genome)
    formula_h = {}
    for line in network.lines:
        a = assignment[line.id]
        h = cycle_time(network, line) * (2 if line.is_loop else 1) / max(1, a)
        formula_h[line.id] = [round(h)] * periods
    formula = repair(encode(formula_h, assignment))
    genomes = [current, formula]
    # Boundary seeds ensure a useful trade-off even if time allows no generation.
    genomes.extend(
        [
            repair(
                (np.full_like(current[0], low * opt.headway_step_s), current[1].copy())
            ),
            repair(
                (np.full_like(current[0], high * opt.headway_step_s), current[1].copy())
            ),
        ]
    )
    while len(genomes) < opt.population:
        genomes.append(mutate(current if len(genomes) % 2 else formula))
    completed = 0
    stop_reason = "generations"
    budget = min(opt.evaluation_budget, opt.population * (opt.generations + 1))
    initial_count = (
        min(opt.population, max(4, budget // 2))
        if budget < 2 * opt.population
        else opt.population
    )
    submitted = []
    baseline = decode(baseline_genome)
    baseline_point = None
    evaluated = 0

    def score(batch):
        nonlocal evaluated
        candidates = [decode(g) for g in batch]
        submitted.extend(c for c in candidates if c not in submitted)
        # Complete final seeds immediately, so a deadline never starts a costly
        # unbounded final phase and never labels search-only scores as final.
        evaluator.many(candidates, sorted(set(search_seeds + final_seeds)))
        evaluated += len(batch)
        progress(min(0.95, evaluated / budget))
        return evaluator.cached(candidates, search_seeds)

    try:
        try:
            submitted.append(baseline)
            baseline_point = evaluator.many([baseline], final_seeds)[0]
            points = []
            initial = genomes[:initial_count]
            for offset in range(0, len(initial), 4):
                points.extend(score(initial[offset : offset + 4]))
            genomes = initial
            for generation in range(opt.generations):
                if evaluated >= budget:
                    stop_reason = "evaluation_budget"
                    break
                evaluator.check_stop()
                values = [(p["f_A"], p["f_B"]) for p in points]
                ranks, distances = {}, {}
                for rank, front in enumerate(fronts(values)):
                    ranks.update({i: rank for i in front})
                    distances.update(crowding(front, values))

                def tournament():
                    a, b = rng.integers(len(genomes), size=2)
                    return min(
                        (int(a), int(b)), key=lambda i: (ranks[i], -distances[i], i)
                    )

                children = []
                while len(children) < min(opt.population, budget - evaluated):
                    a, b = genomes[tournament()], genomes[tournament()]
                    mask = rng.random(len(line_ids)) < 0.5
                    h = np.where(mask[:, None], a[0], b[0])
                    alloc = np.where(mask, a[1], b[1])
                    children.append(mutate((h, alloc)))
                child_points = []
                for offset in range(0, len(children), 4):
                    child_points.extend(score(children[offset : offset + 4]))
                all_points, all_genomes = points + child_points, genomes + children
                indices = select(
                    list(range(len(all_points))),
                    [(p["f_A"], p["f_B"]) for p in all_points],
                    opt.population,
                )
                points = [all_points[i] for i in indices]
                genomes = [all_genomes[i] for i in indices]
                completed += 1
            if evaluated >= budget and completed < opt.generations:
                stop_reason = "evaluation_budget"
        except DeadlineExceeded:
            stop_reason = "time_budget"
        if baseline_point is None:
            raise DeadlineExceeded(
                "Бюджета не хватило даже на оценку исходного расписания; увеличьте время поиска."
            )
        final_candidates = [c for c in submitted if evaluator.complete(c, final_seeds)]
        final = evaluator.cached(final_candidates, final_seeds)
        # Only repaired in-bounds candidates may enter the optimization front.
        eligible = [
            p
            for p in final
            if all(
                opt.headway_min_s <= h <= opt.headway_max_s
                and h % opt.headway_step_s == 0
                for hs in p["headways"].values()
                for h in hs
            )
        ]
        options, front = four_options(eligible, baseline_point)
        progress(1.0)
        return {
            "options": options,
            "front": front,
            "baseline": baseline_point,
            "generations_completed": completed,
            "stop_reason": stop_reason,
            "seed": network.settings.seed,
            "od_source": "data" if network.od_matrix is not None else "model",
            "evaluations": len(evaluator.cache),
            "evaluation_budget": opt.evaluation_budget,
            "reproducible": stop_reason != "time_budget",
            "evaluated_candidates": [
                {"headways": h, "fleet_assignment": a} for h, a in final_candidates
            ],
        }
    finally:
        evaluator.close()
