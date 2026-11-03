"""침수 연도·날짜 설정. s04(겹침 계산)와 s05(연도별 후보 수)가 같이 씀

import할 때 연도 범위를 검사하므로, 범위 밖 연도를 넣으면 s04·s05 모두 시작 전에 멈춤
"""

# 침수 날짜. 이 날짜 이후 사용승인된 건물은 그 해 침수에서 제외
# 날짜가 None인데 그 해 침수에 닿은 건물이 있으면 s04에서 멈춤
FLOOD_DATES = {
    2022: "2022-08-08",
    2025: "2025-08-13",   # 원본 '피해일시' 칸의 82%가 이 날 (README 5.1 침수 날짜)
}
FIRST_YEAR = 2010   # floodYears 자리 번호 = 연도 - 2010. UINT16(16자리)이라 2010~2025만 담김
LAST_YEAR = FIRST_YEAR + 15

_bad = [y for y in FLOOD_DATES if not FIRST_YEAR <= y <= LAST_YEAR]
if _bad:
    raise ValueError(f"침수 연도 {_bad}: floodYears가 UINT16이라 {FIRST_YEAR}~{LAST_YEAR}만 지원")
