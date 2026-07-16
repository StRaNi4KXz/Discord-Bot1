import { EmbedBuilder, TextChannel, Client, Guild } from "discord.js";
import { getActiveUsers, resetAllStats, updateUserStreak, excludeUser, UserStats } from "./store.js";
import { config } from "./config.js";
import { getNorm } from "./dynamicConfig.js";
import { saveWeekSnapshot } from "./history.js";

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}ч ${m}м`;
}

function getWeekRange(): { monday: Date; sunday: Date } {
  const now = new Date();
  const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek - 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { monday, sunday };
}

function fmtDate(d: Date): string {
  return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}`;
}

// ── Поиск канала рапорт-* для участника ──────────────────────────────────────

function findReportChannel(guild: Guild, member: import("discord.js").GuildMember): TextChannel | null {
  const nameBeforePipe = (member.nickname ?? member.displayName).toLowerCase().split("|")[0].trim();
  const username = member.user.username.toLowerCase();

  return (guild.channels.cache.find((ch) => {
    if (!("name" in ch) || !ch.isTextBased()) return false;
    const name = (ch as any).name as string;
    if (!name.toLowerCase().startsWith("рапорт-")) return false;
    const suffix = name.toLowerCase().replace("рапорт-", "").trim();
    return suffix === username || suffix === nameBeforePipe ||
      username.startsWith(suffix) || nameBeforePipe.startsWith(suffix) ||
      suffix.startsWith(username) || suffix.startsWith(nameBeforePipe);
  }) as TextChannel | null) ?? null;
}

// ── Персональный рапорт куратора → канал рапорт-* ────────────────────────────

async function sendCuratorDM(
  client: Client,
  user: UserStats,
  displayName: string,
  dateRange: string,
  guild?: Guild
): Promise<void> {
  const norm = getNorm();
  const cn = norm.curator;
  const cs = user.curatorStats;
  const sal = norm.salary.curator;

  const voiceOk    = user.voiceSeconds >= norm.voiceHours * 3600;
  const msgOk      = user.messages >= norm.messages;
  const obzvonOk   = cs.obzvon >= cn.obzvon;
  const proverkaKmOk = cs.proverkaKm >= cn.proverkaKm;
  const spisokOk   = cs.spisok >= cn.spisok;
  const normPassed = voiceOk && msgOk && obzvonOk && proverkaKmOk && spisokOk;

  const tiketSf    = cs.tiket * sal.tiket;
  const obzvonSf   = cs.obzvon * sal.obzvon;
  const proverkaKmSf = cs.proverkaKm * sal.proverkaKm;
  const spisokSf   = cs.spisok * sal.spisok;
  const aktivSf    = cs.aktiv * sal.aktiv;
  const totalSalary = sal.bonus + tiketSf + obzvonSf + proverkaKmSf + spisokSf + aktivSf;

  const normLine = normPassed
    ? `# Недельная норма выполнена <a:rts_oks:713056535546167389>`
    : `# Недельная норма не выполнена <a:rts_Animated_Cross:739902221042319392>`;

  const lines: string[] = [
    `# Куратор (${displayName})`,
    `## Отчёт с ${dateRange}`,
    `**=====================**`,
    `** Тикеты ** - ${cs.tiket} (бонус) = ${tiketSf} сф`,
    ``,
    `** Обзвон** - ${cs.obzvon}/${cn.obzvon} ${obzvonOk ? "✅" : "❌"} = ${obzvonSf} сф`,
    ``,
    `** Проверка км** - ${cs.proverkaKm}/${cn.proverkaKm} ${proverkaKmOk ? "✅" : "❌"} = ${proverkaKmSf} сф`,
    ``,
    `** Список** - ${cs.spisok}/${cn.spisok} ${spisokOk ? "✅" : "❌"} = ${spisokSf} сф`,
    ``,
    ...(cs.aktiv > 0 ? [`** Актив** - ${cs.aktiv} (бонус) = ${aktivSf} сф`, ``] : []),
    `**Бонусные роли: Clan Curator + ${sal.bonus} сф**`,
    ``,
    `**=====================**`,
    normLine,
    `# Общая зарплата: ${totalSalary} сапфиров`,
  ];

  try {
    const discordUser = await client.users.fetch(user.userId).catch(() => null);
    if (!discordUser) {
      console.warn(`[Report] Не удалось найти пользователя для ДМ: ${displayName}`);
      return;
    }
    await discordUser.send(lines.join("\n"));
    console.log(`[Report] Куратор-рапорт (ДМ) отправлен: ${displayName}`);
  } catch (e) {
    console.warn(`[Report] Не удалось отправить ДМ куратору ${displayName}:`, e);
  }
}

