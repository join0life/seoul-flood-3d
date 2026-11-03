// 구간별 숫자 기록기. 렌더러를 모름 → 어댑터의 getStats()·describe()로만 숫자를 받음
//
// 타일 수는 어댑터가 "시작 후 누적"으로 주고, 여기서 구간 끝마다 직전 값과 빼서 구간 값으로 만듦.
// (어댑터가 구간을 몰라도 되게)

export const SLOW_FRAME_MS = 33.3; // 30fps 아래로 떨어진 프레임
// 이보다 긴 프레임 간격은 렌더러가 느린 게 아니라 브라우저가 렌더를 멈춘 것(창 가림·최소화 등)으로 봄
export const STALL_FRAME_MS = 1000;

const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// 95번째 백분위(nearest-rank): 정렬해서 95% 지점의 값. 최대값 하나는 우연히 튈 수 있어서 같이 봄
const p95 = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1] : null);

export function createRecorder(adapter, path, { region, kind, n }) {
  const segs = path.segments.map((s) => ({
    name: s.name,
    type: s.type,
    duration: s.duration,
    frameTimes: [],
    workTimes: [],
  }));
  let t0 = 0;
  let lastFrame = null;
  let prevStats = null;
  let initialTilesLoadedMs = null;

  // invalid 사유. 하나라도 있으면 그 회차는 summarize 평균에서 빠짐 (파일은 남겨서 원인 확인용)
  const invalidReasons = [];
  let curSeg = 0;
  const elapsed = () => ((performance.now() - t0) / 1000).toFixed(1);
  // 탭 전환·창 최소화로 화면이 숨으면 브라우저가 rAF를 멈춤 → 그동안의 숫자는 렌더러 성능이 아님
  const onVisibility = () => {
    if (document.hidden) invalidReasons.push(`재생 중 화면 숨김 (${segs[curSeg].name}, ${elapsed()}s)`);
  };

  return {
    start() {
      t0 = performance.now();
      lastFrame = null;
      prevStats = adapter.getStats();
      document.addEventListener("visibilitychange", onVisibility);
    },

    /**
     * 프레임 간격 = 직전 렌더 직후 ~ 이번 렌더 직후. 첫 프레임은 직전이 없어서 안 셈
     * 작업 시간 = 어댑터가 잰 이번 프레임의 렌더러 작업(메인 스레드 CPU). 첫 프레임도 셈
     *   GPU가 실제로 그리는 시간과 프레임 사이 비동기 작업(타일 응답 처리 등)은 안 들어감
     *   → 프레임 간격(사용자가 보는 끊김)과 같이 봐야 함
     */
    frame(now, segIndex, workMs) {
      curSeg = segIndex;
      if (lastFrame !== null) {
        const gap = now - lastFrame;
        segs[segIndex].frameTimes.push(gap);
        // 창이 다른 창에 가려지면 visibilitychange 없이 렌더만 멈출 때가 있어서 간격으로도 검사
        if (gap > STALL_FRAME_MS)
          invalidReasons.push(`프레임 간격 ${round(gap)}ms > ${STALL_FRAME_MS}ms (${segs[segIndex].name}, ${elapsed()}s)`);
      }
      lastFrame = now;
      segs[segIndex].workTimes.push(workMs);
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
      document.removeEventListener("visibilitychange", onVisibility);
      const canvas = adapter.describe().canvas;
      return {
        version: 1,
        valid: invalidReasons.length === 0,
        invalidReasons,
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
        segments: segs.map(({ frameTimes, workTimes, ...s }) => {
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
            avgWorkMs: round(mean(workTimes), 2),
            p95WorkMs: round(p95(workTimes), 2),
            maxWorkMs: round(workTimes.length ? Math.max(...workTimes) : null, 2),
            frameTimesMs: frameTimes.map((t) => round(t)), // 나중에 다른 지표를 다시 재지 않고 계산하려고 원본도 남김
            workTimesMs: workTimes.map((t) => round(t, 2)),
          };
        }),
        path, // 결과마다 경로를 같이 남김 → summarize가 같은 경로끼리만 평균 냈는지 검사
      };
    },
  };
}
