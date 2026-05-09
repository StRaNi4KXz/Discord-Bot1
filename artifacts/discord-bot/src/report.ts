import { EmbedBuilder, TextChannel, Client, Guild, ChannelType } from "discord.js";
import { getActiveUsers, resetAllStats, updateUserStreak, UserStats } from "./store.js";
import { config } from "./config.js";
import { getNorm } from "./dynamicConfig.js";
import { saveWeekSnapshot } from "./history.js";

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}ч ${m}м`;
}

function checkNorm(user: UserStats): { passed: boolean; voice: boolean; messages: boolean } {
  const norm = getNorm();
  const voice = user.voiceSeconds >= norm.voiceHours * 3600;
  const messages = user.messages >= norm.messages;
  return { passed: voice && messages, voice, messages };
}

export async function sendPersonalReport(guild: Guild, user: UserStats, displayName: string): Promise<void> {
  try {
    const discordUser = await guild.client.users.fetch(user.userId);
    const username = discordUser.username.toLowerCase();

    await guild.channels.fetch();

    const reportChannel = guild.channels.cache.find(
      (ch) => {
        if (ch.type !== ChannelType.GuildText) return false;
        const name = ch.name.toLowerCase();
        return name === `рапорт-${username}` || name.startsWith(`рапорт-${username}`);
      }
    ) as TextChannel | undefined;

    if (!reportChannel) {
      console.warn(`[Report] Канал рапорт-${username} не найден`);
      return;
    }

    const norm = checkNorm(user);
    const normNorm = getNorm();
    const voiceStr = formatTime(user.voiceSeconds);
    const normStr = norm.passed
      ? "# ✅ Недельная норма выполнена!"
      : "# ❌ Недельная норма не выполнена!";

    const streakLine = user.streak > 0
      ? `**🔥 Стрик:** ${user.streak} ${user.streak === 1 ? "неделя" : user.streak < 5 ? "недели" : "недель"} подряд${user.bestStreak > user.streak ? ` (рекорд: ${user.bestStreak})` : user.bestStreak === user.streak && user.streak > 1 ? " 🏆 новый рекорд!" : ""}`
      : `**🔥 Стрик:** 0 (норма не выполнена)`;

    const text = [
      `**Clan member:** ${displayName}`,
      `**Активность в войсах:** ${voiceStr} / ${normNorm.voiceHours}ч`,
      `**Активность по сообщениям:** ${user.messages} / ${normNorm.messages}`,
      streakLine,
      ``,
      normStr,
    ].join("\n");

    await reportChannel.send(text);
    console.log(`[Report] Отправлено в канал рапорт-${username}`);
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
    const displayName = member?.displayName ?? user.username;

    const normResult = checkNorm(user);
    const voiceStr = formatTime(user.voiceSeconds);
    const msgStr = `${user.messages} сообщ.`;
    const line = `**${displayName}** — голос: ${voiceStr} / ${norm.voiceHours}ч, чат: ${msgStr} / ${norm.messages}`;

    updateUserStreak(user.userId, normResult.passed);

    historyUsers.push({
      userId: user.userId,
      displayName,
      messages: user.messages,
      voiceSeconds: user.voiceSeconds,
      passed: normResult.passed,
    });

    if (normResult.passed) {
      passed.push("✅ " + line);
    } else {
      const reasons: string[] = [];
      if (!normResult.voice) reasons.push("недостаточно времени в голосовом");
      if (!normResult.messages) reasons.push("недостаточно сообщений");
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

  // Save history snapshot before resetting
  saveWeekSnapshot({
    weekEnding: new Date().toISOString().slice(0, 10),
    voiceHoursNorm: norm.voiceHours,
    messagesNorm: norm.messages,
    users: historyUsers,
  });

  resetAllStats();
  console.log("[Report] Отчёт отправлен, статистика сброшена.");
}
