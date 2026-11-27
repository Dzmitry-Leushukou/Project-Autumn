"""Случайная добавка к стоянке: Бернулли и логнормальная длительность.

p=min(1,p0*(off+on)/capacity), B~Bernoulli(p), delay=B*X.
sigma²=ln(1+(std/mean)²), mu=ln(mean)-sigma²/2, X~LogNormal(mu,sigma).
mean,std — условные среднее и СКО длительности в секундах.
Зависимость вероятности от обмена — допущение проекта, без калибровки.
"""

import math


def delay_duration(rng, mean, std, size=None):
    variance = math.log1p((std / mean) ** 2)
    return rng.lognormal(math.log(mean) - variance / 2, math.sqrt(variance), size)


def stop_delay(rng, settings, off, on, capacity):
    probability = min(1, settings.p0 * (off + on) / capacity)
    return (
        float(delay_duration(rng, settings.mean_s, settings.std_s))
        if probability > 0 and rng.random() < probability
        else 0.0
    )
