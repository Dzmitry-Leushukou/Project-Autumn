import copy
from io import BytesIO
import json
from pathlib import Path
from zipfile import ZipFile

import pytest

from data_io.network import read_network, validate
from data_io.tfl.import_london import (
    PATHS,
    SOURCES,
    build_network,
    column_index,
    extract_workbook,
    number,
    read_sheets,
    time_columns,
)


def inputs():
    routes = {line: read_network(SOURCES / f"{line}_route.json") for line in PATHS}
    return routes, read_network(SOURCES / "numbat_2025_twt.json")


def test_offline_rebuild_matches_committed_network_and_audit():
    routes, extracted = inputs()
    document, audit = build_network(routes, extracted)
    root = Path(__file__).resolve().parents[1]
    assert document == read_network(root / "datasets/london/london_subset.json")
    assert audit == read_network(SOURCES / "import_audit.json")
    network, report = validate(document)
    assert network is not None, report
    assert not network.meta.synthetic
    assert len(network.stations) == 14
    assert len(network.demand) == 14 * 80
    assert audit["total_entries_05_25"] == pytest.approx(573558.453090302)
    assert report["sources"]["demand.0.entries"] == "data"
    assert report["sources"]["stations.0.x"] == "estimate"
    assert report["sources"]["segments.0.length_m"] == "estimate"
    assert report["sources"]["schedule.headways.L1.0"] == "estimate"
    assert report["sources"]["fleet"] == "assumption"


def test_source_reconciliation_and_midnight_mapping():
    routes, extracted = inputs()
    document, audit = build_network(routes, extracted)
    assert extracted["publication_date"] == "2026-07-01"
    assert extracted["day_type"] == "TWT"
    assert len(extracted["workbook_sha256"]) == 64
    for row in extracted["entries"]:
        assert sum(row["values"]) == pytest.approx(row["total_24h"], rel=1e-7)
    green = next(
        r
        for r in document["demand"]
        if r["station"] == "Green Park" and r["start_min"]["value"] == 300
    )
    assert green["entries"]["value"] == pytest.approx(9.391575840000002)
    assert max(r["start_min"]["value"] for r in document["demand"]) == 1485
    assert sum(r["entries"]["value"] for r in document["demand"]) == pytest.approx(
        audit["total_entries_05_25"]
    )
    frequency = audit["schedule"]["L1"]["periods"][0]
    assert frequency["headway_s"] == round(3600 / frequency["mean_trains_per_hour"])


def test_missing_inputs_fail_instead_of_becoming_zero():
    routes, extracted = inputs()
    broken = copy.deepcopy(extracted)
    broken["entries"][0]["values"][0] = None
    with pytest.raises(ValueError, match="Missing/invalid"):
        build_network(routes, broken)
    broken = copy.deepcopy(extracted)
    broken["entries"].pop()
    with pytest.raises(ValueError, match="Expected one source row"):
        build_network(routes, broken)
    broken = copy.deepcopy(extracted)
    for row in broken["frequencies"]:
        row["values"][:4] = [0] * 4
    with pytest.raises(ValueError, match="No trains"):
        build_network(routes, broken)


def test_topology_is_checked_against_api_sequence():
    routes, extracted = inputs()
    for seq in routes["jubilee"]["stopPointSequences"]:
        seq["stopPoint"] = [
            s for s in seq["stopPoint"] if s["name"] != "Southwark Underground Station"
        ]
    with pytest.raises(ValueError, match="not contiguous"):
        build_network(routes, extracted)


def test_door_annotation_has_cross_checked_sources_and_no_surface_stations():
    evidence = read_network(SOURCES / "platform_doors_audit.json")
    assert evidence["status"] == "cross_checked_manual_annotation"
    assert evidence["source"] == "user"
    assert len(evidence["jubilee_doors"]) == 8
    assert not set(evidence["jubilee_extension_without_doors"]) & set(
        evidence["jubilee_doors"]
    )
    assert len(evidence["sources"]) == 4
    assert all(
        s["http_status"] == 200 and s["quote"] and len(s["text_sha256"]) == 64
        for s in evidence["sources"]
    )
    routes, extracted = inputs()
    document, audit = build_network(routes, extracted)
    assert {s["id"] for s in document["stations"] if s["platform_doors"]} == set(
        evidence["jubilee_doors"]
    )
    assert audit["platform_doors"]["source"] == "user"


def test_ooxml_cached_values_preserve_zero_missing_and_columns():
    stream = BytesIO()
    with ZipFile(stream, "w") as z:
        z.writestr(
            "xl/sharedStrings.xml",
            '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Station</t></si></sst>',
        )
        z.writestr(
            "xl/workbook.xml",
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Example" sheetId="1" r:id="rId1"/></sheets></workbook>',
        )
        z.writestr(
            "xl/_rels/workbook.xml.rels",
            '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
        )
        z.writestr(
            "xl/worksheets/sheet1.xml",
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="AA1"><v>0</v></c><c r="AB1"><f>1+1</f><v>2</v></c><c r="AC1"><f>1+1</f></c></row></sheetData></worksheet>',
        )
    row = read_sheets(stream.getvalue(), ["Example"])["Example"][1]
    assert row == {0: "Station", 26: 0, 27: 2, 28: None}
    assert column_index("DC42") == 106
    assert number(row[26], "zero") == 0
    with pytest.raises(ValueError):
        number(row[28], "no cached value")


def test_time_columns_use_quarter_numbers_after_midnight():
    headers = {i: "0500-0515" for i in range(96)}
    rows = {3: headers, 2: {i: i + 21 for i in range(96)}}
    times = time_columns(rows)
    assert times[76][1] * 15 == 1440
    rows[2][76] = 1
    with pytest.raises(ValueError, match="96 consecutive"):
        time_columns(rows)
