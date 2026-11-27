import type { Network } from "./model";
import { tagged, value } from "./numeric";

/** Replace only [start,end); preserve the remaining flow at its original rate. */
export function replaceDemand(
  rows: any[],
  station: string,
  start: number,
  end: number,
  entries: number,
) {
  const result: any[] = [];
  for (const row of rows) {
    const a = value(row.start_min) * 60,
      b = a + value(row.len_min) * 60;
    if (row.station !== station || b <= start || a >= end) {
      result.push(row);
      continue;
    }
    for (const [left, right] of [
      [a, Math.min(b, start)],
      [Math.max(a, end), b],
    ]) {
      if (right > left)
        result.push({
          ...row,
          start_min: left / 60,
          len_min: (right - left) / 60,
          entries: tagged((value(row.entries) * (right - left)) / (b - a)),
        });
    }
  }
  result.push({
    station,
    start_min: start / 60,
    len_min: (end - start) / 60,
    entries: tagged(entries),
  });
  return result;
}

/** Refine the demand step so each edited interval boundary falls on a step. */
export function alignedDemandStep(
  rows: any[],
  currentStep: number,
  start: number,
  end: number,
) {
  const gcd = (a: number, b: number): number => {
    while (b) [a, b] = [b, a % b];
    return a;
  };
  let step = Math.round(currentStep * 1000);
  for (const row of rows) {
    const a = value(row.start_min) * 60,
      b = a + value(row.len_min) * 60;
    if (b <= start || a >= end) continue;
    for (const boundary of [Math.max(start, a), Math.min(end, b)])
      step = gcd(step, Math.round((boundary - start) * 1000));
  }
  return Math.max(0.001, step / 1000);
}

export function plannedEntries(
  network: Network,
  station: string,
  start: number,
  end: number,
) {
  const od = network.od_matrix != null;
  return (od ? network.od_matrix! : network.demand).reduce((sum, row) => {
    if (station && (od ? row.origin : row.station) !== station) return sum;
    const a = value(row.start_min) * 60,
      length = value(row.len_min) * 60;
    const overlap = Math.max(0, Math.min(end, a + length) - Math.max(start, a));
    return (
      sum +
      (length > 0
        ? (value(od ? row.trips : row.entries) * overlap) / length
        : 0)
    );
  }, 0);
}
