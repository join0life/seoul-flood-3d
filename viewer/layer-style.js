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
  if (!SCHEMA_PROPS[name])
    throw new Error(`schema/building.json에 ${name} 속성이 없음`);

/** floodYears 자리 번호 = 연도 - 2010 (schema 설명 그대로). UINT16이라 2010~2025 */
const FLOOD_BASE_YEAR = 2010;
export const YEARS = [2022, 2025];

const v = (name) => `\${${name}}`;
const hasFloodBit = (year) =>
  `(floor(${v(PROP.floodYears)} / ${2 ** (year - FLOOD_BASE_YEAR)}) % 2 === 1)`;

/** 조건은 여기 한 곳에만. 레이어는 이 이름을 골라 씀 */
const CONDITIONS = {
  // 선택한 연도 중 하나라도 침수. 연도를 하나도 안 고르면 거짓 → 두 레이어 모두 안 칠함
  flood: (years) =>
    years.length ? years.map(hasFloodBit).join(" || ") : "false",
  basement: () => `${v(PROP.ugrndFlr)} >= 1`,
  residential: () => `${v(PROP.isResidential)} === true`,
  // 높이 정보가 없는 건물(DEFAULT, 3.25m로 그림)은 후보에서 뺌. 메타데이터 ENUM은 이름 문자열로 옴
  measuredHeight: () => `${v(PROP.heightSource)} !== 'DEFAULT'`,
};

/**
 * 위에 있을수록 우선(켜진 레이어 중 먼저 맞는 색). 나머지는 BASE_COLOR
 * 패널 행도 이 목록으로 만듦 → 레이어를 하나 추가하면 색과 패널 행이 같이 생김
 */
export const LAYERS = [
  {
    id: "candidate",
    label: "현장 확인 후보",
    description: "침수 이력 중 지하층이 있는 주거 건물",
    when: ["flood", "basement", "residential", "measuredHeight"],
    color: "#ff8c1a",
  },
  {
    id: "flood",
    label: "침수 이력",
    verdict: "침수 이력만 있음", // 상세 패널 판정 문구(없으면 label)
    description: "선택한 연도 침수흔적에 닿은 건물",
    when: ["flood"],
    // 근거 레이어라 후보(주황)보다 약하게. 조명 뒤 화면 색 기준 회색과 ΔE 14.8, 채도는 주황의 약 36%
    // (#8ec5ff는 중간 파랑으로 보였고, #bfd9f5는 회색과 ΔE 10.7로 너무 붙음. 관악 zoom에서 비교)
    color: "#a9cbef",
  },
];
// 기타 건물. Cesium 조명이 면 방향에 따라 어둡게 곱해서, 밝게 둬야 화면에서 연한 회색으로 보임
const BASE_COLOR = "#e5e7eb";
// 범례 견본 색 = 화면에서 기타 건물이 보이는 회색. 캔버스 픽셀 실측 중앙값(11/6, 관악 232점 rgb(125,132,140) · 동작 186점 rgb(126,133,137))
// Cesium 조명은 시계(태양 방향)를 따르므로 시간대에 따라 조금 달라질 수 있음
const LEGEND_BASE_COLOR = "#7d848c";

export const DEFAULT_STATE = {
  layers: new Set(LAYERS.map((l) => l.id)),
  years: [2022],
};

/** @param {{ layers: Set<string>, years: number[] }} state */
export function buildStyle(state) {
  const conditions = LAYERS.filter((l) => state.layers.has(l.id)).map((l) => [
    l.when.map((c) => `(${CONDITIONS[c](state.years)})`).join(" && "),
    `color('${l.color}')`,
  ]);
  conditions.push(["true", `color('${BASE_COLOR}')`]);
  return new Cesium.Cesium3DTileStyle({ color: { conditions } });
}

/** 후보 레이어의 조건 = 상세 패널 체크리스트 항목(이 순서대로) */
export const CANDIDATE_CONDITIONS = LAYERS.find(
  (l) => l.id === "candidate",
).when;

