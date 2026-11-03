import time

import geopandas as gpd
import pandas as pd
from shapely.ops import unary_union

from region import BUILDING_5186, BUILDING_FILE, FLOOD_5186, RAW, REGION, WORK

TARGET_CRS = 5186                            # 건물 지도 기준 좌표계

FLOOD_FILES = {2022: RAW / "flood_2022.shp", 2025: RAW / "flood_2025.shp"}
BUILDING_COLS = ["A1", "A8", "A13", "A16", "A23", "A26", "A27"]
# 서울 범위(EPSG:5186, 경계 + 여유 약 5km). 서울 원본에 시군구코드는 서울인데 좌표가 250km 남쪽인 도형 2개가 있음
# → 그대로 두면 쿼드트리 루트가 남한 절반을 덮음
SEOUL_BBOX = (175_000, 530_000, 225_000, 575_000)   # 서, 남, 동, 북 (m)


def read(path, columns=None):
    """columns=None이면 모든 칸, []이면 도형만 읽음"""
    gdf = gpd.read_file(path, engine="pyogrio", encoding="cp949", columns=columns)
    print(f"  {path.name}: {len(gdf):,}개, 좌표계 {gdf.crs.to_epsg()}")
    return gdf


def keep_polygons(geom):
    """도형 보정 후 선·점 조각이 섞이면 면만 남김"""
    if geom is None or geom.is_empty:
        return None
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    parts = [g for g in getattr(geom, "geoms", []) if g.geom_type in ("Polygon", "MultiPolygon")]
    return unary_union(parts) if parts else None


def fix_geometry(gdf, name):
    bad = ~gdf.is_valid
    print(f"  {name}: 잘못된 도형 {bad.sum():,}개")
    gdf.loc[bad, "geometry"] = gdf.loc[bad, "geometry"].make_valid().apply(keep_polygons)
    before = len(gdf)
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty]
    print(f"  {name}: 보정 후 버린 도형 {before - len(gdf):,}개, 남은 {len(gdf):,}개")
    return gdf


def main():
    t0 = time.perf_counter()
    WORK.mkdir(parents=True, exist_ok=True)

    print(f"[건물] REGION={REGION}")
    b = read(BUILDING_FILE)[BUILDING_COLS + ["geometry"]]
    if b.crs.to_epsg() != TARGET_CRS:
        b = b.to_crs(TARGET_CRS)
    b = fix_geometry(b, "건물")
    c = b.geometry.centroid
    w, s, e, n = SEOUL_BBOX
    inside = c.x.between(w, e) & c.y.between(s, n)
    print(f"  건물: 서울 범위 밖이라 뺀 도형 {(~inside).sum():,}개, 남은 {inside.sum():,}개")
    b = b[inside]

    print("[침수]")
    floods = []
    for year, path in FLOOD_FILES.items():
        f = read(path, columns=[])            # 도형만 읽음 → 주소·PNU·구호 정보 등은 메모리에도 안 올림
        f["year"] = year
        f = f.to_crs(TARGET_CRS)              # 5179 → 5186 재투영
        floods.append(fix_geometry(f, f"침수 {year}"))
    flood = gpd.GeoDataFrame(pd.concat(floods, ignore_index=True), crs=TARGET_CRS)

    b.to_file(BUILDING_5186, engine="pyogrio")
    flood.to_file(FLOOD_5186, engine="pyogrio")
    print(f"저장 완료 · {time.perf_counter() - t0:.1f}s")


if __name__ == "__main__":
    main()