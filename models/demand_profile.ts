/**
 * Синтетический профиль спроса для конструктора, а не наблюдения метро.
 * mid — середина 15-минутного интервала в минутах от начала первого дня.
 * Утро: exp(-(mid-510)²/(2*75²)); вечер: exp(-(mid-1080)²/(2*90²)).
 * flat = 1; morning = 0.25 + 0.9*утро; peaks = 0.25 + 0.75*утро + 0.9*вечер.
 * Вход интервала = peak * multiplier. Пики: 08:30 и 18:00.
 * Вызывается web/src/model.ts → demandProfile из панели станции.
 */
export function demandMultiplier(mid: number, profile: string) {
  const morning = Math.exp(-((mid - 510) ** 2) / (2 * 75 ** 2)),
    evening = Math.exp(-((mid - 1080) ** 2) / (2 * 90 ** 2));
  return profile === "flat"
    ? 1
    : profile === "morning"
      ? 0.25 + 0.9 * morning
      : 0.25 + 0.75 * morning + 0.9 * evening;
}
