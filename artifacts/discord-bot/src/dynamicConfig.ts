import fs from "fs";
import path from "path";

const CONFIG_FILE = path.resolve(__dirname, "../data/dynamic_config.json");

interface DynamicNorm {
  voiceHours: number;
  messages: number;
  curator: {
    obzvon: number;
    tiket: number;
    proverka: number;
    proverkaKm: number;
    spisok: number;
  };
  moderator: {
    aktiv: number;
    tiket: number;
  };
  ignoredCategoryIds: string[];
}

let norm: DynamicNorm = {
  voiceHours: 2,
  messages: 40,
  curator: { obzvon: 5, tiket: 5, proverka: 5, proverkaKm: 0, spisok: 5 },
  moderator: { aktiv: 5, tiket: 5 },
  ignoredCategoryIds: [],
};

function ensureDir(): void {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadDynamicConfig(): void {
  ensureDir();
  if (!fs.existsSync(CONFIG_FILE)) return;
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    norm = {
      ...norm,
      ...parsed,
      curator: { ...norm.curator, ...(parsed.curator ?? {}) },
      moderator: { ...norm.moderator, ...(parsed.moderator ?? {}) },
      ignoredCategoryIds: parsed.ignoredCategoryIds ?? norm.ignoredCategoryIds,
    };
    console.log(`[DynConfig] Норма: ${norm.voiceHours}ч голос, ${norm.messages} сообщений`);
  } catch (e) {
    console.error("[DynConfig] Ошибка загрузки конфига:", e);
  }
}

function save(): void {
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(norm, null, 2), "utf-8");
}

export function getNorm(): DynamicNorm {
  return norm;
}

export function setVoiceHours(hours: number): void {
  norm.voiceHours = hours;
  save();
  console.log(`[DynConfig] Норма голоса изменена: ${hours}ч`);
}

export function setMessages(count: number): void {
  norm.messages = count;
  save();
  console.log(`[DynConfig] Норма сообщений изменена: ${count}`);
}

export function setCuratorNorm(key: keyof DynamicNorm["curator"], value: number): void {
  norm.curator[key] = value;
  save();
  console.log(`[DynConfig] Норма куратора ${key} изменена: ${value}`);
}

export function setModeratorNorm(key: keyof DynamicNorm["moderator"], value: number): void {
  norm.moderator[key] = value;
  save();
  console.log(`[DynConfig] Норма модератора ${key} изменена: ${value}`);
}

export function addIgnoredCategory(categoryId: string): boolean {
  if (norm.ignoredCategoryIds.includes(categoryId)) return false;
  norm.ignoredCategoryIds.push(categoryId);
  save();
  console.log(`[DynConfig] Категория ${categoryId} добавлена в игнор`);
  return true;
}

export function removeIgnoredCategory(categoryId: string): boolean {
  const idx = norm.ignoredCategoryIds.indexOf(categoryId);
  if (idx === -1) return false;
  norm.ignoredCategoryIds.splice(idx, 1);
  save();
  console.log(`[DynConfig] Категория ${categoryId} убрана из игнора`);
  return true;
}

export function isCategoryIgnored(categoryId: string | null | undefined): boolean {
  if (!categoryId) return false;
  return norm.ignoredCategoryIds.includes(categoryId);
}
