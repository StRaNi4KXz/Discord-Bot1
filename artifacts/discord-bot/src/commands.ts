import {
  Message,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ButtonInteraction,
  ChannelType,
} from "discord.js";
import { getAllUsers, getUser } from "./store.js";
import { config } from "./config.js";
import { sendPersonalReport } from "./report.js";

let lastTestReportAt: number | null = null;

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}ч ${m}м`;
}

export function buildStatusEmbed(
  displayName: string,
  messages: number,
  voiceSeconds: number,
  totalMessages: number,
  totalVoiceSeconds: number,
  mode: "week" | "all"
): { embeds: [EmbedBuilder]; components: [ActionRowBuilder<ButtonBuilder>] } {
  const isWeek = mode === "week";
  const msgCount = isWeek ? messages : totalMessages;
  const voiceSec = isWeek ? voiceSeconds : totalVoiceSeconds;

  const voiceDone = msgCount >= config.weeklyNorm.messages;
  const msgDone = voiceSec >= config.weeklyNorm.voiceHours * 3600;

  const voiceIcon = voiceSec >= config.weeklyNorm.voiceHours * 3600 ? "✅" : "❌";
  const msgIcon = msgCount >= config.weeklyNorm.messages ? "✅" : "❌";

  const embed = new EmbedBuilder()
    .setTitle(`📊 Статистика — ${displayName}`)
    .setDescription(isWeek ? "📅 За текущую неделю" : "🗓️ За всё время")
    .addFields(
      {
        name: `${voiceIcon} Голос`,
        value: `${formatTime(voiceSec)} / ${isWeek ? config.weeklyNorm.voiceHours + "ч" : "∞"}`,
        inline: true,
      },
      {
        name: `${msgIcon} Сообщений`,
        value: `${msgCount} / ${isWeek ? config.weeklyNorm.messages : "∞"}`,
        inline: true,
      }
    )
    .setColor(isWeek ? (voiceDone && msgDone ? 0x57f287 : 0xed4245) : 0x5865f2)
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`status_week_${messages}_${voiceSeconds}_${totalMessages}_${totalVoiceSeconds}_${displayName}`)
      .setLabel("📅 Неделя")
      .setStyle(isWeek ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`status_all_${messages}_${voiceSeconds}_${totalMessages}_${totalVoiceSeconds}_${displayName}`)
      .setLabel("🗓️ За всё время")
      .setStyle(!isWeek ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

export async function handleStatusButton(interaction: ButtonInteraction): Promise<void> {
  const id = interaction.customId;
  const parts = id.split("_");
  // format: status_{mode}_{messages}_{voiceSeconds}_{totalMessages}_{totalVoiceSeconds}_{displayName...}
  const mode = parts[1] as "week" | "all";
  const messages = parseInt(parts[2], 10);
  const voiceSeconds = parseFloat(parts[3]);
  const totalMessages = parseInt(parts[4], 10);
  const totalVoiceSeconds = parseFloat(parts[5]);
  const displayName = parts.slice(6).join("_");

  const reply = buildStatusEmbed(displayName, messages, voiceSeconds, totalMessages, totalVoiceSeconds, mode);
  await interaction.update(reply);
}

export async function handleCommand(message: Message): Promise<void> {
  const content = message.content.trim();

  if (content === "!норма" || content === "!norm") {
    const users = getAllUsers();
    if (users.length === 0) {
      await message.reply("Статистика пуста — ещё никто не набрал активности.");
      return;
    }

    const lines = await Promise.all(
      users.map(async (u) => {
        const member = await message.guild?.members.fetch(u.userId).catch(() => null);
        const displayName = member?.displayName ?? u.username;
        const voiceDone = u.voiceSeconds >= config.weeklyNorm.voiceHours * 3600;
        const msgDone = u.messages >= config.weeklyNorm.messages;
        const icon = voiceDone && msgDone ? "✅" : "❌";
        return `${icon} **${displayName}** — голос: ${formatTime(u.voiceSeconds)}/${config.weeklyNorm.voiceHours}ч, сообщений: ${u.messages}/${config.weeklyNorm.messages}`;
      })
    );

    await message.reply(`📊 **Текущая статистика:**\n${lines.join("\n")}`);
    return;
  }

  if (content.startsWith("!статус") || content.startsWith("!status")) {
    const parts = content.split(" ");
    const mention = parts[1];

    let targetUserId: string;
    let displayName: string;

    if (mention) {
      const userId = mention.replace(/[<@!>]/g, "");
      const member = await message.guild?.members.fetch(userId).catch(() => null);
      if (!member) {
        await message.reply("Пользователь не найден.");
        return;
      }
      targetUserId = userId;
      displayName = member.displayName;
      getUser(userId, member.user.username);
    } else {
      targetUserId = message.author.id;
      const member = await message.guild?.members.fetch(targetUserId).catch(() => null);
      displayName = member?.displayName ?? message.author.username;
      getUser(targetUserId, message.author.username);
    }

    const user = getUser(targetUserId, displayName);
    const reply = buildStatusEmbed(
      displayName,
      user.messages,
      user.voiceSeconds,
      user.totalMessages,
      user.totalVoiceSeconds,
      "week"
    );
    await message.reply(reply);
    return;
  }

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
        return `**${displayName}**: ${u.voiceSeconds.toFixed(0)}с голос (всего: ${u.totalVoiceSeconds.toFixed(0)}с), ${u.messages} сообщ. (всего: ${u.totalMessages}), в канале: ${u.voiceJoinedAt ? "да" : "нет"}`;
      })
    );
    await message.reply("🔍 **Сырые данные:**\n" + lines.join("\n"));
    return;
  }

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
        ?? { userId: member?.id ?? "", username: usernameFromChannel, messages: 0, voiceSeconds: 0, voiceJoinedAt: null, totalMessages: 0, totalVoiceSeconds: 0 };

      const norm = userStats.voiceSeconds >= config.weeklyNorm.voiceHours * 3600
        && userStats.messages >= config.weeklyNorm.messages;
      const normStr = norm
        ? "# ✅ Недельная норма выполнена!"
        : "# ❌ Недельная норма не выполнена!";
      const h = Math.floor(userStats.voiceSeconds / 3600);
      const m2 = Math.floor((userStats.voiceSeconds % 3600) / 60);

      const text = [
        `**Clan member:** ${displayName}`,
        `**Активность в войсах:** ${h}ч ${m2}м / ${config.weeklyNorm.voiceHours}ч`,
        `**Активность по сообщениям:** ${userStats.messages} / ${config.weeklyNorm.messages}`,
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

  if (content === "!помощь" || content === "!help") {
    await message.reply(
      "**Команды бота:**\n" +
      "`!норма` — показать статистику всех участников за неделю\n" +
      "`!статус [@user]` — статистика участника (кнопки: неделя / за всё время)\n" +
      "`!тестрапорт` — отправить рапорты в личные каналы прямо сейчас\n" +
      "`!дебаг` — сырые данные (секунды, счётчики)\n" +
      "`!помощь` — это сообщение"
    );
  }
}
