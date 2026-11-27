"""Посадка агрегированных групп по FIFO при ограниченной вместимости.

Для подходящих групп в порядке прихода:
boarded_i = min(size_i, max(0, free - sum_{j<i} size_j)).
Отказы = sum(size_i - boarded_i); непоместившаяся группа делится.
Неподходящие по маршруту группы отбираются до вызова и не считаются отказами.
Веса могут быть дробными: один объект представляет группу, а не человека.
Вызывается из discrete_events.Simulator._exchange.
"""

import numpy as np


def fifo_boarding(sizes, free):
    before = np.cumsum(sizes) - sizes
    return np.minimum(sizes, np.maximum(0, free - before))
