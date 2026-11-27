import type { Network } from "./model";
export type ConnectionSelection = {
  kind: "segment" | "transfer";
  index: number;
};

const sameEdge = (a: string, b: string, c: string, d: string) =>
  (a === c && b === d) || (a === d && b === c);

// Each line is an ordered path: a cut must split the path, never bridge the gap.
function repairLines(
  network: Network,
  removedStation?: string,
  removedEdge?: { from: string; to: string },
) {
  const ids = new Set(network.lines.map((line) => line.id));
  let changed = false;
  network.lines = network.lines.flatMap((line) => {
    const stations: string[] = line.stations.filter(
      (id: string) => id !== removedStation,
    );
    const pairs: string[][] = line.stations
      .slice(1)
      .map((id: string, i: number) => [line.stations[i], id]);
    if (line.is_loop && line.stations.length > 2)
      pairs.push([line.stations.at(-1), line.stations[0]]);
    if (removedStation && !line.stations.includes(removedStation))
      return [line];
    if (
      removedEdge &&
      !pairs.some(([a, b]) => sameEdge(a, b, removedEdge.from, removedEdge.to))
    )
      return [line];
    const connected = (a: string, b: string) =>
      pairs.some(([c, d]) => sameEdge(a, b, c, d)) &&
      network.segments.some((edge) => sameEdge(a, b, edge.from, edge.to));
    const groups: string[][] = [];
    for (const id of stations) {
      const group = groups.at(-1);
      if (group && connected(group.at(-1)!, id)) group.push(id);
      else groups.push([id]);
    }
    const closed =
      line.is_loop &&
      stations.length > 1 &&
      connected(stations.at(-1)!, stations[0]);
    if (closed && groups.length > 1)
      groups[0] = [...groups.pop()!, ...groups[0]];
    if (!line.stations.length) return [line];
    changed = true;
    const paths = groups.filter((group) => group.length >= 2);
    // Keep an empty editable line if the cut left no usable route.
    return (paths.length ? paths : [[]]).map((path, i) => {
      let id = line.id;
      if (i > 0) {
        let suffix = i + 1;
        while (ids.has(`${line.id}_${suffix}`)) suffix++;
        id = `${line.id}_${suffix}`;
        ids.add(id);
        if (network.schedule?.headways?.[line.id])
          network.schedule.headways[id] = structuredClone(
            network.schedule.headways[line.id],
          );
      }
      const next = {
        ...line,
        id,
        name: i ? `${line.name} (${i + 1})` : line.name,
        stations: path,
        is_loop: false,
      };
      if (next.depot_station && !path.includes(next.depot_station))
        delete next.depot_station;
      return next;
    });
  });
  if (changed) delete network.fleet_assignment;
}

export function removeStation(network: Network, id: string) {
  network.stations = network.stations.filter((station) => station.id !== id);
  network.segments = network.segments.filter(
    (edge) => edge.from !== id && edge.to !== id,
  );
  network.transfers = network.transfers.filter(
    (edge) => edge.from !== id && edge.to !== id,
  );
  network.demand = network.demand.filter((row) => row.station !== id);
  if (network.od_matrix)
    network.od_matrix = network.od_matrix.filter(
      (row) => row.origin !== id && row.destination !== id,
    );
  repairLines(network, id);
}

export function removeConnection(
  network: Network,
  kind: "segment" | "transfer",
  index: number,
) {
  if (kind === "transfer") network.transfers.splice(index, 1);
  else {
    const edge = network.segments[index];
    if (!edge) return;
    network.segments = network.segments.filter(
      (candidate) =>
        !sameEdge(edge.from, edge.to, candidate.from, candidate.to),
    );
    repairLines(network, undefined, edge);
  }
}
