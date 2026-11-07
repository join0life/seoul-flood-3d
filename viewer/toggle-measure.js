// 2-6 토글 반응 시간 측정 (?measure=1일 때만 cesium-check.html이 불러옴. 평소 화면·bench에는 없음)
// "이미 받은 타일을 다시 칠하는 시간"만 잼: 카메라 고정 → tilesLoaded 뒤 → 패널 체크박스를 실제로 클릭(input.click())
//
// 지표(전환 하나마다)
//   반응 시간   = 클릭 직전 ~ 새 스타일이 적용된 첫 프레임의 postRender (performance.now)
//   처리기 시간 = 클릭 직전 ~ click()이 돌아온 시점 (onChange: 스타일 만들기 + 지표·구 목록 다시 그리기)
//   프레임 작업 = 그 프레임의 preUpdate ~ postRender (Cesium 메인 스레드 작업. GPU 시간은 안 들어감)
//   Long Task  = PerformanceObserver("longtask", 50ms 이상)가 클릭 ~ 첫 프레임 구간에 겹쳐 잡은 것
//   평균 프레임 간격 = 첫 프레임 뒤 1초 동안 postRender 간격 평균 (계산값). 전환 프레임 → 다음 프레임 간격부터 들어감
//   직전→전환 간격 = 클릭 전 마지막 postRender ~ 전환 프레임 postRender. 1초 간격에는 안 들어가서 따로 셈
//                   33ms 이상 = 60Hz에서 새 프레임 없이 화면 주기 하나를 건너뜀(프레임 밀림)
//   그려진 건물 수 = 그 프레임에 tileVisible로 보인 타일의 featuresLength 합 (스크립트가 셈)
//   사람 입력 = 그 전환 구간(쉬는 시간 포함)에 들어온 실제 입력(isTrusted) + 창 포커스 잃음·탭 숨김. 0이 아니면 그 회차는 오염
//              (스크립트의 input.click()은 isTrusted=false라 안 셈)
//
// "첫 프레임"의 근거: Cesium은 tileset.style을 바꾸면 다음 update에서 그 프레임에 고른(보이는) 타일 전부에 스타일을 적용
// → 클릭 뒤 처음 시작한 프레임. 검증 회차(평균에서 뺌)에서 그 프레임의 보이는 건물 전부의 색 = 새 스타일 색인지 확인
// 안 보이던 타일이 나중에 보일 때 칠해지는 비용은 여기서 재지 않음

const { Cartesian3, Color, Math: CMath } = Cesium;

// 2-1에서 관악 zoom 14,841건을 센 지점 = bench/path.json "zoom" 구간 끝 (1400×900 창, LNB 없던 때)
const PATH_URL = "../bench/path.json";
const SETTLE_MS = 1500; // 전환 사이 쉬는 시간(이전 전환의 1초 프레임 기록이 끝난 뒤)
const AFTER_MS = 1000; // 전환 뒤 프레임 간격을 모으는 시간
const ROUNDS = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round1 = (x) => Math.round(x * 10) / 10;

