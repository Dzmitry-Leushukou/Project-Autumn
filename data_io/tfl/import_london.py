"""Rebuild the London demo from auditable TfL snapshots, with optional refresh.

No Excel dependency: read cached numeric values from the published OOXML file.
Never substitute a missing cell, station or time interval with zero.
"""

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
from io import BytesIO
import json
import math
from pathlib import Path, PurePosixPath
import re
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from data_io.network import require_network, write_network

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = ROOT / "datasets/london"
SOURCES = DIRECTORY / "sources"
WORKBOOK_URL = (
    "https://crowding.data.tfl.gov.uk/NUMBAT/NUMBAT%202025/NBT25TWT_Outputs.xlsx"
)
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
JUBILEE = [
    "Green Park",
    "Westminster",
    "Waterloo",
    "Southwark",
    "London Bridge",
    "Bermondsey",
    "Canada Water",
    "Canary Wharf",
    "North Greenwich",
]
BAKERLOO = [
    "Piccadilly Circus",
    "Charing Cross",
    "Embankment",
    "Waterloo",
    "Lambeth North",
    "Elephant & Castle",
]
PATHS = {"jubilee": JUBILEE, "bakerloo": BAKERLOO}
ENTRY_NAMES = {
    "Waterloo": "Waterloo LU",
    "London Bridge": "London Bridge LU",
    "Canary Wharf": "Canary Wharf LU",
    "Charing Cross": "Charing Cross LU",
    "Elephant & Castle": "Elephant & Castle LU",
}
DOOR_AUDIT = json.loads(
    (SOURCES / "platform_doors_audit.json").read_text(encoding="utf-8")
)
DOORS = set(DOOR_AUDIT["jubilee_doors"])


def column_index(address):
    result = 0
    for char in re.match(r"[A-Z]+", address).group():
        result = result * 26 + ord(char) - ord("A") + 1
    return result - 1


def read_sheets(payload, names):
    """Read only the source sheets needed for the import; do not execute formulas."""
    with ZipFile(BytesIO(payload)) as archive:
        strings = [
            "".join(item.itertext())
            for item in ET.fromstring(archive.read("xl/sharedStrings.xml"))
        ]
        relationships = {
            r.get("Id"): r.get("Target")
            for r in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        }
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        paths = {}
        for sheet in workbook.findall("s:sheets/s:sheet", NS):
            rid = sheet.get(
                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
            )
            target = relationships[rid]
            paths[sheet.get("name")] = (
                target.lstrip("/")
                if target.startswith("/")
                else str(PurePosixPath("xl") / target)
            )
        result = {}
        for name in names:
            rows = {}
            with archive.open(paths[name]) as stream:
                for _, node in ET.iterparse(stream, events=("end",)):
                    if node.tag != f"{{{NS['s']}}}row":
                        continue
                    values = {}
                    for cell in node.findall("s:c", NS):
                        raw = cell.findtext("s:v", namespaces=NS)
                        kind = cell.get("t")
                        if kind == "s":
                            value = strings[int(raw)] if raw is not None else None
                        elif kind == "inlineStr":
                            value = "".join(cell.find("s:is", NS).itertext())
                        elif kind in ("str", "e"):
                            value = raw
                        else:
                            value = float(raw) if raw is not None else None
                        values[column_index(cell.get("r"))] = value
                    rows[int(node.get("r"))] = values
                    node.clear()
            result[name] = rows
        return result


def number(value, context):
    if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError(f"Missing/invalid numeric source value: {context}: {value!r}")
    return float(value)


def time_columns(rows):
    header, quarters = rows[3], rows[2]
    columns = [
        (i, int(number(quarters.get(i), f"quarter column {i}")) - 1)
        for i, v in header.items()
        if isinstance(v, str) and re.fullmatch(r"\d{4}-\d{4}", v)
    ]
    minutes = [q * 15 for _, q in columns]
    if minutes != list(range(300, 1740, 15)):
        raise ValueError(
            "Expected 96 consecutive 15-minute columns from 05:00 to next-day 05:00"
        )
    return columns


