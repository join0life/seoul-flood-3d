// WGS84 위경도·높이 ↔ ECEF(지구 중심 좌표) ↔ ENU(한 지점 기준 동·북·위 좌표)
//
// 타일러(tiler/node)와 렌더러(renderer)가 같이 쓰는 공용 모듈. 라이브러리 없음(브라우저·Node 둘 다).
// 공식을 하나로 두는 이유: 타일을 만들 때 쓴 좌표 변환과 그릴 때 쓰는 변환이 같아야
// "같은 위경도 = 같은 자리"가 보장됨
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

/**
 * ECEF(m) → 위경도(도)·높이(m). toEcef의 반대
 * 위도는 식 하나로 안 풀려서 반복으로 좁힘(보통 3~4번이면 float64 한계까지 수렴)
 */
export function toGeodetic(p: Vec3): { lon: number; lat: number; height: number } {
  const [x, y, z] = p;
  const r = Math.hypot(x, y); // 지구 자전축에서 떨어진 거리
  let lat = Math.atan2(z, r * (1 - E2));
  for (let i = 0; i < 10; i++) {
    const s = Math.sin(lat);
    const N = A / Math.sqrt(1 - E2 * s * s);
    const next = Math.atan2(z + E2 * N * s, r);
    if (Math.abs(next - lat) < 1e-15) {
      lat = next;
      break;
    }
    lat = next;
  }
  const s = Math.sin(lat);
  const N = A / Math.sqrt(1 - E2 * s * s);
  // h = p/cos(lat) - N 은 극 근처에서 0으로 나눔 → 위도 방향 성분으로 계산하는 식을 씀
  const height = r * Math.cos(lat) + z * s - (A * A) / N;
  return { lon: (Math.atan2(y, x) * 180) / Math.PI, lat: (lat * 180) / Math.PI, height };
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
