import type { Trajectory } from "./model";

export function before(items: any[], time: number, field: string) {
  let low = 0,
    high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (items[mid][field] <= time) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

export function queueIndex(trajectory: Trajectory | null) {
  const stations = new Map<string, any[]>();
  const directions = new Map<
    string,
    Map<string | null, { time: number; value: number }[]>
  >();
  const total: { time: number; value: number }[] = [];
  let waiting = 0;
  for (const item of trajectory?.queue_events ?? []) {
    const q = stations.get(item.station) ?? [];
    q.push({ time: item.time, value: (q.at(-1)?.value ?? 0) + item.delta });
    stations.set(item.station, q);
    waiting += item.delta;
    if (total.at(-1)?.time === item.time)
      total[total.length - 1].value = waiting;
    else total.push({ time: item.time, value: waiting });
  }
  for (const item of trajectory?.queue_directions ?? []) {
    const rows = directions.get(item.station) ?? new Map();
    const q = rows.get(item.towards) ?? [];
    q.push({ time: item.time, value: (q.at(-1)?.value ?? 0) + item.delta });
    rows.set(item.towards, q);
    directions.set(item.station, rows);
  }
  return { stations, directions, total };
}

export function queueAt(
  items: { time: number; value: number }[],
  time: number,
) {
  return Math.max(0, items[before(items, time, "time")]?.value ?? 0);
}

const passengerFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
});
export const passengerCount = (count: number) =>
  passengerFormatter.format(Math.max(0, count));

type TrainRecords = { trips: any[]; stops: any[]; roster: any };

export function trainIndex(trajectory: Trajectory | null) {
  const trains = new Map<number, TrainRecords>();
  for (const item of trajectory?.trains ?? [])
    trains.set(item.train, { trips: [], stops: [], roster: item });
  for (const kind of ["trips", "stops"] as const)
    for (const item of trajectory?.[kind] ?? []) {
      if (!trains.has(item.train))
        trains.set(item.train, {
          trips: [],
          stops: [],
          roster: { train: item.train, line: item.line },
        });
      trains.get(item.train)![kind].push(item);
    }
  return trains;
}

export function trainAt(records: TrainRecords, time: number) {
  const trip = records.trips[before(records.trips, time, "departure")];
  const stop = records.stops[before(records.stops, time, "arrival")];
  if (trip && (trip.arrival === null || time < trip.arrival))
    return {
      phase: "trip",
      item: trip,
      blocked: time > trip.ready,
      delay: Math.max(0, time - trip.ready),
    };
  if (stop && (stop.departure === null || time < stop.departure))
    return {
      phase: "stop",
      item: stop,
      blocked: stop.ready != null && time > stop.ready && !stop.retire,
      delay: Math.max(0, time - (stop.ready ?? time)),
    };
  return {
    phase: "pool",
    item: stop ?? records.roster,
    blocked: false,
    delay: 0,
  };
}
