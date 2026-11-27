"""Входящий спрос: интенсивность и пуассоновское число пассажиров.

Средний вход за шаг: N = sum(entries * step_s / (len_min * 60)).
При шуме N_sample ~ Poisson(N), иначе используется N без округления.
Интенсивность берётся в начале шага, последний шаг ограничен концом дня.
Для явной OD тот же расчёт выполняется по trips каждой записи отдельно.
Вызывается из discrete_events.Simulator._generate.
"""


def expected_entries(rows, time, step):
    return sum(
        row.entries * step / (row.len_min * 60)
        for row in rows
        if row.start_min * 60 <= time < (row.start_min + row.len_min) * 60
    )


def sample_entries(rng, mean, noise):
    return float(rng.poisson(mean)) if noise else mean
