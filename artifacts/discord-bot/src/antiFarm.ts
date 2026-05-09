import { config } from "./config.js";

const recentMessages = new Map<string, { content: string; timestamp: number }[]>();

export function isSpam(userId: string, content: string, atTimestamp?: number): boolean {
  const trimmed = content.trim();

  if (trimmed.length < config.antiFarm.minMessageLength) {
    return true;
  }

  const ts = atTimestamp ?? Date.now();
  const window = config.antiFarm.duplicateWindowMs;

  if (!recentMessages.has(userId)) {
    recentMessages.set(userId, []);
  }

  const history = recentMessages.get(userId)!;
  const filtered = history.filter((m) => ts - m.timestamp < window);
  recentMessages.set(userId, filtered);

  const isDuplicate = filtered.some(
    (m) => normalize(m.content) === normalize(trimmed)
  );

  if (isDuplicate) {
    return true;
  }

  filtered.push({ content: trimmed, timestamp: ts });

  return false;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
