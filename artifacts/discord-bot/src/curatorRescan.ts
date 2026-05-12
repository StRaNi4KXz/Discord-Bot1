import { Client, TextChannel } from "discord.js";
import { getUser, saveStats } from "./store.js";

function getWeekStart(): number {
  const now = new Date();
  const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dow);
  monday.setHours(0, 0, 0, 0);
  return monday.getTime();
}

export async function rescanCuratorStats(client: Client): Promise<void> {
  const weekStart = getWeekStart();
  console.log(`[CuratorRescan] Пересчёт с ${new Date(weekStart).toISOString()}...`);

  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.channels.fetch();
    } catch {
      continue;
    }

    for (const channel of guild.channels.cache.values()) {
      const chName = "name" in channel ? (channel as any).name as string : "";
      if (!chName.startsWith("рапорт-")) continue;
      if (!("messages" in channel)) continue;

      const counts: Record<string, {
        userId: string;
        username: string;
        obzvon: number;
        tiket: number;
        proverka: number;
        proverkaKm: number;
        spisok: number;
      }> = {};

      try {
        let lastId: string | undefined;
        let done = false;

        while (!done) {
          const options: { limit: number; before?: string } = { limit: 100 };
          if (lastId) options.before = lastId;

          const batch = await (channel as TextChannel).messages.fetch(options).catch(() => null);
          if (!batch || batch.size === 0) break;

          const sorted = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
          let reachedCutoff = false;

          for (const msg of sorted) {
            if (msg.createdTimestamp < weekStart) {
              reachedCutoff = true;
              continue;
            }
            if (msg.author.bot) continue;

            const lower = msg.content.trim().toLowerCase();
            const id = msg.author.id;

            if (!counts[id]) {
              counts[id] = { userId: id, username: msg.author.username, obzvon: 0, tiket: 0, proverka: 0, proverkaKm: 0, spisok: 0 };
            }

            let matched = false;
            if (lower.startsWith("+обзвон"))                                              { counts[id].obzvon++;     matched = true; }
            else if (lower.startsWith("+проверка км") || lower.startsWith("+проверкакм")) { counts[id].proverkaKm++; matched = true; }
            else if (lower.startsWith("+проверка"))                                       { counts[id].proverka++;   matched = true; }
            else if (lower.startsWith("+тикет"))                                          { counts[id].tiket++;      matched = true; }
            else if (lower.startsWith("+список"))                                         { counts[id].spisok++;     matched = true; }

            if (matched) {
              const already = msg.reactions.cache.get("✅");
              const botReacted = already?.users.cache.has(client.user!.id);
              if (!botReacted) {
                msg.react("✅").catch(() => {});
              }
            }
          }

          const oldestTs = Math.min(...batch.map((m) => m.createdTimestamp));
          if (oldestTs < weekStart || reachedCutoff) {
            done = true;
          } else {
            lastId = batch.last()?.id;
          }
        }
      } catch (err) {
        console.warn(`[CuratorRescan] Ошибка в #${chName}:`, err);
      }

      for (const c of Object.values(counts)) {
        const user = getUser(c.userId, c.username);
        user.curatorStats.obzvon     = c.obzvon;
        user.curatorStats.tiket      = c.tiket;
        user.curatorStats.proverka   = c.proverka;
        user.curatorStats.proverkaKm = c.proverkaKm;
        user.curatorStats.spisok     = c.spisok;
        console.log(`[CuratorRescan] ${c.username}: тикет=${c.tiket} обзвон=${c.obzvon} проверка=${c.proverka} список=${c.spisok}`);
      }
    }
  }

  saveStats();
  console.log(`[CuratorRescan] Готово.`);
}