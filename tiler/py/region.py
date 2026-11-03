"""지역 이름(REGION 환경변수, 기본 gwanak)과 그 지역의 파일 경로. s03~s05가 같이 씀

예: REGION=seoul python tiler/py/s03_prepare.py
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]   # seoul-flood-3d/
RAW = ROOT / "data/raw"
WORK = ROOT / "data/work"

# 지역 이름 → 건물 원본 SHP
BUILDING_FILES = {
    "gwanak": RAW / "gwanak_11620.shp",           # 관악구만 잘라낸 것 (디버깅용)
    "seoul": RAW / "AL_D010_11_20261009.shp",     # GIS건물통합정보 서울 전체 (기준일 2026-10-09)
}

REGION = os.environ.get("REGION", "gwanak")
if REGION not in BUILDING_FILES:
    raise SystemExit(f"REGION={REGION!r}는 없는 지역. 가능한 값: {', '.join(BUILDING_FILES)}")

BUILDING_FILE = BUILDING_FILES[REGION]
BUILDING_5186 = WORK / f"{REGION}_building_5186.gpkg"   # s03 → s04
BUILDING_FLOOD = WORK / f"{REGION}_building_flood.gpkg"  # s04 → s05
FGB = WORK / f"{REGION}.fgb"                             # s05 → Node 타일러
FLOOD_5186 = WORK / "flood_5186.gpkg"   # 침수는 지역과 상관없이 서울 전체 도형이라 이름에 지역을 안 붙임
