// 구간별 숫자 기록기. 렌더러를 모름 → 어댑터의 getStats()·describe()로만 숫자를 받음
//
// 타일 수는 어댑터가 "시작 후 누적"으로 주고, 여기서 구간 끝마다 직전 값과 빼서 구간 값으로 만듦.
// (어댑터가 구간을 몰라도 되게)

export const SLOW_FRAME_MS = 33.3; // 30fps 아래로 떨어진 프레임

const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

export function createRecorder(adapter, path, { region, kind, n }) {
  const segs = path.segments.map((s) => ({
    name: s.name,
    type: s.type,
    duration: s.duration,
    frameTimes: [],
  }));
  let t0 = 0;
  let lastFrame = null;
  let prevStats = null;
  let initialTilesLoadedMs = null;

  return {
    start() {
      t0 = performance.now();
      lastFrame = null;
      prevStats = adapter.getStats();
    },

    /** 프레임 시간 = 직전 렌더 직후 ~ 이번 렌더 직후. 첫 프레임은 직전이 없어서 안 셈 */
    frame(now, segIndex) {
      if (lastFrame !== null) segs[segIndex].frameTimes.push(now - lastFrame);
      lastFrame = now;
    },

    endSegment(segIndex, camera) {
      const s = adapter.getStats();
      Object.assign(segs[segIndex], {
        tilesLoaded: s.tilesLoaded - prevStats.tilesLoaded,
        tilesUnloaded: s.tilesUnloaded - prevStats.tilesUnloaded,
        pendingRequestsAtEnd: s.pendingRequests,
        memoryBytesAtEnd: s.memoryBytes,
        endCamera: camera,
      });
      prevStats = s;
    },

    markInitialTilesLoaded(now) {
      initialTilesLoadedMs = now - t0;
    },

    finish() {
      const canvas = adapter.describe().canvas;
      return {
        version: 1,
        renderer: adapter.describe().renderer,
        region,
        kind, // first | revisit
        n,
        recordedAt: new Date().toISOString(),
        env: {
          userAgent: navigator.userAgent,
          devicePixelRatio: window.devicePixelRatio,
          canvas,
          renderer: adapter.describe(), // 버전·타일셋 옵션(기본값 그대로, 값만 기록)
        },
        // 첫 재생에서만 값이 있음. 재방문은 이미 불러온 상태라 null
        initialTilesLoadedMs: round(initialTilesLoadedMs),
        totalMs: round(performance.now() - t0),
        segments: segs.map(({ frameTimes, ...s }) => {
          const sum = frameTimes.reduce((a, b) => a + b, 0);
          return {
            ...s,
            frames: frameTimes.length,
            avgFrameMs: round(frameTimes.length ? sum / frameTimes.length : null, 2),
            maxFrameMs: round(frameTimes.length ? Math.max(...frameTimes) : null),
            slowFrameRatio: round(
              frameTimes.length ? frameTimes.filter((t) => t > SLOW_FRAME_MS).length / frameTimes.length : null,
              4,
            ),
            frameTimesMs: frameTimes.map((t) => round(t)), // 나중에 p95 등을 다시 재지 않고 계산하려고 원본도 남김
          };
        }),
        path, // 결과마다 경로를 같이 남김 → summarize가 같은 경로끼리만 평균 냈는지 검사
      };
    },
  };
}
