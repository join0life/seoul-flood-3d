import { loadBuildings } from "../src/load.js";
import { buildQuadtree, type TileNode } from "../src/quadtree.js";
import { buildTileMesh } from "../src/mesh.js";
import { FGB, REGION } from "../src/region.js";

console.log(`REGION=${REGION}`);
const tree = buildQuadtree(await loadBuildings(FGB));
const tiles: TileNode[] = [];
(function walk(n: TileNode) {
  tiles.push(n);
  n.children.forEach(walk);
})(tree);

const t0 = performance.now();
let vertices = 0,
  triangles = 0,
  maxVerts = 0,
  maxDev = 0,
  maxCoord = 0,
  featureCheck = true;
for (const tile of tiles) {
  const m = buildTileMesh(tile);
  const v = m.positions.length / 3;
  vertices += v;
  triangles += m.indices.length / 3;
  maxVerts = Math.max(maxVerts, v);
  maxDev = Math.max(maxDev, m.maxDeviation);
  for (const x of m.positions) maxCoord = Math.max(maxCoord, Math.abs(x));
  // featureId가 0 ~ (건물 수-1) 범위 안에 있는지
  for (const id of m.featureIds)
    if (id >= tile.buildings.length) featureCheck = false;
}
const t1 = performance.now();

const bytes = vertices * (12 + 12 + 2) + triangles * 3 * 4;
console.log(
  `타일 ${tiles.length}개 · 꼭짓점 ${vertices.toLocaleString()}개 · 삼각형 ${triangles.toLocaleString()}개`,
);
console.log(
  `타일당 최대 꼭짓점 ${maxVerts.toLocaleString()}개 ${maxVerts < 65536 ? "(Uint16 인덱스 가능)" : "(Uint32 인덱스 필요)"}`,
);
console.log(
  `지붕 삼각분할 최대 오차 ${maxDev.toExponential(2)} · 타일 중심에서 가장 먼 좌표 ${maxCoord.toFixed(0)}m`,
);
console.log(`featureId 범위 ${featureCheck ? "정상" : "이상!"}`);
console.log(
  `메시 데이터 약 ${(bytes / 1e6).toFixed(1)}MB (위치·법선·featureId·인덱스) · ${((t1 - t0) / 1000).toFixed(1)}s`,
);
