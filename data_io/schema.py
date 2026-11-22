"""Versioned public schema. Tagged numbers accept provenance without burdening math."""

from typing import Annotated, Literal
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

Source = Literal["data", "estimate", "assumption", "user"]


class TaggedNumber(BaseModel):
    value: float
    source: Source


def unwrap(value):
    if isinstance(value, dict) and "value" in value:
        return TaggedNumber.model_validate(value).value
    return value


def integer(value):
    value = unwrap(value)
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


Number = Annotated[
    float, BeforeValidator(unwrap, json_schema_input_type=float | TaggedNumber)
]
Integer = Annotated[
    int, BeforeValidator(integer, json_schema_input_type=int | TaggedNumber)
]
Positive = Annotated[Number, Field(gt=0, allow_inf_nan=False)]
Nonnegative = Annotated[Number, Field(ge=0, allow_inf_nan=False)]
PositiveInt = Annotated[Integer, Field(gt=0, strict=True)]
Natural = Annotated[Integer, Field(ge=0, strict=True)]


class Model(BaseModel):
    model_config = ConfigDict(
        extra="forbid", populate_by_name=True, allow_inf_nan=False
    )


class Meta(Model):
    name: str = Field(min_length=1)
    format_version: Literal["1.0"] = "1.0"
    synthetic: bool
    description: str = ""


class Station(Model):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    x: Annotated[Number, Field(ge=0, le=1000)]
    y: Annotated[Number, Field(ge=0, le=1000)]
    platform_doors: bool = False
    door_open_s: Nonnegative = 4
    door_close_s: Nonnegative = 6
    dwell_base_s: Nonnegative = 20
    boarding_rate_pps: Positive = 6


class Line(Model):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    is_loop: bool = False
    stations: list[str] = Field(min_length=2)
    depot_station: str | None = None


class Segment(Model):
    origin: str = Field(alias="from")
    destination: str = Field(alias="to")
    length_m: Positive | None = None
    run_time_s: Positive | None = None
    max_speed_mps: Positive | None = None


class Transfer(Model):
    origin: str = Field(alias="from")
    destination: str = Field(alias="to")
    walk_time_s: Nonnegative = 180


class Train(Model):
    capacity: PositiveInt = 800
    max_speed_mps: Positive = 20
    acceleration_mps2: Positive = 1
    deceleration_mps2: Positive = 1
    turnaround_s: Nonnegative = 120


class Demand(Model):
    station: str
    start_min: Nonnegative
    len_min: Positive
    entries: Nonnegative


class OD(Model):
    origin: str
    destination: str
    start_min: Nonnegative
    len_min: Positive
    trips: Nonnegative


class Routes(Model):
    margin: Annotated[Number, Field(ge=0, le=0.5)] = 0.30
    max_routes: PositiveInt = 5
    theta: Nonnegative = 0.02
    transfer_penalty_s: Nonnegative = 300
    diversity: Annotated[Number, Field(ge=0, le=1)] = 0.2
    classes: PositiveInt = 8


class Delays(Model):
    p0: Annotated[Number, Field(ge=0, le=1)] = 0.05
    mean_s: Positive = 5
    std_s: Nonnegative = 3


class WeightsA(Model):
    wait: Nonnegative = 1
    denied: Nonnegative = 120
    queue: Nonnegative = 30


class WeightsB(Model):
    empty: Nonnegative = 0.7
    fleet: Nonnegative = 0.3


class OptimizerSettings(Model):
    headway_min_s: PositiveInt = 60
    headway_max_s: PositiveInt = 1200
    headway_step_s: PositiveInt = 15
    population: Annotated[Integer, Field(ge=4, strict=True)] = 40
    generations: PositiveInt = 30
    time_budget_s: Positive = 60
    evaluation_budget: Annotated[Integer, Field(ge=4, strict=True)] = 20
    seeds_search: PositiveInt = 3
    seeds_final: PositiveInt = 5
    weights_a: WeightsA = Field(default_factory=WeightsA)
    weights_b: WeightsB = Field(default_factory=WeightsB)


class ServiceTargets(Model):
    max_denied_share: Annotated[Number, Field(ge=0, le=1)] = 0.02


class Settings(Model):
    day_start_s: Nonnegative = 18000
    day_end_s: Positive = 90000
    group_step_s: Positive = 120
    seed: Natural = 42
    demand_noise: bool = True
    od_beta: Nonnegative = 1
    routes: Routes = Field(default_factory=Routes)
    delays: Delays = Field(default_factory=Delays)
    optimizer: OptimizerSettings = Field(default_factory=OptimizerSettings)
    service_targets: ServiceTargets = Field(default_factory=ServiceTargets)


class Schedule(Model):
    period_len_min: PositiveInt = 60
    headways: dict[str, list[PositiveInt]] = Field(default_factory=dict)


class Network(Model):
    meta: Meta
    lines: list[Line] = Field(min_length=1)
    stations: list[Station] = Field(min_length=2)
    segments: list[Segment] = Field(min_length=1)
    transfers: list[Transfer] = Field(default_factory=list)
    train: Train = Field(default_factory=Train)
    fleet: Natural
    demand: list[Demand]
    od_matrix: list[OD] | None = None
    schedule: Schedule = Field(default_factory=Schedule)
    fleet_assignment: dict[str, Natural] | None = None
    settings: Settings = Field(default_factory=Settings)
