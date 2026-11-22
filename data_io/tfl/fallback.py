"""Manual London subset. No claim of measured TfL demand or travel times."""
from pathlib import Path
from scripts.generate_demos import build
from data_io.network import write_network


def london_fallback():
    jubilee = ["Green Park","Westminster","Waterloo","Southwark","London Bridge","Bermondsey","Canada Water","Canary Wharf","North Greenwich"]
    bakerloo = ["Piccadilly Circus","Charing Cross","Embankment","Waterloo","Lambeth North","Elephant & Castle"]
    document = build("07 · Лондон / учебный участок",[jubilee,bakerloo])
    positions = {
        "Green Park":(120,180),"Westminster":(220,320),"Waterloo":(350,470),"Southwark":(470,470),"London Bridge":(580,470),"Bermondsey":(670,540),"Canada Water":(770,540),"Canary Wharf":(860,430),"North Greenwich":(930,540),
        "Piccadilly Circus":(250,100),"Charing Cross":(340,210),"Embankment":(350,340),"Lambeth North":(350,640),"Elephant & Castle":(460,770),
    }
    doors = {"Westminster","Waterloo","Southwark","London Bridge","Bermondsey","Canada Water","Canary Wharf","North Greenwich"}
    for station in document["stations"]:
        station["name"] = station["id"]
        x,y = positions[station["id"]]
        station["x"],station["y"] = {"value":x,"source":"user"},{"value":y,"source":"user"}
        # Station-level model simplification: Waterloo's flag applies to both
        # line platforms, though Bakerloo has no platform screen doors.
        station["platform_doors"] = station["id"] in doors
    document["lines"][0].update(name="Jubilee",color="#8A9094")
    document["lines"][1].update(name="Bakerloo",color="#A16B3E")
    document["meta"].update(description="Синтетическая демонстрация по вручную заданной топологии Jubilee/Bakerloo. TfL HTTP 403 при проверке 22.11.2026. Спрос, времена хода, парк и расписание НЕ реальные данные. Двери — предварительная ручная разметка, без доступной повторной проверки источников.")
    document["fleet"] = {"value":32,"source":"assumption"}
    # Keep all physical parameters separately tagged as assumptions.
    for segment in document["segments"]:
        segment["length_m"]["value"] = 850
    return document


if __name__ == "__main__":
    path = Path(__file__).resolve().parents[2] / "datasets/london/london_subset.json"
    path.parent.mkdir(parents=True,exist_ok=True)
    write_network(london_fallback(),path)
