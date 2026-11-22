"""Fractional cohorts in a growable NumPy store; station FIFO holds only indices."""
import numpy as np

GROUP_DTYPE = [("route","i4"),("leg","i4"),("arrived","f8"),("size","f8"),("ride","i4")]


class GroupStore:
    def __init__(self):
        self.values = np.empty(4096,dtype=GROUP_DTYPE)
        self.count = 0

    def add(self, route, leg, arrived, size, ride=0):
        if self.count == len(self.values):
            expanded = np.empty(len(self.values)*2,dtype=GROUP_DTYPE)
            expanded[:self.count] = self.values
            self.values = expanded
        idx = self.count
        self.values[idx] = (route,leg,arrived,size,ride)
        self.count += 1
        return idx
