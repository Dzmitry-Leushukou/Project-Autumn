import { useMemo, useState } from "react";
import type { Network, Trajectory } from "./model";
import { clock, setting } from "./model";
import { before, queueAt, queueIndex } from "./replay";
import { plannedEntries } from "./demandIntervals";

type Point = { time: number; value: number };
const format = (v: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(v);

function DayPlot({
  title,
  unit,
  points,
  start,
  end,
  time,
  onTime,
  bars,
  binSeconds,
}: {
  title: string;
  unit: string;
  points: Point[];
  start: number;
  end: number;
  time: number;
  onTime: (time: number) => void;
  bars?: boolean;
  binSeconds: number;
}) {
  const w = 920,
    h = 210,
    left = 64,
    right = 24,
    top = 28,
    bottom = 46;
  const max =
    2 * Math.max(1, Math.ceil(Math.max(0, ...points.map((p) => p.value)) / 2));
  const x = (t: number) =>
      left + ((t - start) / (end - start)) * (w - left - right),
    y = (v: number) => top + (1 - v / max) * (h - top - bottom);
  const marker = Math.max(start, Math.min(end, time));
  return (
    <figure className="day-plot">
      <figcaption>
        {title} <small>{unit}</small>
      </figcaption>
      <svg
        role="img"
        aria-label={title}
        viewBox={`0 0 ${w} ${h}`}
        onClick={(e) => {
          const bounds = e.currentTarget.getBoundingClientRect();
          const relative = ((e.clientX - bounds.left) / bounds.width) * w;
          onTime(
            Math.round(
              Math.max(
                start,
                Math.min(
                  end,
                  start +
                    ((relative - left) / (w - left - right)) * (end - start),
                ),
              ),
            ),
          );
        }}
      >
        <title>{title}</title>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={left}
              x2={w - right}
              y1={y(max * f)}
              y2={y(max * f)}
              className="day-grid"
            />
            <text x={left - 10} y={y(max * f) + 4} textAnchor="end">
              {format(max * f)}
            </text>
          </g>
        ))}
        {bars ? (
          points.map((p) => (
            <rect
              key={p.time}
              x={x(p.time) + 1}
              y={y(p.value)}
              width={Math.max(
                0,
                x(Math.min(end, p.time + binSeconds)) - x(p.time) - 2,
              )}
              height={y(0) - y(p.value)}
              className="day-demand-bar"
            >
              <title>
                {clock(p.time)}–{clock(Math.min(end, p.time + binSeconds))}:{" "}
                {format(p.value)} чел.
              </title>
            </rect>
          ))
        ) : (
          <path
            className="day-line"
            d={points
              .map(
                (p, i) =>
                  `${i ? "H" : "M"}${x(p.time)}${i ? `V${y(p.value)}` : `,${y(p.value)}`}`,
              )
              .join(" ")}
          />
        )}
        <line
          className="day-marker"
          x1={x(marker)}
          x2={x(marker)}
          y1={top}
          y2={h - bottom}
        />
        {Array.from(
          { length: 5 },
          (_, i) => start + ((end - start) * i) / 4,
        ).map((t, i) => (
          <text
            key={t}
            x={x(t)}
            y={h - 20}
            textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}
          >
            {clock(t, false)}
            {t >= 86400 ? ` +${Math.floor(t / 86400)}д` : ""}
          </text>
        ))}
        {!points.length && (
          <text x={w / 2} y={100} textAnchor="middle">
            После запуска симуляции
          </text>
        )}
      </svg>
    </figure>
  );
}

