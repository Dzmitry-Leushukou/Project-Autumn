import { useState } from "react";
import type { Network } from "./model";
import { setting, clock } from "./model";
import { demandMultiplier } from "../../models/demand_profile";
import MathFormula from "./MathFormula";
import {
  bernoulliMass,
  curve,
  gravityShares,
  logitShares,
  lognormalCurve,
  lognormalParameters,
  mutationMass,
  normalDensity,
  poissonMass,
  type Point,
} from "./distributionMath";

const number = (value: number) =>
  new Intl.NumberFormat("ru-RU", {
    notation:
      Math.abs(value) >= 100000 ||
      (Math.abs(value) > 0 && Math.abs(value) < 0.0001)
        ? "scientific"
        : "standard",
    maximumFractionDigits: value < 0.01 && value !== 0 ? 4 : 2,
  }).format(value);

function initialGraphValue(
  network: Network,
  path: string,
  min: number,
  max: number,
) {
  const value = setting(network, path);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}

function Graph({
  title,
  points,
  discrete = false,
  probability = false,
  xLabel,
  yLabel,
  xRange,
  xFormat = number,
}: {
  title: string;
  points: Point[];
  discrete?: boolean;
  probability?: boolean;
  xLabel: string;
  yLabel: string;
  xRange?: [number, number];
  xFormat?: (x: number) => string;
}) {
  const width = 640,
    height = 260,
    left = 60,
    right = 24,
    top = 16,
    bottom = 66;
  const min = xRange?.[0] ?? (discrete ? points[0].x - 0.6 : points[0].x),
    max = xRange?.[1] ?? (discrete ? points.at(-1)!.x + 0.6 : points.at(-1)!.x),
    peak = probability ? 1 : Math.max(...points.map((p) => p.y)) * 1.12 || 1,
    plotWidth = width - left - right,
    plotHeight = height - top - bottom,
    x = (value: number) => left + ((value - min) / (max - min)) * plotWidth,
    y = (value: number) => top + plotHeight * (1 - value / peak),
    barWidth = Math.min(56, (plotWidth / (max - min)) * 0.68);
  const ticks = discrete
    ? points.length <= 10
      ? points
      : points.filter(
          (_, i) =>
            i % Math.max(1, Math.ceil(points.length / 7)) === 0 ||
            i === points.length - 1,
        )
    : Array.from({ length: 5 }, (_, i) => ({ x: min + ((max - min) * i) / 4 }));
  return (
    <svg
      className="distribution-graph"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <text x={left} y={12} className="graph-axis-title">
        {yLabel}
      </text>
      {[0, 0.5, 1].map((fraction) => (
        <g key={fraction}>
          <line
            x1={left}
            x2={width - right}
            y1={y(peak * fraction)}
            y2={y(peak * fraction)}
            className="graph-grid"
          />
          <text x={left - 10} y={y(peak * fraction) + 4} textAnchor="end">
            {number(peak * fraction)}
          </text>
        </g>
      ))}
      {discrete ? (
        points.map((p) => (
          <rect
            key={p.x}
            x={x(p.x) - barWidth / 2}
            y={y(p.y)}
            width={barWidth}
            height={Math.max(0, y(0) - y(p.y))}
            className="graph-bar"
          >
            <title>
              {p.label ?? xFormat(p.x)}: {number(p.y)}
            </title>
          </rect>
        ))
      ) : (
        <path
          className="graph-curve"
          d={points
            .map(
              (p, i) =>
                `${i ? "L" : "M"}${x(p.x).toFixed(3)},${y(p.y).toFixed(3)}`,
            )
            .join(" ")}
        />
      )}
      <line
        x1={left}
        x2={width - right}
        y1={y(0)}
        y2={y(0)}
        className="graph-axis"
      />
      {ticks.map((p, i) => (
        <text
          key={p.x}
          x={x(p.x)}
          y={height - bottom + 22}
          textAnchor={
            !discrete && i === 0
              ? "start"
              : !discrete && i === ticks.length - 1
                ? "end"
                : "middle"
          }
        >
          {"label" in p && typeof p.label === "string" ? p.label : xFormat(p.x)}
        </text>
      ))}
      <text
        x={left + plotWidth / 2}
        y={height - 10}
        textAnchor="middle"
        className="graph-axis-title"
      >
        {xLabel}
      </text>
    </svg>
  );
}

function Parameter({
  label,
  value,
  min,
  max,
  step = 0.1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const next = e.target.valueAsNumber;
          if (Number.isFinite(next))
            onChange(Math.max(min, Math.min(max, next)));
        }}
      />
    </label>
  );
}

function Plot({
  title,
  formula,
  where,
  children,
}: {
  title: string;
  formula?: string;
  where: string;
  children: React.ReactNode;
}) {
  return (
    <section className="distribution-plot" aria-label={title}>
      <h3>{title}</h3>
      <p className="distribution-use">{where}</p>
      {formula && (
        <div className="math-formulas">
          <MathFormula tex={formula} display />
        </div>
      )}
      {children}
    </section>
  );
}

