import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(__dirname, "../data/stats.json");

export interface UserStats {
  userId: string;
  username: string;
  messages: number;
  voiceSeconds: number;
  voiceJoinedAt: number | null;
}

const stats = new Map<string, UserStats>();

function ensureDataDir(): void {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadStats(): void {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const arr: UserStats[] = JSON.parse(raw);
    stats.clear();
    for (const u of arr) {
      u.voiceJoinedAt = null;
      stats.set(u.userId, u);
    }
    console.log(`[Store] Загружена статистика: ${stats.size} участников`);
  } catch (e) {
    console.error("[Store] Ошибка загрузки статистики:", e);
  }
}

export function saveStats(): void {
  ensureDataDir();
  try {
    const arr = Array.from(stats.values()).map((u) => ({
      ...u,
      voiceJoinedAt: null,
    }));
    fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2), "utf-8");
  } catch (e) {
    console.error("[Store] Ошибка сохранения статистики:", e);
  }
}

export function getUser(userId: string, username: string): UserStats {
  if (!stats.has(userId)) {
    stats.set(userId, {
      userId,
      username,
      messages: 0,
      voiceSeconds: 0,
      voiceJoinedAt: null,
    });
  }
  return stats.get(userId)!;
}

export function getAllUsers(): UserStats[] {
  return Array.from(stats.values());
}

export function resetAllStats(): void {
  for (const user of stats.values()) {
    user.messages = 0;
    user.voiceSeconds = 0;
    user.voiceJoinedAt = null;
  }
  saveStats();
}

export function recordVoiceJoin(userId: string, username: string): void {
  const user = getUser(userId, username);
  user.voiceJoinedAt = Date.now();
}

export function recordVoiceLeave(userId: string, username: string): void {
  const user = getUser(userId, username);
  if (user.voiceJoinedAt !== null) {
    const seconds = (Date.now() - user.voiceJoinedAt) / 1000;
    user.voiceJoinedAt = null;
    if (seconds >= 30) {
      user.voiceSeconds += seconds;
      saveStats();
    }
  }
}

export function incrementMessages(userId: string, username: string): void {
  const user = getUser(userId, username);
  user.messages += 1;
  saveStats();
}
