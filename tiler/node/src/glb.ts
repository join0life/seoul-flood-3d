import { readFileSync } from "node:fs";
import { Document, NodeIO, Primitive } from "@gltf-transform/core";
import {
  EXTMeshFeatures,
  EXTStructuralMetadata,
} from "@gltf-transform/extensions";
import type { TileMesh } from "./mesh.js";
import type { TileNode } from "./quadtree.js";

// schema/building.json = GLB 속성표 머리줄(그대로 씀)
const SCHEMA = JSON.parse(
  readFileSync(
    new URL("../../../schema/building.json", import.meta.url),
    "utf8",
  ),
);
const CLASS = "building";
const PROPS: Record<string, any> = SCHEMA.classes[CLASS].properties;

const io = new NodeIO().registerExtensions([
  EXTMeshFeatures,
  EXTStructuralMetadata,
]);
const bytes = (v: ArrayBufferView) =>
  new Uint8Array(v.buffer, v.byteOffset, v.byteLength);

/**
 * GLB 바이너리 구역 재배치: 모든 bufferView 시작 위치를 8바이트 배수로 맞춤.
 * EXT_structural_metadata 규칙상 속성표 값 구역은 정렬돼 있어야 하는데,
 * glTF Transform 4.5.1로 쓰면 이 구역이 정렬 없이 이어 붙어서 표준 검사(3d-tiles-validator)에서 에러가 났음.
 *
 * 가정: GLB = 헤더 + JSON 청크 1개 + BIN 청크 1개, 버퍼 1개(BIN)를 모든 bufferView가 씀.
 * 압축(meshopt 등)이나 외부 버퍼가 들어와 가정이 깨지면 조용히 잘못된 GLB를 만들지 않고 여기서 멈춤.
 */
function alignBufferViews(glb: Uint8Array): Uint8Array {
  const fail = (msg: string): never => {
    throw new Error(`alignBufferViews: ${msg} (GLB 구조가 바뀌었으면 이 함수를 다시 확인)`);
  };
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (glb.byteLength < 12 || dv.getUint32(0, true) !== 0x46546c67)
    fail("GLB 헤더(magic)가 아님");
  if (dv.getUint32(4, true) !== 2)
    fail(`glTF 버전 ${dv.getUint32(4, true)} (2만 지원)`);
  if (dv.getUint32(8, true) !== glb.byteLength)
    fail("헤더의 전체 길이와 실제 길이가 다름");

  // 청크를 순서대로 다 읽음: [길이, 종류, 내용]
  const chunks: { type: number; data: Uint8Array }[] = [];
  for (let p = 12; p < glb.byteLength; ) {
    if (p + 8 > glb.byteLength) fail("청크 머리가 잘림");
    const len = dv.getUint32(p, true);
    if (p + 8 + len > glb.byteLength) fail("청크 내용이 잘림");
    chunks.push({
      type: dv.getUint32(p + 4, true),
      data: glb.subarray(p + 8, p + 8 + len),
    });
    p += 8 + len;
  }
  if (
    chunks.length !== 2 ||
    chunks[0].type !== 0x4e4f534a ||
    chunks[1].type !== 0x004e4942
  )
    fail(`청크 구성이 [JSON, BIN]이 아님 (청크 ${chunks.length}개)`);
  const json = JSON.parse(new TextDecoder().decode(chunks[0].data));
  const bin = chunks[1].data;

  if (json.buffers?.length !== 1)
    fail(`버퍼가 ${json.buffers?.length ?? 0}개 (1개만 지원)`);
  if (json.buffers[0].uri !== undefined) fail("버퍼가 외부 파일(uri)을 가리킴");
  if (json.buffers[0].byteLength > bin.byteLength)
    fail("버퍼 길이가 BIN 청크보다 김");
  for (const [i, bv] of (json.bufferViews ?? []).entries()) {
    if (bv.buffer !== 0) fail(`bufferView ${i}가 버퍼 ${bv.buffer}를 씀`);
    if ((bv.byteOffset ?? 0) + bv.byteLength > json.buffers[0].byteLength)
      fail(`bufferView ${i}가 버퍼 범위를 넘음`);
  }

  let size = 0;
  for (const bv of json.bufferViews)
    size = Math.ceil(size / 8) * 8 + bv.byteLength;
  const newBin = new Uint8Array(Math.ceil(size / 8) * 8);
  let offset = 0;
  for (const bv of json.bufferViews) {
    offset = Math.ceil(offset / 8) * 8;
    newBin.set(
      bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength),
      offset,
    );
    bv.byteOffset = offset;
    offset += bv.byteLength;
  }
  json.buffers[0].byteLength = newBin.byteLength;

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = new Uint8Array(Math.ceil(jsonBytes.length / 4) * 4).fill(
    0x20,
  ); // JSON 청크는 공백으로 채움
  jsonPadded.set(jsonBytes);
  const out = new Uint8Array(12 + 8 + jsonPadded.length + 8 + newBin.length);
  const o = new DataView(out.buffer);
  o.setUint32(0, 0x46546c67, true);
  o.setUint32(4, 2, true);
  o.setUint32(8, out.length, true);
  o.setUint32(12, jsonPadded.length, true);
  o.setUint32(16, 0x4e4f534a, true);
  out.set(jsonPadded, 20);
  const b = 20 + jsonPadded.length;
  o.setUint32(b, newBin.length, true);
  o.setUint32(b + 4, 0x004e4942, true);
  out.set(newBin, b + 8);
  return out;
}