/**
 * 건물 하나 판정. 화면 색과 같은 조건식(CONDITIONS)을 Cesium.Expression으로 계산 → 색과 패널이 어긋날 수 없음
 * 레이어 ON/OFF와 상관없이 "선택 연도 기준으로 어느 레이어에 해당하나"(LAYERS 우선순위)
 * @returns {{ checks: Record<string, boolean>, verdict: string, layer: object | null }}
 */
export function judge(feature, years) {
  const ids = new Set(LAYERS.flatMap((l) => l.when));
  const checks = Object.fromEntries(
    [...ids].map((c) => [
      c,
      new Cesium.Expression(CONDITIONS[c](years)).evaluate(feature) === true,
    ]),
  );
  const layer = LAYERS.find((l) => l.when.every((c) => checks[c])) ?? null;
  return {
    checks,
    layer,
    verdict: layer ? (layer.verdict ?? layer.label) : "해당 없음",
  };
}

/** floodYears 비트 → 연도 목록 (자리 번호 = 연도 - 2010, UINT16) */
export const floodYearList = (bits) =>
  Array.from({ length: 16 }, (_, i) => FLOOD_BASE_YEAR + i).filter(
    (y) => Math.floor(bits / 2 ** (y - FLOOD_BASE_YEAR)) % 2 === 1,
  );

const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};
const swatch = (color) =>
  el("span", {
    className: "swatch",
    ariaHidden: "true",
    style: `background:${color}`,
  });

/**
 * 레이어 패널: 연도(복수, 최소 1개) → 레이어 토글(LAYERS 순서, 색 견본 + 설명) → 범례(기타 건물)
 * 진짜 <input type=checkbox> + <label>이라 Tab·Space로 조작됨. 바뀔 때마다 onChange(상태)
 */
export function mountLayerPanel(parent, state, onChange) {
  const hint = el("div", { className: "hint", role: "status" });

  const years = el(
    "fieldset",
    { className: "years" },
    el("legend", {}, "연도"),
  );
  for (const y of YEARS) {
    const box = el("input", {
      type: "checkbox",
      checked: state.years.includes(y),
    });
    box.onchange = () => {
      // 연도를 다 끄면 칠할 침수가 없어 화면이 전부 회색 → 마지막 하나는 못 끄게 되돌림
      if (!box.checked && state.years.length === 1) {
        box.checked = true;
        hint.textContent = " 연도는 최소 1개 이상 선택해 주세요.";
        return;
      }
      hint.textContent = "";
      state.years = box.checked
        ? [...state.years, y].sort()
        : state.years.filter((x) => x !== y);
      onChange(state);
    };
    years.append(el("label", {}, box, ` ${y}`));
  }
  years.append(hint);

  const layers = el("fieldset", {}, el("legend", {}, "레이어"));
  for (const l of LAYERS) {
    const box = el("input", {
      type: "checkbox",
      checked: state.layers.has(l.id),
      id: `layer-${l.id}`,
    });
    box.onchange = () => {
      box.checked ? state.layers.add(l.id) : state.layers.delete(l.id);
      onChange(state);
    };
    // label 하나가 체크박스·견본·이름을 감쌈 → 어디를 눌러도 토글. 설명은 aria-describedby로 읽힘
    const desc = el("small", { id: `layer-${l.id}-desc` }, l.description);
    box.setAttribute("aria-describedby", desc.id);
    layers.append(
      el("label", { className: "layer" }, box, swatch(l.color), l.label, desc),
    );
  }

  // 범례는 토글이 아님: 체크박스 자리는 비우고 견본을 레이어 견본과 같은 칸에 → 꺼진 체크박스로 안 보이게
  // 견본 색은 BASE_COLOR(흰색에 가까움)가 아니라 조명을 받은 뒤 화면에 보이는 회색(LEGEND_BASE_COLOR)
  parent.append(
    years,
    layers,
    el(
      "div",
      { className: "legend" },
      el("span"),
      swatch(LEGEND_BASE_COLOR),
      "기타 건물 (항상 표시)",
    ),
  );
}
