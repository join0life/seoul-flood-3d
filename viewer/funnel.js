// LNB 지표(깔때기): 침수 이력 → 현장 확인 후보 (선택 연도 조합 기준, 지역 전체 또는 고른 구)
// 화면은 2줄. funnel.json의 지하층·주거 단계 숫자(floodBasement 등)는 그대로 둠(화면에서만 안 씀)
// 숫자는 타일러 s09가 지역 전체·구별로 세어 둔 funnel.json. 화면에서 세지 않음(보이는 타일만 세져서 틀림)

const fmt = (n) => n.toLocaleString("ko-KR");
const pct = (n, base) => (base ? `${((n / base) * 100).toFixed(1)}%` : "–"); // 70.0%처럼 자릿수 고정
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};

/** 화면 연도 선택 → funnel.json 키 ("2022", "2025", "2022+2025") */
export const yearKey = (years) => [...years].sort().join("+");

/** funnel.json을 받음. 파일이 없으면(그 지역은 s09를 안 돌림) null + 경고 */
export async function loadFunnel(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn(`[funnel] ${url} 없음(${e.message}) → 지표·구 목록 숨김. 타일러 s09를 돌릴 것`);
    return null;
  }
}

/**
 * 깔때기를 container에 그림
 * @param district null이면 지역 전체, 아니면 data.districts의 한 항목
 */
export function renderFunnel(container, data, district, years) {
  const f = (district ?? data).funnel[yearKey(years)];
  if (!f) {
    container.hidden = true;
    return;
  }
  const step = (label, n, base, baseLabel, note) =>
    el("li", { className: "step" },
      el("span", { className: "label" }, label),
      el("span", { className: "num" }, fmt(n), el("small", {}, "건")),
      ...(base === null ? [] : [el("span", { className: "pct" }, `${baseLabel}의 ${pct(n, base)}`)]),
      ...(note ? [el("span", { className: "note" }, note)] : []));
  const dropped = f.noHeight ?? f.floodBasementResidential - f.candidate;
  container.replaceChildren(
    el("h2", { className: "title" }, `지표 · ${district?.name ?? data.regionLabel} · ${years.join(", ")}`),
    el("ol", { className: "steps" },
      step("침수 이력", f.flood, null),
      // 후보 = 침수 이력 중 지하층 + 주거 + 높이 정보까지 거른 최종 후보. 높이 때문에 빠진 수는 따로 밝힘
      step("현장 확인 후보", f.candidate, f.flood, "침수 이력", dropped ? `높이 정보 없는 건물 ${fmt(dropped)}건 제외` : null)),
    el("div", { className: "source" }, `출처: ${data.sources.building} · ${data.sources.flood}`),
  );
  container.hidden = false;
}