export default function DailyTimeline({
  network,
  trajectory,
  time,
  onTime,
}: {
  network: Network;
  trajectory: Trajectory | null;
  time: number;
  onTime: (t: number) => void;
}) {
  const [station, setStation] = useState(""),
    [minutes, setMinutes] = useState(15),
    [chosenTime, setChosenTime] = useState<number | null>(null);
  const selected = network.stations.some((s) => s.id === station)
    ? station
    : "";
  const start = setting(network, "day_start_s"),
    end = setting(network, "day_end_s");
  const data = useMemo(() => {
    const queues = queueIndex(trajectory),
      events = selected ? (queues.stations.get(selected) ?? []) : queues.total;
    const bins: Point[] = [],
      waiting: Point[] = [],
      trains: Point[] = [];
    if (!(end > start)) return { bins, waiting, trains, events };
    for (let t = start; t < end; t += minutes * 60)
      bins.push({
        time: t,
        value: plannedEntries(
          network,
          selected,
          t,
          Math.min(end, t + minutes * 60),
        ),
      });
    if (trajectory) {
      for (let t = start; t <= end; t = Math.min(end, t + 60)) {
        waiting.push({ time: t, value: queueAt(events, t) });
        const sample = trajectory.series[before(trajectory.series, t, "time")];
        if (sample) trains.push({ time: t, value: sample.trains_active });
        if (t === end) break;
      }
    }
    return { bins, waiting, trains, events };
  }, [network, trajectory, selected, minutes, start, end]);
  if (!(end > start)) return null;
  const cursor = trajectory
    ? time
    : Math.max(start, Math.min(end, chosenTime ?? start));
  const at = Math.max(start, Math.min(end, cursor)),
    bin =
      start +
      Math.min(
        data.bins.length - 1,
        Math.floor((at - start) / (minutes * 60)),
      ) *
        minutes *
        60;
  const sample = trajectory?.series[before(trajectory.series, at, "time")];
  const setTime = (t: number) => {
    setChosenTime(t);
    if (trajectory) onTime(t);
  };
  return (
    <section className="panel daily-timeline" aria-label="График за день">
      <div className="section-heading">
        <h2>График за день</h2>
      </div>
      <div className="day-controls">
        <label>
          <span>Пассажиры</span>
          <select
            aria-label="Станция на графике"
            value={selected}
            onChange={(e) => setStation(e.target.value)}
          >
            <option value="">Вся сеть</option>
            {network.stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Интервал входа</span>
          <select
            aria-label="Интервал графика"
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          >
            {[15, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m} мин
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="day-note">
        Вход — план за интервал. Очередь и поезда — результат прогона, срезы раз
        в минуту.
      </p>
      <div
        className="day-readout"
        aria-label="Значения на графике"
        data-testid="day-readout"
      >
        <b>{clock(at)}</b>
        <span>
          Вход {clock(bin)}–{clock(Math.min(end, bin + minutes * 60))}:{" "}
          <b>
            {format(
              plannedEntries(
                network,
                selected,
                bin,
                Math.min(end, bin + minutes * 60),
              ),
            )}{" "}
            чел.
          </b>
        </span>
        <span>
          Ожидают: <b>{trajectory ? format(queueAt(data.events, at)) : "—"}</b>
        </span>
        <span>
          Поезда вне депо: <b>{sample?.trains_active ?? "—"}</b>
        </span>
      </div>
      <div className="day-plots">
        <DayPlot
          title={`Плановый вход за ${minutes} мин`}
          unit="чел."
          points={data.bins}
          start={start}
          end={end}
          time={at}
          onTime={setTime}
          bars
          binSeconds={minutes * 60}
        />
        <DayPlot
          title="Ожидают на станциях"
          unit="≈чел."
          points={data.waiting}
          start={start}
          end={end}
          time={at}
          onTime={setTime}
          binSeconds={60}
        />
        <DayPlot
          title="Поезда вне депо — вся сеть"
          unit="составов"
          points={data.trains}
          start={start}
          end={end}
          time={at}
          onTime={setTime}
          binSeconds={60}
        />
      </div>
      <label className="day-scrubber">
        <span>Время на графике</span>
        <input
          aria-label="Время на графике"
          type="range"
          min={start}
          max={end}
          step="1"
          value={at}
          onChange={(e) => setTime(Number(e.target.value))}
        />
      </label>
      {network.od_matrix != null && (
        <p className="day-note">Вход рассчитан по поездкам OD-матрицы.</p>
      )}
    </section>
  );
}
