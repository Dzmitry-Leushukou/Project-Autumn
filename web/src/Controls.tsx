import type { Network } from "./model";
import {
  colors,
  clock,
  defaults,
  demandProfile,
  rawSetting,
  setPath,
  source,
  stationDefaults,
  tagged,
  trainDefaults,
  value,
} from "./model";
import { useId, useState } from "react";
import {
  fieldHelp,
  durationText,
  numberText,
  parameterName,
  parameterValue,
  validationMessage,
} from "./uiText";
export function Badge({
  raw,
  automatic = false,
}: {
  raw: any;
  automatic?: boolean;
}) {
  const kind = automatic ? "automatic" : source(raw);
  const labels: Record<string, string> = {
    automatic: "рассчитано",
    данные: "из данных",
    оценка: "оценка по данным",
    допущение: "по умолчанию",
    "задано вами": "задано вами",
  };
  const hints: Record<string, string> = {
    automatic:
      "Распределение автоматически рассчитано по времени оборота и доступному парку.",
    данные: "Значение отмечено во входном файле как полученное из данных.",
    оценка: "Приближённое значение, вычисленное по исходным данным.",
    допущение:
      "Учебное предположение модели. Это не измерение на реальном метро; значение можно изменить.",
    "задано вами": "Явное значение из файла сети или введённое вручную.",
  };
  return (
    <small className="source" title={hints[kind]}>
      {labels[kind] ?? kind}
    </small>
  );
}
export function Field({
  label,
  raw,
  fallback,
  onChange,
  step = 1,
  min = 0,
  max,
  type = "number",
  hint,
  display,
  scale = 1,
  unit,
}: {
  label: string;
  raw: any;
  fallback?: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  type?: string;
  hint?: string;
  display?: string;
  scale?: number;
  unit?: string;
}) {
  const id = useId();
  return (
    <label className={`field ${type === "range" ? "slider" : ""}`}>
      <span>
        {label}
        <Badge raw={raw} />
      </span>
      {type === "range" && (
        <output>
          {numberText(value(raw, fallback) * scale, 2)}
          {unit}
        </output>
      )}
      <input
        aria-label={label}
        type={type}
        aria-describedby={hint || display ? id : undefined}
        value={value(raw, fallback) * scale}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value) / scale)}
      />
      {(hint || display) && (
        <small className="field-help" id={id}>
          {display && <b>{display}. </b>}
          {hint}
        </small>
      )}
    </label>
  );
}
type Props = {
  n: Network;
  update: (fn: (d: Network) => void, auto?: boolean) => void;
  editing: boolean;
  selected: string | null;
  activeLine: string;
  setActiveLine: (s: string) => void;
  report: any;
  onCsv: () => void;
  addSegment: (d: Network, a: string, b: string) => void;
  onStationDelete: (id: string) => void;
  onConnectionDelete: (kind: "segment" | "transfer", index: number) => void;
};
export default function Controls({
  n,
  update,
  editing,
  selected,
  activeLine,
  setActiveLine,
  report,
  onCsv,
  addSegment,
  onStationDelete,
  onConnectionDelete,
}: Props) {
  const [profile, setProfile] = useState("peaks"),
    [peak, setPeak] = useState(100),
    s = n.stations.find((s) => s.id === selected),
    line = n.lines.find((l) => l.id === activeLine);
  const field = (path: string, label: string, options: any = {}) => (
    <Field
      key={path}
      label={label}
      raw={rawSetting(n, path)}
      fallback={path.split(".").reduce((o, k) => o?.[k], defaults)}
      onChange={(v) =>
        update(
          (d) => setPath(d.settings, path, tagged(v)),
          !path.startsWith("optimizer."),
        )
      }
      {...options}
      hint={options.hint ?? fieldHelp[path]}
    />
  );
  return (
    <aside className="sidebar">
      <section className="panel sidebar-intro">
        <h2>{editing ? "Параметры сети" : "Параметры расчёта"}</h2>
        <p>
          «По умолчанию» — предположение модели, «из данных» — значение из
          источника. После изменения сети запустите симуляцию заново.
        </p>
      </section>
      {editing && (
        <>
          <section className="panel side-section">
            <h3>Топология</h3>
            <label className="field">
              <span>Название сети</span>
              <input
                aria-label="Название сети"
                value={n.meta.name}
                onChange={(e) =>
                  update((d) => {
                    d.meta.name = e.target.value;
                  })
                }
              />
            </label>
            <label className="field">
              <span>Активная ветка</span>
              <select
                aria-label="Активная ветка"
                value={activeLine}
                onChange={(e) => setActiveLine(e.target.value)}
              >
                {n.lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() =>
                update((d) => {
                  const id = `L${d.lines.length + 1}`;
                  d.lines.push({
                    id,
                    name: `Линия ${d.lines.length + 1}`,
                    color: colors[d.lines.length % colors.length],
                    is_loop: false,
                    stations: [],
                  });
                  setActiveLine(id);
                  delete d.fleet_assignment;
                  delete d.schedule;
                })
              }
            >
              + Добавить ветку
            </button>
            {line && (
              <>
                <label className="field">
                  <span>Название ветки</span>
                  <input
                    aria-label="Название ветки"
                    value={line.name}
                    onChange={(e) =>
                      update((d) => {
                        d.lines.find((l) => l.id === activeLine).name =
                          e.target.value;
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Цвет ветки</span>
                  <input
                    aria-label="Цвет ветки"
                    type="color"
                    value={line.color}
                    onChange={(e) =>
                      update((d) => {
                        d.lines.find((l) => l.id === activeLine).color =
                          e.target.value;
                      })
                    }
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    aria-label="Кольцевая ветка"
                    checked={line.is_loop}
                    onChange={(e) =>
                      update((d) => {
                        const l = d.lines.find((l) => l.id === activeLine);
                        l.is_loop = e.target.checked;
                        if (l.is_loop && l.stations.length > 2)
                          addSegment(d, l.stations.at(-1), l.stations[0]);
                      })
                    }
                  />
                  Кольцевая ветка
                </label>
                <p className="hint">
                  «Ветка»: кликайте станции по порядку. Общие станции включайте
                  в несколько веток.
                </p>
              </>
            )}
          </section>
          {s && (
            <section
              className="panel side-section"
              data-testid="station-settings"
            >
              <h3>Свойства станции · {s.id}</h3>
              <button
                className="delete-button"
                onClick={() => onStationDelete(s.id)}
              >
                Удалить станцию
              </button>
              <label className="field">
                <span>Название станции</span>
                <input
                  aria-label="Название станции"
                  value={s.name}
                  onChange={(e) =>
                    update((d) => {
                      d.stations.find((s) => s.id === selected).name =
                        e.target.value;
                    })
                  }
                />
              </label>
              <label className="check">
                <input
                  aria-label="Платформенные двери"
                  type="checkbox"
                  checked={!!s.platform_doors}
                  onChange={(e) =>
                    update((d) => {
                      d.stations.find((s) => s.id === selected).platform_doors =
                        e.target.checked;
                    })
                  }
                />
                Платформенные двери
              </label>
              {Object.entries(stationDefaults).map(([key, fallback]) => (
                <Field
                  key={key}
                  label={
                    (
                      {
                        door_open_s: "Открытие дверей, с",
                        door_close_s: "Закрытие дверей, с",
                        dwell_base_s: "Базовая стоянка, с",
                        boarding_rate_pps: "Посадка и высадка, чел./с",
                      } as any
                    )[key]
                  }
                  raw={s[key]}
                  fallback={fallback as number}
                  min={key === "boarding_rate_pps" ? 0.1 : 0}
                  step={0.1}
                  hint={
                    key === "boarding_rate_pps"
                      ? "Скорость посадки и высадки через все двери поезда. 6 означает 6 пассажиров в секунду суммарно."
                      : key === "dwell_base_s"
                        ? "Минимальная стоянка без обмена пассажиров и случайных задержек."
                        : "Добавляется к стоянке только при включённых платформенных дверях."
                  }
                  onChange={(v) =>
                    update((d) => {
                      d.stations.find((s) => s.id === selected)[key] =
                        tagged(v);
                    })
                  }
                />
              ))}
              <h4>Спрос станции</h4>
              <Field
                label="Пик, человек / 15 минут"
                raw={peak}
                hint="Масштаб входящего потока за 15 минут. Для ровного профиля это точное значение, для пикового максимум может быть выше. Кнопка ниже заменит спрос только этой станции."
                onChange={setPeak}
              />
              <label className="field">
                <span>Профиль спроса</span>
                <select
                  aria-label="Профиль спроса"
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                >
                  <option value="peaks">Два пика</option>
                  <option value="flat">Ровный</option>
                  <option value="morning">Утренний</option>
                </select>
              </label>
              <button
                onClick={() =>
                  update((d) => {
                    d.demand = d.demand
                      .filter((r) => r.station !== selected)
                      .concat(demandProfile(d, selected!, peak, profile));
                  })
                }
              >
                Применить спрос к станции
              </button>
            </section>
          )}
          <details className="panel side-section">
            <summary>Перегоны и переходы</summary>
            {n.segments.map((s, i) => (
              <div className="connection-settings" key={`${s.from}:${s.to}`}>
                <Field
                  label={`${s.from} — ${s.to}, м`}
                  raw={s.length_m}
                  min={1}
                  hint={
                    s.run_time_s != null
                      ? `В файле задано время хода: ${durationText(value(s.run_time_s))}. Оно имеет приоритет; изменение длины не изменит время хода, пока run_time_s не удалён из JSON.`
                      : "Длина перегона в метрах. По ней, скорости и ускорению рассчитывается время движения."
                  }
                  onChange={(v) =>
                    update((d) => {
                      d.segments[i].length_m = tagged(v);
                    })
                  }
                />
                <button
                  className="delete-button"
                  aria-label={`Удалить перегон ${s.from} — ${s.to}`}
                  onClick={() => onConnectionDelete("segment", i)}
                >
                  Удалить перегон
                </button>
              </div>
            ))}
            {n.transfers.map((tr, i) => (
              <div className="connection-settings" key={`transfer:${i}`}>
                <Field
                  label={`Переход ${tr.from} — ${tr.to}, с`}
                  raw={tr.walk_time_s}
                  fallback={180}
                  onChange={(v) =>
                    update((d) => {
                      d.transfers[i].walk_time_s = tagged(v);
                    })
                  }
                />
                <button
                  className="delete-button"
                  aria-label={`Удалить переход ${tr.from} — ${tr.to}`}
                  onClick={() => onConnectionDelete("transfer", i)}
                >
                  Удалить переход
                </button>
              </div>
            ))}
          </details>
        </>
      )}
      <div className="mode-panels" hidden={!editing}>
        <details className="panel side-section" open>
          <summary>Пассажиры</summary>
          {field("routes.margin", "Широта выбора маршрута", {
            type: "range",
            max: 50,
            step: 1,
            scale: 100,
            unit: "%",
          })}
          {field("routes.theta", "Чувствительность ко времени θ", {
            step: 0.001,
          })}
          {field("routes.transfer_penalty_s", "Штраф за пересадку, с", {
            step: 10,
            display: durationText(
              value(rawSetting(n, "routes.transfer_penalty_s"), 300),
            ),
          })}
          {field("routes.diversity", "Разнообразие пассажиров", {
            type: "range",
            max: 1,
            step: 0.01,
          })}
          {field("routes.classes", "Групп предпочтений пассажиров", { min: 1 })}
          {field("seed", "Номер случайного сценария")}
          <label className="check">
            <input
              type="checkbox"
              checked={n.settings.demand_noise ?? true}
              onChange={(e) =>
                update((d) => {
                  d.settings.demand_noise = e.target.checked;
                }, true)
              }
            />
            Случайный спрос (Пуассон)
          </label>
          <p className="hint">
            Направления поездок:{" "}
            {n.od_matrix
              ? "заданы в файле: откуда и куда едут пассажиры"
              : "рассчитываются по популярности и удалённости станций"}
            .
          </p>
        </details>
        <details className="panel side-section">
          <summary>Случайные задержки</summary>
          {field("delays.p0", "Вероятность задержки, %", {
            max: 100,
            step: 1,
            scale: 100,
          })}
          {field("delays.mean_s", "Средняя задержка, с", {
            min: 0.1,
            step: 0.1,
          })}
          {field("delays.std_s", "Разброс задержки, с", { step: 0.1 })}
          <p className="hint">
            Моделируются только небольшие задержки на остановках. Редкие
            задержки могут оказаться длиннее среднего; поломки и аварии не
            учитываются.
          </p>
        </details>
        <details className="panel side-section" open={editing}>
          <summary>Поезд и общий парк</summary>
          {Object.entries(trainDefaults).map(([key, fallback]) => (
            <Field
              key={key}
              label={
                (
                  {
                    capacity: "Вместимость поезда",
                    max_speed_mps: "Скорость, м/с",
                    acceleration_mps2: "Ускорение, м/с²",
                    deceleration_mps2: "Замедление, м/с²",
                    turnaround_s: "Разворот, с",
                  } as any
                )[key]
              }
              raw={n.train[key]}
              fallback={fallback as number}
              min={key === "turnaround_s" ? 0 : 0.1}
              step={key.includes("mps2") ? 0.1 : 1}
              hint={
                key === "capacity"
                  ? "Пассажиров в одном составе. После заполнения остальные ждут следующий поезд."
                  : key === "max_speed_mps"
                    ? `Это ${numberText(value(n.train[key], fallback as number) * 3.6)} км/ч. На коротком перегоне поезд может не успеть разогнаться до этой скорости.`
                    : key === "turnaround_s"
                      ? "Время подготовки к обратному выпуску на конечной. У кольца разворота нет."
                      : "Постоянное ускорение или торможение при расчёте времени хода. Это не скорость."
              }
              onChange={(v) =>
                update((d) => {
                  d.train[key] = tagged(v);
                })
              }
            />
          ))}
          <Field
            label="Общий парк поездов"
            raw={n.fleet}
            hint="Сколько составов доступно всей сети. Назначения по веткам в расписании не могут превышать это число."
            onChange={(v) =>
              update((d) => {
                d.fleet = tagged(v);
                delete d.fleet_assignment;
              })
            }
          />
        </details>
      </div>
      <div className="mode-panels" hidden={editing}>
        <details className="panel side-section">
          <summary>Параметры поиска</summary>
          {field("optimizer.population", "Популяция", { min: 4 })}
          {field("optimizer.generations", "Поколения", { min: 1 })}
          {field("optimizer.time_budget_s", "Бюджет поиска, с", { min: 1 })}
          {field("optimizer.evaluation_budget", "Максимум оценок расписаний", {
            min: 4,
          })}
          {field("optimizer.seeds_search", "Прогонов на вариант при поиске", {
            min: 1,
          })}
          {field("optimizer.seeds_final", "Прогонов для итоговой оценки", {
            min: 1,
          })}
          {field("optimizer.headway_min_s", "Граница интервала снизу, с", {
            min: 1,
          })}
          {field("optimizer.headway_max_s", "Граница интервала сверху, с", {
            min: 1,
          })}
          {field("optimizer.headway_step_s", "Шаг интервала, с", { min: 1 })}
          {field("optimizer.weights_a.wait", "Вес ожидания", { step: 0.1 })}
          {field("optimizer.weights_a.denied", "Вес отказов", { step: 1 })}
          {field("optimizer.weights_a.queue", "Вес очереди", { step: 1 })}
          {field("optimizer.weights_b.empty", "Вес пустых мест", { step: 0.1 })}
          {field("optimizer.weights_b.fleet", "Вес парка", { step: 0.1 })}
          {field(
            "service_targets.max_denied_share",
            "Отказов на 100 посадок, максимум",
            {
              max: 100,
              step: 0.1,
              scale: 100,
            },
          )}
          <p className="hint">
            Если перегон или платформа заняты, следующий поезд ждёт независимо
            от интервала в расписании.
          </p>
        </details>
      </div>
      <div className="mode-panels" hidden={!editing}>
        <details className="panel side-section">
          <summary>Время и спрос</summary>
          {(
            [
              ["day_start_s", "Начало работы"],
              ["day_end_s", "Конец работы"],
            ] as const
          ).map(([path, label]) => (
            <div className="field" key={path}>
              <span>
                {label}
                <Badge raw={rawSetting(n, path)} />
              </span>
              <input
                aria-label={label}
                type="time"
                step="60"
                value={clock(value(rawSetting(n, path), defaults[path]), false)}
                onChange={(e) => {
                  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(
                    e.target.value,
                  );
                  if (match) {
                    const next =
                      Math.floor(
                        value(rawSetting(n, path), defaults[path]) / 86400,
                      ) *
                        86400 +
                      Number(match[1]) * 3600 +
                      Number(match[2]) * 60;
                    if (next !== value(rawSetting(n, path), defaults[path]))
                      update(
                        (d) => setPath(d.settings, path, tagged(next)),
                        true,
                      );
                  }
                }}
              />
              <select
                aria-label={
                  path === "day_end_s"
                    ? "День окончания работы"
                    : "День начала работы"
                }
                value={Math.floor(
                  value(rawSetting(n, path), defaults[path]) / 86400,
                )}
                onChange={(e) =>
                  update(
                    (d) =>
                      setPath(
                        d.settings,
                        path,
                        tagged(
                          (value(rawSetting(n, path), defaults[path]) % 86400) +
                            Number(e.target.value) * 86400,
                        ),
                      ),
                    true,
                  )
                }
              >
                {[
                  ...new Set([
                    0,
                    1,
                    Math.floor(
                      value(rawSetting(n, path), defaults[path]) / 86400,
                    ),
                  ]),
                ].map((day) => (
                  <option key={day} value={day}>
                    {day === 0
                      ? "Первый день"
                      : day === 1
                        ? "Следующий день"
                        : `Через ${day} дн.`}
                  </option>
                ))}
              </select>
              <small className="field-help">
                Обычное время от 00:00 до 23:59. Для работы после полуночи
                выберите следующий день.
              </small>
            </div>
          ))}
          {field("group_step_s", "Период появления пассажиров, с", {
            min: 1,
            display: durationText(value(rawSetting(n, "group_step_s"), 120)),
          })}
          {field("od_beta", "Влияние удалённости назначения β", { step: 0.1 })}
          <button onClick={onCsv}>↑ Импорт спроса из CSV</button>
          <p className="hint">
            CSV: код станции, начало в минутах от полуночи, длительность в
            минутах, число входящих за интервал. Заголовок:
            station,start_min,len_min,entries. Записи добавляются к
            существующим; пересечения будут показаны в проверке сети.
          </p>
        </details>
      </div>
      <details
        className="panel side-section validation"
        open={report?.errors?.length > 0}
      >
        <summary>
          Проверка сети{" "}
          <span>
            {!report
              ? "проверяем…"
              : report.errors?.length
                ? `${report.errors.length} ошибок`
                : "ошибок нет"}
          </span>
        </summary>
        {report ? (
          ["errors", "warnings", "missing", "assumptions"].map((kind) => (
            <div key={kind}>
              <h4>
                {
                  (
                    {
                      errors: "Ошибки",
                      warnings: "Предупреждения",
                      missing: "Не заданы явно",
                      assumptions:
                        "Значения по умолчанию и автоматические оценки",
                    } as any
                  )[kind]
                }{" "}
                · {report[kind]?.length ?? 0}
              </h4>
              <ul>
                {report[kind]?.map((r: any, i: number) => (
                  <li key={i}>
                    <b>{parameterName(r.path, n)}</b>
                    <span>{validationMessage(r.message)}</span>
                    {r.value !== undefined && (
                      <small>{parameterValue(r.path, r.value, n)}</small>
                    )}
                    <details>
                      <summary>Поле в JSON</summary>
                      <code>{r.path}</code>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <p>Проверяем…</p>
        )}
      </details>
    </aside>
  );
}
