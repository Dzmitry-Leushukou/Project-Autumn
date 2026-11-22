"""Client-independent reference reconstruction (the browser uses the same rules)."""


def state_at(trajectory, time):
    waiting = {}
    for event in trajectory.get("queue_events",[]):
        if event["time"] > time:
            break
        station = event["station"]
        waiting[station] = waiting.get(station,0)+event["delta"]
    trains = {}
    for stop in trajectory["stops"]:
        if stop["arrival"] <= time and (stop["departure"] is None or time < stop["departure"]):
            trains[stop["train"]] = {"phase":"platform","station":stop["station"],"load":stop["load"]}
    for trip in trajectory["trips"]:
        if trip["departure"] <= time and (trip["arrival"] is None or time < trip["arrival"]):
            fraction = min(1,(time-trip["departure"])/(trip["ready"]-trip["departure"]))
            trains[trip["train"]] = {"phase":"tube","from":trip["from"],"to":trip["to"],"fraction":fraction,"load":trip["load"]}
    return {"waiting":waiting,"trains":trains}
