import { useState } from "react";
import type { Network } from "./model";
import { downloadComparison } from "./exportComparison";

export const fmt = (x: number, d = 0) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: d }).format(x ?? 0);
export function Pareto({ result }: { result: any }) {
  const points = [...result.front, result.baseline],
    xs = points.map((p) => p.f_A),
    ys = points.map((p) => p.f_B),
    minX = Math.min(...xs),
    minY = Math.min(...ys),
    sx = Math.max(...xs) - minX || 1,
    sy = Math.max(...ys) - minY || 1,
    x = (v: number) => 60 + ((v - minX) / sx) * 640,
    y = (v: number) => 230 - ((v - minY) / sy) * 170;
  return (
    <figure className="pareto">
      <figcaption>
        Фронт Парето{" "}
        <small>
          Найденные компромиссы: левее и ниже — лучше. Точки 1–4 соответствуют
          карточкам.
        </small>
      </figcaption>
      <svg
        viewBox="0 0 760 285"
        role="img"
        aria-label="Фронт Парето: ожидание и ресурсы"
      >
        <path d="M60 40V230H720" fill="none" stroke="#adb1b3" />
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <path
              d={`M60 ${230 - t * 170}H720`}
              stroke="#dddcd6"
              strokeDasharray="3 4"
            />
            <text x="7" y={234 - t * 170}>
              {fmt(minY + t * sy, 2)}
            </text>
            <text x={60 + t * 640} y="251" textAnchor="middle">
              {fmt(minX + t * sx, 1)}
            </text>
          </g>
        ))}
        <polyline
          points={result.front
            .map((p: any) => `${x(p.f_A)},${y(p.f_B)}`)
            .join(" ")}
          fill="none"
          stroke="#1f2a37"
          strokeWidth="1.5"
        />
        {result.front.map((p: any, i: number) => (
          <circle key={i} cx={x(p.f_A)} cy={y(p.f_B)} r="4" fill="#1f2a37">
            <title>{`А ${fmt(p.f_A, 2)}, Б ${fmt(p.f_B, 3)}`}</title>
          </circle>
        ))}
        {result.options.map((p: any, i: number) => (
          <g key={i}>
            <circle
              cx={x(p.f_A)}
              cy={y(p.f_B)}
              r="8"
              fill={i === 3 ? "#f4f1ea" : "#1f2a37"}
              stroke="#1f2a37"
              strokeWidth="2"
            />
            <text x={x(p.f_A) + 12} y={y(p.f_B) - 10}>
              {i + 1}
            </text>
          </g>
        ))}
        <text x="390" y="279" textAnchor="middle">
          А · Ожидание, отказы и очереди →
        </text>
        <text x="60" y="25">
          Б · Пустые места и парк ↑
        </text>
      </svg>
      <p className="chart-help">
        Ось А объединяет ожидание, отказы в посадке и очереди. Ось Б — пустые
        места и использование парка. Это взвешенные оценки, не минуты и не
        проценты; веса задаются в «Параметрах поиска». Исходное расписание может
        быть хуже найденных точек по обеим осям.
      </p>
    </figure>
  );
}
export function Options({
  result,
  onApply,
  network,
}: {
  result: any;
  onApply: (o: any) => void;
  network: Network;
}) {
  const [exporting, setExporting] = useState<number | null>(null),
    [exportError, setExportError] = useState("");
  return (
    <>
      <div className="option-grid">
        {result.options.map((o: any, i: number) => (
          <article
            key={o.name}
            className={`option ${i === 2 ? "recommended" : ""}`}
          >
            <span className="option-number">{i + 1}</span>
            <h3>{o.name}</h3>
            <b>
              {fmt(o.metrics.W, 1)} <small>с ожидания</small>
            </b>
            <p>
              Пустые места {fmt(o.metrics.E * 100, 1)}%<br />
              Использовано поездов: {fmt(o.metrics.used_trains, 1)} в среднем
              <br />
              {Math.abs(o.metrics.W - result.baseline.metrics.W) < 0.05
                ? "Ожидание как в исходном варианте"
                : `Ожидание ${o.metrics.W < result.baseline.metrics.W ? "меньше" : "больше"} на ${fmt(Math.abs(o.metrics.W - result.baseline.metrics.W), 1)} с`}
              <br />
              Разброс ожидания между прогонами: {fmt(o.std.W, 1)} с
            </p>
            <button data-testid={`option-${i}`} onClick={() => onApply(o)}>
              Запустить вариант ↗
            </button>
            {i !== 3 && (
              <button
                data-testid={`export-option-${i}`}
                disabled={exporting !== null}
                onClick={async () => {
                  setExporting(i);
                  setExportError("");
                  try {
                    await downloadComparison(network, result.baseline, o);
                  } catch (error: any) {
                    setExportError(
                      `Не удалось сохранить Excel: ${error.message}`,
                    );
                  } finally {
                    setExporting(null);
                  }
                }}
              >
                {exporting === i ? "Готовим Excel…" : "↓ Сравнить в Excel"}
              </button>
            )}
          </article>
        ))}
      </div>
      {exportError && (
        <p className="message error" role="alert">
          {exportError}
        </p>
      )}
      <p className="result-note">
        Показатели карточек усреднены по нескольким случайным прогонам. Поэтому
        среднее число использованных поездов может быть дробным. После выбора
        карта показывает один прогон, и числа могут немного отличаться.
      </p>
      <Pareto result={result} />
      <p className="result-note">
        Завершено поколений: {result.generations_completed}. Расчётов симуляции:{" "}
        {result.evaluations}. Время поиска: {fmt(result.compute_seconds, 1)} с.{" "}
        {result.od_source === "model"
          ? "направления поездок рассчитаны моделью"
          : "направления поездок из файла"}{" "}
        ·{" "}
        {result.stop_reason === "time_budget"
          ? "остановка по бюджету времени"
          : result.stop_reason === "evaluation_budget"
            ? "достигнут максимум оценок"
            : "завершён заданный поиск"}
      </p>
    </>
  );
}
