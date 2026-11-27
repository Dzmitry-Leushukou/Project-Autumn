"""Неоднородность предпочтений: равновесные классы пассажиров.

sigma² = ln(1 + diversity²), z,z' ~ N(0,1).
theta_k = theta * exp(sigma*z_k - sigma²/2).
gamma_k = gamma * exp(sigma*z'_k - sigma²/2).
Поправка сохраняет математическое ожидание базового параметра.
При diversity=0 классы совпадают; классы создаются один раз за прогон.
Вызывается из routing.Router.__init__, используется в route_choice.py.
"""

import math
import numpy as np


def passenger_classes(settings, rng):
    sigma2 = math.log1p(settings.diversity**2)
    z = rng.standard_normal((2, settings.classes))
    thetas = settings.theta * np.exp(math.sqrt(sigma2) * z[0] - sigma2 / 2)
    gammas = settings.transfer_penalty_s * np.exp(math.sqrt(sigma2) * z[1] - sigma2 / 2)
    return thetas, gammas
