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
        <small>Ни одна точка не улучшает обе цели одновременно</small>
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
    </figure>
  );
}
export function Options({
  result,
  onApply,
}: {
  result: any;
  onApply: (o: any) => void;
}) {
  return (
    <>
      <div className="option-grid">
        {result.options.map((o: any, i: number) => (
          <article
            key={o.name}
            className={`option ${i === 2 ? "recommended" : ""}`}
          >
            <span className="option-number">
              0{i + 1}
              {i === 2 ? " / БАЛАНС" : ""}
            </span>
            <h3>{o.name}</h3>
            <b>
              {fmt(o.metrics.W, 1)} <small>с ожидания</small>
            </b>
            <p>
              Пустые места {fmt(o.metrics.E * 100, 1)}%<br />
              Поездов {fmt(o.metrics.used_trains, 1)}
              <br />Δ ожидания {fmt(
                o.metrics.W - result.baseline.metrics.W,
                1,
              )}{" "}
              с<br />
              Разброс W ±{fmt(o.std.W, 1)} с
            </p>
            <button data-testid={`option-${i}`} onClick={() => onApply(o)}>
              Запустить вариант ↗
            </button>
          </article>
        ))}
      </div>
      <Pareto result={result} />
      <p className="result-note">
        {result.generations_completed} поколений · {result.evaluations}{" "}
        seed-прогонов · {fmt(result.compute_seconds, 1)} с ·{" "}
        {result.od_source === "model" ? "OD — модельные" : "OD — данные"} ·{" "}
        {result.stop_reason === "time_budget"
          ? "остановка по бюджету времени"
          : "завершён заданный поиск"}
      </p>
    </>
  );
}