function LognormalPlot({
  multiplier,
  network,
}: {
  multiplier?: boolean;
  network: Network;
}) {
  const [mean, setMean] = useState(
      multiplier ? 1 : initialGraphValue(network, "delays.mean_s", 0.1, 100),
    ),
    [std, setStd] = useState(
      multiplier
        ? initialGraphValue(network, "routes.diversity", 0, 2)
        : initialGraphValue(network, "delays.std_s", 0, 100),
    );
  const { mu, sigma } = lognormalParameters(mean, std);
  const constant = sigma === 0;
  const title = multiplier
    ? "Логнормальное — множители предпочтений"
    : "Логнормальное — длительность возникшей задержки";
  const xmax = constant
    ? mean * 2
    : Math.max(mean + 4 * std, Math.exp(mu + 3.5 * sigma));
  return (
    <Plot
      title={title}
      formula={String.raw`f(x)=\frac{1}{x\sigma\sqrt{2\pi}}\exp\!\left(-\frac{(\ln x-\mu)^2}{2\sigma^2}\right),\quad x>0,\ \sigma>0`}
      where={
        multiplier
          ? "Множители R и R′ в θₖ = θR и γₖ = γR′. Среднее 1, коэффициент вариации c. μ и σ — среднее и СКО ln R; f — плотность."
          : "X в δ = BX: длительность при B = 1. m и s — среднее и СКО X; μ и σ — среднее и СКО ln X; f — плотность. Вероятность возникновения задаётся отдельно распределением Бернулли."
      }
    >
      <fieldset className="distribution-parameters">
        <legend>Параметры графика</legend>
        {!multiplier && (
          <Parameter
            label="m, с"
            value={mean}
            min={0.1}
            max={100}
            onChange={setMean}
          />
        )}
        <Parameter
          label={multiplier ? "c — разнообразие" : "s, с"}
          value={std}
          min={0}
          max={multiplier ? 2 : 100}
          step={multiplier ? 0.05 : 0.1}
          onChange={setStd}
        />
        <output>
          μ = {number(mu)}; σ = {number(sigma)}
        </output>
      </fieldset>
      {constant && (
        <p className="distribution-use">
          Постоянное значение: {number(mean)}
          {multiplier ? "" : " с"}. Вероятность 1.
        </p>
      )}
      <Graph
        title={title}
        points={lognormalCurve(mean, std, xmax)}
        discrete={constant}
        probability={constant}
        xRange={[0, xmax]}
        xLabel={multiplier ? "Множитель R" : "Длительность X, с"}
        yLabel={
          constant
            ? "Вероятность"
            : multiplier
              ? "Плотность вероятности"
              : "Плотность, 1/с"
        }
      />
    </Plot>
  );
}

