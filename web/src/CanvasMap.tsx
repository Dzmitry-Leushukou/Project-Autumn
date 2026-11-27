import { useEffect, useMemo, useRef, useState } from "react";
import type { Network, Trajectory } from "./model";
import type { ConnectionSelection } from "./topologyEditing";
import { value } from "./model";
import {
  queueIndex,
  queueAt,
  trainIndex,
  trainAt,
  passengerCount,
} from "./replay";
type Props = {
  network: Network;
  trajectory: Trajectory | null;
  metrics: any;
  clockRef: React.RefObject<{ time: number; playing: boolean; speed: number }>;
  onTime: (t: number) => void;
  editing: boolean;
  tool: string;
  onMapClick: (x: number, y: number, station?: string) => void;
  onConnectionDelete: (kind: "segment" | "transfer", index: number) => void;
  onConnectionSelect: (kind: "segment" | "transfer", index: number) => void;
  selectedConnection: ConnectionSelection | null;
  selected: string | null;
  heat: string;
};
export default function CanvasMap(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null),
    host = useRef<HTMLDivElement>(null),
    latest = useRef(props),
    geometry = useRef<any>(null),
    hits = useRef<any[]>([]),
    pointer = useRef<{ x: number; y: number } | null>(null),
    frames = useRef<number[]>([]);
  const [tooltip, setTooltip] = useState<any>(null);
  latest.current = props;
  const indexed = useMemo(() => {
    const trains = trainIndex(props.trajectory);
    const queues = queueIndex(props.trajectory).stations;
    return { trains, queues };
  }, [props.trajectory]);
  const indexRef = useRef(indexed);
  indexRef.current = indexed;
  useEffect(() => {
    let request = 0,
      last = performance.now(),
      lastReport = 0,
      lastTooltip = 0,
      width = 0,
      height = 0;
    const node = canvas.current!,
      container = host.current!;
    const resize = new ResizeObserver(() => {
      width = container.clientWidth;
      height = container.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      node.width = width * dpr;
      node.height = height * dpr;
      node.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    resize.observe(container);
    const draw = (stamp: number) => {
      const p = latest.current,
        ctx = node.getContext("2d")!,
        clock = p.clockRef.current;
      const elapsed = Math.min(0.1, (stamp - last) / 1000);
      last = stamp;
      if (clock.playing && p.trajectory) {
        clock.time = Math.min(
          p.trajectory.meta.simulation_end_s,
          clock.time + elapsed * clock.speed,
        );
        if (clock.time >= p.trajectory.meta.simulation_end_s)
          clock.playing = false;
        if (stamp - lastReport > 100 || !clock.playing) {
          p.onTime(clock.time);
          lastReport = stamp;
        }
      }
      const scale = Math.max(
          0.01,
          Math.min((width - 120) / 1000, (height - 100) / 1000),
        ),
        ox = (width - 1000 * scale) / 2,
        oy = (height - 1000 * scale) / 2;
      const project = (s: any) => ({
        x: ox + value(s.x) * scale,
        y: oy + value(s.y) * scale,
      });
      geometry.current = { scale, ox, oy, width, height };
      ctx.clearRect(0, 0, width, height);
      if (p.editing) {
        ctx.fillStyle = "#1f2a3712";
        for (let x = 0; x <= 1000; x += 50)
          for (let y = 0; y <= 1000; y += 50) {
            ctx.beginPath();
            ctx.arc(ox + x * scale, oy + y * scale, 1, 0, Math.PI * 2);
            ctx.fill();
          }
      }
      const stations = new Map(p.network.stations.map((s) => [s.id, s]));
      for (const [li, line] of p.network.lines.entries()) {
        const pairs = line.stations
          .slice(0, -1)
          .map((s: string, i: number) => [s, line.stations[i + 1]]);
        if (line.is_loop && line.stations.length > 2)
          pairs.push([line.stations.at(-1), line.stations[0]]);
        for (const [from, to] of pairs) {
          if (!stations.has(from) || !stations.has(to)) continue;
          const a = project(stations.get(from)),
            b = project(stations.get(to));
          ctx.beginPath();
          ctx.strokeStyle = line.color;
          ctx.lineWidth = 6;
          const dx = b.x - a.x,
            dy = b.y - a.y,
            d = Math.hypot(dx, dy) || 1;
          const shared =
            p.network.lines.filter(
              (l) => l.stations.includes(from) && l.stations.includes(to),
            ).length > 1;
          const shift = shared ? (li % 2 ? 3 : -3) : 0;
          ctx.moveTo(a.x - (dy / d) * shift, a.y + (dx / d) * shift);
          ctx.lineTo(b.x - (dy / d) * shift, b.y + (dx / d) * shift);
          ctx.stroke();
          if (p.heat === "segments") {
            ctx.strokeStyle = `rgba(31,42,55,${Math.min(0.8, p.metrics?.heatmap?.segments?.[`${from}|${to}`] ?? 0)})`;
            ctx.lineWidth = 13;
            ctx.stroke();
          }
        }
      }
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#68717c";
      for (const tr of p.network.transfers) {
        const a = stations.get(tr.from),
          b = stations.get(tr.to);
        if (!a || !b) continue;
        const u = project(a),
          v = project(b);
        ctx.beginPath();
        ctx.moveTo(u.x, u.y);
        ctx.lineTo(v.x, v.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      if (p.editing && p.selectedConnection) {
        const { kind, index } = p.selectedConnection;
        const edge = (
          kind === "segment" ? p.network.segments : p.network.transfers
        )[index];
        const from = edge && stations.get(edge.from),
          to = edge && stations.get(edge.to);
        if (from && to) {
          const a = project(from),
            b = project(to);
          ctx.beginPath();
          ctx.strokeStyle = "rgba(180,145,53,.65)";
          ctx.lineWidth = 11;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      const targets: any[] = [];
      for (const s of p.network.stations) {
        const a = project(s),
          interchange =
            p.network.lines.filter((l) => l.stations.includes(s.id)).length > 1,
          queue = p.metrics?.heatmap?.stations?.[s.id] ?? 0;
        if (p.heat === "queues") {
          ctx.beginPath();
          ctx.fillStyle = "rgba(31,42,55,.12)";
          ctx.arc(a.x, a.y, 10 + Math.min(25, queue * 20), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.fillStyle = "#fdfcf8";
        ctx.strokeStyle = "#1f2a37";
        ctx.lineWidth = s.id === p.selected ? 4 : interchange ? 3 : 1.8;
        ctx.arc(a.x, a.y, interchange ? 7 : 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (s.platform_doors) {
          ctx.fillStyle = "#1f2a37";
          ctx.fillRect(a.x - 3, a.y - 2, 2, 4);
          ctx.fillRect(a.x + 1, a.y - 2, 2, 4);
        }
        ctx.font = "11px system-ui";
        ctx.fillStyle = "#1f2a37";
        ctx.textAlign = "left";
        ctx.fillText(s.name, a.x + 11, a.y - 9);
        const q = indexRef.current.queues.get(s.id) ?? [];
        targets.push({
          ...a,
          type: "station",
          name: s.name,
          id: s.id,
          waiting: queueAt(q, clock.time),
        });
      }
      if (p.trajectory && !p.editing)
        for (const [tid, records] of indexRef.current.trains) {
          const state = trainAt(records, clock.time),
            trip = state.phase === "trip" ? state.item : null,
            stop = state.phase === "stop" ? state.item : null;
          let a: any = null,
            item: any = null,
            next = "",
            delay = 0;
          if (trip) {
            const from = stations.get(trip.from),
              to = stations.get(trip.to);
            if (from && to) {
              const u = project(from),
                v = project(to),
                f = Math.min(
                  1,
                  (clock.time - trip.departure) / (trip.ready - trip.departure),
                ),
                d = Math.hypot(v.x - u.x, v.y - u.y) || 1;
              a = {
                x: u.x + (v.x - u.x) * f - ((v.y - u.y) / d) * 4,
                y: u.y + (v.y - u.y) * f + ((v.x - u.x) / d) * 4,
              };
              item = trip;
              next = to.name;
              delay = Math.max(0, clock.time - trip.ready);
            }
          } else if (stop) {
            const station = stations.get(stop.station);
            if (station) {
              a = project(station);
              a.x += stop.direction * 5;
              a.y += 5;
              item = stop;
              next = station.name;
              delay = state.delay;
            }
          }
          if (!a || !item) continue;
          const line = p.network.lines.find((l) => l.id === item.line);
          ctx.fillStyle = line?.color ?? "#1f2a37";
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(a.x - 7, a.y - 4.5, 14, 9, 3);
          ctx.fill();
          ctx.stroke();
          if (p.heat === "blocking" && delay > 0) {
            ctx.strokeStyle = "#1f2a37";
            ctx.strokeRect(a.x - 10, a.y - 7, 20, 14);
          }
          targets.push({
            ...a,
            type: "train",
            id: tid,
            name: `Поезд ${tid + 1} · ${line?.name}`,
            load: item.load,
            capacity: value(p.network.train.capacity, 800),
            next,
            delay,
            locationLabel: stop ? "На станции" : "Следующая станция",
            waitLabel: stop
              ? "Ждёт свободный перегон"
              : "Ждёт свободную платформу",
          });
        }
      if (p.heat === "blocking")
        for (const [key, v] of Object.entries(
          p.metrics?.heatmap?.blocking ?? {},
        )) {
          const parts = key.split("|");
          if (parts[0] !== "tube") continue;
          const a = stations.get(parts[1]),
            b = stations.get(parts[2]);
          if (!a || !b) continue;
          const u = project(a),
            w = project(b);
          ctx.lineWidth = 4 + Number(v) * 10;
          ctx.strokeStyle = "rgba(31,42,55,.5)";
          ctx.setLineDash([2, 5]);
          ctx.beginPath();
          ctx.moveTo(u.x, u.y);
          ctx.lineTo(w.x, w.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      hits.current = targets;
      if (stamp - lastTooltip > 100) {
        lastTooltip = stamp;
        const cursor = pointer.current,
          hit =
            cursor &&
            [...targets]
              .reverse()
              .find((h) => Math.hypot(h.x - cursor.x, h.y - cursor.y) < 12),
          nextTooltip =
            hit && cursor
              ? {
                  ...hit,
                  left: Math.max(8, Math.min(cursor.x + 16, width - 230)),
                  top: Math.max(8, cursor.y - 70),
                }
              : null;
        setTooltip((old: any) => {
          if (!old || !nextTooltip)
            return old === nextTooltip ? old : nextTooltip;
          return [
            "type",
            "id",
            "name",
            "waiting",
            "load",
            "capacity",
            "next",
            "delay",
            "locationLabel",
            "waitLabel",
            "left",
            "top",
          ].every((key) => old[key] === nextTooltip[key])
            ? old
            : nextTooltip;
        });
      }
      frames.current.push(elapsed * 1000);
      if (frames.current.length > 120) frames.current.shift();
      (window as any).__metroFrameMs = frames.current;
      request = requestAnimationFrame(draw);
    };
    request = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(request);
      resize.disconnect();
    };
  }, []);
  const point = (event: React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  };
  const selection = props.selectedConnection;
  const selectedEdge =
    selection &&
    (selection.kind === "segment"
      ? props.network.segments
      : props.network.transfers)[selection.index];
  const nameOf = (id: string) =>
    props.network.stations.find((station) => station.id === id)?.name ?? id;
  const selectionLabel = selectedEdge
    ? `${selection!.kind === "segment" ? "Перегон" : "Переход"} ${nameOf(selectedEdge.from)} — ${nameOf(selectedEdge.to)}`
    : props.selected
      ? `Станция ${nameOf(props.selected)}`
      : null;
  return (
    <div
      className={`map-host ${props.editing ? "editing" : ""}`}
      ref={host}
      data-testid="map"
    >
      <canvas
        ref={canvas}
        aria-label="Карта сети метро"
        tabIndex={props.editing ? 0 : undefined}
        onMouseMove={(e) => {
          pointer.current = point(e);
        }}
        onMouseLeave={() => {
          pointer.current = null;
          setTooltip(null);
        }}
        onClick={(e) => {
          if (!props.editing) return;
          const p = point(e),
            g = geometry.current;
          if (!g) return;
          const hit = hits.current.find(
            (h) =>
              h.type === "station" && Math.hypot(h.x - p.x, h.y - p.y) < 15,
          );
          if ((props.tool === "delete" || props.tool === "select") && !hit) {
            const project = (id: string) => {
              const station = props.network.stations.find((s) => s.id === id);
              return station
                ? {
                    x: g.ox + value(station.x) * g.scale,
                    y: g.oy + value(station.y) * g.scale,
                  }
                : null;
            };
            const edges = (["segment", "transfer"] as const)
              .flatMap((kind) =>
                (kind === "segment"
                  ? props.network.segments
                  : props.network.transfers
                ).map((edge, index) => {
                  const a = project(edge.from),
                    b = project(edge.to);
                  if (!a || !b) return { kind, index, distance: Infinity };
                  const dx = b.x - a.x,
                    dy = b.y - a.y;
                  const t = Math.max(
                    0,
                    Math.min(
                      1,
                      ((p.x - a.x) * dx + (p.y - a.y) * dy) /
                        (dx * dx + dy * dy || 1),
                    ),
                  );
                  return {
                    kind,
                    index,
                    distance: Math.hypot(
                      p.x - a.x - t * dx,
                      p.y - a.y - t * dy,
                    ),
                  };
                }),
              )
              .sort((a, b) => a.distance - b.distance);
            if (edges[0]?.distance <= 10) {
              if (props.tool === "delete")
                props.onConnectionDelete(edges[0].kind, edges[0].index);
              else props.onConnectionSelect(edges[0].kind, edges[0].index);
            } else if (props.tool === "select") props.onMapClick(0, 0);
            return;
          }
          props.onMapClick(
            Math.max(0, Math.min(1000, (p.x - g.ox) / g.scale)),
            Math.max(0, Math.min(1000, (p.y - g.oy) / g.scale)),
            hit?.id,
          );
        }}
      />
      {!props.network.stations.length && (
        <div className="map-empty">
          <h2>Начните со станции</h2>
          <p>
            Выберите «Станции» и нажмите на поле.
            <br />
            Затем соедините их инструментом «Ветка».
          </p>
        </div>
      )}
      {tooltip && (
        <div
          className="map-tooltip"
          role="tooltip"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          <strong>{tooltip.name}</strong>
          {tooltip.type === "train" ? (
            <>
              <span>
                Загрузка ≈{passengerCount(tooltip.load)} / {tooltip.capacity}
              </span>
              <span>
                {tooltip.locationLabel}: {tooltip.next}
              </span>
              {tooltip.delay > 0 && (
                <span>
                  {tooltip.waitLabel}: {tooltip.delay.toFixed(1)} с
                </span>
              )}
            </>
          ) : (
            <span>Ожидают ≈{passengerCount(tooltip.waiting)} пасс.</span>
          )}
        </div>
      )}
      <div className="map-note" aria-live="polite">
        {props.editing
          ? props.tool === "select"
            ? selectionLabel
              ? `${selectionLabel}. Delete — удалить, Ctrl+Z — отменить.`
              : "Выберите станцию, перегон или переход. Delete — удалить, Ctrl+Z — отменить."
            : props.tool === "delete"
              ? "Нажмите станцию, перегон или переход для удаления. Ctrl+Z — отмена."
              : "Схема редактирования: расстояния задаются в свойствах перегонов"
          : "Пассажиры показаны приблизительно; направление поездки выбирает модель"}
      </div>
    </div>
  );
}