export function mountToggleMeasure({ viewer, tileset, layersEl }) {
  const { scene } = viewer;

  // 프레임 기록: preUpdate에 시작 시각, tileVisible로 그 프레임에 보인 타일, postRender에 끝
  let frameStart = 0;
  let frameTiles = new Set();
  let lastRenderEnd = 0; // 직전 프레임의 postRender 시각(직전→전환 간격용)
  const postRenderWaiters = new Set();
  scene.preUpdate.addEventListener(() => {
    frameStart = performance.now();
    frameTiles = new Set();
  });
  tileset.tileVisible.addEventListener((tile) => frameTiles.add(tile));
  scene.postRender.addEventListener(() => {
    const now = performance.now();
    for (const w of [...postRenderWaiters]) w({ now, start: frameStart, tiles: frameTiles });
    lastRenderEnd = now;
  });
  const nextFrame = (pred) =>
    new Promise((resolve) => {
      const w = (f) => {
        if (!pred(f)) return;
        postRenderWaiters.delete(w);
        resolve(f);
      };
      postRenderWaiters.add(w);
    });
  const framesFor = (ms, from) =>
    new Promise((resolve) => {
      const times = [from];
      const w = (f) => {
        times.push(f.now);
        if (f.now - from < ms) return;
        postRenderWaiters.delete(w);
        resolve(times);
      };
      postRenderWaiters.add(w);
    });

  const longTasks = [];
  try {
    new PerformanceObserver((list) => longTasks.push(...list.getEntries())).observe({ type: "longtask", buffered: true });
  } catch {
    console.warn("[measure] longtask 관찰 불가(이 브라우저 미지원)");
  }

  // 사람 입력 기록: 측정 중 마우스·키·휠·터치가 들어오거나 창이 뒤로 가면 그 구간 표에 남김
  const humanEvents = [];
  const note = (e) => humanEvents.push({ t: performance.now(), type: e.type });
  for (const type of ["pointerdown", "pointermove", "wheel", "keydown", "touchstart"])
    window.addEventListener(type, (e) => e.isTrusted && note(e), { capture: true, passive: true });
  window.addEventListener("blur", note);
  document.addEventListener("visibilitychange", () => document.hidden && note({ type: "hidden" }));
  const humanIn = (from, to) => {
    const es = humanEvents.filter((e) => e.t >= from && e.t <= to);
    if (!es.length) return "없음";
    const n = {};
    for (const e of es) n[e.type] = (n[e.type] ?? 0) + 1;
    return Object.entries(n).map(([k, v]) => `${k}×${v}`).join(" ");
  };

  // 패널 체크박스 찾기. 화면 문구가 아니라 식별자로: 레이어는 id="layer-<LAYERS id>", 연도는 value="<연도>"
  // (문구를 바꿔도 안 깨지게. 못 찾으면 조용히 엉뚱한 걸 누르지 않고 멈춤)
  const box = (key) => {
    const input = layersEl.querySelector(/^\d{4}$/.test(key) ? `fieldset.years input[value="${key}"]` : `#layer-${key}`);
    if (!input) throw new Error(`[measure] 체크박스 없음: ${key}`);
    return input;
  };
  const ensure = (key, on) => box(key).checked !== on && box(key).click();

  const buildingsIn = (tiles) => [...tiles].reduce((n, t) => n + (t.content?.featuresLength ?? 0), 0);
  // 그 프레임에 보인 건물 전부: 지금 색 = 지금 스타일이 계산한 색? (검증 회차에서만. 시간 측정이 끝난 뒤에 함)
  const mismatches = (tiles) => {
    let bad = 0;
    const want = new Color();
    for (const t of tiles)
      for (let i = 0; i < (t.content?.featuresLength ?? 0); i++) {
        const f = t.content.getFeature(i);
        tileset.style.color.evaluateColor(f, want);
        if (!f.color.equalsEpsilon(want, 1 / 255)) bad++; // Color.equalsEpsilon은 정적 함수가 없음(인스턴스 메서드)
      }
    return bad;
  };

  async function waitLoaded() {
    const t0 = performance.now();
    while (!tileset.tilesLoaded) {
      if (performance.now() - t0 > 60000) throw new Error("[measure] 60초 안에 tilesLoaded가 안 됨");
      await sleep(200);
    }
  }

  /** 전환 하나: 자기 task에서 클릭 → 첫 프레임 → 1초 프레임 간격 */
  async function toggle(label, key, verify) {
    const begin = performance.now();
    await waitLoaded();
    await sleep(SETTLE_MS);
    const input = box(key);
    const { prev, t0, t1 } = await new Promise((r) =>
      setTimeout(() => {
        const prev = lastRenderEnd;
        const t0 = performance.now();
        input.click();
        r({ prev, t0, t1: performance.now() });
      }),
    );
    const frame = await nextFrame((f) => f.start >= t0);
    const times = await framesFor(AFTER_MS, frame.now);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    const lt = longTasks.filter((e) => e.startTime < frame.now && e.startTime + e.duration > t0);
    return {
      전환: label,
      "반응(ms)": round1(frame.now - t0),
      "처리기(ms)": round1(t1 - t0),
      "프레임 작업(ms)": round1(frame.now - frame.start),
      "클릭→프레임 시작(ms)": round1(frame.start - t0),
      "Long Task": lt.length ? lt.map((e) => round1(e.duration)).join("+") + "ms" : "없음",
      "직전→전환(ms)": round1(frame.now - prev),
      "전환→다음(ms)": round1(gaps[0]),
      "프레임 밀림": frame.now - prev >= 33 ? "예" : "아니오",
      "1초 평균 간격(ms)": round1(gaps.reduce((a, b) => a + b, 0) / gaps.length),
      "1초 최대 간격(ms)": round1(Math.max(...gaps)),
      건물: buildingsIn(frame.tiles),
      "사람 입력": humanIn(begin, performance.now()),
      ...(verify ? { "색 불일치": mismatches(frame.tiles) } : {}),
    };
  }

  const TOGGLES = [
    ["후보 끄기", "candidate"],
    ["후보 켜기", "candidate"],
    ["침수 끄기", "flood"],
    ["침수 켜기", "flood"],
    ["2025 추가 (2022→2022+2025)", "2025"],
    ["2022 제거 (2022+2025→2025)", "2022"],
  ];

  /** 콘솔에서 직접: await runToggleMeasure() → console.table + 결과 객체 */
  async function runToggleMeasure({ rounds = ROUNDS } = {}) {
    const runStart = performance.now();
    // 시작할 때 이미 창이 뒤에 있으면 blur가 안 생겨서 위 기록에 안 잡힘 → 시작 상태를 따로 남김
    const startState = `포커스 ${document.hasFocus() ? "있음" : "없음"}, ${document.visibilityState}`;
    // 시작 상태: 레이어 둘 다 켬, 연도 2022만 (2025를 먼저 끄면 최소 1개 규칙에 안 걸림)
    ensure("candidate", true);
    ensure("flood", true);
    ensure("2022", true);
    ensure("2025", false);

    const path = await (await fetch(PATH_URL)).json();
    const z = path.segments.find((s) => s.name === "zoom").to;
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(z.lon, z.lat, z.height),
      orientation: { heading: CMath.toRadians(z.heading), pitch: CMath.toRadians(z.pitch), roll: 0 },
    });
    await waitLoaded();
    await sleep(3000); // 첫 tilesLoaded 직후 남은 정리(캐시 정리 등)가 끝나게

    const rows = [];
    // 0회차 = 검증 회차(평균에서 뺌): 첫 프레임에 보이는 건물 색이 전부 새 스타일인지
    for (let r = 0; r <= rounds; r++) {
      for (const [label, key] of TOGGLES) rows.push({ 회차: r === 0 ? "검증" : r, ...(await toggle(label, key, r === 0)) });
      // 되돌리기(재지 않음): 2025 → 2022+2025 → 2022
      ensure("2022", true);
      await sleep(300);
      ensure("2025", false);
    }

    const measured = rows.filter((x) => x.회차 !== "검증");
    const keys = ["반응(ms)", "처리기(ms)", "프레임 작업(ms)", "직전→전환(ms)", "전환→다음(ms)", "1초 평균 간격(ms)", "1초 최대 간격(ms)", "건물"];
    const avg = TOGGLES.map(([label]) => {
      const rs = measured.filter((x) => x.전환 === label);
      return {
        전환: label,
        ...Object.fromEntries(keys.map((k) => [k, round1(rs.reduce((a, x) => a + x[k], 0) / rs.length)])),
        "프레임 밀림 회수": `${rs.filter((x) => x["프레임 밀림"] === "예").length}/${rs.length}`,
        "Long Task 회수": `${rs.filter((x) => x["Long Task"] !== "없음").length}/${rs.length}`,
      };
    });
    const humanAll = humanIn(runStart, performance.now()); // 시작 카메라·로딩 대기까지 포함한 전체
    if (humanAll !== "없음") console.warn(`[measure] 측정 중 사람 입력 있음(${humanAll}) → 이 결과는 쓰지 말 것`);
    const env = {
      canvas: `${scene.canvas.width}×${scene.canvas.height} (CSS ${scene.canvas.clientWidth}×${scene.canvas.clientHeight}, DPR ${devicePixelRatio})`,
      camera: z,
      ua: navigator.userAgent,
      "사람 입력(전체)": humanAll,
      "시작 상태": startState,
      screen: `${screen.width}×${screen.height}, 창 위치 ${screenX},${screenY}`,
    };
    console.log("[measure] 조건", env);
    console.table(rows);
    console.table(avg);
    return (window.lastToggleMeasure = { env, rows, avg });
  }
  return runToggleMeasure;
}
