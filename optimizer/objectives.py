"""Совместимые импорты; действующие модели находятся в models/."""

from models.objectives import objectives
from models.pareto import dominates, fronts, crowding, select, four_options

__all__ = ["objectives", "dominates", "fronts", "crowding", "select", "four_options"]