export default function DistributionPlots({
  model,
  network,
}: {
  model: string;
  network: Network;
}) {
  const [mean, setMean] = useState(20),
    [probability, setProbability] = useState(
      initialGraphValue(network, "delays.p0", 0, 1),
    ),
    [exchange, setExchange] = useState(1),
    [beta, setBeta] = useState(initialGraphValue(network, "od_beta", 0, 5)),
    [theta, setTheta] = useState(
      initialGraphValue(network, "routes.theta", 0, 0.1),
    ),
    [profile, setProfile] = useState("peaks");
  switch (model) {
    case "demand":
      return (
        <Plot
          title="Пуассон — число входящих за шаг"
          formula={String.raw`P(N=k)=e^{-\lambda}\frac{\lambda^k}{k!},\quad k=0,1,2,\ldots`}
          where="Nᵢ в генерации спроса при включённом шуме. λ — ожидаемое число пассажиров за один шаг; график показывает теоретические вероятности, не измеренный поток."
        >
          <fieldset className="distribution-parameters">
            <legend>Параметры примера</legend>
            <Parameter
              label="λ — пассажиров за шаг"
              value={mean}
              min={0}
              max={200}
              step={1}
              onChange={setMean}
            />
          </fieldset>
          <Graph
            title="Пуассон — число входящих за шаг"
            points={poissonMass(mean)}
            discrete
            xLabel="Число входящих k, чел."
            yLabel="Вероятность P(N = k)"
          />
        </Plot>
      );
    case "passenger-classes":
      return (
        <>
          <Plot
            title="Нормальное — исходные отклонения классов"
            formula={String.raw`z,z'\sim\mathcal N(0,1),\qquad\varphi(z)=\frac{e^{-z^2/2}}{\sqrt{2\pi}}`}
            where="zₖ и z′ₖ перед логнормальным преобразованием чувствительности θₖ и штрафа γₖ. Среднее 0, СКО 1."
          >
            <Graph
              title="Нормальное — исходные отклонения классов"
              points={curve(-4, 4, normalDensity)}
              xLabel="Отклонение z"
              yLabel="Плотность вероятности"
            />
          </Plot>
          <LognormalPlot multiplier network={network} />
        </>
      );
    case "delays": {
      const p = Math.min(1, probability * exchange);
      return (
        <>
          <Plot
            title="Бернулли — возникновение задержки"
            formula={String.raw`P(B=1)=p,\quad P(B=0)=1-p,\qquad p=\min(1,p_0x/C)`}
            where="B решает, добавится ли задержка на остановке. x = n_on + n_off — пассажирообмен, C — вместимость; при B = 0 добавка δ равна 0."
          >
            <fieldset className="distribution-parameters">
              <legend>Параметры графика</legend>
              <Parameter
                label="p₀, %"
                value={probability * 100}
                min={0}
                max={100}
                step={1}
                onChange={(v) => setProbability(v / 100)}
              />
              <Parameter
                label="x / C — обмен / вместимость"
                value={exchange}
                min={0}
                max={2}
                onChange={setExchange}
              />
              <output>p = {number(p * 100)}%</output>
            </fieldset>
            <Graph
              title="Бернулли — возникновение задержки"
              points={bernoulliMass(p)}
              discrete
              probability
              xLabel="Возникла задержка B"
              yLabel="Вероятность"
            />
          </Plot>
          <LognormalPlot network={network} />
        </>
      );
    }
    case "nsga2":
      return (
        <>
          <Plot
            title="Равномерное — выбор при скрещивании"
            formula={String.raw`U\sim\operatorname{Uniform}[0,1),\quad f(u)=\begin{cases}1,&0\le u<1\\0,&\text{иначе}\end{cases}`}
            where="Для каждой ветки маска U < 0,5 выбирает одного из двух родителей с вероятностью 1/2. Индексы веток, периодов и участников турнира также выбираются равномерно."
          >
            <Graph
              title="Равномерное — выбор при скрещивании"
              points={[
                { x: -0.2, y: 0 },
                { x: 0, y: 0 },
                { x: 0, y: 1 },
                { x: 1, y: 1 },
                { x: 1, y: 0 },
                { x: 1.2, y: 0 },
              ]}
              xLabel="Значение U"
              yLabel="Плотность вероятности"
            />
          </Plot>
          <Plot
            title="Дискретное равномерное — шаг мутации"
            formula={String.raw`P(K=k)=\frac18,\qquad k\in\{-4,-3,-2,-1,1,2,3,4\}`}
            where="K в h′ = h + Ks_h. Все восемь ненулевых смещений равновероятны; после мутации интервал ограничивается границами поиска."
          >
            <Graph
              title="Дискретное равномерное — шаг мутации"
              points={mutationMass()}
              discrete
              xLabel="Число шагов K"
              yLabel="Вероятность P(K = k)"
            />
          </Plot>
        </>
      );
    case "gravity":
      return (
        <Plot
          title="Доли назначений"
          where="Масса пассажиров распределяется по P(j | i). Пример: w₁ = 3000, w₂ = 1000; d₁ = 600 с, d₂ = 200 с. Отдельная случайная жеребьёвка назначения не выполняется."
        >
          <fieldset className="distribution-parameters">
            <legend>Параметры примера</legend>
            <Parameter
              label="β — влияние удалённости"
              value={beta}
              min={0}
              max={5}
              onChange={setBeta}
            />
          </fieldset>
          <Graph
            title="Доли назначений"
            points={gravityShares(beta)}
            discrete
            probability
            xLabel="Станция назначения"
            yLabel="Доля пассажиров"
          />
        </Plot>
      );
    case "route-choice":
      return (
        <Plot
          title="Доли маршрутов по логиту"
          where="Детерминированное распределение массы по вероятностям. Пример для одного класса: T₁ = 600 с, T₂ = 660 с. В полной модели доли усредняются по классам."
        >
          <fieldset className="distribution-parameters">
            <legend>Параметры примера</legend>
            <Parameter
              label="θ — чувствительность, 1/с"
              value={theta}
              min={0}
              max={0.1}
              step={0.005}
              onChange={setTheta}
            />
          </fieldset>
          <Graph
            title="Доли маршрутов по логиту"
            points={logitShares(theta)}
            discrete
            probability
            xLabel="Маршрут"
            yLabel="Доля пассажиров"
          />
        </Plot>
      );
    case "demand-profile":
      return (
        <Plot
          title="Заданный профиль спроса"
          where="Гауссовы пики задают множитель входящего потока. Это кривая спроса по времени, а не плотность вероятности."
        >
          <fieldset className="distribution-parameters">
            <legend>Параметры графика</legend>
            <label>
              <span>Профиль</span>
              <select
                aria-label="Профиль"
                value={profile}
                onChange={(e) => setProfile(e.target.value)}
              >
                <option value="peaks">Два пика</option>
                <option value="morning">Утренний</option>
                <option value="flat">Ровный</option>
              </select>
            </label>
          </fieldset>
          <Graph
            title="Заданный профиль спроса"
            points={curve(0, 1440, (t) => demandMultiplier(t, profile))}
            xLabel="Время суток"
            yLabel="Множитель потока m(t)"
            xFormat={(t) =>
              t === 1440 ? "00:00 (+1 день)" : clock(t * 60, false)
            }
          />
        </Plot>
      );
    default:
      return null;
  }
}
