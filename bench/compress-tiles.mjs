// data/tiles/** 의 .glb·.json 옆에 미리 압축한 .br·.gz를 만듦. 원본은 그대로
// 실행: node bench/compress-tiles.mjs [폴더=data/tiles]   (라이브러리 없음, Node 내장 zlib)
//
// 왜 미리 만드나: 서버가 요청마다 압축하면 그 CPU 시간이 측정에 섞이고, 압축 결과도 매번 같다는 보장이 없음
// 압축 수준: brotli 11·gzip 9 (최대). 한 번 만들어 두고 계속 쓰니 만드는 시간보다 크기가 중요
// 원본이 압축 파일보다 새로우면 다시 만듦 (타일러를 다시 돌린 경우)

import { readdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { availableParallelism } from "node:os";
import zlib from "node:zlib";

// libuv 스레드 수(기본 4)를 코어 수로. 스레드 풀이 처음 쓰이기 전에 정해야 해서 맨 위에서
process.env.UV_THREADPOOL_SIZE ??= String(availableParallelism());

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const dir = resolve(ROOT, process.argv[2] ?? "data/tiles");
const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

function* walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(glb|json)$/.test(e.name)) yield p;
  }
}

const fresh = (src, out) => {
  try {
    return statSync(out).mtimeMs >= statSync(src).mtimeMs;
  } catch {
    return false;
  }
};

const files = [...walk(dir)];
let done = 0;
let skipped = 0;
let raw = 0;
let br = 0;
let gz = 0;
const t0 = performance.now();

// zlib의 비동기 압축은 libuv 스레드에서 돌아감 → 코어 수만큼 동시에
// 파일 읽기·쓰기도 비동기: 동기(readFileSync)면 그동안 이벤트 루프가 멈춰 다른 워커가 압축을 맡기지 못함
async function compress(file) {
  const src = await readFile(file);
  raw += src.length;
  // .br·.gz 둘 다 최신일 때만 건너뜀. 한쪽만 낡았거나 지워졌으면 둘 다 다시 만듦(한쪽만 만드는 분기를 두지 않으려고)
  if (fresh(file, file + ".br") && fresh(file, file + ".gz")) {
    skipped++;
    br += statSync(file + ".br").size;
    gz += statSync(file + ".gz").size;
    return;
  }
  const [b, g] = await Promise.all([
    brotli(src, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: src.length,
        // .glb는 바이너리, .json은 글자 → brotli에 알려주면 조금 더 줄어듦
        [zlib.constants.BROTLI_PARAM_MODE]: file.endsWith(".json")
          ? zlib.constants.BROTLI_MODE_TEXT
          : zlib.constants.BROTLI_MODE_GENERIC,
      },
    }),
    gzip(src, { level: 9 }),
  ]);
  await Promise.all([writeFile(file + ".br", b), writeFile(file + ".gz", g)]);
  br += b.length;
  gz += g.length;
  if (++done % 100 === 0) console.log(`  ${done}/${files.length - skipped}…`);
}

const workers = availableParallelism();
const queue = [...files];
await Promise.all(Array.from({ length: workers }, async () => {
  while (queue.length) await compress(queue.shift());
}));

const pct = (x) => `${((x / raw) * 100).toFixed(1)}%`;
console.log(
  `${relative(ROOT, dir)}: 파일 ${files.length}개 (새로 ${done}, 최신이라 건너뜀 ${skipped}) · ` +
    `원본 ${(raw / 1e6).toFixed(1)}MB → br ${(br / 1e6).toFixed(1)}MB(${pct(br)}) · gz ${(gz / 1e6).toFixed(1)}MB(${pct(gz)}) · ` +
    `${((performance.now() - t0) / 1000).toFixed(1)}s`,
);
