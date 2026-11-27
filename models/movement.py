"""Кинематика поезда: время хода по перегону.

Если L >= v²/(2a) + v²/(2b): t = L/v + v/(2a) + v/(2b).
Иначе vp = sqrt(2L/(1/a+1/b)), t = vp/a + vp/b.
L — метры, v — м/с, a,b — м/с², результат — секунды.
Явное run_time_s имеет приоритет. Вызывается маршрутизатором и симулятором.
"""

import math


def run_time(segment, train):
    if segment.run_time_s is not None:
        return segment.run_time_s
    length = segment.length_m
    speed = min(train.max_speed_mps, segment.max_speed_mps or train.max_speed_mps)
    a, b = train.acceleration_mps2, train.deceleration_mps2
    if length >= speed**2 / (2 * a) + speed**2 / (2 * b):
        return length / speed + speed / (2 * a) + speed / (2 * b)
    peak = math.sqrt(2 * length / (1 / a + 1 / b))
    return peak / a + peak / b
