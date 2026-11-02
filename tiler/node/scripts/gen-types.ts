import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const schema = JSON.parse(
  readFileSync(resolve(root, "schema/building.json"), "utf8"),
);

const pascal = (s: string) => s[0].toUpperCase() + s.slice(1);

function tsType(p: any): string {
  switch (p.type) {
    case "STRING":
      return "string";
    case "BOOLEAN":
      return "boolean";
    case "SCALAR"0:
      return "number";
    case "ENUM":
      return pascal(p.enumType);
    default:
      throw new Error(`지원 안 하는 타입: ${p.type}`);
  }
}

const lines = [
  "// 자동 생성 파일. 직접 고치지 말 것. 원본: schema/building.json",
  "// 다시 만들기: cd tiler/node && npm run gen-types",
  "",
];

for (const [name, e] of Object.entries<any>(schema.enums ?? {})) {
  lines.push(
    `/** ${e.values.map((v: any) => `${v.value}=${v.name}`).join(", ")} */`,
  );
  lines.push(
    `export type ${pascal(name)} = ${e.values.map((v: any) => v.value).join(" | ")};`,
    "",
  );
}

for (const [cls, c] of Object.entries<any>(schema.classes)) {
  lines.push(`/** ${c.description} */`, `export interface ${pascal(cls)} {`);
  for (const [prop, p] of Object.entries<any>(c.properties)) {
    lines.push(`  /** ${p.description} */`, `  ${prop}: ${tsType(p)};`);
  }
  lines.push("}", "");
}

writeFileSync(resolve(root, "schema/building.d.ts"), lines.join("\n"));
console.log("schema/building.d.ts 생성");
