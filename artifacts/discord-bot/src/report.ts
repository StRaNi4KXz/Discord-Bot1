import { EmbedBuilder, TextChannel, Client } from "discord.js";
import { getAllUsers, resetAllStats, UserStats } from "./store.js";
import { config } from "./config.js";

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}ч ${m}м`;
}

function checkNorm(user: UserStats): { passed: boolean; voice: boolean; messages: boolean } {
  const voice = user.voiceSeconds >= config.weeklyNorm.voiceHours * 3600;
  const messages = user.messages >= config.weeklyNorm.messages;
  return { passed: voice && messages, voice, messages };
}

async function sendPersonalDM(client: Client, user: UserStats, displayName: string): Promise<void> {
  try {
    const discordUser = await client.users.fetch(user.userId);
    const norm = checkNorm(user);
    const voiceStr = formatTime(user.voiceSeconds);
    const normStr = norm.passed
      ? "# ✅ Недельная норма выполнена!"
      : "# ❌ Недельная норма не выполнена!";

    const dm = [
      `**Clan member:** ${displayName}`,
      `**Активность в войсах:** ${voiceStr} / ${config.weeklyNorm.voiceHours}ч`,
      `**Активность по сообщениям:** ${user.messages} / ${config.weeklyNorm.messages}`,
      ``,
      normStr,
    ].join("\n");

    await discordUser.send(dm);
    console.log(`[DM] Отправлено личное сообщение: ${displayName}`);
  } catch {
    console.warn(`[DM] Не удалось отправить ЛС пользователю ${displayName} (закрытые ЛС или ошибка)`);
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

  const users = getAllUsers();
  if (users.length === 0) {
    await (channel as TextChannel).send("📊 Статистика за неделю пуста — активности не было.");
    return;
  }

  const guild = client.guilds.cache.first();

  const passed: string[] = [];
  const failed: string[] = [];

  for (const user of users) {
    const member = guild
      ? await guild.members.fetch(user.userId).catch(() => null)
      : null;
    const displayName = member?.displayName ?? user.username;

    const norm = checkNorm(user);
    const voiceStr = formatTime(user.voiceSeconds);
    const msgStr = `${user.messages} сообщ.`;
    const line = `**${displayName}** — голос: ${voiceStr} / ${config.weeklyNorm.voiceHours}ч, чат: ${msgStr} / ${config.weeklyNorm.messages}`;

    if (norm.passed) {
      passed.push("✅ " + line);
    } else {
      const reasons: string[] = [];
      if (!norm.voice) reasons.push("недостаточно времени в голосовом");
      if (!norm.messages) reasons.push("недостаточно сообщений");
      failed.push("❌ " + line + ` *(${reasons.join(", ")})*`);
    }

    await sendPersonalDM(client, user, displayName);
  }

  const embed = new EmbedBuilder()
    .setTitle("📋 Еженедельная проверка нормы активности")
    .setColor(failed.length === 0 ? 0x57f287 : 0xed4245)
    .setTimestamp()
    .setFooter({ text: `Норма: ${config.weeklyNorm.voiceHours}ч голос + ${config.weeklyNorm.messages} сообщений` });

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

  resetAllStats();
  console.log("[Report] Отчёт отправлен, статистика сброшена.");
}
