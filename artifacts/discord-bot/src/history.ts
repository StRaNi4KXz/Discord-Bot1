import fs from "fs";
import path from "path";

const HISTORY_FILE = path.resolve(__dirname, "../data/history.json");
const MAX_WEEKS = 12;

export interface WeekEntry {
  userId: string;
  displayName: string;
  messages: number;
  voiceSeconds: number;
  passed: boolean;
}

export interface WeekSnapshot {
  weekEnding: string;
  voiceHoursNorm: number;
  messagesNorm: number;
  users: WeekEntry[];
}

let history: WeekSnapshot[] = [];

function ensureDir(): void {
  const dir = path.dirname(HISTORY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadHistory(): void {
  ensureDir();
  if (!fs.existsSync(HISTORY_FILE)) return;
  try {
    const raw = fs.readFileSync(HISTORY_FILE, "utf-8");
    history = JSON.parse(raw);
    console.log(`[History] Загружено ${history.length} недель истории`);
  } catch (e) {
    console.error("[History] Ошибка загрузки истории:", e);
  }
}

export function saveWeekSnapshot(snapshot: WeekSnapshot): void {
  ensureDir();
  history.push(snapshot);
  if (history.length > MAX_WEEKS) {
    history = history.slice(-MAX_WEEKS);
  }
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
  console.log(`[History] Снимок за ${snapshot.weekEnding} сохранён (всего: ${history.length})`);
}

export function getHistory(): WeekSnapshot[] {
  return [...history].reverse();
}
