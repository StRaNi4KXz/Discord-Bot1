import { EmbedBuilder, TextChannel, Client, Guild, ChannelType } from "discord.js";
import { getActiveUsers, resetAllStats, updateUserStreak, excludeUser, UserStats } from "./store.js";
import { config } from "./config.js";
import { getNorm } from "./dynamicConfig.js";
import { saveWeekSnapshot } from "./history.js";
import { rescanCuratorStats } from "./curatorRescan.js";

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}ч ${m}м`;
}

function getWeekRange(): { monday: Date; sunday: Date } {
  const now = new Date();
  const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1;
  // Прошлый понедельник — начало отчётного периода
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek - 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { monday, sunday };
}

function fmtDate(d: Date): string {
  return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}`;
}

export async function sendPersonalReport(
  guild: Guild,
  user: UserStats,
  displayName: string
): Promise<void> {
  try {
    const member = await guild.members.fetch(user.userId).catch(() => null);
    if (!member) {
      console.warn(`[Report] Участник ${displayName} не найден на сервере`);
      return;
    }

    await guild.channels.fetch();

    // Ищем канал только по нику ДО "|" — часть после "|" это тег роли
    const nameBeforePipe = member.displayName.toLowerCase().trim().split("|")[0].trim();
    const nickBeforePipe = (member.nickname?.toLowerCase().trim() ?? "").split("|")[0].trim();
    const username = member.user.username.toLowerCase().trim();

    const reportChannel = guild.channels.cache.find((ch) => {
      const chName = "name" in ch ? (ch as any).name as string : "";
      const name = chName.toLowerCase();
      if (!name.startsWith("рапорт-")) return false;
      const suffix = name.replace("рапорт-", "").trim();
      const matches = (a: string, b: string) =>
        b && (a === b || a.startsWith(b) || b.startsWith(a));
      return (
        matches(suffix, username) ||
        (nickBeforePipe && matches(suffix, nickBeforePipe)) ||
        (nameBeforePipe && matches(suffix, nameBeforePipe))
      );
    }) as TextChannel | undefined;

    if (!reportChannel) {
      console.warn(`[Report] Канал рапорт-${username} не найден`);
      return;
    }

    const normNorm = getNorm();
    const { monday, sunday } = getWeekRange();
    const dateRange = `${fmtDate(monday)}-${fmtDate(sunday)}`;

    const voiceOk = user.voiceSeconds >= normNorm.voiceHours * 3600;
    const msgOk = user.messages >= normNorm.messages;
    const voiceStr = formatTime(user.voiceSeconds);

    // ── Куратор-рапорт ──
    if (user.isCurator) {
      const cn = normNorm.curator;
      const cs = user.curatorStats;

      const obzvonOk   = cs.obzvon   >= cn.obzvon;
      const tiketOk    = cs.tiket    >= cn.tiket;
      const proverkaOk = cs.proverka >= cn.proverka;
      const spisokOk   = cs.spisok   >= cn.spisok;
      const allOk = voiceOk && msgOk && obzvonOk && tiketOk && proverkaOk && spisokOk;

      const text = [
        `# **Куратор: ${displayName}**`,
        `## Отчет с ${dateRange}`,
        `================================`,
        `**> Активность в голосовых каналах - ${voiceOk ? "✅" : "❌"}`,
        `> ${voiceStr} / ${normNorm.voiceHours}ч`,
        `================================`,
        `> Активность в текстовых каналах - ${msgOk ? "✅" : "❌"}`,
        `> ${user.messages} / ${normNorm.messages}`,
        `================================`,
        `> Норма по обзвонам - ${obzvonOk ? "✅" : "❌"}`,
        `> ${cs.obzvon} / ${cn.obzvon}`,
        `================================`,
        `> Норма по спискам - ${spisokOk ? "✅" : "❌"}`,
        `> ${cs.spisok} / ${cn.spisok}`,
        `================================`,
        `> Норма по проверкам - ${proverkaOk ? "✅" : "❌"}`,
        `> ${cs.proverka} / ${cn.proverka}`,
        `================================`,
        `> Норма по тикетам - ${tiketOk ? "✅" : "❌"}`,
        `> ${cs.tiket} / ${cn.tiket}**`,
        `================================`,
        allOk ? `### ✅ Недельная норма выполнена` : `### ❌ Недельная норма не выполнена`,
      ].join("\n");

      await reportChannel.send(text);
      console.log(`[Report] Куратор-рапорт отправлен: ${displayName}`);
      return;
    }

    // ── Модератор-рапорт ──
    if (user.isModerator) {
      const mn = normNorm.moderator;
      const ms = user.moderatorStats;

      const aktivOk = ms.aktiv >= mn.aktiv;
      const tiketOk = ms.tiket >= mn.tiket;
      const allOk   = voiceOk && msgOk && aktivOk && tiketOk;

      const text = [
        `# **Клан-модератор: ${displayName}**`,
        `## Отчет с ${dateRange}`,
        `================================`,
        `**> Активность в голосовых каналах - ${voiceOk ? "✅" : "❌"}`,
        `> ${voiceStr} / ${normNorm.voiceHours}ч`,
        `================================`,
        `> Активность в текстовых каналах - ${msgOk ? "✅" : "❌"}`,
        `> ${user.messages} / ${normNorm.messages}`,
        `================================`,
        `> Норма по активам - ${aktivOk ? "✅" : "❌"}`,
        `> ${ms.aktiv} / ${mn.aktiv}`,
        `================================`,
        `> Норма по тикетам - ${tiketOk ? "✅" : "❌"}`,
        `> ${ms.tiket} / ${mn.tiket}**`,
        `================================`,
        allOk ? `### ✅ Недельная норма выполнена` : `### ❌ Недельная норма не выполнена`,
      ].join("\n");

      await reportChannel.send(text);
      console.log(`[Report] Модератор-рапорт отправлен: ${displayName}`);
      return;
    }

    // ── Обычный участник ──
    const voiceIcon = voiceOk ? "✅" : "❌";
    const msgIcon = msgOk ? "✅" : "❌";
    const normStr =
      voiceOk && msgOk
        ? "### ✅ Недельная норма выполнена"
        : "### ❌ Недельная норма не выполнена";

    const text = [
      `# **Участник: ${displayName}**`,
      `## Отчет с ${dateRange}`,
      `================================`,
      `**> Активность в голосовых каналах - ${voiceIcon}`,
      `> ${voiceStr} / ${normNorm.voiceHours}ч`,
      `================================`,
      `> Активность в текстовых каналах - ${msgIcon}`,
      `> ${user.messages} / ${normNorm.messages}**`,
      `================================`,
      normStr,
    ].join("\n");

    await reportChannel.send(text);
    console.log(`[Report] Отправлено: ${displayName}`);
  } catch (e) {
    console.warn(`[Report] Ошибка отправки для ${displayName}:`, e);
  }
}

