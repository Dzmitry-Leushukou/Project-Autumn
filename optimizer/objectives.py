import math
import numpy as np


def objectives(metrics, settings):
    if metrics["deadlock"] or not any(
        row["releases"] for row in metrics["line_periods"]
    ):
        return 1e9, 1e9
    a, b = settings.weights_a, settings.weights_b
    return (
        a.wait * metrics["W"] + a.denied * metrics["D"] + a.queue * metrics["Qn"],
        b.empty * metrics["E"] + b.fleet * metrics["U"],
    )


def dominates(a, b):
    return all(x <= y for x, y in zip(a, b)) and any(x < y for x, y in zip(a, b))


def fronts(values):
    domination = [[] for _ in values]
    counts = [0] * len(values)
    first = []
    for i, a in enumerate(values):
        for j, b in enumerate(values):
            if dominates(a, b):
                domination[i].append(j)
            elif dominates(b, a):
                counts[i] += 1
        if counts[i] == 0:
            first.append(i)
    result = [first]
    while result[-1]:
        following = []
        for i in result[-1]:
            for j in domination[i]:
                counts[j] -= 1
                if counts[j] == 0:
                    following.append(j)
        if following:
            result.append(following)
        else:
            break
    return result


def crowding(indices, values):
    result = {i: 0.0 for i in indices}
    for axis in (0, 1):
        ordered = sorted(indices, key=lambda i: (values[i][axis], i))
        if not ordered:
            continue
        result[ordered[0]] = result[ordered[-1]] = math.inf
        spread = values[ordered[-1]][axis] - values[ordered[0]][axis]
        if spread:
            for prev, i, nxt in zip(ordered, ordered[1:], ordered[2:]):
                result[i] += (values[nxt][axis] - values[prev][axis]) / spread
    return result


def select(indices, values, count):
    chosen = []
    local_values = [values[i] for i in indices]
    for front in fronts(local_values):
        mapped = [indices[i] for i in front]
        distances = crowding(mapped, values)
        chosen.extend(
            sorted(mapped, key=lambda i: (-distances[i], values[i], i))[
                : count - len(chosen)
            ]
        )
        if len(chosen) >= count:
            break
    return chosen


def four_options(points, baseline):
    feasible = [p for p in points if p["f_A"] < 1e9]
    if not feasible:
        return [], []
    values = [(p["f_A"], p["f_B"]) for p in feasible]
    front = [feasible[i] for i in fronts(values)[0]]
    front.sort(key=lambda p: (p["f_A"], p["f_B"], str(p["headways"])))
    arr = np.array([(p["f_A"], p["f_B"]) for p in front])
    spans = np.ptp(arr, axis=0)
    normalized = (arr - arr.min(axis=0)) / np.where(spans == 0, 1, spans)
    balanced = min(
        range(len(front)),
        key=lambda i: (float(np.linalg.norm(normalized[i])), front[i]["f_A"]),
    )
    chosen = [
        min(front, key=lambda p: (p["f_A"], p["f_B"])),
        min(front, key=lambda p: (p["f_B"], p["f_A"])),
        front[balanced],
        baseline,
    ]
    names = [
        "Минимум ожидания",
        "Минимум пустых поездов",
        "Сбалансированный",
        "Мой вариант",
    ]
    return [{**point, "name": name} for name, point in zip(names, chosen)], front
