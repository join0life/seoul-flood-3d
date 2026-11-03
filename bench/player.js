// 고정 카메라 경로 재생기. 렌더러를 모름 → Cesium·Three.js 어느 쪽 어댑터든 같은 경로를 같은 방식으로 돎
//
// 왜 경과 시간(performance.now) 기준인가:
//   프레임 수 기준이면 느린 렌더러는 같은 프레임 번호에 덜 간 곳을 보게 됨 → 같은 장면 비교가 깨짐.
//   시간 기준이면 FPS와 상관없이 "시작 후 t초의 카메라"가 같음. 느린 프레임은 카메라가 건너뛰는 것으로 드러남.

const POINT_KEYS = ["lon", "lat", "height", "heading", "pitch"];

/** path.json 검사. 문제 목록을 돌려줌(비어 있으면 통과) */
export function validatePath(path) {
  const errors = [];
  const checkPoint = (p, where) => {
    if (!p || typeof p !== "object") return errors.push(`${where}: 지점이 없음`);
    for (const k of POINT_KEYS)
      if (!Number.isFinite(p[k])) errors.push(`${where}.${k}: 숫자가 아님 (${p[k]})`);
    if (p.height <= 0) errors.push(`${where}.height: 0보다 커야 함 (로그 보간)`);
    if (Math.abs(p.pitch) > 90) errors.push(`${where}.pitch: -90~90 밖`);
  };

  if (path?.version !== 1) errors.push(`version: 1이어야 함 (${path?.version})`);
  checkPoint(path?.start, "start");
  const segments = Array.isArray(path?.segments) ? path.segments : [];
  if (!segments.length) errors.push("segments: 비어 있음");
  const names = new Set();
  segments.forEach((s, i) => {
    const where = `segments[${i}](${s?.name})`;
    if (!s?.name || names.has(s.name)) errors.push(`${where}.name: 없거나 겹침`);
    names.add(s?.name);
    if (!(s?.duration > 0)) errors.push(`${where}.duration: 0보다 큰 초여야 함 (${s?.duration})`);
    if (s?.type === "move") checkPoint(s.to, `${where}.to`);
    else if (s?.type !== "hold") errors.push(`${where}.type: hold 또는 move (${s?.type})`);
  });
  return errors;
}

/** 구간마다 출발·도착 지점과 시작·끝 시각(초)을 미리 계산. hold는 직전 지점에 머묾 */
export function buildTimeline(path) {
  let at = path.start;
  let t = 0;
  return path.segments.map((s) => {
    const to = s.type === "move" ? s.to : at;
    const seg = { name: s.name, type: s.type, from: at, to, t0: t, t1: t + s.duration };
    at = to;
    t = seg.t1;
    return seg;
  });
}

const lerp = (a, b, s) => a + (b - a) * s;

/** 구간 안 시각 t(초)의 카메라 지점. 이징 없음(일정 속도) */
export function pointAt(seg, t) {
  const s = Math.min(1, Math.max(0, (t - seg.t0) / (seg.t1 - seg.t0)));
  const { from: a, to: b } = seg;
  // heading은 짧은 쪽으로 돎(355° → 5°는 +10°). 그냥 빼면 -350°를 돌아버림
  const dHeading = ((b.heading - a.heading + 540) % 360) - 180;
  return {
    lon: lerp(a.lon, b.lon, s),
    lat: lerp(a.lat, b.lat, s),
    // 높이는 로그 공간: 30km → 300m를 선형으로 가면 대부분 높은 곳에 있다가 끝에 곤두박질.
    // 로그면 1초마다 같은 "배율"로 내려가서 화면 크기 변화가 일정함
    height: Math.exp(lerp(Math.log(a.height), Math.log(b.height), s)),
    heading: a.heading + dHeading * s,
    pitch: lerp(a.pitch, b.pitch, s),
  };
}

/**
 * 경로를 한 번 재생. 끝나면 resolve
 * hooks.onFrame(now, segIndex): 렌더 직후 매 프레임. segIndex = 방금 그린 프레임이 속한 구간
 * hooks.onSegmentEnd(segIndex, camera): 구간 끝. camera = 끝 지점을 넣은 뒤 어댑터에서 다시 읽은 값
 */
export function play(path, adapter, hooks = {}) {
  const timeline = buildTimeline(path);
  return new Promise((resolve) => {
    adapter.setInputEnabled(false); // 재생 중 마우스·스크롤이 카메라를 건드리면 같은 경로가 아님
    adapter.setCamera(path.start);
    const t0 = performance.now();
    let seg = 0;

    // 렌더 직후에 다음 프레임 카메라를 정함 → 화면에 나오는 위치는 약 한 프레임 전 시각 기준.
    // 두 렌더러 모두 같은 방식이라 비교 조건은 같음
    const off = adapter.onFrame(() => {
      const now = performance.now();
      const t = (now - t0) / 1000;
      hooks.onFrame?.(now, seg);

      // 느린 프레임 하나가 구간 여러 개를 건너뛸 수 있어서 while
      while (seg < timeline.length && t >= timeline[seg].t1) {
        // 끝 지점을 정확히 넣고 다시 읽어서 기록 → 두 번 돌렸을 때 같은지 비교하는 기준점
        adapter.setCamera(timeline[seg].to);
        hooks.onSegmentEnd?.(seg, adapter.getCamera());
        seg++;
      }
      if (seg === timeline.length) {
        off();
        adapter.setInputEnabled(true);
        resolve();
        return;
      }
      adapter.setCamera(pointAt(timeline[seg], t));
    });
  });
}
