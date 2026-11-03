"""지역 이름(REGION 환경변수, 기본 gwanak)과 그 지역의 파일 경로. s03~s05가 같이 씀

지역 목록은 tiler/regions.json 하나에 있음 (Node tiler/node/src/region.ts도 같은 파일을 읽음)
예: REGION=seoul python tiler/py/s03_prepare.py
"""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]   # seoul-flood-3d/
RAW = ROOT / "data/raw"
WORK = ROOT / "data/work"

REGIONS = json.loads((ROOT / "tiler/regions.json").read_text(encoding="utf-8"))

REGION = os.environ.get("REGION", "gwanak")
if REGION not in REGIONS:
    raise SystemExit(f"REGION='{REGION}'는 없는 지역. 가능한 값: {', '.join(REGIONS)}")

BUILDING_FILE = ROOT / REGIONS[REGION]["building"]
BUILDING_5186 = WORK / f"{REGION}_building_5186.gpkg"   # s03 → s04
BUILDING_FLOOD = WORK / f"{REGION}_building_flood.gpkg"  # s04 → s05
FGB = WORK / f"{REGION}.fgb"                             # s05 → Node 타일러
FLOOD_5186 = WORK / "flood_5186.gpkg"   # 침수는 지역과 상관없이 서울 전체 도형이라 이름에 지역을 안 붙임
