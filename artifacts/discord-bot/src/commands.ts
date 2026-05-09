import {
  Message,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ButtonInteraction,
  ChannelType,
} from "discord.js";
import { getAllUsers, getActiveUsers, getUser, resetUserStats, excludeUser, includeUser, type UserStats } from "./store.js";
import { config } from "./config.js";
import { getNorm, setVoiceHours, setMessages } from "./dynamicConfig.js";
import { sendPersonalReport } from "./report.js";
import { getHistory } from "./history.js";

let lastTestReportAt: number | null = null;

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}ч ${m}м`;
}

// ─── !статус ─────────────────────────────────────────────────────────────────

export function buildStatusEmbed(
  user: UserStats,
  displayName: string,
  mode: "week" | "all"
): { embeds: [EmbedBuilder]; components: [ActionRowBuilder<ButtonBuilder>] } {
  const norm = getNorm();
  const isWeek = mode === "week";
  const msgCount = isWeek ? user.messages : user.totalMessages;
  const voiceSec = isWeek ? user.voiceSeconds : user.totalVoiceSeconds;

  const voiceIcon = voiceSec >= norm.voiceHours * 3600 ? "✅" : "❌";
  const msgIcon = msgCount >= norm.messages ? "✅" : "❌";
  const passed = voiceSec >= norm.voiceHours * 3600 && msgCount >= norm.messages;

  const streakText = user.streak > 0
    ? `🔥 ${user.streak} ${user.streak === 1 ? "неделя" : user.streak < 5 ? "недели" : "недель"} подряд`
    : "🔥 0";
  const bestText = user.bestStreak > 0 ? `Рекорд: ${user.bestStreak}` : "Рекорда нет";

  const embed = new EmbedBuilder()
    .setTitle(`📊 Статистика — ${displayName}`)
    .setDescription(isWeek ? "📅 За текущую неделю" : "🗓️ За всё время")
    .addFields(
      {
        name: `${voiceIcon} Голос`,
        value: `${formatTime(voiceSec)} / ${isWeek ? norm.voiceHours + "ч" : "∞"}`,
        inline: true,
      },
      {
        name: `${msgIcon} Сообщений`,
        value: `${msgCount} / ${isWeek ? norm.messages : "∞"}`,
        inline: true,
      },
      {
        name: "🔥 Стрик",
        value: `${streakText}\n${bestText}`,
        inline: true,
      }
    )
    .setColor(isWeek ? (passed ? 0x57f287 : 0xed4245) : 0x5865f2)
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`status_week_${user.userId}`)
      .setLabel("📅 Неделя")
      .setStyle(isWeek ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`status_all_${user.userId}`)
      .setLabel("🗓️ За всё время")
      .setStyle(!isWeek ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

export async function handleStatusButton(interaction: ButtonInteraction): Promise<void> {
  const id = interaction.customId;
  const isWeek = id.startsWith("status_week_");
  const userId = id.replace("status_week_", "").replace("status_all_", "");

  const member = await interaction.guild?.members.fetch(userId).catch(() => null);
  const displayName = member?.displayName ?? userId;
  const user = getUser(userId, member?.user.username ?? userId);

  await interaction.update(buildStatusEmbed(user, displayName, isWeek ? "week" : "all"));
}

// ─── !топ ────────────────────────────────────────────────────────────────────

export function buildTopEmbed(
  mode: "week" | "all"
): { embeds: [EmbedBuilder]; components: [ActionRowBuilder<ButtonBuilder>] } {
  const norm = getNorm();
  const isWeek = mode === "week";
  const users = getActiveUsers();

  const sorted = [...users].sort((a, b) => {
    const scoreA = (isWeek ? a.voiceSeconds : a.totalVoiceSeconds) + (isWeek ? a.messages : a.totalMessages) * 60;
    const scoreB = (isWeek ? b.voiceSeconds : b.totalVoiceSeconds) + (isWeek ? b.messages : b.totalMessages) * 60;
    return scoreB - scoreA;
  });

  const medals = ["🥇", "🥈", "🥉"];
  const lines = sorted.slice(0, 10).map((u, i) => {
    const voiceSec = isWeek ? u.voiceSeconds : u.totalVoiceSeconds;
    const msgCount = isWeek ? u.messages : u.totalMessages;
    const passed = isWeek
      ? voiceSec >= norm.voiceHours * 3600 && msgCount >= norm.messages
      : null;
    const icon = medals[i] ?? `${i + 1}.`;
    const status = passed === null ? "" : passed ? " ✅" : " ❌";
    const streak = u.streak > 0 ? ` 🔥${u.streak}` : "";
    return `${icon} **${u.username}** — голос: ${formatTime(voiceSec)}, сообщ: ${msgCount}${status}${streak}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`🏆 Топ активности — ${isWeek ? "эта неделя" : "за всё время"}`)
    .setDescription(lines.length > 0 ? lines.join("\n") : "Пока нет данных")
    .setColor(0xfee75c)
    .setTimestamp()
    .setFooter({ text: isWeek ? `Норма: ${norm.voiceHours}ч голос + ${norm.messages} сообщений` : "Накопленная статистика" });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("top_week")
      .setLabel("📅 Неделя")
      .setStyle(isWeek ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("top_all")
      .setLabel("🗓️ За всё время")
      .setStyle(!isWeek ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

export async function handleTopButton(interaction: ButtonInteraction): Promise<void> {
  const mode = interaction.customId === "top_week" ? "week" : "all";
  await interaction.update(buildTopEmbed(mode));
}

// ─── !история ────────────────────────────────────────────────────────────────

function buildHistoryEmbed(): EmbedBuilder {
  const weeks = getHistory().slice(0, 5);

  if (weeks.length === 0) {
    return new EmbedBuilder()
      .setTitle("📚 История недель")
      .setDescription("Истории ещё нет — она появится после первого автоматического отчёта.")
      .setColor(0x5865f2);
  }

  const embed = new EmbedBuilder()
    .setTitle("📚 История недель (последние 5)")
    .setColor(0x5865f2);

  for (const week of weeks) {
    const passedCount = week.users.filter((u) => u.passed).length;
    const total = week.users.length;
    const lines = week.users
      .slice(0, 8)
      .map((u) => `${u.passed ? "✅" : "❌"} **${u.displayName}** — голос: ${formatTime(u.voiceSeconds)}, сообщ: ${u.messages}`);

    if (total > 8) lines.push(`_...и ещё ${total - 8} участников_`);

    embed.addFields({
      name: `📅 Неделя до ${week.weekEnding} | Норма: ${week.voiceHoursNorm}ч + ${week.messagesNorm} сообщ | ${passedCount}/${total} выполнили`,
      value: lines.join("\n") || "Нет данных",
    });
  }

  return embed;
}

// ─── Главный обработчик команд ────────────────────────────────────────────────

export async function handleCommand(message: Message): Promise<void> {
  const content = message.content.trim();

  // ── !норма ──
  if (content === "!норма" || content === "!norm") {
    const users = getActiveUsers();
    const norm = getNorm();
    if (users.length === 0) {
      await message.reply("Статистика пуста — ещё никто не набрал активности.");
      return;
    }

    const lines = await Promise.all(
      users.map(async (u) => {
        const member = await message.guild?.members.fetch(u.userId).catch(() => null);
        const displayName = member?.displayName ?? u.username;
        const voiceDone = u.voiceSeconds >= norm.voiceHours * 3600;
        const msgDone = u.messages >= norm.messages;
        const icon = voiceDone && msgDone ? "✅" : "❌";
        return `${icon} **${displayName}** — голос: ${formatTime(u.voiceSeconds)}/${norm.voiceHours}ч, сообщений: ${u.messages}/${norm.messages}`;
      })
    );

    await message.reply(`📊 **Текущая статистика:**\n${lines.join("\n")}`);
    return;
  }

  // ── !норма установить голос X ──
  const voiceMatch = content.match(/^!норма установить голос (\d+(?:[.,]\d+)?)$/i);
  if (voiceMatch) {
    const hours = parseFloat(voiceMatch[1].replace(",", "."));
    if (isNaN(hours) || hours <= 0 || hours > 168) {
      await message.reply("❌ Укажите корректное количество часов (от 0.5 до 168).");
      return;
    }
    setVoiceHours(hours);
    await message.reply(`✅ Норма голоса установлена: **${hours}ч** в неделю.`);
    return;
  }

  // ── !норма установить сообщений X ──
  const msgMatch = content.match(/^!норма установить сообщений (\d+)$/i);
  if (msgMatch) {
    const count = parseInt(msgMatch[1], 10);
    if (isNaN(count) || count <= 0 || count > 10000) {
      await message.reply("❌ Укажите корректное количество сообщений (от 1 до 10000).");
      return;
    }
    setMessages(count);
    await message.reply(`✅ Норма сообщений установлена: **${count}** в неделю.`);
    return;
  }

  // ── !статус ──
  if (content.startsWith("!статус") || content.startsWith("!status")) {
    const parts = content.split(" ");
    const mention = parts[1];

    let targetUserId: string;
    let displayName: string;

    if (mention && mention.startsWith("<@")) {
      const userId = mention.replace(/[<@!>]/g, "");
      const member = await message.guild?.members.fetch(userId).catch(() => null);
      if (!member) {
        await message.reply("Пользователь не найден.");
        return;
      }
      targetUserId = userId;
      displayName = member.displayName;
    } else {
      targetUserId = message.author.id;
      const member = await message.guild?.members.fetch(targetUserId).catch(() => null);
      displayName = member?.displayName ?? message.author.username;
    }

    const user = getUser(targetUserId, displayName);
    const reply = buildStatusEmbed(user, displayName, "week");
    await message.reply(reply);
    return;
  }

  // ── !топ ──
  if (content === "!топ" || content === "!top") {
    await message.reply(buildTopEmbed("week"));
    return;
  }

  // ── !история ──
  if (content === "!история" || content === "!history") {
    await message.reply({ embeds: [buildHistoryEmbed()] });
    return;
  }

  // ── !исключить ──
  if (content.startsWith("!исключить") || content.startsWith("!exclude")) {
    const parts = content.split(" ");
    const mention = parts[1];
    if (!mention || !mention.startsWith("<@")) {
      await message.reply("Укажите участника: `!исключить @username`");
      return;
    }
    const userId = mention.replace(/[<@!>]/g, "");
    const member = await message.guild?.members.fetch(userId).catch(() => null);
    if (!member) {
      await message.reply("Участник не найден.");
      return;
    }
    const user = getUser(userId, member.user.username);
    if (user.excluded) {
      includeUser(userId, member.user.username);
      await message.reply(`✅ **${member.displayName}** снова включён в учёт активности.`);
    } else {
      excludeUser(userId, member.user.username);
      await message.reply(`🚫 **${member.displayName}** исключён из учёта активности и отчётов.`);
    }
    return;
  }

  // ── !сброс ──
  if (content.startsWith("!сброс") || content.startsWith("!reset")) {
    const parts = content.split(" ");
    const mention = parts[1];
    if (!mention || !mention.startsWith("<@")) {
      await message.reply("Укажите участника: `!сброс @username`");
      return;
    }
    const userId = mention.replace(/[<@!>]/g, "");
    const member = await message.guild?.members.fetch(userId).catch(() => null);
    if (!member) {
      await message.reply("Участник не найден.");
      return;
    }
    const ok = resetUserStats(userId);
    if (ok) {
      await message.reply(`♻️ Недельная статистика **${member.displayName}** сброшена. (Общая история сохранена.)`);
    } else {
      await message.reply(`У **${member.displayName}** пока нет статистики.`);
    }
    return;
  }

  // ── !дебаг ──
  if (content === "!дебаг" || content === "!debug") {
    const users = getAllUsers();
    if (users.length === 0) {
      await message.reply("Данных нет.");
      return;
    }
    const lines = await Promise.all(
      users.map(async (u) => {
        const member = await message.guild?.members.fetch(u.userId).catch(() => null);
        const displayName = member?.displayName ?? u.username;
        const excl = u.excluded ? " 🚫исключён" : "";
        return `**${displayName}**${excl}: голос ${u.voiceSeconds.toFixed(0)}с (всего: ${u.totalVoiceSeconds.toFixed(0)}с), ${u.messages} сообщ. (всего: ${u.totalMessages})`;
      })
    );
    await message.reply("🔍 **Сырые данные:**\n" + lines.join("\n"));
    return;
  }

  // ── !тестрапорт ──
  if (content === "!тестрапорт" || content === "!testreport") {
    const guild = message.guild;
    if (!guild) {
      await message.reply("Команда доступна только на сервере.");
      return;
    }

    const now = Date.now();
    if (lastTestReportAt && now - lastTestReportAt < 60_000) {
      const secsLeft = Math.ceil((60_000 - (now - lastTestReportAt)) / 1000);
      await message.reply(`⏳ Подождите ещё ${secsLeft} сек. перед повторным запуском.`);
      return;
    }
    lastTestReportAt = now;

    await guild.channels.fetch();
    await guild.members.fetch();

    const reportChannels = guild.channels.cache.filter(
      (ch) => ch.type === 0 && ch.name.toLowerCase().startsWith("рапорт-")
    );

    if (reportChannels.size === 0) {
      await message.reply("Каналы `рапорт-*` не найдены на сервере.");
      return;
    }

    await message.reply(`📤 Отправляю рапорты в ${reportChannels.size} канала(ов)...`);

    const statsMap = new Map<string, ReturnType<typeof getAllUsers>[0]>();
    for (const u of getAllUsers()) {
      statsMap.set(u.userId, u);
      statsMap.set(u.username.toLowerCase(), u);
    }

    const norm = getNorm();
    let sent = 0;
    const alreadySent = new Set<string>();

    for (const [, ch] of reportChannels) {
      const channelName = ch.name.toLowerCase();
      const usernameFromChannel = channelName.replace("рапорт-", "");

      const matchesChannel = (m: import("discord.js").GuildMember) => {
        const nick = m.nickname?.toLowerCase() ?? "";
        const display = m.displayName.toLowerCase();
        const user = m.user.username.toLowerCase();
        return (
          nick.startsWith(usernameFromChannel) ||
          nick === usernameFromChannel ||
          display.startsWith(usernameFromChannel) ||
          display === usernameFromChannel ||
          user === usernameFromChannel
        );
      };

      const member =
        guild.members.cache.find(matchesChannel) ??
        (await guild.members.search({ query: usernameFromChannel, limit: 10 })
          .then((r) => r.find(matchesChannel) ?? null)
          .catch(() => null));

      const dedupeKey = member?.id ?? usernameFromChannel;
      if (alreadySent.has(dedupeKey)) {
        console.log(`[TestReport] Пропуск дубля для ${dedupeKey}`);
        continue;
      }

      const displayName = member?.displayName ?? usernameFromChannel;
      const userStats = (member ? statsMap.get(member.id) : undefined)
        ?? statsMap.get(usernameFromChannel)
        ?? { userId: member?.id ?? "", username: usernameFromChannel, messages: 0, voiceSeconds: 0, voiceJoinedAt: null, totalMessages: 0, totalVoiceSeconds: 0, excluded: false };

      if (userStats.excluded) continue;

      const normPassed = userStats.voiceSeconds >= norm.voiceHours * 3600 && userStats.messages >= norm.messages;
      const normStr = normPassed ? "# ✅ Недельная норма выполнена!" : "# ❌ Недельная норма не выполнена!";
      const h = Math.floor(userStats.voiceSeconds / 3600);
      const m2 = Math.floor((userStats.voiceSeconds % 3600) / 60);

      const text = [
        `**Clan member:** ${displayName}`,
        `**Активность в войсах:** ${h}ч ${m2}м / ${norm.voiceHours}ч`,
        `**Активность по сообщениям:** ${userStats.messages} / ${norm.messages}`,
        ``,
        normStr,
      ].join("\n");

      try {
        if (ch.type === ChannelType.GuildText) {
          await (ch as import("discord.js").TextChannel).send(text);
          console.log(`[TestReport] Отправлено в #${ch.name} (участник: ${displayName})`);
          alreadySent.add(dedupeKey);
          sent++;
        }
      } catch (e) {
        console.warn(`[TestReport] Ошибка отправки в #${ch.name}:`, e);
      }
    }

    await message.reply(`✅ Готово! Рапорты отправлены: ${sent} из ${reportChannels.size} каналов.`);
    return;
  }

  // ── !помощь ──
  if (content === "!помощь" || content === "!help") {
    const norm = getNorm();
    await message.reply(
      "**Команды бота:**\n" +
      "`!норма` — статистика всех участников за неделю\n" +
      "`!топ` — топ участников по активности (кнопки: неделя / всё время)\n" +
      "`!история` — архив последних 5 недель\n" +
      "`!статус [@user]` — статистика участника (кнопки: неделя / всё время)\n" +
      "`!тестрапорт` — отправить рапорты прямо сейчас\n" +
      "`!норма установить голос X` — изменить норму голоса (сейчас: **" + norm.voiceHours + "ч**)\n" +
      "`!норма установить сообщений X` — изменить норму сообщений (сейчас: **" + norm.messages + "**)\n" +
      "`!исключить @user` — исключить/включить участника из учёта\n" +
      "`!сброс @user` — сбросить недельную статистику участника\n" +
      "`!дебаг` — сырые данные\n" +
      "`!помощь` — это сообщение"
    );
  }
}
