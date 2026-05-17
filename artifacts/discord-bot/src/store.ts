import fs from "fs";
import path from "path";

const DATA_FILE = path.resolve(__dirname, "../data/stats.json");

export interface UserStats {
  userId: string;
  username: string;
  messages: number;
  voiceSeconds: number;
  voiceJoinedAt: number | null;
  totalMessages: number;
  totalVoiceSeconds: number;
  excluded: boolean;
  isCurator: boolean;
  isModerator: boolean;
  streak: number;
  bestStreak: number;
  curatorStats: {
    obzvon: number;
    tiket: number;
    proverka: number;
    proverkaKm: number;
    spisok: number;
  };
  moderatorStats: {
    aktiv: number;
    tiket: number;
  };
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
      u.excluded = u.excluded ?? false;
      u.isCurator = u.isCurator ?? false;
      u.isModerator = u.isModerator ?? false;
      u.streak = u.streak ?? 0;
      u.bestStreak = u.bestStreak ?? 0;
      u.curatorStats = u.curatorStats ?? { obzvon: 0, tiket: 0, proverka: 0, proverkaKm: 0, spisok: 0 };
      u.moderatorStats = u.moderatorStats ?? { aktiv: 0, tiket: 0 };
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
      excluded: false,
      isCurator: false,
      isModerator: false,
      streak: 0,
      bestStreak: 0,
      curatorStats: { obzvon: 0, tiket: 0, proverka: 0, proverkaKm: 0, spisok: 0 },
      moderatorStats: { aktiv: 0, tiket: 0 },
    });
  }
  return stats.get(userId)!;
}

export function updateUserStreak(userId: string, passed: boolean): void {
  const user = stats.get(userId);
  if (!user) return;
  if (passed) {
    user.streak += 1;
    if (user.streak > user.bestStreak) {
      user.bestStreak = user.streak;
    }
  } else {
    user.streak = 0;
  }
}

export function getAllUsers(): UserStats[] {
  return Array.from(stats.values());
}

export function getActiveUsers(): UserStats[] {
  return Array.from(stats.values()).filter((u) => !u.excluded);
}

export function resetAllStats(): void {
  for (const user of stats.values()) {
    user.messages = 0;
    user.voiceSeconds = 0;
    user.voiceJoinedAt = null;
    user.curatorStats = { obzvon: 0, tiket: 0, proverka: 0, proverkaKm: 0, spisok: 0 };
    user.moderatorStats = { aktiv: 0, tiket: 0 };
  }
  saveStats();
}

export function resetUserStats(userId: string): boolean {
  const user = stats.get(userId);
  if (!user) return false;
  user.messages = 0;
  user.voiceSeconds = 0;
  user.voiceJoinedAt = null;
  saveStats();
  return true;
}

export function excludeUser(userId: string, username: string): void {
  const user = getUser(userId, username);
  user.excluded = true;
  saveStats();
}

export function includeUser(userId: string, username: string): void {
  const user = getUser(userId, username);
  user.excluded = false;
  saveStats();
}

export function setCurator(userId: string, username: string, value: boolean): void {
  const user = getUser(userId, username);
  user.isCurator = value;
  saveStats();
}

export function setModerator(userId: string, username: string, value: boolean): void {
  const user = getUser(userId, username);
  user.isModerator = value;
  saveStats();
}

export function recordVoiceJoin(userId: string, username: string): void {
  const user = getUser(userId, username);
  if (user.excluded) return;
  user.voiceJoinedAt = Date.now();
}

export function recordVoiceLeave(userId: string, username: string): void {
  const user = getUser(userId, username);
  if (user.voiceJoinedAt !== null) {
    const seconds = (Date.now() - user.voiceJoinedAt) / 1000;
    user.voiceJoinedAt = null;
    if (!user.excluded && seconds >= 30) {
      user.voiceSeconds += seconds;
      user.totalVoiceSeconds += seconds;
      saveStats();
    }
  }
}

export function incrementMessages(userId: string, username: string): void {
  const user = getUser(userId, username);
  if (user.excluded) return;
  user.messages += 1;
  user.totalMessages += 1;
  saveStats();
}

export function addVoiceSeconds(userId: string, username: string, seconds: number): void {
  const user = getUser(userId, username);
  user.voiceSeconds += seconds;
  user.totalVoiceSeconds += seconds;
  saveStats();
}

export type CuratorStatKey = keyof UserStats["curatorStats"];
export type ModeratorStatKey = keyof UserStats["moderatorStats"];

export function incrementCuratorStat(
  userId: string,
  username: string,
  stat: CuratorStatKey
): void {
  const user = getUser(userId, username);
  user.curatorStats[stat] += 1;
  saveStats();
}

export function incrementModeratorStat(
  userId: string,
  username: string,
  stat: ModeratorStatKey
): void {
  const user = getUser(userId, username);
  user.moderatorStats[stat] += 1;
  saveStats();
}
