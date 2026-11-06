"""s09: 깔때기 숫자(침수 이력 → 지하층 → 주거 → 최종 후보)를 지역 전체 기준으로 세어 funnel.json으로

왜 타일러가 세나: 화면은 지금 보이는 타일의 건물만 알아서, 화면에서 세면 카메라마다 숫자가 달라짐(틀림)
판정은 viewer/layer-style.js CONDITIONS와 같은 정의. 규칙을 Python에 다시 쓰는 것이라
속성 이름·heightSource 값은 schema/building.json에서 읽음(이름이 바뀌면 여기서 멈춤)
  flood          선택 연도 중 하나라도 floodYears 비트가 켜짐 (OR)
  basement       ugrndFlr >= 1
  residential    isResidential == True
  measuredHeight heightSource != DEFAULT

실행 순서: s08 다음 (s08이 data/tiles/<지역>/을 지우고 다시 만들어서, 먼저 돌리면 funnel.json이 지워짐)
예: REGION=seoul python tiler/py/s09_funnel.py  → data/tiles/seoul/funnel.json
"""
import json
import time
from datetime import datetime, timezone

import pyogrio

from flood_dates import FIRST_YEAR
from region import FGB, REGION, ROOT, TILES_DIR

SCHEMA = json.loads((ROOT / "schema/building.json").read_text(encoding="utf-8"))
PROPS = SCHEMA["classes"]["building"]["properties"]
P = {k: k for k in ("floodYears", "ugrndFlr", "isResidential", "heightSource")}
for name in P.values():
    if name not in PROPS:
        raise SystemExit(f"schema/building.json에 {name} 속성이 없음")
DEFAULT_HEIGHT = next(v["value"] for v in SCHEMA["enums"]["heightSource"]["values"] if v["name"] == "DEFAULT")

# 화면 연도 선택과 같은 키("+"로 이음, 오름차순)
YEAR_SETS = {"2022": [2022], "2025": [2025], "2022+2025": [2022, 2025]}

# 출처(README 5.1 사용 데이터와 같은 값). 데이터를 바꾸면 여기도 바꿀 것
SOURCES = {
    "building": "GIS건물통합정보(국토교통부) 기준일 2026-10-09",
    "flood": "서울시 침수흔적도 2022(2026.1.5 수정본)·2025",
}
REGION_LABEL = {"seoul": "서울 전체", "gwanak": "관악구"}


def main():
    t0 = time.perf_counter()
    print(f"REGION={REGION}")
    df = pyogrio.read_dataframe(FGB, columns=list(P.values()), read_geometry=False)

    basement = df[P["ugrndFlr"]] >= 1
    residential = df[P["isResidential"]] == True  # noqa: E712 (NaN이 섞여도 거짓으로)
    measured = df[P["heightSource"]] != DEFAULT_HEIGHT

    funnel = {}
    for key, years in YEAR_SETS.items():
        mask = sum(1 << (y - FIRST_YEAR) for y in years)
        flood = (df[P["floodYears"]].astype("int64") & mask) > 0
        fb = flood & basement
        fbr = fb & residential
        funnel[key] = {
            "flood": int(flood.sum()),
            "floodBasement": int(fb.sum()),
            "floodBasementResidential": int(fbr.sum()),
            "candidate": int((fbr & measured).sum()),
        }
        print(f"  {key:>9}: " + " → ".join(f"{k} {v:,}" for k, v in funnel[key].items()))

    out = {
        "region": REGION,
        "regionLabel": REGION_LABEL.get(REGION, REGION),
        "buildings": len(df),
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": SOURCES,
        "definition": "flood: 선택 연도 중 하나라도 침수(OR) / floodBasement: 지하층 1개 이상 / "
        "floodBasementResidential: 주거(단독 01000 또는 지상 1~4층 공동 02000) / candidate: 높이 정보 있음(heightSource≠DEFAULT)",
        "funnel": funnel,
    }
    TILES_DIR.mkdir(parents=True, exist_ok=True)
    path = TILES_DIR / "funnel.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"→ {path.relative_to(ROOT)} · {time.perf_counter() - t0:.1f}s")


if __name__ == "__main__":
    main()
