// 건물 상세(#info): 판정 결과 한 줄 → 후보 조건 체크리스트(✓/✗ + 사람이 읽는 근거) → 기타 속성
// 판정 자체는 layer-style.js의 judge()(= 화면 색과 같은 조건식). 여기서는 근거를 글로 풀기만 함
//
// 보여주는 속성은 타일에 들어 있는 것뿐(주소·피해 위치 같은 개별 정보는 타일러에서 이미 버림)

import { CANDIDATE_CONDITIONS, floodYearList, judge, PROP } from "./layer-style.js";

// 용도 이름은 데이터 근거가 있는 것만(README 5.1: 대분류 01000 단독주택, 02000 공동주택). 나머지는 코드 그대로
const USAGE_NAME = { "01000": "단독주택", "02000": "공동주택" };
// heightSource ENUM 이름 → 글 (schema/building.json enums.heightSource 설명 기준)
const HEIGHT_SOURCE = { ORIGINAL: "원본 높이", FROM_FLOORS: "층수로 계산", DEFAULT: "정보 없음(기본값 3.25m)" };

const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};

/** 조건 id → [이름, 근거 DOM]. CONDITIONS에 조건이 늘면 여기 이름이 없어도 id로 표시 */
const EVIDENCE = {
  flood: (f, years) => {
    const all = floodYearList(f.getProperty(PROP.floodYears));
    if (!all.length) return ["침수 이력", "없음"];
    // 선택 안 된 연도도 같이 보여줌(회색) → "2025엔 잠겼지만 지금은 2022만 보는 중"이 드러나게
    const chips = all.map((y) => el("span", { className: years.includes(y) ? "" : "off", title: years.includes(y) ? "" : "선택 안 한 연도" }, `${y}`));
    return ["침수 이력", el("span", {}, ...chips.flatMap((c, i) => (i ? [" · ", c] : [c])))];
  },
  basement: (f) => {
    const n = f.getProperty(PROP.ugrndFlr);
    return ["지하층", n >= 1 ? `지하 ${n}층` : "없음"];
  },
  residential: (f) => {
    const usage = f.getProperty("usage");
    const floors = f.getProperty("grndFlr");
    if (!usage) return ["주거", "용도 정보 없음"];
    if (usage === "02000") {
      // isResidential은 지상 1~4층 공동주택만(schema 설명). 5층 이상이면 왜 ✗인지 같이 적음
      const why = f.getProperty(PROP.isResidential) ? "" : " · 지상 1~4층만 해당";
      return ["주거", `공동주택(지상 ${floors}층)${why}`];
    }
    return ["주거", USAGE_NAME[usage] ?? `용도 코드 ${usage}`];
  },
  measuredHeight: (f) => ["높이 정보", HEIGHT_SOURCE[f.getProperty(PROP.heightSource)] ?? f.getProperty(PROP.heightSource)],
};

/** 상세를 container에 그림. 타일이 내려가 feature를 못 읽으면 false(→ 호출한 쪽이 패널을 닫음) */
export function renderDetail(container, feature, years) {
  let body;
  try {
    const { checks, layer, verdict } = judge(feature, years);
    const swatch = el("span", { className: "swatch", ariaHidden: "true", style: `background:${layer?.color ?? "#e5e7eb"}` });
    const list = el("ul", { className: "checks" });
    for (const id of CANDIDATE_CONDITIONS) {
      const [name, evidence] = EVIDENCE[id]?.(feature, years) ?? [id, ""];
      list.append(
        el("li", { className: checks[id] ? "ok" : "no" },
          el("span", { className: "mark", ariaLabel: checks[id] ? "충족" : "미충족" }, checks[id] ? "✓" : "✗"),
          el("b", {}, name), " ", evidence),
      );
    }
    const height = feature.getProperty("height");
    body = [
      el("div", { className: "verdict" }, swatch, verdict),
      el("div", { className: "basis" }, `선택 연도 ${years.join(", ")} 기준 · 후보 조건`),
      list,
      el("dl", {},
        // 소수 둘째 자리까지, 끝의 0은 뺌: 기본값 3.25가 3.3으로 보이면 "기본값 3.25m" 근거와 어긋남
        el("dt", {}, "높이"), el("dd", {}, `${Number(Number(height).toFixed(2))}m`),
        el("dt", {}, "지상층수"), el("dd", {}, `${feature.getProperty("grndFlr")}층`),
        el("dt", {}, "건물 ID"), el("dd", {}, feature.getProperty("buildingId"))),
    ];
  } catch {
    return false; // 캐시에서 내려간 타일의 feature
  }
  container.replaceChildren(...body);
  container.className = "detail";
  container.hidden = false;
  return true;
}
