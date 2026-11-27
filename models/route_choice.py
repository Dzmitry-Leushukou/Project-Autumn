"""Логит-выбор пути с ожиданием первого подходящего поезда.

Для участка: wait = 0.5 / sum_l(1/h_l,p); для одной ветки это h/2.
T_r,k = ride_s + walk_s + sum(wait) + transfers * gamma_k.
P(r|k) = exp(-theta_k*T_r,k) / sum_m exp(-theta_k*T_m,k).
Итог — среднее вероятностей по классам. Вычитание максимального логита
перед exp защищает от переполнения, не меняя вероятностей.
Вызывается из routing.Router.probabilities. Период фиксируется при входе.
"""

import numpy as np


def route_probabilities(routes, headways, period, thetas, gammas):
    if not routes:
        return np.empty(0)
    times = []
    for route in routes:
        waiting = sum(
            0.5 / sum(1 / headways[line][period] for line in leg.lines)
            for leg in route.legs
            if leg.kind == "ride"
        )
        times.append(
            route.ride_s + route.walk_s + waiting + route.transfers * gammas
        )
    costs = np.array(times).T
    logits = -costs * thetas[:, None]
    logits -= logits.max(axis=1, keepdims=True)
    exp = np.exp(logits)
    return (exp / exp.sum(axis=1, keepdims=True)).mean(axis=0)