// ── Персональный рапорт модератора (ДМ) ──────────────────────────────────────

async function sendModeratorDM(
  client: Client,
  user: UserStats,
  displayName: string,
  dateRange: string
): Promise<void> {
  const norm = getNorm();
  const mn = norm.moderator;
  const ms = user.moderatorStats;
  const sal = norm.salary.moderator;

  const voiceOk = user.voiceSeconds >= norm.voiceHours * 3600;
  const msgOk   = user.messages >= norm.messages;
  const aktivOk = ms.aktiv >= mn.aktiv;
  const tiketOk = ms.tiket >= mn.tiket;
  const normPassed = voiceOk && msgOk && aktivOk && tiketOk;

  const aktivSf = ms.aktiv * sal.aktiv;
  const tiketSf = ms.tiket * sal.tiket;
  const totalSalary = sal.bonus + aktivSf + tiketSf;

  const normLine = normPassed
    ? `# Недельная норма выполнена <a:rts_oks:713056535546167389>`
    : `# Недельная норма не выполнена <a:rts_Animated_Cross:739902221042319392>`;

  const lines: string[] = [
    `# Клан-модератор (${displayName})`,
    `## Отчёт с ${dateRange}`,
    `**=====================**`,
    `** Активы** - ${ms.aktiv}/${mn.aktiv} ${aktivOk ? "✅" : "❌"} = ${aktivSf} сф`,
    ``,
    `** Тикеты** - ${ms.tiket}/${mn.tiket} ${tiketOk ? "✅" : "❌"} = ${tiketSf} сф`,
    ``,
    `**Бонусные роли: Clan Moderator + ${sal.bonus} сф**`,
    ``,
    `**=====================**`,
    normLine,
    `# Общая зарплата: ${totalSalary} сапфиров`,
  ];

  try {
    const discordUser = await client.users.fetch(user.userId).catch(() => null);
    if (!discordUser) {
      console.warn(`[Report] Не удалось найти пользователя для ДМ: ${displayName}`);
      return;
    }
    await discordUser.send(lines.join("\n"));
    console.log(`[Report] Модератор-рапорт (ДМ) отправлен: ${displayName}`);
  } catch (e) {
    console.warn(`[Report] Не удалось отправить ДМ модератору ${displayName}:`, e);
  }
}

// ── Главный недельный отчёт ───────────────────────────────────────────────────

