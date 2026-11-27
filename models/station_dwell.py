"""Стоянка с пассажирообменом и платформенными дверями.

base = dwell_base_s + I_doors * (door_open_s + door_close_s).
dwell = base + (off + on) / boarding_rate_pps + delay.
off,on — пассажиры, поток — чел./с, остальные величины — секунды.
Базовая часть также входит в стоимость маршрута и идеальное время оборота.
"""


def base_dwell(station):
    return station.dwell_base_s + (
        station.door_open_s + station.door_close_s if station.platform_doors else 0
    )


def dwell_time(station, off, on, delay):
    return base_dwell(station) + (off + on) / station.boarding_rate_pps + delay
