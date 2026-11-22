export type Network = {
  meta: {
    name: string;
    synthetic: boolean;
    description: string;
    format_version: string;
  };
  stations: any[];
  lines: any[];
  segments: any[];
  transfers: any[];
  train: any;
  fleet: any;
  demand: any[];
  settings: any;
  schedule?: any;
  fleet_assignment?: Record<string, number>;
  od_matrix?: any[];
};
export type Trajectory = {
  meta: any;
  trips: any[];
  stops: any[];
  series: any[];
  queue_events: any[];
};
export const value = (x: any, fallback = 0): number =>
  typeof x === "object" && x !== null && "value" in x
    ? x.value
    : (x ?? fallback);
export const tagged = (x: number) => ({ value: x, source: "user" });
export const source = (x: any) =>
  x === undefined
    ? "допущение"
    : ((
        {
          data: "данные",
          estimate: "оценка",
          assumption: "допущение",
          user: "задано вами",
        } as any
      )[x?.source] ?? "задано вами");
export const defaults: any = {
  day_start_s: 18000,
  day_end_s: 90000,
  group_step_s: 120,
  seed: 42,
  demand_noise: true,
  od_beta: 1,
  routes: {
    margin: 0.3,
    max_routes: 5,
    theta: 0.02,
    transfer_penalty_s: 300,
    diversity: 0.2,
    classes: 8,
  },
  delays: { p0: 0.05, mean_s: 5, std_s: 3 },
  optimizer: {
    headway_min_s: 60,
    headway_max_s: 1200,
    headway_step_s: 15,
    population: 40,
    generations: 30,
    time_budget_s: 60,
    evaluation_budget: 20,
    seeds_search: 3,
    seeds_final: 5,
    weights_a: { wait: 1, denied: 120, queue: 30 },
    weights_b: { empty: 0.7, fleet: 0.3 },
  },
  service_targets: { max_denied_share: 0.02 },
};
export const trainDefaults: any = {
  capacity: 800,
  max_speed_mps: 20,
  acceleration_mps2: 1,
  deceleration_mps2: 1,
  turnaround_s: 120,
};
export const stationDefaults: any = {
  door_open_s: 4,
  door_close_s: 6,
  dwell_base_s: 20,
  boarding_rate_pps: 6,
};
export const colors = [
  "#C65B49",
  "#397DAD",
  "#B49135",
  "#9670AA",
  "#258A83",
  "#BC637E",
];
export function setting(n: Network, path: string) {
  return value(
    rawSetting(n, path),
    path.split(".").reduce((o, k) => o?.[k], defaults),
  );
}
export function rawSetting(n: Network, path: string) {
  return path.split(".").reduce((v, k) => v?.[k], n.settings);
}
export function setPath(object: any, path: string, next: any) {
  const parts = path.split(".");
  let o = object;
  for (const k of parts.slice(0, -1)) o = o[k] ??= {};
  o[parts.at(-1)!] = next;
}
export function emptyNetwork(): Network {
  return {
    meta: {
      name: "Моя сеть",
      synthetic: true,
      format_version: "1.0",
      description: "Создано в конструкторе. Спрос синтетический.",
    },
    stations: [],
    lines: [
      {
        id: "L1",
        name: "Линия 1",
        color: colors[0],
        is_loop: false,
        stations: [],
      },
    ],
    segments: [],
    transfers: [],
    train: {},
    fleet: 12,
    demand: [],
    settings: {},
  };
}
export function periods(n: Network) {
  return Math.ceil(
    (setting(n, "day_end_s") - setting(n, "day_start_s")) /
      (value(n.schedule?.period_len_min, 60) * 60),
  );
}
export function headways(n: Network): Record<string, any[]> {
  return Object.fromEntries(
    n.lines.map((l) => [
      l.id,
      n.schedule?.headways?.[l.id] ?? Array(Math.max(1, periods(n))).fill(180),
    ]),
  );
}
export function clock(t: number) {
  return `${String(Math.floor(t / 3600)).padStart(2, "0")}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}`;
}
export function demandProfile(
  n: Network,
  station: string,
  peak: number,
  profile: string,
) {
  const rows = [];
  for (
    let t = setting(n, "day_start_s") / 60;
    t < setting(n, "day_end_s") / 60;
    t += 15
  ) {
    const mid = t + 7.5;
    const morning = Math.exp(-((mid - 510) ** 2) / (2 * 75 ** 2)),
      evening = Math.exp(-((mid - 1080) ** 2) / (2 * 90 ** 2));
    const m =
      profile === "flat"
        ? 1
        : profile === "morning"
          ? 0.25 + 0.9 * morning
          : 0.25 + 0.75 * morning + 0.9 * evening;
    rows.push({
      station,
      start_min: t,
      len_min: 15,
      entries: tagged(peak * m),
    });
  }
  return rows;
}
export async function api(path: string, body?: any) {
  const r = await fetch(
    `/api${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await r.json();
  if (!r.ok) {
    const d = data.detail;
    throw new Error(
      typeof d === "object"
        ? d.errors?.map((x: any) => `${x.path}: ${x.message}`).join("\n")
        : (d ?? `HTTP ${r.status}`),
    );
  }
  return data;
}
export function download(name: string, data: any) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
