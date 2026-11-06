// LNB 구 목록: 맨 위 "지역 전체" 줄(고정) + 구별 현장 확인 후보 순위(순위 · 구 이름 · 막대 · 후보 수)
// 숫자는 funnel.json(타일러 s09)의 구별 값. 화면에서 세지 않음
//
// 줄 DOM은 처음에 한 번만 만들고 정렬 때는 옮기기만 함 → 연도가 바뀌면 막대가 이전 길이에서 새 길이로 전환
// (줄을 새로 만들면 이전 길이가 없어서 전환 없이 바로 바뀜)
// Chrome은 DOM에서 옮긴 요소의 전환을 시작하지 않음(실측: 옮긴 막대 getAnimations() 0개, 안 옮기면 1개)
// → 옮긴 뒤 이전 길이를 다시 넣고 스타일을 한 번 확정한 다음 새 길이를 넣음
// CSS order로 화면 순서만 바꾸면 전환은 살지만 Tab 순서가 화면 순서와 어긋나서 안 씀

import { LAYERS } from "./layer-style.js";
import { yearKey } from "./funnel.js";

const fmt = (n) => n.toLocaleString("ko-KR");
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};
// 막대 색 = 지도의 후보(주황) 색. 레이어 색을 바꾸면 같이 바뀜
const BAR_COLOR = LAYERS.find((l) => l.id === "candidate").color;
const SORTS = [
  ["count", "후보 많은 순"],
  ["name", "이름 순"],
];

/**
 * @param onSelect (district | null) => void. 줄을 눌렀을 때만 부름(카메라 이동과는 무관)
 * @returns {{ update(years: number[], selected: object | null): void }}
 */
export function mountDistrictList(container, data, onSelect) {
  let sort = "count";
  let last = null; // 마지막 update 인자(정렬만 바꿀 때 다시 씀)

  const sortBox = el("fieldset", { className: "sort" }, el("legend", { className: "sr-only" }, "정렬"));
  for (const [value, label] of SORTS) {
    const radio = el("input", { type: "radio", name: "district-sort", value, checked: value === sort });
    radio.onchange = () => {
      sort = value;
      last && update(...last);
    };
    sortBox.append(el("label", {}, radio, ` ${label}`));
  }
  const heading = el("h2", { className: "title" });

  const row = (d) => {
    const fill = el("span", { className: "fill", style: `background:${BAR_COLOR}` });
    const btn = el("button", { type: "button", className: "row" },
      el("span", { className: "rank" }),
      el("span", { className: "name" }, d ? d.name : data.regionLabel),
      d ? el("span", { className: "bar", ariaHidden: "true" }, fill) : el("span"),
      el("span", { className: "num" }));
    btn.onclick = () => onSelect(d);
    return { btn, fill, rank: btn.children[0], num: btn.children[3], scale: 0 };
  };
  const all = row(null);
  all.btn.classList.add("all");
  const rows = new Map(data.districts.map((d) => [d.code, { d, ...row(d) }]));
  const scroll = el("div", { className: "scroll" }, ...[...rows.values()].map((r) => r.btn));
  container.replaceChildren(el("div", { className: "head" }, heading, sortBox), all.btn, scroll);

  function update(years, selected) {
    last = [years, selected];
    const key = yearKey(years);
    const n = (d) => d.funnel[key]?.candidate ?? 0;
    heading.textContent = `구별 현장 확인 후보 · ${years.join(", ")}`;

    // 순위는 항상 후보 많은 순 기준(같은 수면 같은 순위). 이름 순으로 바꿔도 숫자는 그대로
    const values = data.districts.map(n);
    const max = Math.max(0, ...values);
    for (const r of rows.values()) {
      const v = n(r.d);
      r.rank.textContent = 1 + values.filter((x) => x > v).length;
      r.num.textContent = fmt(v); // 숫자는 즉시(세어 올라가는 효과 없음)
      r.btn.setAttribute("aria-pressed", String(r.d === selected));
    }
    all.num.textContent = fmt(data.funnel[key]?.candidate ?? 0);
    all.btn.setAttribute("aria-pressed", String(selected === null));

    const order = [...rows.values()].sort((a, b) =>
      sort === "name" ? a.d.name.localeCompare(b.d.name, "ko") : n(b.d) - n(a.d) || a.d.name.localeCompare(b.d.name, "ko"));
    scroll.append(...order.map((r) => r.btn)); // 같은 노드를 옮기기만 함(새로 안 만듦) → DOM 순서 = 화면 순서 = Tab 순서

    // 막대 길이 = 그 연도 1위 구 대비. width 대신 scaleX → 레이아웃을 다시 안 하고 합성만
    for (const r of rows.values()) r.fill.style.transform = `scaleX(${r.scale})`; // 옮긴 요소에 이전 길이
    scroll.getBoundingClientRect(); // 스타일 확정(이전 길이가 전환 시작점이 됨). 25줄을 한 번에 → 강제 레이아웃 1회
    for (const r of rows.values()) {
      r.scale = max ? n(r.d) / max : 0;
      r.fill.style.transform = `scaleX(${r.scale})`;
    }
  }
  return { update };
}
