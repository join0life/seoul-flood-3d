// 건물 색칠 레이어. 레이어 상태(켜진 레이어, 선택 연도) → Cesium3DTileStyle 하나를 만드는 함수만 둠
// 토글·연도를 바꾸면 스타일을 새로 만들어 tileset.style에 통째로 교체(부분 수정 없음 → 상태가 한 곳에만 있음)
//
// 왜 Cesium3DTileStyle(조건식)인가: 색 규칙이 "속성 비교 몇 개"라 표준 스타일 언어로 충분하고,
// Cesium이 건물마다 식을 계산해 색 버퍼만 바꿈. CustomShader는 GLSL을 직접 써야 해서 이 단계엔 과함
//
// 스타일 언어 확인(Cesium 1.146, 콘솔에서 Cesium.Expression으로 테스트):
//   % 됨(7 % 3 = 1) / & 없음("Unexpected operator") / == 없음, === 만 됨
//   → 비트 확인은 floor(값 / 2^자리) % 2 === 1

import schema from "../schema/building.json" with { type: "json" };

// 속성 이름은 schema/building.json 그대로. 이름이 바뀌면 여기서 바로 멈춤(조용히 전부 회색이 되지 않게)
const SCHEMA_PROPS = schema.classes.building.properties;
export const PROP = {
  floodYears: "floodYears",
  ugrndFlr: "ugrndFlr",
  isResidential: "isResidential",
  heightSource: "heightSource",
};
for (const name of Object.values(PROP))
  if (!SCHEMA_PROPS[name]) throw new Error(`schema/building.json에 ${name} 속성이 없음`);

/** floodYears 자리 번호 = 연도 - 2010 (schema 설명 그대로). UINT16이라 2010~2025 */
const FLOOD_BASE_YEAR = 2010;
export const YEARS = [2022, 2025];

const v = (name) => `\${${name}}`;
const hasFloodBit = (year) => `(floor(${v(PROP.floodYears)} / ${2 ** (year - FLOOD_BASE_YEAR)}) % 2 === 1)`;

/** 조건은 여기 한 곳에만. 레이어는 이 이름을 골라 씀 */
const CONDITIONS = {
  // 선택한 연도 중 하나라도 침수. 연도를 하나도 안 고르면 거짓 → 두 레이어 모두 안 칠함
  flood: (years) => (years.length ? years.map(hasFloodBit).join(" || ") : "false"),
  basement: () => `${v(PROP.ugrndFlr)} >= 1`,
  residential: () => `${v(PROP.isResidential)} === true`,
  // 높이 정보가 없는 건물(DEFAULT, 3.25m로 그림)은 후보에서 뺌. 메타데이터 ENUM은 이름 문자열로 옴
  measuredHeight: () => `${v(PROP.heightSource)} !== 'DEFAULT'`,
};

/** 위에 있을수록 우선(켜진 레이어 중 먼저 맞는 색). 나머지는 BASE_COLOR */
export const LAYERS = [
  { id: "candidate", label: "현장 확인 후보", when: ["flood", "basement", "residential", "measuredHeight"], color: "#ff8c1a" },
  { id: "flood", label: "침수 이력", when: ["flood"], color: "#8ec5ff" },
];
const BASE_COLOR = "#b4b4b4";

export const DEFAULT_STATE = { layers: new Set(LAYERS.map((l) => l.id)), years: [2022] };

/** @param {{ layers: Set<string>, years: number[] }} state */
export function buildStyle(state) {
  const conditions = LAYERS.filter((l) => state.layers.has(l.id)).map((l) => [
    l.when.map((c) => `(${CONDITIONS[c](state.years)})`).join(" && "),
    `color('${l.color}')`,
  ]);
  conditions.push(["true", `color('${BASE_COLOR}')`]);
  return new Cesium.Cesium3DTileStyle({ color: { conditions } });
}

/** 최소 UI: 레이어·연도 체크박스. 바뀔 때마다 onChange(새 상태) */
export function mountLayerControls(parent, state, onChange) {
  const row = (label, checked, toggle) => {
    const l = document.createElement("label");
    const c = document.createElement("input");
    c.type = "checkbox";
    c.checked = checked;
    c.onchange = () => {
      toggle(c.checked);
      onChange(state);
    };
    l.append(c, ` ${label}`);
    parent.append(l, document.createElement("br"));
  };
  for (const l of LAYERS) row(l.label, state.layers.has(l.id), (on) => (on ? state.layers.add(l.id) : state.layers.delete(l.id)));
  for (const y of YEARS)
    row(`${y}년`, state.years.includes(y), (on) => {
      state.years = on ? [...state.years, y].sort() : state.years.filter((x) => x !== y);
    });
}
