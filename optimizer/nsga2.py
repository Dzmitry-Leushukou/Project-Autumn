"""NSGA-II: rank/crowding tournaments, line crossover, bounded mutation/repair."""
import math
from time import perf_counter
import numpy as np
from core.physics import allocate_fleet,cycle_time
from core.randomness import RandomStreams
from .evaluation import Evaluator,Cancelled
from .objectives import fronts,crowding,select,four_options


def optimize(network, *, fleet_assignment_locked=False, workers=None, progress=lambda p:None, cancelled=lambda:False):
    opt = network.settings.optimizer
    rng = RandomStreams(network.settings.seed).search
    line_ids = [l.id for l in network.lines]
    periods = len(network.schedule.headways[line_ids[0]])
    low = math.ceil(opt.headway_min_s/opt.headway_step_s)
    high = opt.headway_max_s//opt.headway_step_s
    assignment = allocate_fleet(network)
    start = perf_counter()
    evaluator = Evaluator(network,workers,cancelled)
    search_seeds = [network.settings.seed+i for i in range(opt.seeds_search)]
    final_seeds = [network.settings.seed+i for i in range(opt.seeds_final)]

    def encode(headways, allocation):
        h = np.array([headways[l] for l in line_ids],dtype=int)
        return h,np.array([allocation[l] for l in line_ids],dtype=int)

    def repair(genome):
        h,a = genome
        h = np.clip(np.rint(h/opt.headway_step_s),low,high).astype(int)*opt.headway_step_s
        a = np.maximum(0,a.astype(int))
        if fleet_assignment_locked:
            a = np.array([assignment[l] for l in line_ids])
        else:
            while a.sum() > network.fleet:
                i = int(np.argmax(a))
                a[i] -= 1
        return h,a

    def decode(genome):
        h,a = genome
        return {l:h[i].tolist() for i,l in enumerate(line_ids)},{l:int(a[i]) for i,l in enumerate(line_ids)}

    def mutate(genome):
        h,a = (v.copy() for v in genome)
        for _ in range(max(1,len(line_ids))):
            i = int(rng.integers(len(line_ids)))
            p = int(rng.integers(periods))
            h[i,p] += int(rng.choice([-4,-3,-2,-1,1,2,3,4]))*opt.headway_step_s
        if not fleet_assignment_locked and len(a)>1:
            i,j = rng.choice(len(a),2,replace=False)
            if a[i] > 0:
                a[i] -= 1
                a[j] += 1
        return repair((h,a))

    baseline_genome = encode(network.schedule.headways,assignment)
    current = repair(baseline_genome)
    formula_h = {}
    for line in network.lines:
        a = assignment[line.id]
        h = cycle_time(network,line)*(2 if line.is_loop else 1)/max(1,a)
        formula_h[line.id] = [round(h)]*periods
    formula = repair(encode(formula_h,assignment))
    genomes = [current,formula]
    # Boundary seeds ensure a useful trade-off even if time allows no generation.
    genomes.extend([repair((np.full_like(current[0],low*opt.headway_step_s),current[1].copy())),repair((np.full_like(current[0],high*opt.headway_step_s),current[1].copy()))])
    while len(genomes) < opt.population:
        genomes.append(mutate(current if len(genomes)%2 else formula))
    completed = 0
    stop_reason = "generations"
    try:
        points = []
        evaluated_genomes = []
        # Budget is checked between small complete batches, including the initial
        # population: a large initial population must not monopolize the budget.
        for offset in range(0,len(genomes),4):
            batch = genomes[offset:offset+4]
            points.extend(evaluator.many([decode(g) for g in batch],search_seeds))
            evaluated_genomes.extend(batch)
            if perf_counter()-start >= opt.time_budget_s*0.35:
                stop_reason = "time_budget"
                break
        genomes = evaluated_genomes
        progress(0.15)
        for generation in range(opt.generations):
            if cancelled(): raise Cancelled()
            # Reserve time for final multi-seed evaluation rather than returning
            # search-only scores under final labels.
            if perf_counter()-start >= opt.time_budget_s*0.55:
                stop_reason = "time_budget"
                break
            values = [(p["f_A"],p["f_B"]) for p in points]
            ranks,distances = {},{}
            for rank,front in enumerate(fronts(values)):
                ranks.update({i:rank for i in front})
                distances.update(crowding(front,values))
            def tournament():
                a,b = rng.integers(len(genomes),size=2)
                return min((int(a),int(b)),key=lambda i:(ranks[i],-distances[i],i))
            children = []
            while len(children) < opt.population:
                a,b = genomes[tournament()],genomes[tournament()]
                mask = rng.random(len(line_ids)) < 0.5
                h = np.where(mask[:,None],a[0],b[0])
                alloc = np.where(mask,a[1],b[1])
                children.append(mutate((h,alloc)))
            child_points = []
            evaluated_children = []
            for offset in range(0,len(children),4):
                batch = children[offset:offset+4]
                child_points.extend(evaluator.many([decode(g) for g in batch],search_seeds))
                evaluated_children.extend(batch)
                if perf_counter()-start >= opt.time_budget_s*0.55:
                    stop_reason = "time_budget"
                    break
            children = evaluated_children
            all_points = points+child_points
            all_genomes = genomes+children
            indices = select(list(range(len(all_points))),[(p["f_A"],p["f_B"]) for p in all_points],opt.population)
            points = [all_points[i] for i in indices]
            genomes = [all_genomes[i] for i in indices]
            completed += 1
            progress(0.15+0.55*(generation+1)/opt.generations)
        # Re-evaluate the complete nondominated archive plus the exact baseline.
        nondominated = fronts([(p["f_A"],p["f_B"]) for p in points])[0]
        final_candidates = []
        for i in nondominated:
            candidate = decode(genomes[i])
            if points[i]["feasible"] and candidate not in final_candidates:
                final_candidates.append(candidate)
        baseline = decode(baseline_genome)
        if baseline not in final_candidates:
            final_candidates.append(baseline)
        final = evaluator.many(final_candidates,final_seeds)
        baseline_point = final[final_candidates.index(baseline)]
        # Only repaired in-bounds candidates may enter the optimization front.
        eligible = [p for p in final if all(opt.headway_min_s <= h <= opt.headway_max_s and h%opt.headway_step_s == 0 for hs in p["headways"].values() for h in hs)]
        options,front = four_options(eligible,baseline_point)
        progress(1.0)
        return {"options":options,"front":front,"baseline":baseline_point,"generations_completed":completed,"stop_reason":stop_reason,"seed":network.settings.seed,"od_source":"data" if network.od_matrix is not None else "model","evaluations":len(evaluator.cache)}
    finally:
        evaluator.close()
