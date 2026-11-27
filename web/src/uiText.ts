import type { Network } from "./model";
import { clock } from "./model";

export const numberText = (v: number, digits = 1) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(v);

export function durationText(seconds: number) {
  if (seconds < 60) return `${numberText(seconds)} с`;
  const minutes = Math.floor(seconds / 60),
    rest = seconds % 60;
  return `${minutes} мин${rest > 0.05 ? ` ${numberText(rest)} с` : ""}`;
}

export function directionText(
  network: Network,
  lineId: string,
  direction: number,
) {
  const line = network.lines.find((l) => l.id === lineId);
  if (!line) return "Неизвестная ветка";
  if (line.is_loop)
    return direction === 1 ? "По порядку станций кольца" : "Обратно по кольцу";
  const id = line.stations[direction === 1 ? line.stations.length - 1 : 0];
  return `К ${network.stations.find((s) => s.id === id)?.name ?? id}`;
}

export const fieldHelp: Record<string, string> = {
  "routes.margin":
    "Насколько маршрут может быть длиннее кратчайшего. 30% допускает альтернативы до 1,3 его стоимости; 0% оставляет один путь.",
  "routes.theta":
    "Чем больше коэффициент, тем сильнее предпочтение маршрута с меньшим временем, ожиданием и пересадками. При 0 пути равновероятны. Единица: 1/с.",
  "routes.transfer_penalty_s":
    "Не реальная задержка: так модель учитывает неудобство пересадки при выборе маршрута. Например, 300 с равнозначны дополнительным 5 минутам в оценке пути.",
  "routes.diversity":
    "Насколько различаются предпочтения пассажиров. При 0 все одинаковы; большее значение увеличивает разброс чувствительности и отношения к пересадкам.",
  "routes.classes":
    "Количество групп с разными предпочтениями, по которым усредняется выбор пути. Это не число пассажиров и не классы вагонов.",
  seed: "Номер случайного сценария. Одинаковый номер и настройки позволяют повторить прогон. Это не количество запусков.",
  "delays.p0":
    "Вероятность при посадке и высадке суммарно стольких людей, сколько вмещает поезд. При меньшем обмене шанс ниже; при отсутствии обмена равен нулю.",
  "delays.mean_s":
    "Средняя длительность, только если задержка случилась. Она не добавляется на каждой остановке.",
  "delays.std_s":
    "Стандартное отклонение длительности задержки: чем больше, тем сильнее она отличается от среднего. При 0 длительность постоянна.",
  "optimizer.population":
    "Максимум вариантов расписания в одном поколении алгоритма. Фактическое число ограничено общим лимитом проверок.",
  "optimizer.generations":
    "Максимум раундов улучшения расписаний. Поиск может завершиться раньше по числу проверок или времени.",
  "optimizer.time_budget_s":
    "Предельное время поиска. Если оно закончится, будут показаны только полностью проверенные варианты с предупреждением о частичном результате.",
  "optimizer.evaluation_budget":
    "Максимум проверяемых кандидатов. Каждый кандидат рассчитывается несколько раз со случайностью. Исходное расписание оценивается отдельно.",
  "optimizer.seeds_search":
    "Сколько случайных прогонов усреднить для оценки одного варианта во время поиска.",
  "optimizer.seeds_final":
    "Сколько случайных прогонов усреднить для итоговых карточек и подбора числа поездов. Больше прогонов — устойчивее оценка, но дольше расчёт.",
  "optimizer.headway_min_s":
    "Самый короткий интервал, который разрешено пробовать алгоритму. Занятые перегоны всё равно могут задержать поезда.",
  "optimizer.headway_max_s":
    "Самый длинный разрешённый интервал поиска. Эти границы не меняют исходное пользовательское расписание.",
  "optimizer.headway_step_s":
    "Допустимые интервалы кратны этому шагу. Например, при шаге 15 с алгоритм пробует 180, 195, 210 с.",
  "optimizer.weights_a.wait":
    "Множитель среднего времени ожидания в пассажирской цели. Вместе со следующими двумя весами определяет приоритет обслуживания.",
  "optimizer.weights_a.denied":
    "Штраф за отказ в посадке из-за заполненного поезда. При весе ожидания 1 значение 120 приравнивает один отказ на пассажира к 120 с ожидания.",
  "optimizer.weights_a.queue":
    "Штраф за пиковую очередь размером с целый поезд. При весе ожидания 1 значение 30 приравнивает такую очередь к 30 с ожидания.",
  "optimizer.weights_b.empty":
    "Вклад доли пустых мест в оценку ресурсов. Увеличьте, если важнее избегать полупустых поездов.",
  "optimizer.weights_b.fleet":
    "Вклад доли задействованных поездов в оценку ресурсов. Увеличьте, если важнее оставлять часть парка в резерве.",
  "service_targets.max_denied_share":
    "Порог только для подбора числа поездов: отказы / успешные посадки на выбранной ветке за период. Повторные отказы считаются повторно. Это не доля уникальных людей.",
  group_step_s:
    "Как часто модель создаёт новые группы пассажиров. Это не шаг движения поездов и не скорость анимации. Меньший шаг точнее учитывает изменения спроса, но увеличивает время расчёта.",
  od_beta:
    "Насколько сильно удалённость уменьшает привлекательность назначения. При 0 влияет только популярность станции; при большем значении чаще выбираются близкие станции.",
};

