import math
import numpy as np


class RandomStreams:
    """One root seed, fixed independent named substreams."""
    def __init__(self, seed):
        demand, delays, classes, search = np.random.SeedSequence(seed).spawn(4)
        self.demand = np.random.default_rng(demand)
        self.delays = np.random.default_rng(delays)
        self.classes = np.random.default_rng(classes)
        self.search = np.random.default_rng(search)


def delay_duration(rng, mean, std, size=None):
    variance = math.log1p((std/mean)**2)
    return rng.lognormal(math.log(mean)-variance/2, math.sqrt(variance), size)
