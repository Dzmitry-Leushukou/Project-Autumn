// Теоретические графики справки: расчёт вероятностей, без выборок и изменения симуляции.
export type Point = { x: number; y: number; label?: string };

export function poissonMass(mean: number): Point[] {
  if (mean === 0) return [{ x: 0, y: 1 }];
  const first = Math.max(0, Math.floor(mean - 6 * Math.sqrt(mean))),
    last = Math.ceil(mean + 6 * Math.sqrt(mean) + 6);
  let logFactorial = 0;
  const points = [];
  for (let k = 0; k <= last; k++) {
    if (k > 0) logFactorial += Math.log(k);
    if (k >= first)
      points.push({
        x: k,
        y: Math.exp(k * Math.log(mean) - mean - logFactorial),
      });
  }
  return points;
}

export function normalDensity(x: number) {
  return Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI);
}

export function lognormalParameters(mean: number, std: number) {
  const variance = Math.log1p((std / mean) ** 2);
  return { mu: Math.log(mean) - variance / 2, sigma: Math.sqrt(variance) };
}

export function lognormalDensity(x: number, mean: number, std: number) {
  if (x <= 0 || std === 0) return 0;
  const { mu, sigma } = lognormalParameters(mean, std);
  if (sigma === 0) return 0;
  return (
    Math.exp(-((Math.log(x) - mu) ** 2) / (2 * sigma * sigma)) /
    (x * sigma * Math.sqrt(2 * Math.PI))
  );
}

export function lognormalCurve(
  mean: number,
  std: number,
  max: number,
): Point[] {
  const { mu, sigma } = lognormalParameters(mean, std);
  if (sigma === 0) return [{ x: mean, y: 1 }];
  return [
    { x: 0, y: 0 },
    ...curve(mu - 5 * sigma, mu + 3.5 * sigma, (logX) =>
      lognormalDensity(Math.exp(logX), mean, std),
    ).map((p) => ({ x: Math.exp(p.x), y: p.y })),
    { x: max, y: lognormalDensity(max, mean, std) },
  ];
}

export function bernoulliMass(probability: number): Point[] {
  return [
    { x: 0, y: 1 - probability, label: "Нет" },
    { x: 1, y: probability, label: "Да" },
  ];
}

export function mutationMass(): Point[] {
  return [-4, -3, -2, -1, 1, 2, 3, 4].map((x) => ({ x, y: 1 / 8 }));
}

export function gravityShares(beta: number): Point[] {
  const weights = [3000 * 600 ** -beta, 1000 * 200 ** -beta];
  const total = weights[0] + weights[1];
  return weights.map((w, x) => ({
    x,
    y: w / total,
    label: `Назначение ${x + 1}`,
  }));
}

export function logitShares(theta: number): Point[] {
  const first = 1 / (1 + Math.exp(-theta * 60));
  return [
    { x: 0, y: first, label: "Маршрут 1" },
    { x: 1, y: 1 - first, label: "Маршрут 2" },
  ];
}

export function curve(
  a: number,
  b: number,
  density: (x: number) => number,
): Point[] {
  return Array.from({ length: 241 }, (_, i) => {
    const x = a + ((b - a) * i) / 240;
    return { x, y: density(x) };
  });
}