def extract_workbook(payload):
    sheets = read_sheets(payload, ["_Cover", "Station_Entries", "Link_Frequencies"])
    entries = []
    expected = {ENTRY_NAMES.get(s, s) for path in PATHS.values() for s in path}
    rows = sheets["Station_Entries"]
    cols = time_columns(rows)
    for row_index, row in rows.items():
        if row_index <= 3 or row.get(2) not in expected:
            continue
        values = [
            number(row.get(i), f"Station_Entries!row {row_index} column {i+1}")
            for i, _ in cols
        ]
        total = number(row.get(4), f"Station_Entries!E{row_index}")
        if not math.isclose(sum(values), total, rel_tol=1e-7, abs_tol=1e-5):
            raise ValueError(f"Daily/quarter-hour total mismatch: {row.get(2)}")
        entries.append(
            {
                "row": row_index,
                "nlc": int(row[0]),
                "asc": row[1],
                "station": row[2],
                "total_24h": total,
                "values": values,
            }
        )
    if len(entries) != len(expected) or {r["station"] for r in entries} != expected:
        raise ValueError("Missing/duplicate NUMBAT station entries")
    nlcs = {
        name: next(
            r["nlc"] for r in entries if r["station"] == ENTRY_NAMES.get(name, name)
        )
        for path in PATHS.values()
        for name in path
    }
    edges = {
        (line.title(), frozenset((nlcs[a], nlcs[b])))
        for line, path in PATHS.items()
        for a, b in zip(path, path[1:])
    }
    frequencies = []
    rows = sheets["Link_Frequencies"]
    cols = time_columns(rows)
    for row_index, row in rows.items():
        if (
            row_index <= 3
            or (row.get(1), frozenset((row.get(4), row.get(7)))) not in edges
        ):
            continue
        frequencies.append(
            {
                "row": row_index,
                "link": row[0],
                "line": row[1],
                "direction": row[2],
                "from_nlc": int(row[4]),
                "to_nlc": int(row[7]),
                "values": [
                    number(
                        row.get(i), f"Link_Frequencies row {row_index}, column {i+1}"
                    )
                    for i, _ in cols
                ],
            }
        )
    if len(frequencies) != 2 * len(edges) or len(
        {r["link"] for r in frequencies}
    ) != len(frequencies):
        raise ValueError(
            "Missing/duplicate directed link frequencies in selected subset"
        )
    serial = number(sheets["_Cover"][5].get(1), "_Cover!B5")
    return {
        "workbook_url": WORKBOOK_URL,
        "workbook_sha256": hashlib.sha256(payload).hexdigest(),
        "publication_date": (datetime(1899, 12, 30) + timedelta(days=serial))
        .date()
        .isoformat(),
        "demand_year": 2025,
        "day_type": "TWT",
        "day_type_description": "Typical autumn Tuesday–Thursday; not a specific observed date",
        "start_minutes": list(range(300, 1740, 15)),
        "entries": entries,
        "frequencies": frequencies,
    }


def fetch(url):
    # Optional refresh uses httpx, installed by scripts/setup.py (test extra).
    import httpx

    response = httpx.get(url, timeout=60, follow_redirects=True)
    response.raise_for_status()
    return response.content


def refresh():
    SOURCES.mkdir(parents=True, exist_ok=True)
    workbook = fetch(WORKBOOK_URL)
    extracted = extract_workbook(workbook)
    retrieved = datetime.now(timezone.utc).isoformat()
    extracted["retrieved_utc"] = retrieved
    routes = {}
    for line in PATHS:
        url = f"https://api.tfl.gov.uk/Line/{line}/Route/Sequence/outbound"
        raw = fetch(url)
        routes[line] = json.loads(raw)
    # Validate the full replacement before writing either the demo or snapshots.
    document, audit = build_network(routes, extracted)
    for line, route in routes.items():
        write_network(route, SOURCES / f"{line}_route.json")
    write_network(extracted, SOURCES / "numbat_2025_twt.json")
    write_network(audit, SOURCES / "import_audit.json")
    write_network(document, DIRECTORY / "london_subset.json")
    return audit