export async function sendWeeklyReport(client: Client): Promise<void> {
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

  // Пересканируем статы кураторов и модераторов перед отчётом
  await rescanCuratorStats(client);

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

    // Для куратора норма включает curator stats
    if (user.isCurator) {
      const cn = norm.curator;
      const cs = user.curatorStats;
      normPassed =
        normPassed &&
        cs.obzvon >= cn.obzvon &&
        cs.tiket >= cn.tiket &&
        cs.proverka >= cn.proverka &&
        cs.spisok >= cn.spisok;
    }

    // Для модератора норма включает moderator stats
    if (user.isModerator) {
      const mn = norm.moderator;
      const ms = user.moderatorStats;
      normPassed =
        normPassed &&
        ms.aktiv >= mn.aktiv &&
        ms.tiket >= mn.tiket;
    }

    const voiceStr = formatTime(user.voiceSeconds);
    const msgStr = `${user.messages} сообщ.`;
    const line = `**${displayName}** — голос: ${voiceStr} / ${norm.voiceHours}ч, чат: ${msgStr} / ${norm.messages}`;

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
        if (cs.obzvon < cn.obzvon)     reasons.push(`мало обзвонов (${cs.obzvon}/${cn.obzvon})`);
        if (cs.tiket < cn.tiket)       reasons.push(`мало тикетов (${cs.tiket}/${cn.tiket})`);
        if (cs.proverka < cn.proverka) reasons.push(`мало проверок (${cs.proverka}/${cn.proverka})`);
        if (cs.spisok < cn.spisok)     reasons.push(`мало списков (${cs.spisok}/${cn.spisok})`);
      }
      if (user.isModerator) {
        const mn = norm.moderator;
        const ms = user.moderatorStats;
        if (ms.aktiv < mn.aktiv) reasons.push(`мало активов (${ms.aktiv}/${mn.aktiv})`);
        if (ms.tiket < mn.tiket) reasons.push(`мало тикетов (${ms.tiket}/${mn.tiket})`);
      }
      failed.push("❌ " + line + ` *(${reasons.join(", ")})*`);
    }

    if (guild) {
      await sendPersonalReport(guild, user, displayName);
    }
  }

  const embed = new EmbedBuilder()
    .setTitle("📋 Еженедельная проверка нормы активности")
    .setColor(failed.length === 0 ? 0x57f287 : 0xed4245)
    .setTimestamp()
    .setFooter({ text: `Норма: ${norm.voiceHours}ч голос + ${norm.messages} сообщений` });

  if (passed.length > 0) {
    embed.addFields({
      name: `✅ Норма выполнена (${passed.length})`,
      value: passed.join("\n").slice(0, 1024),
    });
  }

  if (failed.length > 0) {
    embed.addFields({
      name: `❌ Норма не выполнена (${failed.length})`,
      value: failed.join("\n").slice(0, 1024),
    });
  }

  await (channel as TextChannel).send({ embeds: [embed] });

  saveWeekSnapshot({
    weekEnding: new Date().toISOString().slice(0, 10),
    voiceHoursNorm: norm.voiceHours,
    messagesNorm: norm.messages,
    users: historyUsers,
  });

  resetAllStats();
  console.log("[Report] Отчёт отправлен, статистика сброшена.");
}
