// 하단 깔때기: 침수 이력 → 지하층 있음 → 현장 확인 후보 (선택 연도 조합 기준, 지역 전체)
// 숫자는 타일러 s09가 지역 전체를 세어 둔 funnel.json. 화면에서 세지 않음(보이는 타일만 세져서 틀림)

const fmt = (n) => n.toLocaleString("ko-KR");
const pct = (n, base) => (base ? `${((n / base) * 100).toFixed(1)}%` : "–"); // 70.0%처럼 자릿수 고정
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};

/** 화면 연도 선택 → funnel.json 키 ("2022", "2025", "2022+2025") */
const yearKey = (years) => [...years].sort().join("+");

/**
 * funnel.json을 받아 container에 깔때기를 그림. 파일이 없으면(그 지역은 s09를 안 돌림) 숨기고 경고
 * @returns {Promise<(years: number[]) => void>} 연도가 바뀔 때 부를 갱신 함수
 */
export async function mountFunnel(container, url) {
  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status}`);
    data = await res.json();
  } catch (e) {
    console.warn(`[funnel] ${url} 없음(${e.message}) → 깔때기 숨김. 타일러 s09를 돌릴 것`);
    container.hidden = true;
    return () => {};
  }

  return function update(years) {
    const f = data.funnel[yearKey(years)];
    if (!f) {
      container.hidden = true;
      return;
    }
    const step = (label, n, base, note) =>
      el("div", { className: "step" },
        el("div", { className: "label" }, label),
        el("div", { className: "num" }, fmt(n), el("small", {}, "건")),
        el("div", { className: "pct" }, base === null ? " " : `이전 단계의 ${pct(n, base)}`),
        ...(note ? [el("div", { className: "note" }, note)] : []));
    const dropped = f.floodBasementResidential - f.candidate;
    container.replaceChildren(
      el("div", { className: "title" }, `${data.regionLabel} · ${years.join(", ")} 침수`),
      el("div", { className: "steps" },
        step("침수 이력", f.flood, null),
        el("span", { className: "arrow", ariaHidden: "true" }, "→"),
        step("지하층 있음", f.floodBasement, f.flood),
        el("span", { className: "arrow", ariaHidden: "true" }, "→"),
        // 3단계는 주거 + 높이 정보까지 거른 최종 후보. 높이 때문에 빠진 수는 따로 밝힘
        step("현장 확인 후보", f.candidate, f.floodBasement, dropped ? `높이 정보 없는 건물 ${fmt(dropped)}건 제외` : null)),
      el("div", { className: "source" }, `출처: ${data.sources.building} · ${data.sources.flood}`),
    );
    container.hidden = false;
  };
}
