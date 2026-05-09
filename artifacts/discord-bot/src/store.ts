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
  totalMessages: number;
  totalVoiceSeconds: number;
}

interface DataFile {
  lastSeenAt: number | null;
  users: UserStats[];
}

const stats = new Map<string, UserStats>();
let lastSeenAt: number | null = null;

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
    const parsed = JSON.parse(raw);

    let users: UserStats[];
    if (Array.isArray(parsed)) {
      users = parsed;
      lastSeenAt = null;
    } else {
      const data = parsed as DataFile;
      users = data.users ?? [];
      lastSeenAt = data.lastSeenAt ?? null;
    }

    stats.clear();
    for (const u of users) {
      u.voiceJoinedAt = null;
      u.totalMessages = u.totalMessages ?? u.messages;
      u.totalVoiceSeconds = u.totalVoiceSeconds ?? u.voiceSeconds;
      stats.set(u.userId, u);
    }
    console.log(`[Store] Загружена статистика: ${stats.size} участников, lastSeenAt: ${lastSeenAt ? new Date(lastSeenAt).toISOString() : "нет"}`);
  } catch (e) {
    console.error("[Store] Ошибка загрузки статистики:", e);
  }
}

export function saveStats(): void {
  ensureDataDir();
  try {
    const data: DataFile = {
      lastSeenAt,
      users: Array.from(stats.values()).map((u) => ({ ...u, voiceJoinedAt: null })),
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("[Store] Ошибка сохранения статистики:", e);
  }
}

export function getLastSeenAt(): number | null {
  return lastSeenAt;
}

export function updateLastSeenAt(): void {
  lastSeenAt = Date.now();
  saveStats();
}

export function getUser(userId: string, username: string): UserStats {
  if (!stats.has(userId)) {
    stats.set(userId, {
      userId,
      username,
      messages: 0,
      voiceSeconds: 0,
      voiceJoinedAt: null,
      totalMessages: 0,
      totalVoiceSeconds: 0,
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
    // totalMessages and totalVoiceSeconds are never reset
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
      user.totalVoiceSeconds += seconds;
      saveStats();
    }
  }
}

export function incrementMessages(userId: string, username: string): void {
  const user = getUser(userId, username);
  user.messages += 1;
  user.totalMessages += 1;
  saveStats();
}
