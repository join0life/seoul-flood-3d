// WGS84 위경도·높이 ↔ ECEF(지구 중심 좌표) ↔ ENU(타일 중심 기준 동·북·위 좌표)
const A = 6378137; // 적도 반지름(m)
const F = 1 / 298.257223563; // 편평률
const E2 = F * (2 - F); // 이심률 제곱

export type Vec3 = [number, number, number];

/** 위경도(도)·높이(m) → ECEF(m) */
export function toEcef(lon: number, lat: number, h: number): Vec3 {
  const l = (lon * Math.PI) / 180,
    p = (lat * Math.PI) / 180;
  const sinP = Math.sin(p),
    cosP = Math.cos(p);
  const N = A / Math.sqrt(1 - E2 * sinP * sinP);
  return [
    (N + h) * cosP * Math.cos(l),
    (N + h) * cosP * Math.sin(l),
    (N * (1 - E2) + h) * sinP,
  ];
}

/** 한 지점에서 본 동·북·위 방향 (타일 중심에 하나씩) */
export interface Enu {
  origin: Vec3;
  east: Vec3;
  north: Vec3;
  up: Vec3;
}

export function enuAt(lon: number, lat: number): Enu {
  const l = (lon * Math.PI) / 180,
    p = (lat * Math.PI) / 180;
  const sl = Math.sin(l),
    cl = Math.cos(l),
    sp = Math.sin(p),
    cp = Math.cos(p);
  return {
    origin: toEcef(lon, lat, 0),
    east: [-sl, cl, 0],
    north: [-sp * cl, -sp * sl, cp],
    up: [cp * cl, cp * sl, sp],
  };
}

/** ECEF 점 → 타일 중심 기준 [동, 북, 위](m). 값이 작아서 float32로 저장해도 안 떨림 */
export function toLocal(enu: Enu, p: Vec3): Vec3 {
  const d: Vec3 = [
    p[0] - enu.origin[0],
    p[1] - enu.origin[1],
    p[2] - enu.origin[2],
  ];
  const dot = (v: Vec3) => d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
  return [dot(enu.east), dot(enu.north), dot(enu.up)];
}

/** 3D Tiles 타일 transform: 지역 좌표 → ECEF (4×4, 열 우선) */
export function enuToEcefMatrix(enu: Enu): number[] {
  return [...enu.east, 0, ...enu.north, 0, ...enu.up, 0, ...enu.origin, 1];
}