export async function sendWeeklyReport(client: Client, dateRange?: string): Promise<void> {
  const channelId = config.reportChannelId;
  if (!channelId) {
    console.error("[Report] DISCORD_REPORT_CHANNEL_ID не задан");
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.error("[Report] Канал не найден или не является текстовым");
    return;
  }

  if (!dateRange) {
    const { monday, sunday } = getWeekRange();
    dateRange = `${fmtDate(monday)}-${fmtDate(sunday)}`;
  }

  const users = getActiveUsers();
  const norm = getNorm();

  if (users.length === 0) {
    await (channel as TextChannel).send("📊 Статистика за неделю пуста — активности не было.");
    return;
  }

  const guild = client.guilds.cache.first();

  const passed: string[] = [];
  const failed: string[] = [];
  const historyUsers: import("./history.js").WeekEntry[] = [];

  for (const user of users) {
    const member = guild
      ? await guild.members.fetch(user.userId).catch(() => null)
      : null;

    if (guild && !member) {
      console.log(`[Report] ${user.username} не найден на сервере — авто-исключён.`);
      excludeUser(user.userId, user.username);
      continue;
    }

    const displayName = member?.displayName ?? user.username;

    const voiceOk = user.voiceSeconds >= norm.voiceHours * 3600;
    const msgOk = user.messages >= norm.messages;
    let normPassed = voiceOk && msgOk;

    // Куратор: тикеты и активы — бонус, не норма
    if (user.isCurator) {
      const cn = norm.curator;
      const cs = user.curatorStats;
      normPassed =
        normPassed &&
        cs.obzvon >= cn.obzvon &&
        cs.proverkaKm >= cn.proverkaKm &&
        cs.spisok >= cn.spisok;
    }

    if (user.isModerator) {
      const mn = norm.moderator;
      const ms = user.moderatorStats;
      normPassed =
        normPassed &&
        ms.aktiv >= mn.aktiv &&
        ms.tiket >= mn.tiket;
    }

    const voiceStr = formatTime(user.voiceSeconds);
    const line = `${displayName} - голос: ${voiceStr}, сообщений: ${user.messages}`;

    updateUserStreak(user.userId, normPassed);

    historyUsers.push({
      userId: user.userId,
      displayName,
      messages: user.messages,
      voiceSeconds: user.voiceSeconds,
      passed: normPassed,
    });

    if (normPassed) {
      passed.push("✅ " + line);
    } else {
      const reasons: string[] = [];
      if (!voiceOk) reasons.push("недостаточно времени в голосовом");
      if (!msgOk) reasons.push("недостаточно сообщений");
      if (user.isCurator) {
        const cn = norm.curator;
        const cs = user.curatorStats;
        if (cs.obzvon < cn.obzvon)         reasons.push(`обзвоны ${cs.obzvon}/${cn.obzvon}`);
        if (cs.proverkaKm < cn.proverkaKm) reasons.push(`проверки КМ ${cs.proverkaKm}/${cn.proverkaKm}`);
        if (cs.spisok < cn.spisok)         reasons.push(`списки ${cs.spisok}/${cn.spisok}`);
      }
      if (user.isModerator) {
        const mn = norm.moderator;
        const ms = user.moderatorStats;
        if (ms.aktiv < mn.aktiv) reasons.push(`мало активов (${ms.aktiv}/${mn.aktiv})`);
        if (ms.tiket < mn.tiket) reasons.push(`мало тикетов (${ms.tiket}/${mn.tiket})`);
      }
      failed.push("❌ " + line + ` *(${reasons.join(", ")})*`);
    }

    // Персональный ДМ кураторам и модераторам
    if (user.isCurator) {
      await sendCuratorDM(client, user, displayName, dateRange);
    } else if (user.isModerator) {
      await sendModeratorDM(client, user, displayName, dateRange);
    }
  }

  const lines: string[] = [
    `📋 **Еженедельная проверка нормы | ${dateRange}**`,
    `Норма: ${norm.voiceHours}ч голос + ${norm.messages} сообщений`,
    ``,
  ];

  if (passed.length > 0) {
    lines.push(`✅ Норма выполнена (${passed.length})`);
    lines.push(...passed);
    lines.push(``);
  }

  if (failed.length > 0) {
    lines.push(`❌ Норма не выполнена (${failed.length})`);
    lines.push(...failed);
  }

  const text = lines.join("\n");
  // Discord limit 2000 chars per message — split if needed
  for (let i = 0; i < text.length; i += 1900) {
    await (channel as TextChannel).send(text.slice(i, i + 1900));
  }

  saveWeekSnapshot({
    weekEnding: new Date().toISOString().slice(0, 10),
    voiceHoursNorm: norm.voiceHours,
    messagesNorm: norm.messages,
    users: historyUsers,
  });

  resetAllStats();
  console.log("[Report] Отчёт отправлен, статистика сброшена.");
}
