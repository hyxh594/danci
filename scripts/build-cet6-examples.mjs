import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const dataDir = path.join(projectDir, "data");
const corePath = path.join(dataDir, "cet6-core.js");
const outputPath = path.join(dataDir, "cet6-examples.js");

function loadCoreWords() {
  const source = fs.readFileSync(corePath, "utf8").replace(/^const CET6_CORE_WORDS\s*=/m, "globalThis.__CET6_CORE_WORDS__ =");
  // The generated core file contains data only (no imports or side effects).
  // Evaluating it here keeps this build helper independent of a JSON conversion step.
  globalThis.__CET6_CORE_WORDS__ = undefined;
  Function(source)();
  return globalThis.__CET6_CORE_WORDS__ || [];
}

function sourcePriority(fileName) {
  if (fileName === "cet6-sentence-source.jsonl") return 0;
  if (fileName.includes("四级")) return 1;
  if (fileName.includes("考研")) return 2;
  if (fileName.includes("专八")) return 3;
  if (fileName.includes("托福")) return 4;
  if (fileName.includes("GRE")) return 5;
  if (fileName.includes("SAT")) return 6;
  if (fileName.includes("高中")) return 7;
  return 99;
}

function normalizeSentence(value) {
  return String(value || "")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isUsefulSentence(sentence, word) {
  if (!sentence || sentence.length < 8) return false;
  const hasEndPunctuation = /[.!?。！？]$/.test(sentence);
  const hasTarget = new RegExp(`\\b${String(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(sentence);
  return hasEndPunctuation && (hasTarget || sentence.split(/\s+/).length >= 5);
}

function chooseExample(record, word) {
  const sentences = Array.isArray(record?.sentences) ? record.sentences : [];
  const candidates = sentences
    .map((item) => ({ sentence: normalizeSentence(item?.sentence), translation: String(item?.translation || "").trim() }))
    .filter((item) => item.sentence && item.translation);
  const preferred = candidates.find((item) => isUsefulSentence(item.sentence, word));
  if (preferred) return { ...preferred, sentenceSource: "公开例句" };
  if (candidates[0]) {
    const fragment = candidates[0];
    if (/[.!?。！？]$/.test(fragment.sentence)) return { ...fragment, sentenceSource: "公开例句" };
    return {
      sentence: `The term “${fragment.sentence}” is commonly used in English.`,
      translation: `“${fragment.sentence}”是英语中的常用表达（${fragment.translation}）。`,
      sentenceSource: "公开例句整理"
    };
  }

  const phrases = Array.isArray(record?.phrases) ? record.phrases : [];
  const phrase = phrases.find((item) => item?.phrase && item?.translation);
  if (phrase) {
    return {
      sentence: `The phrase “${normalizeSentence(phrase.phrase)}” is commonly used in English.`,
      translation: `短语“${normalizeSentence(phrase.phrase)}”在英语中很常用（${String(phrase.translation).trim()}）。`,
      sentenceSource: "公开短语"
    };
  }
  return null;
}

function inferPartOfSpeech(record, word) {
  const type = String(record?.translations?.[0]?.type || "").toLowerCase();
  if (/adv|副词/.test(type)) return "adverb";
  if (/^(v|verb|vt|vi)$/.test(type) || /\bverb\b/.test(type)) return "verb";
  if (/adj|形容/.test(type)) return "adjective";
  if (/prep|介词/.test(type)) return "preposition";
  const text = `${word.meaning || ""}${word.category || ""}`;
  if (/的$/.test(text)) return "adjective";
  if (/地$/.test(text)) return "adverb";
  return "noun";
}

const FALLBACK_OVERRIDES = {
  stereotype: ["The article challenges the stereotype that older workers cannot learn new technology.", "这篇文章挑战了“年长员工无法学习新技术”的刻板印象。"],
  mindset: ["A growth mindset helps students respond positively to failure.", "成长型心态能帮助学生积极面对失败。"],
  prosper: ["Small businesses can prosper when they adapt to changing consumer needs.", "小企业适应不断变化的消费者需求后就能发展壮大。"],
  landmark: ["The researchers described the discovery as a landmark achievement.", "研究人员称这项发现是一项里程碑式的成就。"],
  credential: ["A professional credential can open doors to new opportunities.", "专业资质可以为新的机会打开大门。"],
  ultra: ["The camera offers an ultra-wide view of the night sky.", "这台相机可以拍摄超广角的夜空。"],
  artifact: ["The museum displayed an ancient artifact from the region.", "博物馆展出了该地区的一件古代文物。"],
  assortment: ["The shop offers an assortment of affordable snacks.", "这家商店提供各种价格实惠的零食。"],
  glide: ["The swan seemed to glide silently across the lake.", "天鹅似乎无声地滑过湖面。"],
  electoral: ["The reform changed the country's electoral system.", "这项改革改变了该国的选举制度。"],
  afloat: ["The life jacket kept the child safely afloat.", "救生衣让孩子安全地漂浮在水面上。"],
  bureaucrat: ["The bureaucrat approved the request after reviewing the documents.", "这名官僚审阅文件后批准了申请。"],
  affix: ["Please affix your signature to the bottom of the form.", "请在表格底部签名。"],
  clog: ["Leaves can clog the drain after heavy rain.", "大雨后，树叶可能会堵塞排水管。"],
  confederation: ["The confederation brought several small states together.", "这个邦联把几个小国家联合在了一起。"],
  tribune: ["The newspaper served as a tribune for ordinary citizens.", "这份报纸成了普通民众发声的平台。"],
  unleash: ["The new policy may unleash a wave of innovation.", "这项新政策可能会释放一波创新活力。"],
  bloc: ["The countries formed a trading bloc to reduce tariffs.", "这些国家组成了贸易集团，以降低关税。"],
  esthetic: ["The designer balanced esthetic appeal with practical function.", "设计师兼顾了审美吸引力和实用功能。"],
  judiciary: ["An independent judiciary is essential to the rule of law.", "独立的司法机构是法治不可或缺的基础。"],
  tornado: ["The tornado destroyed several homes within minutes.", "龙卷风在几分钟内摧毁了数座房屋。"],
  antagonism: ["Years of antagonism made cooperation difficult.", "多年的对立使合作变得困难。"],
  beak: ["The bird used its sharp beak to crack the seed.", "这只鸟用锋利的喙啄开了种子。"],
  cockpit: ["Only trained pilots may enter the cockpit during the flight.", "飞行途中只有受过训练的飞行员可以进入驾驶舱。"],
  coexist: ["Different cultures can coexist peacefully in the same city.", "不同文化可以在同一座城市中和平共存。"],
  crackdown: ["The government announced a crackdown on illegal dumping.", "政府宣布严厉打击非法倾倒垃圾的行为。"],
  maneuver: ["The driver had to maneuver carefully through the narrow street.", "司机必须小心地操纵车辆在狭窄街道中通过。"],
  plumbing: ["The old building needs new plumbing.", "这栋老建筑需要更换管道装置。"],
  standby: ["A backup generator remained on standby during the storm.", "暴风雨期间，一台备用发电机一直处于待命状态。"]
};

function fallbackExample(word, record) {
  const override = FALLBACK_OVERRIDES[word.word];
  if (override) return { sentence: override[0], translation: override[1] };
  const term = word.word;
  const meaning = word.meaning || "该词";
  const part = inferPartOfSpeech(record, word);
  if (part === "verb") {
    return {
      sentence: `Researchers often ${term} new evidence before making a decision.`,
      translation: `研究人员在作出决定前，通常会${term}新的证据（${meaning}）。`
    };
  }
  if (part === "adjective") {
    return {
      sentence: `The team adopted a ${term} approach to solve the problem.`,
      translation: `团队采用了${term}的方式来解决这个问题（${meaning}）。`
    };
  }
  if (part === "adverb") {
    return {
      sentence: `The system can respond ${term} under pressure.`,
      translation: `系统在压力下能够${term}地作出响应（${meaning}）。`
    };
  }
  return {
    sentence: `The study examines the role of ${term} in modern society.`,
    translation: `这项研究探讨了${term}（${meaning}）在现代社会中的作用。`
  };
}

function readSourceRecords() {
  const files = fs.readdirSync(dataDir)
    .filter((name) => /^cet6-sentence-source.*\.jsonl$/.test(name) || /^sentence-source-.*\.jsonl$/.test(name))
    .sort((a, b) => sourcePriority(a) - sourcePriority(b) || a.localeCompare(b));
  if (!files.length) {
    throw new Error("No sentence source JSONL files found. Refusing to rebuild the bank without public source data.");
  }
  const byWord = new Map();
  let recordCount = 0;
  for (const fileName of files) {
    const filePath = path.join(dataDir, fileName);
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        const key = String(record?.word || "").trim().toLowerCase();
        if (!key || byWord.has(key)) continue;
        byWord.set(key, record);
        recordCount += 1;
      } catch {
        // Ignore a malformed line and continue building the rest of the bank.
      }
    }
  }
  return { byWord, files, recordCount };
}

const coreWords = loadCoreWords();
const { byWord, files, recordCount } = readSourceRecords();
let publicExamples = 0;
let generatedExamples = 0;
let phraseExamples = 0;

const examples = coreWords.map((word) => {
  const sourceRecord = byWord.get(String(word.word).toLowerCase());
  const selected = chooseExample(sourceRecord, word.word);
  const example = selected || { ...fallbackExample(word, sourceRecord), sentenceSource: "应用场景生成" };
  if (example.sentenceSource === "应用场景生成") generatedExamples += 1;
  else {
    publicExamples += 1;
    if (example.sentenceSource === "公开短语") phraseExamples += 1;
  }
  return {
    id: word.id,
    word: word.word,
    meaning: word.meaning,
    sentence: example.sentence,
    sentenceTranslation: example.translation,
    sentenceSource: example.sentenceSource,
    phonetic: sourceRecord?.us || sourceRecord?.uk || ""
  };
});

const header = [
  "// CET-6 example-sentence bank generated from the local core vocabulary.",
  "// Public examples are sourced from KyleBing/english-vocabulary:",
  "// https://github.com/KyleBing/english-vocabulary",
  "// The source data is not guaranteed to be official CET-6 exam text.",
  "// Entries marked 应用场景生成 are deterministic supplemental examples.",
  "const CET6_EXAMPLE_WORDS = "
].join("\n");
fs.writeFileSync(outputPath, `${header}${JSON.stringify(examples, null, 2)};\n`, "utf8");

console.log(JSON.stringify({
  coreWords: coreWords.length,
  sourceFiles: files,
  uniqueSourceRecords: recordCount,
  publicExamples,
  phraseExamples,
  generatedExamples,
  outputPath
}, null, 2));
