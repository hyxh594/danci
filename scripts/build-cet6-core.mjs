import { readFile, writeFile } from "node:fs/promises";

const sourcePath = new URL("../.cache-cet/cet_full_list.json", import.meta.url);
const outputPath = new URL("../data/cet6-core.js", import.meta.url);
const source = JSON.parse(await readFile(sourcePath, "utf8"));
const rows = source["四六级词汇词频排序表"]
  .filter((row) => row["六级"] === "★")
  .sort((a, b) => Number(b["词频"] || 0) - Number(a["词频"] || 0))
  .map((row, index) => ({
    id: `cet6-${String(row["单词"]).toLowerCase()}`,
    word: String(row["单词"]).trim(),
    meaning: String(row["释义"] || "").trim(),
    frequency: Number(row["词频"] || 0),
    category: row["分类"] || "",
    subcategory: row["子分类"] || "",
    level: "CET6",
    source: "exam-data/CETVocabulary（六级★，按真题词频排序）",
    sourceRank: index + 1
  }));

const content = `// Generated from exam-data/CETVocabulary/cet_full_list.json.\n// Data license: CC BY-NC-SA 4.0. Keep attribution when redistributing.\nconst CET6_CORE_WORDS = ${JSON.stringify(rows, null, 2)};\n`;
await writeFile(outputPath, content, "utf8");
console.log(`Generated ${rows.length} CET-6 words -> ${outputPath.pathname}`);
