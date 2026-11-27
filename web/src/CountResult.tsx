import type { Network } from "./model";
import { clock, setting, value } from "./model";
import { numberText, durationText } from "./uiText";

export default function CountResult({
  result,
  network,
}: {
  result: any;
  network: Network;
}) {
  const found = result.simulation,
    d = result.diagnostics;
  const line = network.lines.find((l) => l.id === result.line_id);
  const start =
    setting(network, "day_start_s") +
    result.period_index * value(network.schedule?.period_len_min, 60) * 60;
  const end = Math.min(
    setting(network, "day_end_s"),
    start + value(network.schedule?.period_len_min, 60) * 60,
  );
  const threshold = setting(network, "service_targets.max_denied_share");
  return (
    <section className="count-result" aria-label="Результат подбора поездов">
      <h3>
        {found ? "Подходящий вариант найден" : "Подходящий вариант не найден"}
      </h3>
      <p>
        {line?.name ?? result.line_id}, период {clock(start)}–{clock(end)}.
        Остальные ветки и периоды сохранены.
      </p>
      {found ? (
        <div className="count-summary">
          <div>
            <span>Число поездов</span>
            <strong>{found.trains}</strong>
            <span>на всю ветку, оба направления</span>
          </div>
          <div>
            <span>Интервал в расписании</span>
            <strong>{durationText(found.headway_s)}</strong>
            <span>
              {numberText(found.headway_s, 0)} секунд между выпусками в каждом
              направлении
            </span>
          </div>
        </div>
      ) : (
        <p className="count-failure">
          {d
            ? "Среди проверенных сочетаний поездов и интервалов нет варианта, который выполнил все условия ниже."
            : `Доступное число поездов для этой ветки: ${result.available_fleet}. Проверяемые варианты не помещаются в общий парк. Уменьшите запрошенное число или измените распределение поездов.`}
        </p>
      )}
      <p>
        <b>Идеальная оценка по обороту:</b>{" "}
        {result.formula_trains == null
          ? "не определена без подходящего интервала"
          : `число поездов — ${result.formula_trains}`}
        . Она учитывает движение, минимальные стоянки и развороты, но не спрос и
        блокировки. Это ориентир; проверка на конечном периоде может дать как
        большее, так и меньшее число.
      </p>
      {d && (
        <>
          <h4>
            Проверка обслуживания{!found && " последнего проверенного варианта"}
          </h4>
          {!found && (
            <p>
              Число поездов: {d.trains}, интервал {durationText(d.headway_s)}.
            </p>
          )}
          <ul className="service-checks">
            <li>
              <b>{d.deadlock ? "Не выполнено" : "Выполнено"}:</b> нет взаимной
              блокировки поездов или прогона без единого выпуска.
            </li>
            <li>
              <b>{d.releases > 0 ? "Выполнено" : "Не выполнено"}:</b> в
              выбранном периоде{" "}
              {d.releases > 0
                ? "были выпуски поездов"
                : "не было выпусков поездов"}
              .
            </li>
            <li>
              <b>
                {d.release_delay_s <= 0.1 * d.headway_s
                  ? "Выполнено"
                  : "Не выполнено"}
                :
              </b>{" "}
              средняя задержка выпуска {numberText(d.release_delay_s)} с при
              допустимых {numberText(0.1 * d.headway_s)} с (10% интервала).
            </li>
            <li>
              <b>
                {d.denied_share <= threshold ? "Выполнено" : "Не выполнено"}:
              </b>{" "}
              отказы на 100 успешных посадок:{" "}
              {numberText(100 * d.denied_share, 2)}; допустимый максимум —{" "}
              {numberText(100 * threshold, 2)}. Повторные отказы учитываются.
            </li>
          </ul>
          <details className="count-details">
            <summary>Что влияло на работу поездов</summary>
            <p>
              Суммарное дополнительное время всех поездов за выбранный период.
              Число случайных прогонов для усреднения: {result.seeds.length}.
              Это не задержка одного поезда: если два поезда ждали по 10 секунд,
              здесь будет 20 секунд.
            </p>
            <dl className="diagnostic-list">
              <div>
                <dt>Посадка и высадка</dt>
                <dd>{numberText(d.boarding_s)} с</dd>
              </div>
              <div>
                <dt>Случайные задержки на остановках</dt>
                <dd>{numberText(d.random_delay_s)} с</dd>
              </div>
              <div>
                <dt>Ожидание свободных перегонов и платформ</dt>
                <dd>{numberText(d.blocking_s)} с</dd>
              </div>
              <div>
                <dt>Из этого — на общих участках веток</dt>
                <dd>{numberText(d.shared_blocking_s)} с</dd>
              </div>
              <div>
                <dt>Посадки и высадки, суммарное число действий</dt>
                <dd>≈{numberText(d.passenger_exchange, 0)}</dd>
              </div>
            </dl>
            <p>
              Посадки и высадки не равны числу уникальных пассажиров. Время на
              общих участках уже включено в общее время блокировок.
            </p>
          </details>
        </>
      )}
      <p>
        Проверено вариантов: {result.checked.length}. Случайных прогонов на
        каждый вариант: {result.seeds.length}. Для ветки доступно поездов:{" "}
        {result.available_fleet}.
      </p>
      <p>
        {found ? (
          <>
            <b>Результат не применён.</b> Перенесите найденный парк и интервал в
            расписание и нажмите «Запустить симуляцию».
          </>
        ) : (
          <>
            Попробуйте увеличить общий парк, изменить распределение поездов или
            расширить диапазон интервалов поиска.
          </>
        )}
      </p>
    </section>
  );
}
