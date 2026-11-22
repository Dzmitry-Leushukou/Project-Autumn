import { useEffect, useMemo, useRef, useState } from "react";
import { queueIndex, queueAt } from "./replay";
import CanvasMap from "./CanvasMap";
import Controls, { Badge } from "./Controls";
import { fmt, Options } from "./Results";
import type { Network, Trajectory } from "./model";
import {
  api,
  clock,
  demandProfile,
  download,
  emptyNetwork,
  headways,
  periods,
  setting,
  tagged,
  value,
} from "./model";

export default function App() {
  const [catalogue, setCatalogue] = useState<any[]>([]),
    [network, setNetwork] = useState<Network | null>(null),
    [demo, setDemo] = useState("b_transfer"),
    [editing, setEditing] = useState(false),
    [tool, setTool] = useState("station"),
    [selected, setSelected] = useState<string | null>(null),
    [activeLine, setActiveLine] = useState("L1"),
    [transferFrom, setTransferFrom] = useState<string | null>(null);
  const [report, setReport] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(""),
    [metrics, setMetrics] = useState<any>(null),
    [trajectory, setTrajectory] = useState<Trajectory | null>(null),
    [time, setTime] = useState(18000),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(60),
    [heat, setHeat] = useState("none"),
    [job, setJob] = useState<any>(null),
    [result, setResult] = useState<any>(null),
    [locked, setLocked] = useState(false),
    [trainResult, setTrainResult] = useState<any>(null),
    [countMode, setCountMode] = useState("by_headway"),
    [countValue, setCountValue] = useState(180),
    [period, setPeriod] = useState(0),
    [showAll, setShowAll] = useState(false);
  const clockRef = useRef({ time, playing, speed }),
    upload = useRef<HTMLInputElement>(null),
    csv = useRef<HTMLInputElement>(null),
    auto = useRef(false),
    version = useRef(0),
    jobNetwork = useRef<Network | null>(null);
  clockRef.current.playing = playing;
  clockRef.current.speed = speed;
  const queues = useMemo(() => queueIndex(trajectory), [trajectory]);
  const setClock = (t: number) => {
    clockRef.current.time = t;
    setTime(t);
  };
  function reset(n: Network, id = "") {
    version.current++;
    setNetwork(n);
    setDemo(id);
    setMetrics(null);
    setTrajectory(null);
    setResult(null);
    setReport(null);
    setTrainResult(null);
    setPlaying(false);
    setSelected(null);
    setActiveLine(n.lines[0]?.id ?? "L1");
    setPeriod(0);
    setClock(setting(n, "day_start_s"));
    setError("");
    setNotice("");
    auto.current = false;
  }
  useEffect(() => {
    let live = true;
    api("/networks")
      .then(async (data) => {
        const initial = await api("/networks/b_transfer");
        if (!live) return;
        setCatalogue(data);
        reset(initial, "b_transfer");
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!network) return;
    let live = true;
    const v = version.current;
    const timer = setTimeout(() => {
      api("/validate", { network })
        .then((r) => {
          if (!live) return;
          setReport(r);
          if (auto.current && !r.errors.length && trajectory && !editing) {
            auto.current = false;
            simulate(network, v);
          }
        })
        .catch((e) => live && setError(e.message));
    }, 450);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [network]);
  useEffect(() => {
    if (!job?.job_id || ["done", "failed", "cancelled"].includes(job.status))
      return;
    let live = true;
    const timer = setInterval(
      () =>
        api(`/jobs/${job.job_id}`)
          .then((data) => {
            if (!live) return;
            setJob({ ...data, job_id: job.job_id });
            if (data.status === "done") {
              setResult(data.result);
              setNotice(
                data.result.reproducible === false
                  ? "Поиск остановлен по времени. Показаны полностью проверенные варианты; для повторяемого поиска увеличьте время или уменьшите максимум оценок."
                  : data.result.options.length
                    ? "Четыре варианта готовы. Выберите расписание для сравнения."
                    : "Допустимых расписаний не найдено. Измените интервалы или парк.",
              );
            }
            if (data.status === "failed") setError(data.error);
          })
          .catch((e) => {
            setError(e.message);
            setJob(null);
          }),
      600,
    );
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [job?.job_id, job?.status]);
  async function simulate(document: Network, expected = version.current) {
    setBusy("simulate");
    setError("");
    try {
      const run = await api("/simulate", { network: document });
      const t = await api(`/runs/${run.run_id}/trajectory`);
      if (expected !== version.current) return;
      setMetrics(run.metrics);
      setTrajectory(t);
      setReport(run.validation);
      setClock(setting(document, "day_start_s"));
      setPlaying(true);
      setNotice(
        run.deadlock
          ? "Взаимная блокировка: расписание недопустимо."
          : "Прогон готов. Время можно перематывать.",
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  if (!network)
    return (
      <div className="loading">
        <b>METRO LAB</b>
        <p>{error || "Подключаем лабораторию…"}</p>
      </div>
    );
  const n = network;
  const update = (fn: (d: Network) => void, recompute = false) => {
    const d = structuredClone(n);
    fn(d);
    setNetwork(d);
    setError("");
    setTrainResult(null);
    version.current++;
    if (recompute) auto.current = true;
  };
  async function optimize() {
    setError("");
    setResult(null);
    jobNetwork.current = structuredClone(n);
    try {
      const next = await api("/optimize", {
        network: n,
        fleet_assignment_locked: locked,
      });
      setJob({ ...next, status: "queued", progress: 0 });
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function calculate() {
    setBusy("count");
    setError("");
    try {
      setTrainResult(
        await api("/train-count", {
          network: n,
          line_id: activeLine,
          period_index: period,
          mode: countMode,
          ...(countMode === "by_headway"
            ? { headway_s: countValue }
            : { trains: countValue }),
        }),
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  function addSegment(d: Network, a: string, b: string) {
    if (
      a === b ||
      d.segments.some(
        (s) => [s.from, s.to].includes(a) && [s.from, s.to].includes(b),
      )
    )
      return;
    const u = d.stations.find((s) => s.id === a),
      v = d.stations.find((s) => s.id === b);
    d.segments.push({
      from: a,
      to: b,
      length_m: {
        value: Math.max(
          1,
          Math.hypot(value(u.x) - value(v.x), value(u.y) - value(v.y)) * 5,
        ),
        source: "estimate",
      },
    });
  }
  function mapClick(x: number, y: number, station?: string) {
    if (station) setSelected(station);
    if (tool === "station" && !station) {
      update((d) => {
        let i = d.stations.length + 1;
        while (d.stations.some((s) => s.id === `S${i}`)) i++;
        const id = `S${i}`;
        d.stations.push({
          id,
          name: `Станция ${d.stations.length + 1}`,
          x: tagged(Math.round(x)),
          y: tagged(Math.round(y)),
        });
        d.demand.push(...demandProfile(d, id, 100, "peaks"));
        setSelected(id);
      });
    } else if (tool === "line" && station) {
      update((d) => {
        const l = d.lines.find((l) => l.id === activeLine);
        if (!l) return;
        if (l.stations.includes(station)) {
          setNotice(
            "Станция уже на ветке. Для замыкания включите «Кольцевая».",
          );
          return;
        }
        const prev = l.stations.at(-1);
        if (prev) addSegment(d, prev, station);
        l.stations.push(station);
        if (l.is_loop && l.stations.length > 2)
          addSegment(d, station, l.stations[0]);
        delete d.fleet_assignment;
      });
    } else if (tool === "transfer" && station) {
      if (!transferFrom) {
        setTransferFrom(station);
        setNotice("Выберите вторую станцию перехода.");
      } else {
        if (transferFrom !== station)
          update((d) =>
            d.transfers.push({
              from: transferFrom,
              to: station,
              walk_time_s: { value: 180, source: "assumption" },
            }),
          );
        setTransferFrom(null);
      }
    }
  }
  const hw = headways(n),
    allocation =
      n.fleet_assignment ??
      report?.assumptions?.find(
        (r: any) => r.path === "fleet_assignment" && r.value,
      )?.value ??
      metrics?.fleet_assignment ??
      {},
    inProgress = job && ["queued", "running"].includes(job.status),
    invalid = report?.errors?.length > 0;
  const waiting = trajectory ? queueAt(queues.total, time) : metrics?.waiting;
  function importJson(file: File) {
    file.text().then((text) => {
      try {
        const d = JSON.parse(text);
        if (!Array.isArray(d.stations) || !Array.isArray(d.lines) || !d.meta)
          throw new Error("Нет meta, stations или lines");
        d.settings ??= {};
        d.train ??= {};
        d.transfers ??= [];
        reset(d);
        setEditing(false);
      } catch (e: any) {
        setError(`Файл сети: ${e.message}`);
      }
    });
  }
  async function importCsv(file: File) {
    try {
      const rows = (await file.text())
        .replace(/^\uFEFF/, "")
        .trim()
        .split(/\r?\n/)
        .map((r) => r.split(",").map((v) => v.trim().replace(/^"|"$/g, "")));
      if (rows[0].join(",") !== "station,start_min,len_min,entries")
        throw new Error("Ожидаются station,start_min,len_min,entries");
      const data = rows.slice(1).map((r, i) => {
        if (
          r.length !== 4 ||
          r.slice(1).some((x) => x === "" || !Number.isFinite(Number(x)))
        )
          throw new Error(`Некорректная строка ${i + 2}`);
        return {
          station: r[0],
          start_min: Number(r[1]),
          len_min: Number(r[2]),
          entries: tagged(Number(r[3])),
        };
      });
      update((d) => d.demand.push(...data));
      setNotice(
        `Добавлено записей: ${data.length}. Проверьте пересечения интервалов.`,
      );
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Metro Lab">
          <span className="brand-mark">
            M<span>↗</span>
          </span>
          <span>
            METRO LAB<small>Лаборатория городского движения</small>
          </span>
        </a>
        <nav>
          <button
            className={!editing ? "tab active" : "tab"}
            onClick={() => setEditing(false)}
          >
            Симуляция
          </button>
          <button
            className={editing ? "tab active" : "tab"}
            onClick={() => setEditing(true)}
          >
            Конструктор
          </button>
        </nav>
        <span className="local-status">
          ● Локальная модель · seed {setting(n, "seed")}
        </span>
      </header>
      <main className="workspace">
        <section className="page-heading">
          <div>
            <div className="eyebrow">МАТЕМАТИЧЕСКОЕ МОДЕЛИРОВАНИЕ / 01</div>
            <h1>{editing ? "Соберите свою сеть" : "Город в движении"}</h1>
            <p>
              {editing
                ? "Топология, спрос и физика — в одном сценарии."
                : "Как меняется ожидание, когда меняется расписание."}
            </p>
          </div>
          <div className="file-actions">
            <button onClick={() => upload.current?.click()}>
              ↑ Загрузить JSON
            </button>
            <button onClick={() => download("metro-network.json", n)}>
              ↓ Сохранить
            </button>
            {editing && (
              <button
                onClick={() => {
                  reset(emptyNetwork());
                  setEditing(true);
                  setTool("station");
                }}
              >
                Новая сеть
              </button>
            )}
          </div>
        </section>
        <input
          ref={upload}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            if (e.target.files?.[0]) importJson(e.target.files[0]);
            e.target.value = "";
          }}
          aria-label="Файл сети"
        />
        <input
          ref={csv}
          type="file"
          accept=".csv,text/csv"
          hidden
          aria-label="Файл спроса CSV"
          onChange={(e) => {
            if (e.target.files?.[0]) importCsv(e.target.files[0]);
            e.target.value = "";
          }}
        />
        <div className="scenario-bar">
          <label>
            Сценарий
            <select
              aria-label="Демо-сеть"
              value={demo}
              disabled={inProgress}
              onChange={async (e) => {
                const id = e.target.value;
                setBusy("load");
                try {
                  reset(await api(`/networks/${id}`), id);
                } catch (err: any) {
                  setError(err.message);
                } finally {
                  setBusy("");
                }
              }}
            >
              <option value="">Своя сеть</option>
              {catalogue.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <span className="scenario-name">
            {n.meta.name}
            <small>
              {n.meta.synthetic
                ? "Синтетические данные"
                : "Данные TfL · модельные направления"}
            </small>
          </span>
          <span className="scenario-size">
            {n.stations.length} станций / {n.lines.length} линии /{" "}
            {value(n.fleet)} поездов
          </span>
          <button
            className="primary"
            disabled={!!busy || invalid || inProgress}
            onClick={() => simulate(n)}
          >
            {busy === "simulate" ? "Расчёт…" : "▶ Запустить симуляцию"}
          </button>
        </div>
        {!n.meta.synthetic && n.meta.description && (
          <details className="message">
            <summary>Источники и границы модели</summary>
            <p>{n.meta.description}</p>
          </details>
        )}
        {error && (
          <div className="message error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="message" role="status">
            {notice}
          </div>
        )}
        <div className="dashboard">
          <div className="main-column">
            <section className="map-panel panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">
                    {editing ? "КОНСТРУКТОР" : "СХЕМА ДВИЖЕНИЯ"}
                  </span>
                  <h2>{editing ? "Станции и связи" : "Сеть метро"}</h2>
                </div>
                {editing ? (
                  <div className="tool-switch">
                    {[
                      ["station", "Станции"],
                      ["line", "Ветка"],
                      ["transfer", "Переход"],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        className={tool === key ? "selected" : ""}
                        onClick={() => {
                          setTool(key);
                          setTransferFrom(null);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <label className="heat-select">
                    Слой
                    <select
                      aria-label="Тепловая карта"
                      value={heat}
                      onChange={(e) => setHeat(e.target.value)}
                    >
                      <option value="none">Обычная схема</option>
                      <option value="queues">Очереди станций</option>
                      <option value="segments">Загрузка перегонов</option>
                      <option value="blocking">Блокировки</option>
                    </select>
                  </label>
                )}
              </div>
              <CanvasMap
                network={n}
                trajectory={trajectory}
                metrics={metrics}
                clockRef={clockRef}
                onTime={setTime}
                editing={editing}
                tool={tool}
                onMapClick={mapClick}
                selected={selected}
                heat={heat}
              />
              <div className="line-legend">
                {n.lines.map((l) => (
                  <button
                    key={l.id}
                    className={
                      activeLine === l.id ? "line-key chosen" : "line-key"
                    }
                    onClick={() => setActiveLine(l.id)}
                  >
                    <i style={{ background: l.color }} />
                    {l.name}
                  </button>
                ))}
              </div>
              {!editing && (
                <div className="playback">
                  <button
                    className="play-button"
                    aria-label={playing ? "Пауза" : "Продолжить"}
                    disabled={!trajectory}
                    onClick={() => setPlaying(!playing)}
                  >
                    {playing ? "Ⅱ" : "▶"}
                  </button>
                  <b className="clock">{clock(time)}</b>
                  <input
                    aria-label="Время симуляции"
                    type="range"
                    min={setting(n, "day_start_s")}
                    max={
                      trajectory?.meta.simulation_end_s ??
                      setting(n, "day_end_s")
                    }
                    step="1"
                    value={time}
                    disabled={!trajectory}
                    onChange={(e) => {
                      setPlaying(false);
                      setClock(Number(e.target.value));
                    }}
                  />
                  <select
                    aria-label="Скорость времени"
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                  >
                    {[1, 10, 60, 300].map((s) => (
                      <option key={s} value={s}>
                        ×{s}
                      </option>
                    ))}
                  </select>
                  <button
                    className="text-button"
                    disabled={!trajectory}
                    onClick={() =>
                      download("metro-trajectory.json", trajectory)
                    }
                  >
                    ↓ Траектория
                  </button>
                </div>
              )}
            </section>
            <section className="metric-grid" aria-label="Показатели симуляции">
              {[
                [
                  "Среднее ожидание",
                  metrics ? `${fmt(metrics.W, 1)} с` : "—",
                  result
                    ? `исходное ${fmt(result.baseline.metrics.W, 1)} с`
                    : "на пассажира",
                ],
                [
                  "Перевезено",
                  metrics ? fmt(metrics.transported) : "—",
                  metrics
                    ? `не доехало ${fmt(metrics.unfinished)}`
                    : "завершили маршрут",
                ],
                [
                  "Загрузка поездов",
                  metrics ? `${fmt(metrics.LF * 100, 1)}%` : "—",
                  "по проходам перегонов",
                ],
                [
                  "Ожидают",
                  metrics ? fmt(waiting ?? 0) : "—",
                  "в выбранный момент",
                ],
                [
                  "Использовано поездов",
                  metrics
                    ? `${fmt(metrics.used_trains)} / ${value(n.fleet)}`
                    : "—",
                  metrics
                    ? `выпуск +${fmt(metrics.release_delay_s, 1)} с`
                    : "за весь прогон",
                ],
              ].map(([label, val, note]) => (
                <article className="metric panel" key={label}>
                  <span>{label}</span>
                  <b>{val}</b>
                  <small>{note}</small>
                </article>
              ))}
            </section>
            <section className="panel schedule-panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">ИНТЕРВАЛЫ И ПАРК</span>
                  <h2>Расписание</h2>
                </div>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={locked}
                    onChange={(e) => setLocked(e.target.checked)}
                  />
                  Закрепить парк
                </label>
              </div>
              <div className="schedule-tools">
                <label>
                  Период
                  <select
                    aria-label="Период расписания"
                    value={period}
                    onChange={(e) => setPeriod(Number(e.target.value))}
                  >
                    {Array.from({ length: Math.max(1, periods(n)) }, (_, i) => (
                      <option key={i} value={i}>
                        {clock(
                          setting(n, "day_start_s") +
                            i * value(n.schedule?.period_len_min, 60) * 60,
                        )}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="text-button"
                  onClick={() => setShowAll(!showAll)}
                >
                  {showAll ? "Один период" : "Все периоды"}
                </button>
                <span>
                  Интервал, с · оба направления
                  <Badge raw={n.schedule} />
                </span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Линия</th>
                      {(showAll
                        ? Array.from({ length: periods(n) }, (_, i) => i)
                        : [period]
                      ).map((p) => (
                        <th key={p}>
                          {clock(
                            setting(n, "day_start_s") +
                              p * value(n.schedule?.period_len_min, 60) * 60,
                          )}
                        </th>
                      ))}
                      <th>Парк</th>
                      <th>Формула / прогон</th>
                      <th>Факт. интервал</th>
                    </tr>
                  </thead>
                  <tbody>
                    {n.lines.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <i
                            className="line-dot"
                            style={{ background: l.color }}
                          />
                          {l.name}
                        </td>
                        {(showAll
                          ? Array.from({ length: periods(n) }, (_, i) => i)
                          : [period]
                        ).map((p) => (
                          <td key={p}>
                            <input
                              aria-label={`Интервал ${l.name} период ${p + 1}`}
                              type="number"
                              min="1"
                              step="15"
                              value={value(hw[l.id][p], 180)}
                              onChange={(e) =>
                                update((d) => {
                                  const h = headways(d);
                                  h[l.id][p] = tagged(Number(e.target.value));
                                  d.schedule = {
                                    period_len_min:
                                      d.schedule?.period_len_min ?? 60,
                                    headways: h,
                                  };
                                })
                              }
                            />
                            <Badge raw={n.schedule?.headways?.[l.id]?.[p]} />
                          </td>
                        ))}
                        <td>
                          <input
                            aria-label={`Парк ${l.name}`}
                            type="number"
                            min="0"
                            max={value(n.fleet)}
                            value={value(allocation[l.id])}
                            onChange={(e) =>
                              update((d) => {
                                d.fleet_assignment = Object.fromEntries(
                                  d.lines.map((l) => [
                                    l.id,
                                    value(allocation[l.id]),
                                  ]),
                                );
                                d.fleet_assignment![l.id] = Number(
                                  e.target.value,
                                );
                              })
                            }
                          />
                          <Badge raw={n.fleet_assignment} />
                        </td>
                        <td>
                          {metrics?.line_periods?.find(
                            (r: any) => r.line === l.id && r.period === period,
                          )?.formula_trains ?? "—"}{" "}
                          /{" "}
                          {metrics?.line_periods?.find(
                            (r: any) => r.line === l.id && r.period === period,
                          )?.used_trains ?? "—"}
                        </td>
                        <td>
                          {metrics?.actual_headways
                            ?.filter(
                              (r: any) =>
                                r.line === l.id && r.period === period,
                            )
                            .map(
                              (r: any) =>
                                `${r.direction === 1 ? "→" : "←"} ${r.headway_s ? fmt(r.headway_s, 1) : "—"} с`,
                            )
                            .join(" · ") ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="count-controls">
                <select
                  aria-label="Ветка для расчёта"
                  value={activeLine}
                  onChange={(e) => setActiveLine(e.target.value)}
                >
                  {n.lines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Режим расчёта поездов"
                  value={countMode}
                  onChange={(e) => {
                    setCountMode(e.target.value);
                    setCountValue(e.target.value === "by_headway" ? 180 : 8);
                  }}
                >
                  <option value="by_headway">По интервалу, с</option>
                  <option value="by_fleet">По парку, поездов</option>
                </select>
                <input
                  aria-label="Значение для расчёта поездов"
                  type="number"
                  min="1"
                  value={countValue}
                  onChange={(e) => setCountValue(Number(e.target.value))}
                />
                <button disabled={!!busy || invalid} onClick={calculate}>
                  {busy === "count"
                    ? "Проверяем…"
                    : "Рассчитать количество поездов"}
                </button>
              </div>
              {trainResult && (
                <div className="count-result">
                  <strong>
                    Формула: {trainResult.formula_trains ?? "—"} · Симуляция:{" "}
                    {trainResult.simulation
                      ? `${trainResult.simulation.trains} поездов, ${trainResult.simulation.headway_s} с`
                      : "не найдено в диапазоне"}
                  </strong>
                  <p>{trainResult.explanation}</p>
                  <small>
                    Проверено: {trainResult.checked.length} · seed:{" "}
                    {trainResult.seeds.join(", ")}
                  </small>
                </div>
              )}
            </section>
            <section className="panel optimization">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">ДВА КРИТЕРИЯ / NSGA-II</span>
                  <h2>Найти свой баланс</h2>
                </div>
                <button
                  className="primary"
                  disabled={invalid || !!busy || inProgress}
                  onClick={optimize}
                >
                  Оптимизировать
                </button>
              </div>
              <p className="section-description">
                Меньше ожидания на платформах. Меньше пустых мест в поездах.
                <br />
                Один фронт решений — четыре точки зрения.
              </p>
              {inProgress && (
                <div className="job-progress">
                  <progress max="1" value={job.progress} />
                  <span>
                    {Math.round(job.progress * 100)}% ·{" "}
                    {job.status === "queued" ? "В очереди" : "Поиск расписания"}
                  </span>
                  <button
                    onClick={async () => {
                      try {
                        const status = await api(
                          `/jobs/${job.job_id}/cancel`,
                          {},
                        );
                        setJob({ ...job, ...status });
                      } catch (e: any) {
                        setError(e.message);
                      }
                    }}
                  >
                    Отмена
                  </button>
                </div>
              )}
              {job?.status === "cancelled" && (
                <p className="section-description">Поиск отменён.</p>
              )}
              {result && (
                <Options
                  result={result}
                  onApply={(o) => {
                    const d = structuredClone(jobNetwork.current ?? n);
                    d.schedule = {
                      period_len_min: d.schedule?.period_len_min ?? 60,
                      headways: o.headways,
                    };
                    d.fleet_assignment = o.fleet_assignment;
                    version.current++;
                    setNetwork(d);
                    setEditing(false);
                    simulate(d, version.current);
                  }}
                />
              )}
              {!result && !inProgress && (
                <div className="optimization-empty">
                  <span>А — пассажиры</span>
                  <div className="tradeoff-line" />
                  <span>Б — ресурсы</span>
                </div>
              )}
            </section>
          </div>
          <Controls
            n={n}
            update={update}
            editing={editing}
            selected={selected}
            activeLine={activeLine}
            setActiveLine={setActiveLine}
            report={report}
            onCsv={() => csv.current?.click()}
            addSegment={addSegment}
          />
        </div>
        <footer>
          METRO LAB{" "}
          <span>
            Дискретные события · общий seed · воспроизводимые эксперименты
          </span>
          <a
            href={
              import.meta.env.VITE_API_DOCS_URL ?? "http://127.0.0.1:8000/docs"
            }
            target="_blank"
            rel="noreferrer"
          >
            API ↗
          </a>
        </footer>
      </main>
    </>
  );
}
