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

function findReportChannel(guild: import("discord.js").Guild, member: import("discord.js").GuildMember) {
  const username = member.user.username.toLowerCase().trim();

  // Берём только часть ДО "|" — это никнейм, после "|" — тег роли (не нужен)
  const displayName = member.displayName.toLowerCase().trim();
  const nameBeforePipe = displayName.split("|")[0].trim();

  // Серверный ник тоже только до "|"
  const rawNick = member.nickname?.toLowerCase().trim() ?? "";
  const nickBeforePipe = rawNick.split("|")[0].trim();

  return guild.channels.cache.find((ch) => {
    const chName = "name" in ch ? (ch as any).name as string : "";
    const name = chName.toLowerCase();
    if (!name.startsWith("рапорт-")) return false;
    const suffix = name.replace("рапорт-", "").trim();

    if (matchesSuffix(suffix, username)) return true;
    if (nickBeforePipe && matchesSuffix(suffix, nickBeforePipe)) return true;
    if (nameBeforePipe && matchesSuffix(suffix, nameBeforePipe)) return true;
    return false;
  });
}

export async function rescanCuratorStats(client: Client): Promise<void> {
  const weekStart = getWeekStart();
  const allUsers = getAllUsers();
  const curators = allUsers.filter((u) => u.isCurator);
  const moderators = allUsers.filter((u) => u.isModerator);

  const total = curators.length + moderators.length;
  if (total === 0) {
    console.log(`[CuratorRescan] Нет кураторов и модераторов, пропускаю.`);
    return;
  }

  console.log(`[CuratorRescan] Пересчёт: ${curators.length} кураторов, ${moderators.length} модераторов с ${new Date(weekStart).toISOString()}...`);

  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.channels.fetch();
      await guild.members.fetch();
    } catch {
      continue;
    }

    // ── Кураторы ──
    for (const curator of curators) {
      const member = guild.members.cache.get(curator.userId);
      if (!member) continue;

      const reportChannel = findReportChannel(guild, member);

      if (!reportChannel || !("messages" in reportChannel)) {
        console.log(`[CuratorRescan] Канал не найден для куратора ${member.displayName}`);
        continue;
      }

      let obzvon = 0, tiket = 0, proverka = 0, proverkaKm = 0, spisok = 0;
      let scanSuccess = false;

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
            if (msg.createdTimestamp < weekStart) { reachedCutoff = true; continue; }
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
              if (!botReacted) msg.react("✅").catch(() => {});
            }
          }

          const oldestTs = Math.min(...batch.map((m) => m.createdTimestamp));
          if (oldestTs < weekStart || reachedCutoff) done = true;
          else lastId = batch.last()?.id;
        }

        scanSuccess = true;
      } catch (err) {
        console.warn(`[CuratorRescan] Ошибка куратора ${member.displayName}, статы не изменены:`, err);
      }

      if (scanSuccess) {
        curator.curatorStats.obzvon     = obzvon;
        curator.curatorStats.tiket      = tiket;
        curator.curatorStats.proverka   = proverka;
        curator.curatorStats.proverkaKm = proverkaKm;
        curator.curatorStats.spisok     = spisok;
        console.log(`[CuratorRescan] Куратор ${member.displayName}: тикет=${tiket} обзвон=${obzvon} проверка=${proverka} список=${spisok}`);
      }
    }

    // ── Модераторы ──
    for (const moderator of moderators) {
      const member = guild.members.cache.get(moderator.userId);
      if (!member) continue;

      const reportChannel = findReportChannel(guild, member);

      if (!reportChannel || !("messages" in reportChannel)) {
        console.log(`[CuratorRescan] Канал не найден для модератора ${member.displayName}`);
        continue;
      }

      let aktiv = 0, tiket = 0;
      let scanSuccess = false;

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
            if (msg.createdTimestamp < weekStart) { reachedCutoff = true; continue; }
            if (msg.author.id !== moderator.userId) continue;

            const lower = msg.content.trim().toLowerCase();
            let matched = false;

            if (lower.startsWith("+актив"))       { aktiv++;  matched = true; }
            else if (lower.startsWith("+тикет"))  { tiket++;  matched = true; }

            if (matched) {
              const already = msg.reactions.cache.get("✅");
              const botReacted = already?.users.cache.has(client.user!.id);
              if (!botReacted) msg.react("✅").catch(() => {});
            }
          }

          const oldestTs = Math.min(...batch.map((m) => m.createdTimestamp));
          if (oldestTs < weekStart || reachedCutoff) done = true;
          else lastId = batch.last()?.id;
        }

        scanSuccess = true;
      } catch (err) {
        console.warn(`[CuratorRescan] Ошибка модератора ${member.displayName}, статы не изменены:`, err);
      }

      if (scanSuccess) {
        moderator.moderatorStats.aktiv = aktiv;
        moderator.moderatorStats.tiket = tiket;
        console.log(`[CuratorRescan] Модератор ${member.displayName}: актив=${aktiv} тикет=${tiket}`);
      }
    }
  }

  saveStats();
  console.log(`[CuratorRescan] Готово.`);
}
