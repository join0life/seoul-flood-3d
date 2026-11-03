import time

import geopandas as gpd
import pandas as pd

from flood_dates import FIRST_YEAR, FLOOD_DATES   # import할 때 연도 범위(2010~2025) 검사
from region import BUILDING_5186, BUILDING_FLOOD, FLOOD_5186, REGION


def main():
    t0 = time.perf_counter()
    print(f"REGION={REGION}")
    b = gpd.read_file(BUILDING_5186, engine="pyogrio").reset_index(drop=True)
    flood = gpd.read_file(FLOOD_5186, engine="pyogrio")

    appr = pd.to_datetime(b["A13"], errors="coerce")   # 사용승인일. 이상한 값은 빈칸(NaT)
    b["floodYears"] = 0

    for year, date in FLOOD_DATES.items():
        f = flood[flood["year"] == year]
        hit = gpd.sjoin(b[["geometry"]], f[["geometry"]], predicate="intersects").index.unique()
        touched = b.index.isin(hit)
        if date is None and touched.any():
            # 날짜를 모르면 사용승인일 거르기가 틀어짐. 닿은 건물이 0동일 때만 넘어감
            raise ValueError(f"{year} 침수에 닿은 건물 {touched.sum():,}동인데 FLOOD_DATES 날짜가 비어 있음. 날짜를 채울 것")

        cutoff = pd.Timestamp(date or f"{year}-01-01")
        built_before = appr.isna() | (appr < cutoff)    # 날짜 모르면 남김(전에 정한 규칙)
        ok = touched & built_before

        bit = 1 << (year - FIRST_YEAR)                  # 2022 → 4096
        b.loc[ok, "floodYears"] = b.loc[ok, "floodYears"] | bit
        print(f"  {year}: 닿은 건물 {touched.sum():,} → 침수 전 건물 {ok.sum():,} "
              f"(침수 후 지어져 제외 {(touched & ~built_before).sum():,})")

    b["floodYears"] = b["floodYears"].astype("uint16")
    print(f"침수 이력 있는 건물 {(b['floodYears'] > 0).sum():,}개")

    b.to_file(BUILDING_FLOOD, engine="pyogrio")
    print(f"저장 완료 · {time.perf_counter() - t0:.1f}s")


if __name__ == "__main__":
    main()