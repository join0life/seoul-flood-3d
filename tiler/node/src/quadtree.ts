import type { BuildingFeature } from "./load.js";

export const MAX_PER_TILE = 1000; // 타일 하나에 담을 최대 건물 수(시작값. 1단계에서 측정하며 조정)
export const MAX_DEPTH = 12;

export interface TileNode {
  id: string; // "0", "0-2", "0-2-1" … 경로가 곧 이름
  level: number;
  buildings: BuildingFeature[]; // 이 타일에만 들어가는 건물 (ADD: 부모·자식에 중복 없음)
  children: TileNode[];
  geometricError: number; // 이 타일까지만 그렸을 때 빠지는 가장 큰 건물 크기(m). 잎은 0
  region: [number, number, number, number, number]; // [서, 남, 동, 북(도), 최대 높이(m)] 자기+자손 전체
}

type Bounds = [number, number, number, number];

export function buildQuadtree(all: BuildingFeature[]): TileNode {
  const b: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of all) {
    b[0] = Math.min(b[0], f.center[0]);
    b[1] = Math.min(b[1], f.center[1]);
    b[2] = Math.max(b[2], f.center[0]);
    b[3] = Math.max(b[3], f.center[1]);
  }
  return build(all, b, 0, "0");
}

function build(
  items: BuildingFeature[],
  bounds: Bounds,
  level: number,
  id: string,
): TileNode {
  const sorted = [...items].sort((a, b) => b.size - a.size); // 큰 건물부터
  const isLeaf = sorted.length <= MAX_PER_TILE || level >= MAX_DEPTH;
  const own = isLeaf ? sorted : sorted.slice(0, MAX_PER_TILE);
  const rest = isLeaf ? [] : sorted.slice(MAX_PER_TILE);

  const children: TileNode[] = [];
  if (rest.length) {
    const [w, s, e, n] = bounds;
    const mx = (w + e) / 2,
      my = (s + n) / 2;
    const quads: Bounds[] = [
      [w, s, mx, my],
      [mx, s, e, my],
      [w, my, mx, n],
      [mx, my, e, n],
    ];
    const groups: BuildingFeature[][] = [[], [], [], []];
    for (const f of rest) {
      const [x, y] = f.center;
      groups[(x >= mx ? 1 : 0) + (y >= my ? 2 : 0)].push(f);
    }
    groups.forEach((g, i) => {
      if (g.length) children.push(build(g, quads[i], level + 1, `${id}-${i}`));
    });
  }

  // 영역 = 자기 건물 + 자손 영역 전체 (자식 영역이 부모 안에 들어가야 함)
  const region: TileNode["region"] = [
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
    0,
  ];
  for (const f of own) {
    region[0] = Math.min(region[0], f.bbox[0]);
    region[1] = Math.min(region[1], f.bbox[1]);
    region[2] = Math.max(region[2], f.bbox[2]);
    region[3] = Math.max(region[3], f.bbox[3]);
    region[4] = Math.max(region[4], f.props.height);
  }
  for (const c of children) {
    for (let i = 0; i < 2; i++) region[i] = Math.min(region[i], c.region[i]);
    for (let i = 2; i < 5; i++) region[i] = Math.max(region[i], c.region[i]);
  }

  return {
    id,
    level,
    buildings: own,
    children,
    geometricError: rest.length ? rest[0].size : 0,
    region,
  };
}
