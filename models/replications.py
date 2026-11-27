"""Усреднение нескольких случайных прогонов для сравнения планов.

Среднее m_bar=sum(m_s)/S; СКО=sqrt(sum((m_s-m_bar)²)/S), ddof=0.
Разреженные записи соединяются по ветке, направлению и периоду.
Отсутствующий интервал не равен нулю; отсутствующее тепло ресурса равно нулю.
Недопустимость хотя бы одного seed сохраняется. Один seed+i используется
для всех кандидатов, чтобы сравнивать планы на одинаковых реализациях спроса.
"""

import numpy as np


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


def summarize_candidate(samples, headways, assignment, seeds):
    """Свести метрики и цели одного расписания по одинаковому набору seed."""
    metrics = average_metrics([m for m, _ in samples])
    values = np.array([o for _, o in samples])
    invalid = bool(np.any(values >= 1e9))
    return {
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
