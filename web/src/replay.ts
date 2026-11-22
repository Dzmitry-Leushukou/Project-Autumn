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
  return { stations, total };
}

export function queueAt(
  items: { time: number; value: number }[],
  time: number,
) {
  return Math.max(0, items[before(items, time, "time")]?.value ?? 0);
}
