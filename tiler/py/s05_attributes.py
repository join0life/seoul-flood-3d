import json
import time
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "data/work"
SCHEMA = json.loads((ROOT / "schema/building.json").read_text(encoding="utf-8"))

FLOOR_HEIGHT = 3.25                                   # 층당 높이 중앙값(m)
HEIGHT_SOURCE = {"ORIGINAL": 0, "FROM_FLOORS": 1, "DEFAULT": 2}


def to_int(s):
    """숫자로 바꿈. '*********' 같은 깨진 값은 0"""
    return pd.to_numeric(s, errors="coerce").fillna(0).clip(0, 255).astype("uint8")


def check_schema(df):
    """schema/building.json에 적힌 칸과 정확히 같은지 검사"""
    expected = set(SCHEMA["classes"]["building"]["properties"])
    actual = set(df.columns) - {"geometry"}
    if expected != actual:
        raise ValueError(f"schema 불일치 · 빠진 칸 {expected - actual} · 남는 칸 {actual - expected}")
    print("  schema 검사 통과")


def main():
    t0 = time.perf_counter()
    b = gpd.read_file(WORK / "building_flood.gpkg", engine="pyogrio")

    out = gpd.GeoDataFrame(geometry=b.geometry, crs=b.crs)
    out["buildingId"] = b["A1"].astype(str)
    out["floodYears"] = b["floodYears"].astype("uint16")
    out["grndFlr"] = to_int(b["A26"])
    out["ugrndFlr"] = to_int(b["A27"])
    out["usage"] = b["A8"].fillna("").astype(str)
    out["isResidential"] = (out["usage"] == "01000") | (
        (out["usage"] == "02000") & out["grndFlr"].between(1, 4)
    )

    # 높이: 원본 → 지상층수 × 3.25 → 3.25
    h = pd.to_numeric(b["A16"], errors="coerce")
    has_h = h > 0
    has_f = ~has_h & (out["grndFlr"] > 0)
    out["height"] = np.select([has_h, has_f], [h, out["grndFlr"] * FLOOR_HEIGHT], FLOOR_HEIGHT).astype("float32")
    out["heightSource"] = np.select(
        [has_h, has_f], [HEIGHT_SOURCE["ORIGINAL"], HEIGHT_SOURCE["FROM_FLOORS"]], HEIGHT_SOURCE["DEFAULT"]
    ).astype("uint8")

    check_schema(out)

    # 확인용 숫자 (저장은 안 함, 후보는 셰이더가 계산)
    cand = (out["floodYears"] > 0) & (out["ugrndFlr"] >= 1) & out["isResidential"]
    print(f"  높이 출처: {out['heightSource'].value_counts().sort_index().to_dict()}  (0 원본 / 1 층수 / 2 기본)")
    print(f"  후보(2022): {cand.sum():,}동")

    out = out.to_crs(4326)                            # 위경도(WGS84)로 바꿔서 저장
    path = WORK / "gwanak.fgb"
    out.to_file(path, driver="FlatGeobuf", engine="pyogrio")
    print(f"저장 완료 · {path.stat().st_size / 1e6:.1f}MB · {time.perf_counter() - t0:.1f}s")


if __name__ == "__main__":
    main()