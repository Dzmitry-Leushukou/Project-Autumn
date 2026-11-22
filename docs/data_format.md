# Формат сети 1.0

Полная машинная схема: `data_io/network.schema.json`. Примеры: шесть JSON в `datasets/synthetic/`. Это единственный формат сети; CSV импортирует только спрос.

Обязательны `meta` (name, synthetic), `stations` (id, name, x, y), `lines` (id, name, color, stations), `segments` (from, to и length_m или run_time_s), `fleet`, `demand`. Координаты 0–1000, время в секундах от полуночи, demand.start_min/len_min в минутах. Число периодов = ceil((day_end_s-day_start_s)/(period_len_min*60)). Кольцо замыкается без повторения первой станции.

Числовое значение допускает запись `{"value": 750, "source": "estimate"}`. Источники: data / estimate / assumption / user. Число без тега — явное пользовательское значение, а не свидетельство реальных данных. Отчёт валидатора содержит `sources` по путям JSON. Применённые defaults перечислены в `assumptions`; незаданные обязательные параметры — в `missing` и `errors`. `fleet_assignment` можно опустить: он будет вычислен по времени оборота, с явным источником assumption. Пропуски спроса означают 0 и дают предупреждение, не ошибку (конкретное правило раздела 5).

Отчёт: `errors`, `warnings`, `missing`, `assumptions` — списки `{path,message,...}`. Ошибки блокируют расчёт. Нормализованная модель хранится отдельно от исходного JSON; read/write сохраняют исходные теги без потерь.

Минимальный фрагмент записи перегона: `{"from":"A","to":"B","length_m":{"value":900,"source":"user"}}`. Полный минимально изменяемый пример — `a_simple.json`.
