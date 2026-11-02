import { readFileSync } from "node:fs";
import { deserialize } from "flatgeobuf/geojson";
import type { Polygon, MultiPolygon } from "geojson";
import type { Building } from "../../../schema/building.js";

/** 건물 한 동: 속성 + 바닥면 + 계산용 값 */
export interface BuildingFeature {
  row: number; // 원본 순서. 나중에 타일 안에서 featureId를 새로 매김
  props: Building;
  geometry: Polygon | MultiPolygon; // 위경도
  bbox: [number, number, number, number]; // [서, 남, 동, 북] (도)
  center: [number, number]; // bbox 중심 (도)
  size: number; // 크기(m) = max(가로, 세로, 높이)
}

const M_PER_DEG_LAT = 110_574;

export async function loadBuildings(path: string): Promise<BuildingFeature[]> {
  const bytes = new Uint8Array(readFileSync(path));
  const out: BuildingFeature[] = [];
  let row = 0;
  for await (const f of deserialize(bytes)) {
    const geometry = f.geometry as Polygon | MultiPolygon;
    const rings =
      geometry.type === "Polygon"
        ? geometry.coordinates
        : geometry.coordinates.flat();
    let w = Infinity,
      s = Infinity,
      e = -Infinity,
      n = -Infinity;
    for (const ring of rings)
      for (const [x, y] of ring) {
        if (x < w) w = x;
        if (x > e) e = x;
        if (y < s) s = y;
        if (y > n) n = y;
      }
    const props = f.properties as unknown as Building;
    const lat = (s + n) / 2;
    const dx = (e - w) * M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
    const dy = (n - s) * M_PER_DEG_LAT;
    out.push({
      row: row++,
      props,
      geometry,
      bbox: [w, s, e, n],
      center: [(w + e) / 2, lat],
      size: Math.max(dx, dy, props.height),
    });
  }
  return out;
}
