"""Воспроизводимость: четыре независимых подпотока случайных чисел.

SeedSequence(seed).spawn(4): спрос, задержки, классы, поиск.
Число вызовов одного подпотока не сдвигает последовательность другого.
Это организация случайности, а не дополнительная физическая модель.
"""

import numpy as np


class RandomStreams:
    """One root seed, fixed independent named substreams."""

    def __init__(self, seed):
        demand, delays, classes, search = np.random.SeedSequence(seed).spawn(4)
        self.demand = np.random.default_rng(demand)
        self.delays = np.random.default_rng(delays)
        self.classes = np.random.default_rng(classes)
        self.search = np.random.default_rng(search)
