import type { Network } from "./model";
import { setting, value } from "./model";

// Use the search snapshot, not the subsequently edited network in the UI.
export async function comparisonWorkbook(
  network: Network,
  baseline: any,
  option: any,
) {
  const ExcelJS = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.creator = "Metro Lab";
  const plan = book.addWorksheet("Интервалы", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  plan.columns = [
    { header: "Ветка", key: "line", width: 22 },
    { header: "Начало", key: "start", width: 29 },
    { header: "Конец", key: "end", width: 29 },
    { header: "Исходный интервал, с", key: "old", width: 24 },
    { header: "Новый интервал, с", key: "next", width: 24 },
    { header: "Разница, с", key: "delta", width: 18 },
    { header: "Разница, %", key: "percent", width: 18 },
    { header: "Исходный парк", key: "fleetOld", width: 20 },
    { header: "Новый парк", key: "fleetNext", width: 20 },
  ];
  const start = setting(network, "day_start_s"),
    end = setting(network, "day_end_s"),
    span = value(network.schedule?.period_len_min, 60) * 60;
  const timeFormat = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    return days === 0
      ? "hh:mm"
      : days === 1
        ? 'hh:mm" (следующий день)"'
        : `hh:mm" (+${days} дн.)"`;
  };
  for (const line of network.lines) {
    const old = baseline.headways[line.id],
      next = option.headways[line.id];
    if (!old || !next || old.length !== next.length)
      throw new Error("Периоды исходного и нового расписаний не совпадают.");
    for (let p = 0; p < old.length; p++) {
      const before = value(old[p]),
        after = value(next[p]),
        rowNumber = plan.rowCount + 1;
      const a = start + p * span,
        b = Math.min(end, a + span);
      const row = plan.addRow({
        line: line.name,
        start: a / 86400,
        end: b / 86400,
        old: before,
        next: after,
        delta: {
          formula: `E${rowNumber}-D${rowNumber}`,
          result: after - before,
        },
        percent: {
          formula: `IF(D${rowNumber}=0,"",F${rowNumber}/D${rowNumber})`,
          result: before ? (after - before) / before : "",
        },
        fleetOld: baseline.fleet_assignment[line.id],
        fleetNext: option.fleet_assignment[line.id],
      });
      row.getCell(2).numFmt = timeFormat(a);
      row.getCell(3).numFmt = timeFormat(b);
      row.getCell(7).numFmt = "0.0%";
    }
  }
  const metrics = book.addWorksheet("Показатели", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  metrics.columns = [
    { header: "Показатель", key: "name", width: 42 },
    { header: "Единица", key: "unit", width: 16 },
    { header: "Исходный план", key: "old", width: 24 },
    { header: "Новый план", key: "next", width: 24 },
    { header: "Разница", key: "delta", width: 22 },
  ];
  const fields: [string, string, string, number][] = [
    ["Среднее ожидание", "с", "W", 1],
    ["Завершили поездку", "чел.", "transported", 1],
    ["Не завершили поездку", "чел.", "unfinished", 1],
    ["Средняя загрузка поездов", "%", "LF", 100],
    ["Пустые места", "%", "E", 100],
    ["Использовано поездов, среднее", "поездов", "used_trains", 1],
    ["Средняя задержка выпуска", "с", "release_delay_s", 1],
    ["Отказов на появившегося пассажира", "отказов/чел.", "D", 1],
    ["Пиковая очередь / вместимость", "раз", "Qn", 1],
  ];
  for (const [name, unit, key, multiplier] of fields) {
    const a = baseline.metrics[key],
      b = option.metrics[key];
    const old = Number.isFinite(a) ? a * multiplier : null,
      next = Number.isFinite(b) ? b * multiplier : null,
      n = metrics.rowCount + 1;
    metrics.addRow({
      name,
      unit,
      old,
      next,
      delta:
        old === null || next === null
          ? null
          : { formula: `D${n}-C${n}`, result: next - old },
    });
  }
  for (const sheet of [plan, metrics]) {
    sheet.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: sheet.rowCount, column: sheet.columnCount },
    };
    sheet.eachRow((row, index) => {
      row.height = index === 1 ? 34 : 25;
      row.eachCell((cell) => {
        cell.font = { name: "Arial", size: 11, color: { argb: "FF1F2A37" } };
        cell.alignment = { vertical: "middle", wrapText: index === 1 };
        if (index === 1) {
          cell.font = {
            name: "Arial",
            size: 11,
            bold: true,
            color: { argb: "FFFFFFFF" },
          };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF1F2A37" },
          };
        }
      });
    });
  }
  for (let row = 2; row <= metrics.rowCount; row++)
    for (let col = 3; col <= 5; col++)
      metrics.getCell(row, col).numFmt = "0.00";
  return book.xlsx.writeBuffer();
}

export async function downloadComparison(
  network: Network,
  baseline: any,
  option: any,
) {
  const buffer = await comparisonWorkbook(network, baseline, option);
  const url = URL.createObjectURL(
    new Blob([buffer as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `metro-comparison-${option.name.replace(/[<>:"/\\|?*]/g, "-")}.xlsx`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
