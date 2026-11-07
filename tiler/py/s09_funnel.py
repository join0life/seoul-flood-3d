"""s09: 깔때기 숫자(침수 이력 → 지하층 → 주거 → 최종 후보)를 지역 전체 + 구별로 세어 funnel.json으로

왜 타일러가 세나: 화면은 지금 보이는 타일의 건물만 알아서, 화면에서 세면 카메라마다 숫자가 달라짐(틀림)
판정은 viewer/layer-style.js CONDITIONS와 같은 정의. 규칙을 Python에 다시 쓰는 것이라
속성 이름·heightSource 값은 schema/building.json에서 읽음(이름이 바뀌면 여기서 멈춤)
  flood          선택 연도 중 하나라도 floodYears 비트가 켜짐 (OR)
  basement       ugrndFlr >= 1
  residential    isResidential == True
  measuredHeight heightSource != DEFAULT

구별: fgb 전용 칸 sigungu(A23, s05 FGB_ONLY) → 이름은 tiler/sigungu.csv(원본 A4에서 만든 매핑)
fgb를 한 번만 읽어(도형 포함) 건물마다 판정 → 지역 합계와 구별 합계·bbox를 같은 판정에서 냄
buildingId 중복(서울 383개 ID·788행)은 고치지 않음. 깔때기는 행(도형) 단위로 셈

bbox 두 종류: "bbox"(구 전체 건물), "candidateBbox"(연도 조합별 후보 건물만, 후보 0건이면 그 연도 키가 없음)
화면은 구를 클릭하면 candidateBbox로 카메라를 맞추고, 없으면 bbox로 대체

실행 순서: s08 다음 (s08이 data/tiles/<지역>/을 지우고 다시 만들어서, 먼저 돌리면 funnel.json이 지워짐)
예: REGION=seoul python tiler/py/s09_funnel.py  → data/tiles/seoul/funnel.json
"""
import json
import time
from datetime import datetime, timezone

import pandas as pd
import pyogrio

from flood_dates import FIRST_YEAR
from region import FGB, REGION, ROOT, TILES_DIR

SCHEMA = json.loads((ROOT / "schema/building.json").read_text(encoding="utf-8"))
PROPS = SCHEMA["classes"]["building"]["properties"]
P = {k: k for k in ("floodYears", "ugrndFlr", "isResidential", "heightSource")}
for name in P.values():
    if name not in PROPS:
        raise SystemExit(f"schema/building.json에 {name} 속성이 없음")
DEFAULT_HEIGHT = next((v["value"] for v in SCHEMA["enums"]["heightSource"]["values"] if v["name"] == "DEFAULT"), None)
if DEFAULT_HEIGHT is None:
    raise SystemExit("schema/building.json heightSource enum에 DEFAULT 값이 없음")

SIGUNGU_FILE = ROOT / "tiler/sigungu.csv"
SIGUNGU = "sigungu"  # fgb 전용 칸(s05 FGB_ONLY)

# 화면 연도 선택과 같은 키("+"로 이음, 오름차순)
YEAR_SETS = {"2022": [2022], "2025": [2025], "2022+2025": [2022, 2025]}

# 출처(README 5.1 사용 데이터와 같은 값). 데이터를 바꾸면 여기도 바꿀 것
SOURCES = {
    "building": "GIS건물통합정보(국토교통부) 기준일 2026-10-09",
    "flood": "서울시 침수흔적도 2022(2026.1.5 수정본)·2025",
    "districtNames": "GIS건물통합정보 AL_D010 A4(법정동명), 기준일 2026-10-09 · A23은 행정구역 개편 시 변동 가능",
}
STEPS = ["flood", "floodBasement", "floodBasementResidential", "candidate", "noHeight"]
REGION_LABEL = {"seoul": "서울 전체", "gwanak": "관악구"}


