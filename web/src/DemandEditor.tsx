import { useState } from "react";
import type { Network } from "./model";
import { clock, setting, tagged, value } from "./model";
import { alignedDemandStep, replaceDemand } from "./demandIntervals";
import { passengerCount } from "./replay";

function TimeInput({
  label,
  seconds,
  onChange,
}: {
  label: string;
  seconds: number;
  onChange: (v: number) => void;
}) {
  const day = Math.floor(seconds / 86400);
  return (
    <div className="demand-time">
      <label>
        <span>{label}</span>
        <input
          type="time"
          step="60"
          aria-label={label}
          value={clock(seconds, false)}
          onChange={(e) => {
            const [h, m] = e.target.value.split(":").map(Number);
            if (Number.isFinite(h) && Number.isFinite(m))
              onChange(day * 86400 + h * 3600 + m * 60);
          }}
        />
      </label>
      <label>
        <span>День</span>
        <select
          aria-label={`День: ${label}`}
          value={day}
          onChange={(e) =>
            onChange(Number(e.target.value) * 86400 + (seconds % 86400))
          }
        >
          {[...new Set([0, 1, day])].map((d) => (
            <option key={d} value={d}>
              {d === 0
                ? "Первый день"
                : d === 1
                  ? "Следующий день"
                  : `Через ${d} дн.`}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export default function DemandEditor({
  network,
  update,
  disabled,
}: {
  network: Network;
  update: (fn: (n: Network) => void) => void;
  disabled: boolean;
}) {
  const [chosen, setChosen] = useState(network.stations[0]?.id ?? ""),
    [start, setStart] = useState(setting(network, "day_start_s")),
    [end, setEnd] = useState(
      Math.min(
        setting(network, "day_end_s"),
        setting(network, "day_start_s") + 900,
      ),
    ),
    [entries, setEntries] = useState("150"),
    [editing, setEditing] = useState<number | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const station = network.stations.some((s) => s.id === chosen)
    ? chosen
    : (network.stations[0]?.id ?? "");
  const rows = network.demand
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.station === station)
    .sort((a, b) => value(a.row.start_min) - value(b.row.start_min));
  const od = network.od_matrix != null;
  return (
    <section className="panel demand-editor" aria-label="Спрос по интервалам">
      <div className="section-heading">
        <h2>Спрос по интервалам</h2>
      </div>
      <div className="demand-body">
        <p>
          Задайте число входящих за интервал. Очередь на станции рассчитывается
          с учётом движения поездов.
        </p>
        {od && (
          <p role="status">
            Сеть использует OD-матрицу. Входящий поток задан её поездками;
            станционный спрос здесь не применяется.
          </p>
        )}
        <fieldset
          disabled={disabled || od || !station}
          className="demand-fields"
        >
          <legend>Плановый вход</legend>
          <label>
            <span>Станция</span>
            <select
              aria-label="Станция для спроса"
              value={station}
              onChange={(e) => {
                setChosen(e.target.value);
                setEditing(null);
                setError("");
                setNotice("");
              }}
            >
              {network.stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <TimeInput
            label="Начало интервала спроса"
            seconds={start}
            onChange={setStart}
          />
          <TimeInput
            label="Конец интервала спроса"
            seconds={end}
            onChange={setEnd}
          />
          <label>
            <span>Входящих за интервал, чел.</span>
            <input
              type="number"
              min="0"
              step="1"
              aria-label="Входящих за интервал, чел."
              value={entries}
              onChange={(e) => setEntries(e.target.value)}
            />
          </label>
          <button
            onClick={() => {
              const count = Number(entries),
                a = setting(network, "day_start_s"),
                b = setting(network, "day_end_s");
              if (
                !entries.trim() ||
                !Number.isSafeInteger(count) ||
                count < 0
              ) {
                setError("Введите целое неотрицательное число входящих.");
                return;
              }
              if (end <= start || start < a || end > b) {
                setError(
                  `Интервал должен быть внутри ${clock(a)}–${clock(b)}; конец позже начала.`,
                );
                return;
              }
              let step = 0;
              update((n) => {
                const original = n.demand.filter((_, i) => i !== editing);
                n.demand = replaceDemand(original, station, start, end, count);
                step = alignedDemandStep(
                  n.demand,
                  setting(n, "group_step_s"),
                  a,
                  b,
                );
                n.settings.group_step_s = tagged(step);
              });
              setEditing(null);
              setError("");
              setNotice(
                `Сохранено: ${clock(start)}–${clock(end)}, ${count} чел. Шаг появления: ${step} с.`,
              );
            }}
          >
            {editing === null
              ? "Задать вход за интервал"
              : "Сохранить интервал"}
          </button>
          {editing !== null && (
            <button onClick={() => setEditing(null)}>
              Отменить редактирование
            </button>
          )}
        </fieldset>
        <small className="demand-help">
          Пересекающаяся часть старого спроса заменяется. Шаг появления
          согласуется с границами интервалов. При включённом Пуассоне число
          вошедших случайное; без него используется заданный поток.
        </small>
        {error && (
          <p className="message error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
      </div>
      <div className="table-scroll demand-rows">
        <table aria-label="Интервалы спроса станции">
          <thead>
            <tr>
              <th>С</th>
              <th>До</th>
              <th>Входящих, чел.</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ row, index }) => (
              <tr key={index}>
                <td>{clock(value(row.start_min) * 60)}</td>
                <td>
                  {clock((value(row.start_min) + value(row.len_min)) * 60)}
                </td>
                <td>{passengerCount(value(row.entries))}</td>
                <td>
                  <button
                    disabled={disabled || od}
                    aria-label={`Изменить интервал ${clock(value(row.start_min) * 60)}`}
                    onClick={() => {
                      setStart(value(row.start_min) * 60);
                      setEnd((value(row.start_min) + value(row.len_min)) * 60);
                      setEntries(String(Math.round(value(row.entries))));
                      setEditing(index);
                      setError("");
                      setNotice("");
                    }}
                  >
                    Изменить
                  </button>{" "}
                  <button
                    disabled={disabled || od}
                    aria-label={`Удалить интервал ${clock(value(row.start_min) * 60)}`}
                    onClick={() => {
                      update((n) => {
                        n.demand.splice(index, 1);
                      });
                      setEditing(null);
                      setNotice("");
                    }}
                  >
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4}>Интервалы не заданы; вход равен нулю.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
