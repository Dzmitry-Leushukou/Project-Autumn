import { useMemo, useState } from "react";
import type { Network, Trajectory } from "./model";
import { clock, dayLabel, value } from "./model";
import {
  passengerCount,
  queueAt,
  queueIndex,
  trainAt,
  trainIndex,
} from "./replay";

export default function LiveTables({
  network,
  trajectory,
  time,
  playing,
  onTogglePlayback,
}: {
  network: Network;
  trajectory: Trajectory;
  time: number;
  playing: boolean;
  onTogglePlayback: () => void;
}) {
  const [tab, setTab] = useState("stations");
  const queues = useMemo(() => queueIndex(trajectory), [trajectory]);
  const trains = useMemo(() => trainIndex(trajectory), [trajectory]);
  const stations = useMemo(
    () => new Map(network.stations.map((s) => [s.id, s.name])),
    [network.stations],
  );
  const lines = useMemo(
    () => new Map(network.lines.map((l) => [l.id, l])),
    [network.lines],
  );
  const name = (id: string) => stations.get(id) ?? id;
  const capacity = value(network.train.capacity, 800);
  const directionOrder = useMemo(() => {
    const order = new Map(network.stations.map((s, i) => [s.id, i]));
    const result = new Map<string, (string | null)[]>();
    if (!trajectory.queue_directions) return result;
    const neighbours = new Map<string, Set<string | null>>(
      network.stations.map((s) => [s.id, new Set<string | null>()]),
    );
    for (const line of network.lines) {
      for (let i = 0; i < line.stations.length; i++) {
        const a = line.stations[i],
          b = line.stations[i + 1] ?? (line.is_loop ? line.stations[0] : null);
        if (b && b !== a) {
          neighbours.get(a)?.add(b);
          neighbours.get(b)?.add(a);
        }
      }
    }
    for (const [station, directions] of queues.directions)
      for (const towards of directions.keys())
        neighbours.get(station)?.add(towards);
    for (const [station, directions] of neighbours)
      result.set(
        station,
        [...directions].sort((a, b) => {
          if (a === null) return b === null ? 0 : 1;
          if (b === null) return -1;
          return (
            (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) ||
            a.localeCompare(b)
          );
        }),
      );
    return result;
  }, [network, queues, trajectory]);
  return (
    <section className="panel live-panel" aria-label="Состояние сети сейчас">
      <div className="section-heading">
        <div>
          <h2>Станции и поезда</h2>
        </div>
        <div className="live-playback">
          <button
            aria-label={
              playing ? "Пауза таблиц и карты" : "Продолжить таблицы и карту"
            }
            onClick={onTogglePlayback}
          >
            {playing ? "Ⅱ Пауза" : "▶ Продолжить"}
          </button>
          <time data-testid="live-time">
            {clock(time, false)}:
            {String(Math.floor(time % 60)).padStart(2, "0")}
            {dayLabel(time) && (
              <small className="clock-day">{dayLabel(time)}</small>
            )}
          </time>
        </div>
      </div>
      <div className="live-tabs" role="tablist" aria-label="Таблицы состояния">
        <button
          role="tab"
          id="station-tab"
          aria-controls="station-panel"
          aria-selected={tab === "stations"}
          onClick={() => setTab("stations")}
        >
          Станции ({network.stations.length})
        </button>
        <button
          role="tab"
          id="train-tab"
          aria-controls="train-panel"
          aria-selected={tab === "trains"}
          onClick={() => setTab("trains")}
        >
          Поезда ({trains.size})
        </button>
      </div>
      <p className="live-note">
        Состояние на выбранное время. Направления — к следующей станции. ≈ —
        количество округлено; сумма частей может отличаться от итога.
      </p>
      {tab === "stations" ? (
        <div
          className="table-scroll live-scroll"
          role="tabpanel"
          id="station-panel"
          aria-labelledby="station-tab"
          tabIndex={0}
        >
          <table
            className="station-live-table"
            aria-label="Очереди станций сейчас"
          >
            <colgroup>
              <col className="station-name-col" />
              <col className="station-total-col" />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>Станция</th>
                <th>Ожидают, ≈чел.</th>
                <th>Направление · ≈чел.</th>
              </tr>
            </thead>
            <tbody>
              {network.stations.map((station) => {
                const total = queueAt(
                  queues.stations.get(station.id) ?? [],
                  time,
                );
                const directions = (directionOrder.get(station.id) ?? []).map(
                  (towards) => ({
                    towards,
                    count: queueAt(
                      queues.directions.get(station.id)?.get(towards) ?? [],
                      time,
                    ),
                  }),
                );
                return (
                  <tr
                    key={station.id}
                    data-testid={`station-state-${station.id}`}
                  >
                    <th scope="row" title={station.name}>
                      {station.name}
                    </th>
                    <td className="live-number" data-testid="station-waiting">
                      {passengerCount(total)}
                    </td>
                    <td>
                      {directions.length ? (
                        <ul className="direction-list">
                          {directions.map((d) => (
                            <li key={d.towards ?? "unserved"}>
                              <span
                                title={
                                  d.towards === null
                                    ? "Нет доступного маршрута"
                                    : name(d.towards)
                                }
                              >
                                {d.towards === null
                                  ? "Нет доступного маршрута"
                                  : name(d.towards)}
                              </span>
                              <b>{passengerCount(d.count)}</b>
                            </li>
                          ))}
                        </ul>
                      ) : !trajectory.queue_directions ? (
                        "Направления не записаны в этой траектории"
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className="table-scroll live-scroll"
          role="tabpanel"
          id="train-panel"
          aria-labelledby="train-tab"
          tabIndex={0}
        >
          <table className="train-live-table" aria-label="Поезда сейчас">
            <colgroup>
              {[70, 135, 190, 220, 170, 140, 95].map((width, i) => (
                <col key={i} style={{ width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th>Поезд</th>
                <th>Ветка</th>
                <th>Направление</th>
                <th>Где находится</th>
                <th>Состояние</th>
                <th>На борту, ≈чел.</th>
                <th>Загрузка</th>
              </tr>
            </thead>
            <tbody>
              {[...trains]
                .sort(([a], [b]) => a - b)
                .map(([id, records]) => {
                  const state = trainAt(records, time),
                    item = state.item;
                  const line = lines.get(item.line);
                  const turning =
                    state.phase === "pool" &&
                    item.retire &&
                    !line?.is_loop &&
                    time <
                      item.departure + value(network.train.turnaround_s, 120);
                  const direction =
                    state.phase === "pool" && item.retire && !line?.is_loop
                      ? -item.direction
                      : item.direction;
                  const target =
                    line?.stations[
                      direction === 1 ? line.stations.length - 1 : 0
                    ];
                  const directionText = line?.is_loop
                    ? direction === 1
                      ? "По порядку станций кольца"
                      : "Обратно по кольцу"
                    : target
                      ? `К ${name(target)}`
                      : "—";
                  const load = state.phase === "pool" ? 0 : item.load;
                  const status =
                    state.phase === "trip"
                      ? state.blocked
                        ? "Ждёт платформу"
                        : "В пути"
                      : state.phase === "stop"
                        ? state.blocked
                          ? "Ждёт перегон"
                          : "Стоянка"
                        : turning
                          ? "Разворот"
                          : "В депо";
                  return (
                    <tr key={id} data-testid={`train-state-${id}`}>
                      <th scope="row">№{id + 1}</th>
                      <td title={line?.name ?? item.line}>
                        <i
                          className="line-dot"
                          style={{ background: line?.color }}
                        />
                        {line?.name ?? item.line}
                      </td>
                      <td title={directionText}>{directionText}</td>
                      <td
                        title={
                          state.phase === "trip"
                            ? `${name(item.from)} → ${name(item.to)}`
                            : name(item.station ?? "—")
                        }
                      >
                        {state.phase === "trip"
                          ? `${name(item.from)} → ${name(item.to)}`
                          : item.station
                            ? name(item.station)
                            : "—"}
                      </td>
                      <td>
                        <span className={state.blocked ? "train-blocked" : ""}>
                          {status}
                        </span>
                        <small className="blocking-duration">
                          {state.blocked
                            ? `${Math.floor(state.delay)} с`
                            : "\u00a0"}
                        </small>
                      </td>
                      <td className="live-number">
                        {passengerCount(load)} / {capacity}
                      </td>
                      <td className="live-number">
                        {Math.round((100 * load) / capacity)}%
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
