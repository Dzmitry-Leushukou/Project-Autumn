"""Validation produces a reviewable report before any model is run."""
import copy
import json
import math
from pathlib import Path
from pydantic import BaseModel, ValidationError
import networkx as nx
from .schema import Network


def read_network(path: str | Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_network(document: dict, path: str | Path):
    Path(path).write_text(json.dumps(document, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def pairs(line):
    return list(zip(line.stations, line.stations[1:] + (line.stations[:1] if line.is_loop else [])))


def validate(document: dict) -> tuple[Network | None, dict]:
    report = {"errors": [], "warnings": [], "missing": [], "assumptions": [], "sources": {}}

    def add(kind, path, message, **extra):
        report[kind].append({"path": path, "message": message, **extra})

    def provenance(value, path=""):
        if isinstance(value, dict):
            if "value" in value and "source" in value:
                report["sources"][path] = value["source"]
            else:
                for k, v in value.items():
                    provenance(v, f"{path}.{k}".strip("."))
        elif isinstance(value, list):
            for i, v in enumerate(value):
                provenance(v, f"{path}.{i}")
        elif isinstance(value, (float, int, bool)):
            # Untagged input is an explicit user value, never real data by inference.
            report["sources"][path] = "user"

    provenance(document)
    try:
        network = Network.model_validate(document)
    except ValidationError as exc:
        for error in exc.errors(include_url=False, include_input=False):
            path = ".".join(map(str, error["loc"]))
            add("errors", path, error["msg"])
            if error["type"] == "missing":
                add("missing", path, "Обязательный параметр отсутствует")
        return None, report

    def defaults(model, path=""):
        for name, field in type(model).model_fields.items():
            value = getattr(model, name)
            key = f"{path}.{field.alias or name}".strip(".")
            if isinstance(value, BaseModel):
                defaults(value, key)
            elif isinstance(value, list) and value and isinstance(value[0], BaseModel):
                for i, item in enumerate(value):
                    defaults(item, f"{key}.{i}")
            elif name not in model.model_fields_set and value is not None:
                add("assumptions", key, "Применено значение по умолчанию", value=value, source="assumption")
                report["sources"][key] = "assumption"

    defaults(network)
    stations = {s.id for s in network.stations}
    line_ids = {l.id for l in network.lines}
    for kind, items in (("stations", network.stations), ("lines", network.lines)):
        seen = set()
        for i, item in enumerate(items):
            if item.id in seen:
                add("errors", f"{kind}.{i}.id", "Повторяющийся id")
            seen.add(item.id)
    membership = {s: set() for s in stations}
    used = set()
    for i, line in enumerate(network.lines):
        if len(set(line.stations)) != len(line.stations):
            add("errors", f"lines.{i}.stations", "Ветка должна быть простым путём/кольцом без повторов")
        if line.is_loop and len(line.stations) < 3:
            add("errors", f"lines.{i}.stations", "Кольцу нужны хотя бы три станции")
        for station in line.stations:
            if station not in stations:
                add("errors", f"lines.{i}.stations", f"Неизвестная станция: {station}")
            else:
                membership[station].add(line.id)
        if line.is_loop:
            if line.depot_station is None:
                line.depot_station = line.stations[0]
                add("assumptions", f"lines.{i}.depot_station", "Депо у первой станции", value=line.depot_station, source="assumption")
            elif line.depot_station not in line.stations:
                add("errors", f"lines.{i}.depot_station", "Депо должно находиться на ветке")
        used.update(frozenset(p) for p in pairs(line))
    graph = nx.Graph()
    graph.add_nodes_from(stations)
    segments = set()
    for i, segment in enumerate(network.segments):
        key = frozenset((segment.origin, segment.destination))
        if key in segments or len(key) != 2:
            add("errors", f"segments.{i}", "Перегон должен быть уникальным и соединять разные станции")
        segments.add(key)
        if not key <= stations:
            add("errors", f"segments.{i}", "Перегон ссылается на неизвестную станцию")
        else:
            graph.add_edge(segment.origin, segment.destination)
        if segment.length_m is None and segment.run_time_s is None:
            add("errors", f"segments.{i}", "Нужны length_m или run_time_s")
            add("missing", f"segments.{i}.length_m", "Не задана длина или время хода")
        if key not in used:
            add("warnings", f"segments.{i}", "Перегон не используется ветками")
    for key in sorted(used - segments, key=lambda p: sorted(p)):
        add("errors", "segments", f"Нет перегона между {', '.join(sorted(key))}")
    for i, transfer in enumerate(network.transfers):
        a, b = transfer.origin, transfer.destination
        if a == b or a not in stations or b not in stations:
            add("errors", f"transfers.{i}", "Переход должен соединять две существующие разные станции")
        elif not any(l1 != l2 for l1 in membership[a] for l2 in membership[b]):
            add("errors", f"transfers.{i}", "Переход должен соединять разные ветки")
        else:
            graph.add_edge(a, b)
    if not nx.is_connected(graph):
        add("errors", "stations", "Граф сети несвязен")
    for station, lines in membership.items():
        if not lines:
            add("errors", "stations", f"Станция {station} не обслуживается ни одной веткой")
    settings = network.settings
    if settings.day_end_s <= settings.day_start_s:
        add("errors", "settings.day_end_s", "Конец суток должен быть позже начала")
    opt = settings.optimizer
    if opt.headway_max_s < opt.headway_min_s or math.ceil(opt.headway_min_s / opt.headway_step_s) * opt.headway_step_s > opt.headway_max_s:
        add("errors", "settings.optimizer", "В диапазоне поиска нет допустимых интервалов")
    periods = max(1, math.ceil((settings.day_end_s - settings.day_start_s) / (network.schedule.period_len_min * 60)))
    for line in network.lines:
        if line.id not in network.schedule.headways:
            if "schedule" in network.model_fields_set and "headways" in network.schedule.model_fields_set:
                add("errors", f"schedule.headways.{line.id}", "Нет расписания ветки")
                add("missing", f"schedule.headways.{line.id}", "Интервалы не заданы")
            else:
                network.schedule.headways[line.id] = [180] * periods
                add("assumptions", f"schedule.headways.{line.id}", "Интервалы 180 секунд", value=[180] * periods, source="assumption")
        elif len(network.schedule.headways[line.id]) != periods:
            add("errors", f"schedule.headways.{line.id}", f"Нужно {periods} периодов")
    if set(network.schedule.headways) - line_ids:
        add("errors", "schedule.headways", "Неизвестная ветка")
    if network.fleet_assignment is None:
        add("missing", "fleet_assignment", "Распределение не задано: будет рассчитано по формуле оборота")
    elif set(network.fleet_assignment) != line_ids or sum(network.fleet_assignment.values()) > network.fleet:
        add("errors", "fleet_assignment", "Нужны все ветки; сумма не должна превышать общий парк")
    demand_by_station = {s: [] for s in stations}
    for i, row in enumerate(network.demand):
        if row.station not in stations:
            add("errors", f"demand.{i}.station", "Неизвестная станция")
        else:
            demand_by_station[row.station].append((row.start_min * 60, (row.start_min + row.len_min) * 60))
    for station, intervals in demand_by_station.items():
        end = settings.day_start_s
        gap = False
        previous = -math.inf
        for a, b in sorted(intervals):
            if a < previous:
                add("errors", "demand", f"Пересекаются интервалы спроса станции {station}")
            previous = max(previous, b)
            if a > end and end < settings.day_end_s:
                gap = True
            if a <= end:
                end = max(end, b)
        if gap or end < settings.day_end_s:
            add("warnings", "demand", f"Спрос {station} не покрывает сутки; в пропусках 0 пассажиров")
    if network.od_matrix is not None:
        for i, row in enumerate(network.od_matrix):
            if row.origin not in stations or row.destination not in stations or row.origin == row.destination:
                add("errors", f"od_matrix.{i}", "Нужны две разные существующие станции")
    return (None if report["errors"] else network), report


def require_network(document: dict) -> Network:
    network, report = validate(document)
    if network is None:
        raise ValueError(report)
    return network


def apply_overrides(document: dict, overrides: dict | None) -> dict:
    result = copy.deepcopy(document)
    def merge(dst, src):
        for k, v in src.items():
            if isinstance(v, dict) and isinstance(dst.get(k), dict) and k != "fleet_assignment":
                merge(dst[k], v)
            else:
                dst[k] = copy.deepcopy(v)
    if overrides:
        if set(overrides) - {"settings", "schedule", "fleet_assignment"}:
            raise ValueError("Допустимы только settings, schedule и fleet_assignment")
        merge(result, overrides)
    return result
