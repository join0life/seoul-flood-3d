import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { toEcef, type Enu } from "../../../shared/geo.js";
import { writeTileGlb } from "../src/glb.js";
import { loadBuildings } from "../src/load.js";
import { buildTileMesh } from "../src/mesh.js";
import { buildQuadtree, type TileNode } from "../src/quadtree.js";
import { FGB, REGION, TILES_DIR as out } from "../src/region.js";
import { buildTileset } from "../src/tileset.js";

console.log(`REGION=${REGION}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(resolve(out, "tiles"), { recursive: true });

const t0 = performance.now();
const buildings = await loadBuildings(FGB);
const tree = buildQuadtree(buildings);
const tiles: TileNode[] = [];
(function walk(n: TileNode) {
  tiles.push(n);
  n.children.forEach(walk);
})(tree);

const enuOf = new Map<string, Enu>();
let total = 0,
  maxSize = 0,
  uint16 = 0;
for (const tile of tiles) {
  const mesh = buildTileMesh(tile);
  enuOf.set(tile.id, mesh.enu);
  if (mesh.positions.length / 3 < 65536) uint16++;
  const glb = await writeTileGlb(tile, mesh);
  writeFileSync(resolve(out, `tiles/${tile.id}.glb`), glb);
  total += glb.byteLength;
  maxSize = Math.max(maxSize, glb.byteLength);
}
// 맨 위 geometricError = 아무것도 안 그렸을 때 빠지는 영역 전체의 크기(루트 경계 상자 수평 대각선, m)
// 전에는 가장 큰 건물 하나(서울 556.7m)라서 첫 화면(-55°, 서울 전체)에서 SSE가 16.89로 문턱 16에 겨우 걸림
// → 캔버스 가로가 약 1,270px보다 좁으면 루트조차 안 그려졌음. 루트 자신의 값(자식으로 내려갈지)은 그대로
const [w, s, e, n] = tree.region;
const midLat = (s + n) / 2, midLon = (w + e) / 2;
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const rootError = Math.hypot(
  dist(toEcef(w, midLat, 0), toEcef(e, midLat, 0)), // 동서 폭(가운데 위도에서)
  dist(toEcef(midLon, s, 0), toEcef(midLon, n, 0)), // 남북 폭
);
writeFileSync(
  resolve(out, "tileset.json"),
  JSON.stringify(buildTileset(tree, enuOf, rootError), null, 2),
);
const t1 = performance.now();

const src = statSync(FGB).size;
console.log(
  `GLB ${tiles.length}개 · 총 ${(total / 1e6).toFixed(1)}MB · 평균 ${(total / tiles.length / 1e3).toFixed(0)}KB · 최대 ${(maxSize / 1e3).toFixed(0)}KB`,
);
console.log(`인덱스 Uint16 ${uint16}개 / Uint32 ${tiles.length - uint16}개`);
console.log(`(참고) 입력 ${basename(FGB)} ${(src / 1e6).toFixed(1)}MB`);
console.log(
  `tileset.json 저장 · 루트 geometricError ${rootError.toFixed(1)}m · ${((t1 - t0) / 1000).toFixed(1)}s`,
);
console.log(`→ ${out}`);
