export interface UserStats {
  userId: string;
  username: string;
  messages: number;
  voiceSeconds: number;
  lastMessages: string[];
  voiceJoinedAt: number | null;
}

const stats = new Map<string, UserStats>();

export function getUser(userId: string, username: string): UserStats {
  if (!stats.has(userId)) {
    stats.set(userId, {
      userId,
      username,
      messages: 0,
      voiceSeconds: 0,
      lastMessages: [],
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
    user.lastMessages = [];
    user.voiceJoinedAt = null;
  }
}

export function addVoiceTime(userId: string, username: string, seconds: number): void {
  const user = getUser(userId, username);
  user.voiceSeconds += seconds;
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
    }
  }
}

export function incrementMessages(userId: string, username: string): boolean {
  const user = getUser(userId, username);
  user.messages += 1;
  return true;
}

export function addLastMessage(userId: string, username: string, content: string): void {
  const user = getUser(userId, username);
  user.lastMessages.push(content);
  if (user.lastMessages.length > 10) {
    user.lastMessages.shift();
  }
}
