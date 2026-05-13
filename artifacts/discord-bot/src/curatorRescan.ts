import { Client, TextChannel } from "discord.js";
import { getAllUsers, saveStats } from "./store.js";

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
  const curators = getAllUsers().filter((u) => u.isCurator);

  if (curators.length === 0) {
    console.log(`[CuratorRescan] Кураторов нет, пропускаю.`);
    return;
  }

  console.log(`[CuratorRescan] Пересчёт для ${curators.length} кураторов с ${new Date(weekStart).toISOString()}...`);

  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.channels.fetch();
      await guild.members.fetch();
    } catch {
      continue;
    }

    for (const curator of curators) {
      const member = guild.members.cache.get(curator.userId);
      if (!member) continue;

      const discordUsername = member.user.username.toLowerCase();

      const reportChannel = guild.channels.cache.find((ch) => {
        const chName = "name" in ch ? (ch as any).name as string : "";
        const name = chName.toLowerCase();
        return (
          name === `рапорт-${discordUsername}` ||
          name.startsWith(`рапорт-${discordUsername}`)
        );
      });

      if (!reportChannel || !("messages" in reportChannel)) {
        console.log(`[CuratorRescan] Канал рапорт-${discordUsername} не найден`);
        continue;
      }

      let obzvon = 0, tiket = 0, proverka = 0, proverkaKm = 0, spisok = 0;

      try {
        let lastId: string | undefined;
        let done = false;

        while (!done) {
          const options: { limit: number; before?: string } = { limit: 100 };
          if (lastId) options.before = lastId;

          const batch = await (reportChannel as TextChannel).messages.fetch(options).catch(() => null);
          if (!batch || batch.size === 0) break;

          const sorted = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
          let reachedCutoff = false;

          for (const msg of sorted) {
            if (msg.createdTimestamp < weekStart) {
              reachedCutoff = true;
              continue;
            }
            if (msg.author.id !== curator.userId) continue;

            const lower = msg.content.trim().toLowerCase();
            let matched = false;

            if (lower.startsWith("+обзвон"))                                              { obzvon++;     matched = true; }
            else if (lower.startsWith("+проверка км") || lower.startsWith("+проверкакм")) { proverkaKm++; matched = true; }
            else if (lower.startsWith("+проверка"))                                       { proverka++;   matched = true; }
            else if (lower.startsWith("+тикет"))                                          { tiket++;      matched = true; }
            else if (lower.startsWith("+список"))                                         { spisok++;     matched = true; }

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
        console.warn(`[CuratorRescan] Ошибка у ${member.displayName}:`, err);
      }

      curator.curatorStats.obzvon     = obzvon;
      curator.curatorStats.tiket      = tiket;
      curator.curatorStats.proverka   = proverka;
      curator.curatorStats.proverkaKm = proverkaKm;
      curator.curatorStats.spisok     = spisok;

      console.log(`[CuratorRescan] ${member.displayName}: тикет=${tiket} обзвон=${obzvon} проверка=${proverka} список=${spisok}`);
    }
  }

  saveStats();
  console.log(`[CuratorRescan] Готово.`);
}