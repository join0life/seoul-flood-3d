import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBuildings } from "../src/load.js";
import { buildQuadtree, MAX_PER_TILE, type TileNode } from "../src/quadtree.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const t0 = performance.now();

const buildings = await loadBuildings(resolve(root, "data/work/gwanak.fgb"));
const t1 = performance.now();
const tree = buildQuadtree(buildings);
const t2 = performance.now();

// 통계
const tiles: TileNode[] = [];
(function walk(n: TileNode) {
  tiles.push(n);
  n.children.forEach(walk);
})(tree);
const total = tiles.reduce((s, t) => s + t.buildings.length, 0);
const byLevel = new Map<
  number,
  { tiles: number; buildings: number; maxErr: number }
>();
for (const t of tiles) {
  const v = byLevel.get(t.level) ?? { tiles: 0, buildings: 0, maxErr: 0 };
  v.tiles++;
  v.buildings += t.buildings.length;
  v.maxErr = Math.max(v.maxErr, t.geometricError);
  byLevel.set(t.level, v);
}

console.log(
  `건물 ${buildings.length.toLocaleString()}동 읽음 · 타일 ${tiles.length}개 · 타일당 최대 ${MAX_PER_TILE}동`,
);
console.log(
  `타일에 들어간 건물 합계 ${total.toLocaleString()}동 ${total === buildings.length ? "(중복·누락 없음)" : "(개수 불일치!)"}`,
);
console.log("레벨 | 타일 | 건물 | geometricError 최대(m)");
for (const [lv, v] of [...byLevel].sort((a, b) => a[0] - b[0])) {
  console.log(
    `  ${lv}  | ${String(v.tiles).padStart(4)} | ${String(v.buildings).padStart(6)} | ${v.maxErr.toFixed(1)}`,
  );
}
console.log(
  `읽기 ${((t1 - t0) / 1000).toFixed(1)}s · 쿼드트리 ${((t2 - t1) / 1000).toFixed(1)}s`,
);
console.log("첫 건물 속성 확인:", buildings[0].props);
