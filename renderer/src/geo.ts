// 좌표계 3개와 그 사이 변환
//
//   ECEF  : 지구 중심이 원점(m). tileset.json의 transform이 이 좌표계로 타일을 놓음. 값이 400만 m대라 float32로는 m 아래가 뭉개짐
//   지역  : 서울 중심 ENU(동·북·위, m). 렌더러가 쓰는 좌표. 서울 끝까지 ±20km라 float32로도 mm 단위가 남음
//   카메라: bench 지점 { lon, lat, height, heading, pitch } (Cesium과 같은 정의)
//
// 위경도 ↔ ECEF, ENU 축은 타일러와 같은 공용 모듈(shared/geo.ts)을 씀 → 타일을 만든 공식으로 그림

import { MathUtils, Matrix4, Vector3 } from "three";
import { enuAt, toEcef, toGeodetic, type Vec3 } from "../../shared/geo";

const { DEG2RAD, RAD2DEG } = MathUtils;

/** 지역 좌표 원점 = 서울 타일셋 루트 타일 중심(소수 6자리). 관악·서울 어느 타일셋이든 같은 원점 */
export const ORIGIN = { lon: 126.99505, lat: 37.564759, height: 0 };

/** (lon, lat, height) 자리의 ENU → ECEF 행렬. 열 = 동·북·위 축, 이동 = 그 자리의 ECEF 위치 */
function enuFrame(lon: number, lat: number, height: number, target: Matrix4): Matrix4 {
  const { east, north, up } = enuAt(lon, lat);
  const v = (a: Vec3) => new Vector3(...a);
  return target.makeBasis(v(east), v(north), v(up)).setPosition(v(toEcef(lon, lat, height)));
}

/** 지역(ENU) → ECEF */
export const LOCAL_TO_ECEF = enuFrame(ORIGIN.lon, ORIGIN.lat, ORIGIN.height, new Matrix4());
/** ECEF → 지역. 타일 행렬 맨 앞에 곱해서 400만 m 단위를 원점 기준 km 단위로 바꿈 */
export const ECEF_TO_LOCAL = LOCAL_TO_ECEF.clone().invert();

export interface CameraPoint {
  lon: number;
  lat: number;
  height: number; // 타원체 높이(m)
  heading: number; // 북쪽에서 시계 방향(도)
  pitch: number; // 수평에서 위가 +(도). 내려다보면 -
}

// 계산용 임시 행렬을 매번 새로 만들지 않고 재사용(GC 부담 줄이기).
// 동기 단일 호출 전용: 같은 함수가 겹쳐 불리거나(재진입) 워커 등에서 동시에 쓰면 값이 섞임
const _enu = new Matrix4();
const _basis = new Matrix4();

/**
 * 카메라 지점 → 지역 좌표의 카메라 행렬
 *
 * heading·pitch는 "카메라가 있는 자리"의 동·북·위 기준(Cesium과 같음). 원점의 동·북·위와는
 * 10km 떨어지면 약 0.1° 어긋나서, 원점 기준으로 바로 계산하면 Cesium 화면과 미세하게 다름.
 * 그래서 카메라 자리의 ENU 행렬로 방향을 만든 뒤 ECEF → 지역 순서로 옮김:
 *   결과 = ECEF_TO_LOCAL × ENU(카메라 자리) × 카메라 축(ENU 안에서)
 */
export function cameraPointToMatrix(p: CameraPoint, target: Matrix4): Matrix4 {
  enuFrame(p.lon, p.lat, p.height, _enu);

  const h = p.heading * DEG2RAD;
  const t = p.pitch * DEG2RAD;
  // 카메라 자리 ENU 안에서: 바라보는 방향, 위, 오른쪽 (roll 0)
  const dir = new Vector3(Math.sin(h) * Math.cos(t), Math.cos(h) * Math.cos(t), Math.sin(t));
  const up = new Vector3(-Math.sin(h) * Math.sin(t), -Math.cos(h) * Math.sin(t), Math.cos(t));
  const right = new Vector3(Math.cos(h), -Math.sin(h), 0);
  // Three.js 카메라는 자기 -Z 방향을 바라봄 → Z축 = -dir
  _basis.makeBasis(right, up, dir.negate());

  return target.copy(ECEF_TO_LOCAL).multiply(_enu).multiply(_basis);
}

/** 지역 좌표의 카메라 행렬 → 카메라 지점 (cameraPointToMatrix의 반대) */
export function matrixToCameraPoint(local: Matrix4): CameraPoint {
  const ecef = new Matrix4().multiplyMatrices(LOCAL_TO_ECEF, local);
  const pos = new Vector3().setFromMatrixPosition(ecef);
  const c = toGeodetic([pos.x, pos.y, pos.z]);

  // 바라보는 방향(-Z 열)을 카메라 자리의 동·북·위 성분으로 나눔
  const dir = new Vector3().setFromMatrixColumn(ecef, 2).negate().normalize();
  const { east, north, up } = enuAt(c.lon, c.lat);
  const e = dir.dot(new Vector3(...east));
  const n = dir.dot(new Vector3(...north));
  const u = dir.dot(new Vector3(...up));

  return {
    lon: c.lon,
    lat: c.lat,
    height: c.height,
    heading: (Math.atan2(e, n) * RAD2DEG + 360) % 360,
    pitch: Math.asin(MathUtils.clamp(u, -1, 1)) * RAD2DEG,
  };
}
