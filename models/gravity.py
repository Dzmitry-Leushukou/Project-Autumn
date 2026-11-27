"""Гравитационная модель назначения: куда едут вошедшие пассажиры.

P(j|i) = w_j * max(d_ij, 1e-9)^(-beta) / sum_k(w_k * max(d_ik, 1e-9)^(-beta)).
w_j — весь вход станции за день; d_ij — стоимость кратчайшего пути в секундах
без ожидания. Вход — только достижимые станции, кроме исходной.
Если весов нет, возвращается пустое распределение: люди остаются в очереди.
Вызывается из routing.Router.destinations; явная OD заменяет эту модель.
"""

import numpy as np


def destination_probabilities(destinations, distances, destination_weights, beta):
    weights = np.array(
        [
            destination_weights[dest] * max(distance, 1e-9) ** (-beta)
            for dest, distance in zip(destinations, distances)
        ],
        dtype=float,
    )
    if weights.sum() == 0:
        return [], np.empty(0)
    return destinations, weights / weights.sum()