/** 속성 한 칸의 값들을 3D Tiles 규칙대로 바이트로 바꿈 */
function encodeColumn(
  def: any,
  values: any[],
): { values: Uint8Array; stringOffsets?: Uint8Array } {
  switch (def.type) {
    case "STRING": {
      const enc = new TextEncoder();
      const parts = values.map((v) => enc.encode(String(v)));
      const offsets = new Uint32Array(parts.length + 1);
      parts.forEach((p, i) => (offsets[i + 1] = offsets[i] + p.length));
      const out = new Uint8Array(offsets[parts.length]);
      parts.forEach((p, i) => out.set(p, offsets[i]));
      return { values: out, stringOffsets: bytes(offsets) };
    }
    case "BOOLEAN": {
      // 값 하나 = 1비트 (8개씩 1바이트)
      const out = new Uint8Array(Math.ceil(values.length / 8));
      values.forEach((v, i) => {
        if (v) out[i >> 3] |= 1 << (i & 7);
      });
      return { values: out };
    }
    case "ENUM":
      return { values: new Uint8Array(values) }; // enum valueType = UINT8
    case "SCALAR": {
      const T = {
        UINT8: Uint8Array,
        UINT16: Uint16Array,
        FLOAT32: Float32Array,
      }[def.componentType as string];
      if (!T)
        throw new Error(`지원 안 하는 componentType: ${def.componentType}`);
      return { values: bytes(new T(values)) }; // FlatGeobuf의 int32·int16을 여기서 schema 타입으로 바꿈
    }
    default:
      throw new Error(`지원 안 하는 타입: ${def.type}`);
  }
}

/** ENU [동, 북, 위] → glTF [x, y(위), z] : glTF는 y가 위쪽 */
function enuToGltf(src: Float32Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    out[i] = src[i];
    out[i + 1] = src[i + 2];
    out[i + 2] = -src[i + 1];
  }
  return out;
}

export async function writeTileGlb(
  tile: TileNode,
  mesh: TileMesh,
): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const featuresExt = doc.createExtension(EXTMeshFeatures);
  const metaExt = doc.createExtension(EXTStructuralMetadata);

  // 1) 머리줄: building.json의 classes·enums를 그대로 옮김
  const schema = metaExt.createSchema().setId(SCHEMA.id);
  const cls = metaExt
    .createClass()
    .setDescription(SCHEMA.classes[CLASS].description);
  for (const [name, def] of Object.entries(PROPS)) {
    const p = metaExt
      .createClassProperty()
      .setType(def.type)
      .setDescription(def.description);
    if (def.componentType) p.setComponentType(def.componentType);
    if (def.enumType) p.setEnumType(def.enumType);
    cls.setProperty(name, p);
  }
  schema.setClass(CLASS, cls);
  for (const [name, e] of Object.entries<any>(SCHEMA.enums ?? {})) {
    const en = metaExt.createEnum().setValueType(e.valueType);
    for (const v of e.values) {
      en.addEnumValue(
        metaExt
          .createEnumValue()
          .setName(v.name)
          .setValue(v.value)
          .setDescription(v.description ?? ""),
      );
    }
    schema.setEnum(name, en);
  }

  // 2) 속성표: 건물 1건 = 1줄. 줄 순서 = featureId
  const table = metaExt
    .createPropertyTable()
    .setClass(CLASS)
    .setCount(tile.buildings.length);
  for (const [name, def] of Object.entries(PROPS)) {
    const col = encodeColumn(
      def,
      tile.buildings.map((b) => (b.props as any)[name]),
    );
    // 타일 안 건물이 전부 빈 문자열이면(예: 용도코드 없음) 0바이트 구역이 생기는데 glTF는 이걸 허용 안 함.
    // schema에서 required가 아니므로 이 칸을 속성표에서 빼면 됨(읽으면 "값 없음")
    if (col.values.byteLength === 0) continue;
    const prop = metaExt.createPropertyTableProperty().setValues(col.values);
    if (col.stringOffsets) prop.setStringOffsets(col.stringOffsets);
    table.setProperty(name, prop);
  }
  doc
    .getRoot()
    .setExtension(
      "EXT_structural_metadata",
      metaExt
        .createStructuralMetadata()
        .setSchema(schema)
        .addPropertyTable(table),
    );

  // 3) 메시: 위치·법선·featureId·인덱스
  const vertexCount = mesh.positions.length / 3;
  const acc = (type: "VEC3" | "SCALAR", array: any) =>
    doc.createAccessor().setBuffer(buffer).setType(type).setArray(array);
  const indices =
    vertexCount < 65536 ? new Uint16Array(mesh.indices) : mesh.indices; // 작으면 2바이트

  const prim = doc
    .createPrimitive()
    .setMode(Primitive.Mode.TRIANGLES)
    .setAttribute("POSITION", acc("VEC3", enuToGltf(mesh.positions)))
    .setAttribute("NORMAL", acc("VEC3", enuToGltf(mesh.normals)))
    .setAttribute("_FEATURE_ID_0", acc("SCALAR", mesh.featureIds))
    .setIndices(acc("SCALAR", indices))
    .setMaterial(
      doc
        .createMaterial()
        .setBaseColorFactor([0.8, 0.8, 0.8, 1])
        .setMetallicFactor(0)
        .setRoughnessFactor(1),
    );

  // "_FEATURE_ID_0의 번호 = 0번 속성표의 줄 번호"
  const featureId = featuresExt
    .createFeatureID()
    .setFeatureCount(tile.buildings.length)
    .setAttribute(0)
    .setPropertyTable(table);
  prim.setExtension(
    "EXT_mesh_features",
    featuresExt.createFeatures().addFeatureID(featureId),
  );

  const m = doc.createMesh().addPrimitive(prim);
  doc.createScene().addChild(doc.createNode().setMesh(m));
  return alignBufferViews(await io.writeBinary(doc));
}
