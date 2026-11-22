from core.physics import allocate_fleet,trains_needed
from .evaluation import Evaluator


def train_count(network, line_id, period_index, mode, headway_s=None, trains=None, *, workers=None):
    line = next((l for l in network.lines if l.id == line_id),None)
    if line is None: raise ValueError("Неизвестная ветка")
    if period_index < 0 or period_index >= len(network.schedule.headways[line_id]): raise ValueError("Неизвестный период")
    if mode not in ("by_headway","by_fleet"): raise ValueError("Неизвестный режим")
    if mode == "by_headway" and (headway_s is None or headway_s <= 0): raise ValueError("Нужен положительный интервал")
    if mode == "by_fleet" and (trains is None or trains < 1): raise ValueError("Нужно положительное число поездов")
    opt = network.settings.optimizer
    allocation = allocate_fleet(network)
    available = network.fleet-sum(n for l,n in allocation.items() if l != line_id)
    if mode == "by_headway":
        formula = trains_needed(network,line,headway_s)
        search = [(n,headway_s) for n in range(max(1,formula-2),formula+7) if n <= available]
    else:
        formula = None
        search = [(trains,h) for h in range(((opt.headway_min_s+opt.headway_step_s-1)//opt.headway_step_s)*opt.headway_step_s,opt.headway_max_s+1,opt.headway_step_s)] if trains <= available else []
    seeds = [network.settings.seed+i for i in range(opt.seeds_final)]
    evaluator = Evaluator(network,workers)
    checked = []
    found = None
    try:
        for n,h in search:
            assignment = {**allocation,line_id:n}
            headways = {l:list(v) for l,v in network.schedule.headways.items()}
            headways[line_id][period_index] = h
            point = evaluator.many([(headways,assignment)],seeds)[0]
            local = next(r for r in point["metrics"]["line_periods"] if r["line"] == line_id and r["period"] == period_index)
            okay = point["feasible"] and local["releases"] > 0 and local["release_delay_s"] <= 0.1*h and local["denied_share"] <= network.settings.service_targets.max_denied_share
            checked.append({"trains":n,"headway_s":h,"feasible":okay,"release_delay_s":local["release_delay_s"],"denied_share":local["denied_share"]})
            if okay:
                found = {"trains":n,"headway_s":h,"metrics":point["metrics"]}
                if mode == "by_fleet": formula = trains_needed(network,line,h)
                break
    finally:
        evaluator.close()
    return {"line_id":line_id,"period_index":period_index,"mode":mode,"formula_trains":formula,"simulation":found,"status":"found" if found else "not_found_in_range","checked":checked,"available_fleet":available,"explanation":"Формула не учитывает посадку, случайные задержки, блокировки труб/платформ и общих участков. Симуляция проверяет задержку выпуска и отказы в посадке. Поиск ограничен общим парком; остальные депо не меняются.","seeds":seeds}
