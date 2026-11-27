"""Две минимизируемые цели: обслуживание пассажиров и ресурсы.

f_A = w_wait*W + w_denied*D + w_queue*Qn.
f_B = w_empty*E + w_fleet*U.
Это взвешенные оценки, не минуты и не проценты.
Тупик или отсутствие выпусков даёт штраф (1e9,1e9).
Вызывается из optimizer/evaluation.py при оценке каждого прогона.
"""


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
