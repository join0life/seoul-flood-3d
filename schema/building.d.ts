// 자동 생성 파일. 직접 고치지 말 것. 원본: schema/building.json
// 다시 만들기: cd tiler/node && npm run gen-types

/** 0=ORIGINAL, 1=FROM_FLOORS, 2=DEFAULT */
export type HeightSource = 0 | 1 | 2;

/** 건물 1동 = 속성표 1줄 */
export interface Building {
  /** 원본 건물 번호(A1 GIS건물통합식별번호). 원본 데이터와 다시 맞춰볼 때 씀 */
  buildingId: string;
  /** 침수 이력. 자리 번호 = 연도 - 2010. UINT16(16자리)이라 2010~2025만 지원. 예: 2022년만 잠김 = 4096 */
  floodYears: number;
  /** 지상층수(A26). 상세 패널 */
  grndFlr: number;
  /** 지하층수(A27, 건축물대장 기준). 셰이더 후보 판정 + 상세 패널 */
  ugrndFlr: number;
  /** 용도코드(A8, 대분류). 상세 패널 */
  usage: string;
  /** 단독주택 01000 또는 지상 1~4층 공동주택 02000. 셰이더 후보 판정 */
  isResidential: boolean;
  /** 돌출 높이(m). 원본 → 지상층수 × 3.25 → 3.25 */
  height: number;
  /** 높이를 어디서 얻었나. DEFAULT면 후보 제외 + 상세 패널에 높이 정보 없음 */
  heightSource: HeightSource;
}
