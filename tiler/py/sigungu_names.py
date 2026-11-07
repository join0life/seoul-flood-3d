"""시군구 코드(A23) → 구 이름 매핑 파일(tiler/sigungu.csv)을 원본 건물 데이터에서 만듦. 이름을 손으로 치지 않음

이름 = A4(법정동명, 예: "서울특별시 관악구 봉천동")의 두 번째 단어. A3(법정동코드) 앞 5자리 = A23 (정의서 AL_D010 예시와 같음)
코드 하나에 이름이 두 개 이상 나오면 멈춤. A4는 앞 두 단어(시도·구)만 쓰고 동 이름은 버림

서울 전체 원본으로 한 번만 돌리면 됨(관악은 서울의 일부). 결과 CSV는 저장소에 커밋 → s09가 읽음
예: python tiler/py/sigungu_names.py
"""
import pyogrio

from region import REGIONS, ROOT

SOURCE = ROOT / REGIONS["seoul"]["building"]
OUT = ROOT / "tiler/sigungu.csv"
HEADER = """\
# 시군구 코드(A23) → 구 이름
# 출처: GIS건물통합정보 AL_D010 A4, 기준일 2026-10-09 (A4 법정동명의 두 번째 단어)
# A23은 행정구역 개편 시 변동 가능
# 손으로 고치지 말 것: python tiler/py/sigungu_names.py 로 다시 만듦
"""


def main():
    df = pyogrio.read_dataframe(SOURCE, columns=["A4", "A23"], read_geometry=False, encoding="cp949")
    df["name"] = df["A4"].astype(str).str.split().str[1]
    names = df.groupby("A23")["name"].unique()
    bad = names[names.map(len) != 1]
    if len(bad):
        raise SystemExit(f"코드 하나에 이름이 여러 개: {bad.to_dict()}")
    rows = [f"{code},{n[0]}" for code, n in names.sort_index().items()]
    OUT.write_text(HEADER + "code,name\n" + "\n".join(rows) + "\n", encoding="utf-8")
    print(f"→ {OUT.relative_to(ROOT)} · {len(rows)}개 구 (원본 {len(df):,}행)")


if __name__ == "__main__":
    main()