def main():
    t0 = time.perf_counter()
    print(f"REGION={REGION}")
    names = pd.read_csv(SIGUNGU_FILE, comment="#", dtype=str).set_index("code")["name"].to_dict()
    # 도형은 구별 bbox(경도·위도 최소·최대)용. fgb는 WGS84로 저장돼 있음(s05)
    df = pyogrio.read_dataframe(FGB, columns=[*P.values(), SIGUNGU])
    t_read = time.perf_counter() - t0

    basement = df[P["ugrndFlr"]] >= 1
    residential = df[P["isResidential"]] == True  # noqa: E712 (NaN이 섞여도 거짓으로)
    measured = df[P["heightSource"]] != DEFAULT_HEIGHT

    # 건물마다 (연도 조합 × 단계) 참/거짓 → 아래에서 지역 전체는 sum, 구별은 groupby sum
    flags = {}
    for key, years in YEAR_SETS.items():
        mask = sum(1 << (y - FIRST_YEAR) for y in years)
        flood = (df[P["floodYears"]].astype("int64") & mask) > 0
        fbr = flood & basement & residential
        flags.update({
            (key, "flood"): flood,
            (key, "floodBasement"): flood & basement,
            (key, "floodBasementResidential"): fbr,
            (key, "candidate"): fbr & measured,
            (key, "noHeight"): fbr & ~measured,  # 높이 정보가 없어 후보에서 빠진 수
        })
    flags = pd.DataFrame(flags)

    def nest(counts):
        """(연도 조합, 단계) → 수  ⇒  {연도 조합: {단계: 수}}"""
        return {key: {step: int(counts[(key, step)]) for step in STEPS} for key in YEAR_SETS}

    funnel = nest(flags.sum())
    for key, f in funnel.items():
        print(f"  {key:>9}: " + " → ".join(f"{k} {v:,}" for k, v in f.items()))

    # 구별. 코드가 비면 어느 구에도 안 넣고 수만 남김. 매핑에 없는 코드는 멈춤(sigungu.csv를 다시 만들 것)
    code = df[SIGUNGU].fillna("").astype(str).str.strip()
    assigned = code != ""
    unknown = sorted(set(code[assigned]) - set(names))
    if unknown:
        raise SystemExit(f"tiler/sigungu.csv에 없는 시군구 코드 {unknown} → python tiler/py/sigungu_names.py")
    by = flags[assigned].groupby(code[assigned]).sum()
    all_bounds = df.geometry.bounds
    bounds = all_bounds[assigned].groupby(code[assigned]).agg(
        {"minx": "min", "miny": "min", "maxx": "max", "maxy": "max"})

    def bbox_of(mask):
        """mask(불) → {구코드: [서,남,동,북]}. 그 구에 해당 건물이 없으면 칸 없음(구 전체 bbox로 대체할 것)"""
        m = mask & assigned
        if not m.any():
            return {}
        b = all_bounds[m].groupby(code[m]).agg({"minx": "min", "miny": "min", "maxx": "max", "maxy": "max"})
        return {c: [round(float(v), 6) for v in b.loc[c, ["minx", "miny", "maxx", "maxy"]]] for c in b.index}

    # 연도 조합별 "후보 건물만" bbox. 구 클릭 카메라가 구 전체 대신 이걸 씀(후보가 0건이면 구 전체 bbox로 대체)
    candidate_bbox = {key: bbox_of(flags[(key, "candidate")]) for key in YEAR_SETS}

    size = code[assigned].value_counts()
    districts = [
        {
            "code": c,
            "name": names[c],
            "buildings": int(size[c]),
            "bbox": [round(float(v), 6) for v in bounds.loc[c, ["minx", "miny", "maxx", "maxy"]]],  # [서, 남, 동, 북]
            "candidateBbox": {key: candidate_bbox[key].get(c) for key in YEAR_SETS},  # 없으면(후보 0건) null → 화면이 bbox로 대체
            "funnel": nest(by.loc[c]),
        }
        for c in sorted(by.index)
    ]

    # 후보 bbox가 구 전체 bbox보다 훨씬 큰 구(동떨어진 후보 하나가 상자를 늘림) → 참고용 출력, 고치지 않음
    def area(b):
        return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    for d in districts:
        full = area(d["bbox"])
        for key, cb in d["candidateBbox"].items():
            if cb and full > 0 and area(cb) > full * 0.9:
                print(f"  [참고] {d['name']}({key}): 후보 bbox가 구 전체의 {area(cb) / full:.0%} "
                      f"→ 후보 {d['funnel'][key]['candidate']:,}건이 넓게 퍼짐")

    # 검산: 구 합 + 미배정 = 지역 전체 (연도 조합 × 단계 전부)
    total = by.sum() + flags[~assigned].sum()
    if not (total == flags.sum()).all():
        raise SystemExit("구별 합계 ≠ 지역 전체")
    print(f"  구 {len(districts)}개 · 시군구 코드 없음 {int((~assigned).sum()):,}건 · 구 합 = 전체 ✓")

    out = {
        "region": REGION,
        "regionLabel": REGION_LABEL.get(REGION, REGION),
        "buildings": len(df),
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": SOURCES,
        "definition": "flood: 선택 연도 중 하나라도 침수(OR) / floodBasement: 지하층 1개 이상 / "
        "floodBasementResidential: 주거(단독 01000 또는 지상 1~4층 공동 02000) / candidate: 높이 정보 있음(heightSource≠DEFAULT) / "
        "noHeight: 주거까지 맞지만 높이 정보가 없어 빠진 수",
        "funnel": funnel,
        "unassigned": int((~assigned).sum()),
        "districts": districts,
    }
    TILES_DIR.mkdir(parents=True, exist_ok=True)
    path = TILES_DIR / "funnel.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"→ {path.relative_to(ROOT)} · {path.stat().st_size:,}B · 읽기 {t_read:.1f}s · 전체 {time.perf_counter() - t0:.1f}s")


if __name__ == "__main__":
    main()
