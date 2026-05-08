import { config } from "./config.js";

const recentMessages = new Map<string, { content: string; timestamp: number }[]>();

export function isSpam(userId: string, content: string): boolean {
  const trimmed = content.trim();

  if (trimmed.length < config.antiFarm.minMessageLength) {
    return true;
  }

  const now = Date.now();
  const window = config.antiFarm.duplicateWindowMs;

  if (!recentMessages.has(userId)) {
    recentMessages.set(userId, []);
  }

  const history = recentMessages.get(userId)!;

  const filtered = history.filter((m) => now - m.timestamp < window);
  recentMessages.set(userId, filtered);

  const isDuplicate = filtered.some(
    (m) => normalize(m.content) === normalize(trimmed)
  );

  if (isDuplicate) {
    return true;
  }

  filtered.push({ content: trimmed, timestamp: now });

  return false;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