def distance_m(a, b):
    lat1, lat2 = math.radians(a["lat"]), math.radians(b["lat"])
    dlat, dlon = lat2 - lat1, math.radians(b["lon"] - a["lon"])
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    )
    return 6371000 * 2 * math.asin(min(1, math.sqrt(h)))


def build_network(routes, extracted):
    points = {}
    for line, path in PATHS.items():
        sequences = routes[line]["stopPointSequences"]
        found = False
        for sequence in sequences:
            stops = sequence["stopPoint"]
            names = [s["name"].removesuffix(" Underground Station") for s in stops]
            for order in (names, names[::-1]):
                if (
                    path[0] in order
                    and order[order.index(path[0]) : order.index(path[0]) + len(path)]
                    == path
                ):
                    found = True
            for stop, name in zip(stops, names):
                if name in path:
                    points[name] = {
                        "naptan": stop["id"],
                        "lat": stop["lat"],
                        "lon": stop["lon"],
                    }
        if not found:
            raise ValueError(
                f"Selected {line} path is not contiguous in TfL route sequence"
            )

    def tag(v, source):
        return {"value": v, "source": source}

    lon_min, lon_max = min(p["lon"] for p in points.values()), max(
        p["lon"] for p in points.values()
    )
    lat_min, lat_max = min(p["lat"] for p in points.values()), max(
        p["lat"] for p in points.values()
    )
    stations = [
        {
            "id": name,
            "name": name,
            "x": tag(
                round(80 + 840 * (p["lon"] - lon_min) / (lon_max - lon_min), 3),
                "estimate",
            ),
            "y": tag(
                round(80 + 840 * (lat_max - p["lat"]) / (lat_max - lat_min), 3),
                "estimate",
            ),
            "platform_doors": name in DOORS,
        }
        for name, p in points.items()
    ]
    demand = []
    station_totals = {}
    for name in points:
        matching = [
            r
            for r in extracted["entries"]
            if r["station"] == ENTRY_NAMES.get(name, name)
        ]
        if len(matching) != 1:
            raise ValueError(f"Expected one source row for {name}")
        row = matching[0]
        included = []
        for minute, entries in zip(
            extracted["start_minutes"], row["values"], strict=True
        ):
            if 300 <= minute < 1500:
                v = number(entries, name)
                demand.append(
                    {
                        "station": name,
                        "start_min": tag(minute, "data"),
                        "len_min": tag(15, "data"),
                        "entries": tag(v, "data"),
                    }
                )
                included.append(v)
        if len(included) != 80:
            raise ValueError(f"Expected 80 simulation intervals for {name}")
        station_totals[name] = {
            "source_row": row["row"],
            "asc": row["asc"],
            "entries_05_25": math.fsum(included),
            "entries_24h": row["total_24h"],
        }
    lines, segments, schedule, schedule_audit = [], [], {}, {}
    for i, (line, path) in enumerate(PATHS.items(), 1):
        line_id = f"L{i}"
        lines.append(
            {
                "id": line_id,
                "name": line.title(),
                "color": "#8A9094" if line == "jubilee" else "#A16B3E",
                "is_loop": False,
                "stations": path,
            }
        )
        for a, b in zip(path, path[1:]):
            segments.append(
                {
                    "from": a,
                    "to": b,
                    "length_m": tag(
                        round(distance_m(points[a], points[b]), 3), "estimate"
                    ),
                }
            )
        links = [r for r in extracted["frequencies"] if r["line"] == line.title()]
        estimates, evidence = [], []
        for period in range(20):
            counts = [
                math.fsum(r["values"][period * 4 : period * 4 + 4]) for r in links
            ]
            frequency = math.fsum(counts) / len(counts)
            if frequency <= 0:
                raise ValueError(
                    f"No trains for {line} period {period}; cannot silently assume a headway"
                )
            headway = max(1, round(3600 / frequency))
            estimates.append(tag(headway, "estimate"))
            evidence.append(
                {
                    "period": period,
                    "mean_trains_per_hour": frequency,
                    "headway_s": headway,
                }
            )
        schedule[line_id] = estimates
        schedule_audit[line_id] = {
            "method": "3600 / mean hourly trains over both directions and all selected links; rounded to integer seconds",
            "source_rows": [r["row"] for r in links],
            "periods": evidence,
        }
    document = {
        "meta": {
            "name": "07 · Лондон / TfL NUMBAT 2025 TWT",
            "format_version": "1.0",
            "synthetic": False,
            "description": "Реальные входы станций NUMBAT 2025, типичный вторник–четверг осени (не конкретная дата). Топология и координаты: сохранённый снимок TfL API. Интервалы оценены по Link_Frequencies, длины — по прямой между координатами. OD модельная; входы всех LU-линий станции направляются только внутри выбранного участка, без уменьшения потока. Парк, тип поезда и физика — допущения; двери — ручная разметка, перепроверенная по TfL и UrbanRail. Станционный флаг Waterloo добавляет двери также Bakerloo — ограничение модели, не физический факт. Это ограниченная учебная модель, не прогноз TfL. Powered by TfL Open Data. Contains OS data © Crown copyright and database rights 2016. Geomni UK Map data © and database rights 2019.",
        },
        "stations": stations,
        "lines": lines,
        "segments": segments,
        "transfers": [],
        "train": {},
        "fleet": tag(32, "assumption"),
        "demand": demand,
        "schedule": {"period_len_min": tag(60, "assumption"), "headways": schedule},
        "settings": {
            "day_start_s": tag(18000, "assumption"),
            "day_end_s": tag(90000, "assumption"),
        },
    }
    require_network(document)
    audit = {
        "workbook_url": extracted["workbook_url"],
        "workbook_sha256": extracted["workbook_sha256"],
        "publication_date": extracted["publication_date"],
        "demand_year": 2025,
        "day_type": "TWT",
        "retrieved_utc": extracted.get("retrieved_utc"),
        "stations": points,
        "station_entries": station_totals,
        "total_entries_05_25": math.fsum(
            x["entries_05_25"] for x in station_totals.values()
        ),
        "schedule": schedule_audit,
        "platform_doors": {
            "status": DOOR_AUDIT["status"],
            "source": "user",
            "stations": sorted(DOORS),
            "sources": [s["url"] for s in DOOR_AUDIT["sources"]],
        },
        "limitations": [
            "Typical day, not a specific date; 2025 demand combined with 2026 API topology",
            "Station entries include all LU lines at each station; subset-only destination model changes real distribution",
            "Straight-line interstation distances are estimates, not measured tunnel lengths",
            "Hourly headways average differing directions/links; model has one headway for both directions",
            "Platform doors manually cross-checked against TfL/UrbanRail; source=user, not an API attribute; Waterloo station flag also applies to Bakerloo as a model approximation",
            "Fleet and train parameters are assumptions",
        ],
    }
    return document, audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Download official TfL sources (default: reproduce offline from committed excerpts)",
    )
    args = parser.parse_args()
    if args.refresh:
        audit = refresh()
    else:
        routes = {
            line: json.loads(
                (SOURCES / f"{line}_route.json").read_text(encoding="utf-8")
            )
            for line in PATHS
        }
        extracted = json.loads(
            (SOURCES / "numbat_2025_twt.json").read_text(encoding="utf-8")
        )
        document, audit = build_network(routes, extracted)
        write_network(document, DIRECTORY / "london_subset.json")
        write_network(audit, SOURCES / "import_audit.json")
    print(
        json.dumps(
            {
                "stations": len(audit["stations"]),
                "entries_05_25": audit["total_entries_05_25"],
                "day_type": "2025 TWT",
                "synthetic": False,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
