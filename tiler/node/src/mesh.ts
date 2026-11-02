import earcut, { deviation } from "earcut";
import type { Polygon, Position } from "geojson";
import { enuAt, toEcef, toLocal, type Enu, type Vec3 } from "./geo.js";
import type { TileNode } from "./quadtree.js";

/** 타일 하나 = 건물 전부를 합친 메시 하나 (draw call 1번) */
export interface TileMesh {
  enu: Enu; // 타일 중심. 0-8에서 transform으로 씀
  positions: Float32Array; // [동, 북, 위] × 꼭짓점 수 (m, 타일 중심 기준)
  normals: Float32Array; // 면 방향 (조명 계산용)
  featureIds: Uint16Array; // 꼭짓점마다 "이 타일 속성표의 몇 번째 줄인지"
  indices: Uint32Array; // 삼각형 = 꼭짓점 번호 3개씩
  maxDeviation: number; // 지붕 삼각분할 면적 오차(0에 가까울수록 정확)
}

export function buildTileMesh(tile: TileNode): TileMesh {
  const [w, s, e, n] = tile.region;
  const enu = enuAt((w + e) / 2, (s + n) / 2);
  const pos: number[] = [],
    nor: number[] = [],
    fid: number[] = [],
    idx: number[] = [];
  let maxDeviation = 0;

  const addVertex = (p: Vec3, normal: Vec3, id: number) => {
    pos.push(...p);
    nor.push(...normal);
    fid.push(id);
    return pos.length / 3 - 1;
  };
  // 삼각형 앞면이 normal 쪽을 보도록 순서를 맞춰서 넣음
  const addTriangle = (a: number, b: number, c: number, normal: Vec3) => {
    const P = (i: number): Vec3 => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const [p0, p1, p2] = [P(a), P(b), P(c)];
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const cross = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const facing =
      cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2];
    facing >= 0 ? idx.push(a, b, c) : idx.push(a, c, b);
  };

  tile.buildings.forEach((b, featureId) => {
    const polygons: Polygon["coordinates"][] =
      b.geometry.type === "Polygon"
        ? [b.geometry.coordinates]
        : b.geometry.coordinates;
    const H = b.props.height;

    for (const polygon of polygons) {
      // GeoJSON 고리는 첫 점 = 끝 점이라 끝 점을 뺌
      const rings = polygon
        .map((r) => r.slice(0, -1))
        .filter((r) => r.length >= 3);
      if (!rings.length) continue;
      const bottom = rings.map((r) =>
        r.map(([x, y]: Position) => toLocal(enu, toEcef(x, y, 0))),
      );
      const top = rings.map((r) =>
        r.map(([x, y]: Position) => toLocal(enu, toEcef(x, y, H))),
      );

      // 지붕: earcut으로 삼각분할
      const flat: number[] = [],
        holes: number[] = [];
      bottom.forEach((ring, i) => {
        if (i > 0) holes.push(flat.length / 2);
        for (const p of ring) flat.push(p[0], p[1]);
      });
      const tris = earcut(flat, holes, 2);
      maxDeviation = Math.max(maxDeviation, deviation(flat, holes, 2, tris));
      const up: Vec3 = [0, 0, 1];
      const roofStart = pos.length / 3;
      for (const ring of top) for (const p of ring) addVertex(p, up, featureId);
      for (let i = 0; i < tris.length; i += 3) {
        addTriangle(
          roofStart + tris[i],
          roofStart + tris[i + 1],
          roofStart + tris[i + 2],
          up,
        );
      }

      // 벽: 모서리마다 사각형 1개 = 삼각형 2개. 면마다 방향이 달라서 꼭짓점을 따로 둠
      rings.forEach((_, r) => {
        const ring = bottom[r],
          ringTop = top[r];
        // 바깥 고리는 반시계, 구멍은 시계 방향으로 맞추면 "오른쪽 = 건물 바깥"
        const area = ring.reduce((sum, p, i) => {
          const q = ring[(i + 1) % ring.length];
          return sum + p[0] * q[1] - q[0] * p[1];
        }, 0);
        const flip = r === 0 ? area < 0 : area > 0;
        for (let i = 0; i < ring.length; i++) {
          let a = i,
            c = (i + 1) % ring.length;
          if (flip) [a, c] = [c, a];
          const dx = ring[c][0] - ring[a][0],
            dy = ring[c][1] - ring[a][1];
          const len = Math.hypot(dx, dy);
          if (len < 1e-6) continue;
          const out: Vec3 = [dy / len, -dx / len, 0];
          const v0 = addVertex(ring[a], out, featureId),
            v1 = addVertex(ring[c], out, featureId);
          const v2 = addVertex(ringTop[c], out, featureId),
            v3 = addVertex(ringTop[a], out, featureId);
          addTriangle(v0, v1, v2, out);
          addTriangle(v0, v2, v3, out);
        }
      });
      // 바닥면은 안 만듦: 땅에 붙어 있어 보이지 않음 → 삼각형 절약
    }
  });

  return {
    enu,
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    featureIds: new Uint16Array(fid),
    indices: new Uint32Array(idx),
    maxDeviation,
  };
}
