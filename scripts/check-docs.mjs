#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const docs = [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "docs/product/decision.md",
  "docs/product/plan.md",
  "docs/product/showcase.md",
  "docs/architecture/agent-map.md",
  "docs/architecture/protocol.md",
  "docs/architecture/storage.md",
  "docs/architecture/rendering.md",
  "docs/architecture/multimodal.md",
  "docs/quality/evaluation.md",
  "docs/reference/dependencies.md",
  "docs/reference/glossary.md",
];
const budgets = {
  "README.md": 140,
  "AGENTS.md": 110,
  "CLAUDE.md": 20,
  "docs/product/decision.md": 130,
  "docs/product/plan.md": 100,
  "docs/product/showcase.md": 80,
  "docs/architecture/agent-map.md": 80,
  "docs/architecture/protocol.md": 500,
  "docs/architecture/storage.md": 140,
  "docs/architecture/rendering.md": 100,
  "docs/architecture/multimodal.md": 80,
  "docs/quality/evaluation.md": 100,
  "docs/reference/dependencies.md": 100,
  "docs/reference/glossary.md": 80,
};

let failures = 0;
const fail = (file, message, line) => {
  failures += 1;
  console.error(`✗ ${file}${line ? `:${line}` : ""}: ${message}`);
};

function load(file) {
  if (!existsSync(resolve(root, file))) {
    fail(file, "文件不存在");
    return null;
  }
  const lines = readFileSync(resolve(root, file), "utf8").split(/\r?\n/);
  const code = new Array(lines.length).fill(false);
  let fence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i].trimStart();
    if (text.startsWith("```") || text.startsWith("~~~")) {
      code[i] = true;
      fence = !fence;
    } else if (fence) {
      code[i] = true;
    }
  }

  const headings = new Map();
  const sections = new Set();
  const duplicates = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    if (code[i]) continue;
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i]);
    if (!match) continue;
    const base = slugify(match[2]);
    const count = duplicates.get(base) ?? 0;
    duplicates.set(base, count + 1);
    headings.set(count === 0 ? base : `${base}-${count}`, i + 1);
    const section = /^##\s+(\d+)\.\s/.exec(lines[i]);
    if (section) sections.add(Number(section[1]));
  }

  return { file, lines, code, headings, sections };
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function stripInlineCode(text) {
  return text.replace(/`[^`]*`/g, "");
}

const data = new Map();
for (const file of docs) {
  const loaded = load(file);
  if (loaded) data.set(file, loaded);
}

for (const doc of data.values()) {
  const { file, lines, code } = doc;
  if (lines.length > budgets[file]) {
    fail(file, `超过文档行数预算 ${budgets[file]}（当前 ${lines.length}）`);
  }

  for (let i = 0; i < lines.length; i += 1) {
    if (code[i]) continue;
    const text = stripInlineCode(lines[i]);
    const linkPattern = /\[[^\]]*\]\(([^)\s]+)\)/g;
    let match;
    while ((match = linkPattern.exec(text)) !== null) {
      const target = match[1];
      if (/^(https?:|mailto:|tel:|data:)/.test(target)) continue;
      const [pathPart, anchor] = target.split("#");
      const targetFile = pathPart ? resolve(dirname(resolve(root, file)), pathPart) : resolve(root, file);
      if (!existsSync(targetFile)) {
        fail(file, `链接目标不存在：${target}`, i + 1);
        continue;
      }
      if (!anchor) continue;
      const targetKey = [...data.keys()].find(
        (key) => resolve(root, key) === targetFile,
      );
      const targetDoc = targetKey ? data.get(targetKey) : null;
      if (targetDoc && !targetDoc.headings.has(decodeURIComponent(anchor))) {
        fail(file, `锚点不存在：${target}`, i + 1);
      }
    }
  }
}

const seenLines = new Map();
for (const doc of data.values()) {
  const { file, lines, code } = doc;
  for (let i = 0; i < lines.length; i += 1) {
    if (code[i]) continue;
    const normalized = lines[i].trim().replace(/\s+/g, " ");
    if (
      normalized.length < 32 ||
      normalized.startsWith("#") ||
      normalized.startsWith("|") ||
      normalized.startsWith("```") ||
      normalized.startsWith("~~~") ||
      /^[-|:\s]+$/.test(normalized)
    ) {
      continue;
    }
    const positions = seenLines.get(normalized) ?? [];
    positions.push(`${file}:${i + 1}`);
    seenLines.set(normalized, positions);
  }
}
for (const [text, positions] of seenLines) {
  if (positions.length > 1) {
    fail("docs", `重复内容出现在 ${positions.join("、")}：${text.slice(0, 80)}`);
  }
}

const seenTables = new Map();
for (const doc of data.values()) {
  const { file, lines, code } = doc;
  for (let i = 0; i < lines.length; i += 1) {
    if (code[i] || !/^\s*\|/.test(lines[i])) continue;
    const block = [];
    let j = i;
    while (j < lines.length && !code[j] && /^\s*\|/.test(lines[j])) {
      block.push(lines[j].trim().replace(/\s+/g, " "));
      j += 1;
    }
    const key = block.join("\n");
    const positions = seenTables.get(key) ?? [];
    positions.push(`${file}:${i + 1}`);
    seenTables.set(key, positions);
    i = j - 1;
  }
}
for (const positions of seenTables.values()) {
  if (positions.length > 1) {
    fail("docs", `重复表格出现在 ${positions.join("、")}`);
  }
}

const docsPaths = {
  decision: "docs/product/decision.md",
  plan: "docs/product/plan.md",
  protocol: "docs/architecture/protocol.md",
};

for (const doc of data.values()) {
  const { file, lines, code } = doc;
  for (let i = 0; i < lines.length; i += 1) {
    if (code[i]) continue;
    const pattern = /(?:docs\/(?:[a-z]+\/)?)?(README|AGENTS|decision|plan|protocol)\.md\s*§(\d+)/g;
    let match;
    while ((match = pattern.exec(lines[i])) !== null) {
      const target =
        match[1] === "README"
          ? "README.md"
          : match[1] === "AGENTS"
            ? "AGENTS.md"
            : docsPaths[match[1]];
      const targetDoc = data.get(target);
      if (targetDoc && !targetDoc.sections.has(Number(match[2]))) {
        fail(file, `引用了不存在的章节：${match[0]}`, i + 1);
      }
    }
  }
}

for (const doc of data.values()) {
  const { file, lines, code } = doc;
  for (let i = 0; i < lines.length; i += 1) {
    if (code[i]) continue;
    const heading = /^##\s+/.exec(lines[i]);
    if (!heading) continue;
    const body = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      if (!code[j] && /^#{1,2}\s+/.test(lines[j])) break;
      if (lines[j].trim()) body.push(lines[j].trim());
    }
    if (body.length === 1 && /见\s*\[/.test(body[0])) {
      fail(file, "纯指针章节：内容移走后应删除该章节并修正引用", i + 1);
    }
  }
}

if (failures > 0) {
  console.error(`\n文档检查失败：${failures} 个问题`);
  process.exit(1);
}
console.log(`✓ 文档检查通过（${data.size} 个文件）`);
for (const [file, doc] of data) {
  console.log(`  ${file}: ${doc.lines.length}/${budgets[file]} 行`);
}