const parameterNames: Record<string, string> = {
  length_m: "Длина перегона",
  run_time_s: "Время хода",
  max_speed_mps: "Максимальная скорость",
  capacity: "Вместимость поезда",
  acceleration_mps2: "Ускорение",
  deceleration_mps2: "Замедление",
  turnaround_s: "Разворот",
  dwell_base_s: "Минимальная стоянка",
  boarding_rate_pps: "Посадка и высадка",
  platform_doors: "Платформенные двери",
  door_open_s: "Открытие дверей",
  door_close_s: "Закрытие дверей",
  walk_time_s: "Пеший переход",
  day_start_s: "Начало работы",
  day_end_s: "Конец работы",
  group_step_s: "Период появления пассажиров",
  od_beta: "Влияние удалённости назначения",
  theta: "Чувствительность ко времени",
  margin: "Допустимый обход",
  diversity: "Различия пассажиров",
  classes: "Группы предпочтений",
  max_routes: "Максимум маршрутов",
  transfer_penalty_s: "Неудобство пересадки",
  p0: "Базовая вероятность задержки",
  mean_s: "Средняя задержка",
  std_s: "Разброс задержки",
  population: "Вариантов в поколении",
  generations: "Поколения поиска",
  time_budget_s: "Лимит времени поиска",
  evaluation_budget: "Лимит проверок расписаний",
  seeds_search: "Прогонов при поиске",
  seeds_final: "Прогонов в итоговой оценке",
  headway_min_s: "Минимальный интервал",
  headway_max_s: "Максимальный интервал",
  headway_step_s: "Шаг интервалов",
  max_denied_share: "Допустимый уровень отказов",
  period_len_min: "Длительность периода",
  seed: "Номер случайного сценария",
  fleet: "Общее число поездов",
  fleet_assignment: "Распределение поездов по веткам",
  demand: "Входящий пассажиропоток",
  entries: "Число входящих пассажиров",
  trips: "Число поездок",
  start_min: "Начало интервала спроса",
  len_min: "Длительность интервала спроса",
  headways: "Интервалы движения",
  od_matrix: "Поездки между станциями",
  demand_noise: "Случайный вход пассажиров",
  x: "Координата X на схеме",
  y: "Координата Y на схеме",
  depot_station: "Станция депо",
  is_loop: "Кольцевая ветка",
  stations: "Станции ветки",
  synthetic: "Учебная сеть",
  format_version: "Версия файла сети",
  wait: "Вес ожидания",
  denied: "Вес отказов в посадке",
  queue: "Вес очереди",
  empty: "Вес пустых мест",
};

export function parameterName(path: string, network: Network) {
  const parts = path.split("."),
    collection = parts[0],
    index = Number(parts[1]);
  let owner = "";
  if (Number.isInteger(index)) {
    if (collection === "stations")
      owner = network.stations[index]?.name ?? `Станция ${index + 1}`;
    if (collection === "lines")
      owner = network.lines[index]?.name ?? `Ветка ${index + 1}`;
    if (collection === "segments") {
      const s = network.segments[index];
      owner = s ? `${s.from} — ${s.to}` : `Перегон ${index + 1}`;
    }
    if (collection === "demand")
      owner = `Спрос ${network.demand[index]?.station ?? ""}, запись ${index + 1}`;
  }
  const last = parts.at(-1)!;
  if (path.includes("weights_b.fleet")) return "Вес использования парка";
  if (parts[0] === "schedule" && parts[1] === "headways")
    return `Интервалы: ${network.lines.find((l) => l.id === parts[2])?.name ?? parts[2] ?? "расписание"}`;
  return [owner, parameterNames[last] ?? last].filter(Boolean).join(": ");
}

export function parameterValue(
  path: string,
  value: any,
  network: Network,
): string {
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (Array.isArray(value)) {
    if (path.includes("headways")) {
      const times = value.map((v) => (typeof v === "object" ? v.value : v));
      if (!times.length) return "Нет интервалов";
      return times.every((v) => v === times[0])
        ? `Каждый период: ${durationText(times[0])}`
        : times.map((v, i) => `Период ${i + 1}: ${durationText(v)}`).join("; ");
    }
    return value.join(", ");
  }
  if (value !== null && typeof value === "object")
    return Object.entries(value)
      .map(
        ([key, v]) =>
          `${network.lines.find((l) => l.id === key)?.name ?? key}: ${parameterValue(`${path}.${key}`, v, network)}`,
      )
      .join("; ");
  if (typeof value !== "number") return String(value);
  const key = path.split(".").at(-1)!;
  if (key === "day_start_s" || key === "day_end_s") return clock(value);
  if (key === "margin" || key === "p0") return `${numberText(100 * value)}%`;
  if (key === "max_denied_share")
    return `${numberText(100 * value)} на 100 успешных посадок`;
  if (key.endsWith("_s")) return durationText(value);
  if (key.endsWith("_min")) return `${numberText(value)} мин`;
  if (key.endsWith("_mps2")) return `${numberText(value)} м/с²`;
  if (key.endsWith("_mps")) return `${numberText(value)} м/с`;
  if (key.endsWith("_pps")) return `${numberText(value)} чел./с`;
  if (key.endsWith("_m")) return `${numberText(value)} м`;
  return numberText(value, 4);
}

export function validationMessage(message: string) {
  if (message.startsWith("Input should be greater than or equal to"))
    return `Значение должно быть не меньше ${message.split(" ").at(-1)}.`;
  if (message.startsWith("Input should be greater than"))
    return `Значение должно быть больше ${message.split(" ").at(-1)}.`;
  if (message.startsWith("Input should be less than or equal to"))
    return `Значение должно быть не больше ${message.split(" ").at(-1)}.`;
  if (message.includes("valid integer")) return "Введите целое число.";
  if (message.includes("valid number") || message.includes("finite number"))
    return "Введите корректное конечное число.";
  if (message === "Field required") return "Обязательное поле не заполнено.";
  if (message.startsWith("Extra inputs"))
    return "В файле есть неизвестное поле. Проверьте формат JSON.";
  return message;
}
