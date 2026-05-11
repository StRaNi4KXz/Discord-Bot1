import {
  Message,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ButtonInteraction,
  ChannelType,
} from "discord.js";
import {
  getAllUsers,
  getActiveUsers,
  getUser,
  resetUserStats,
  excludeUser,
  includeUser,
  addVoiceSeconds,
  setCurator,
  type UserStats,
} from "./store.js";
import { config } from "./config.js";
import { getNorm, setVoiceHours, setMessages, setCuratorNorm } from "./dynamicConfig.js";
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
  const streakText = user.streak > 0 ? `${user.streak}` : "0";
  const bestText = user.bestStreak > 0 ? `${user.bestStreak}` : "отсутствуют";
  const normLine = passed ? "## ✅ Недельная норма выполнена" : "## ❌ Недельная норма не выполнена";

  const desc = isWeek
    ? [
        "📆 За текущую неделю",
        "================================",
        `Войсы - ${voiceIcon}`,
        `${formatTime(voiceSec)} / ${norm.voiceHours}ч`,
        "================================",
        `Сообщения - ${msgIcon}`,
        `${msgCount} / ${norm.messages}`,
        "|————————————————————|",
        `Количество стриков - ${streakText} 🔥`,
        `Рекорды - ${bestText}`,
        normLine,
      ].join("\n")
    : [
        "🗓️ За всё время",
        "================================",
        `Войсы - ${voiceIcon}`,
        `${formatTime(voiceSec)}`,
        "================================",
        `Сообщения - ${msgIcon}`,
        `${msgCount}`,
        "|————————————————————|",
        `Количество стриков - ${streakText} 🔥`,
        `Рекорды - ${bestText}`,
      ].join("\n");

  const embed = new EmbedBuilder()
    .setTitle(`📊 Статистика — ${displayName}`)
    .setDescription(desc)
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
    const scoreA =
      (isWeek ? a.voiceSeconds : a.totalVoiceSeconds) +
      (isWeek ? a.messages : a.totalMessages) * 60;
    const scoreB =
      (isWeek ? b.voiceSeconds : b.totalVoiceSeconds) +
      (isWeek ? b.messages : b.totalMessages) * 60;
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
    .setFooter({
      text: isWeek
        ? `Норма: ${norm.voiceHours}ч голос + ${norm.messages} сообщений`
        : "Накопленная статистика",
    });

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
      .map(
        (u) =>
          `${u.passed ? "✅" : "❌"} **${u.displayName}** — голос: ${formatTime(u.voiceSeconds)}, сообщ: ${u.messages}`
      );

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

  // ── !норма куратор установить X Y ──
  const curatorNormMatch = content.match(
    /^!норма куратор установить (обзвон|тикет|проверка|проверкакм|список) (\d+)$/i
  );
  if (curatorNormMatch) {
    const keyMap: Record<string, keyof ReturnType<typeof getNorm>["curator"]> = {
      обзвон: "obzvon",
      тикет: "tiket",
      проверка: "proverka",
      проверкакм: "proverkaKm",
      список: "spisok",
    };
    const key = keyMap[curatorNormMatch[1].toLowerCase()];
    const value = parseInt(curatorNormMatch[2], 10);
    if (!key || isNaN(value) || value < 0) {
      await message.reply("❌ Некорректное значение.");
      return;
    }
    setCuratorNorm(key, value);
    await message.reply(`✅ Норма куратора **${curatorNormMatch[1]}** установлена: **${value}** в неделю.`);
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

  // ── !куратор ──
  if (content.startsWith("!куратор")) {
    const parts = content.split(" ");
    const mention = parts[1];
    if (!mention || !mention.startsWith("<@")) {
      await message.reply("Укажите участника: `!куратор @username`");
      return;
    }
    const userId = mention.replace(/[<@!>]/g, "");
    const member = await message.guild?.members.fetch(userId).catch(() => null);
    if (!member) {
      await message.reply("Участник не найден.");
      return;
    }
    const user = getUser(userId, member.user.username);
    const newValue = !user.isCurator;
    setCurator(userId, member.user.username, newValue);
    await message.reply(
      newValue
        ? `✅ **${member.displayName}** теперь куратор — будет получать расширенный рапорт.`
        : `↩️ **${member.displayName}** больше не куратор — будет получать обычный рапорт.`
    );
    return;
  }
  
  // ── !вышестоящие ──
  if (content === "!вышестоящие") {
    const curators = getActiveUsers().filter((u) => u.isCurator);

    if (curators.length === 0) {
      await message.reply("Кураторов пока нет. Назначь командой `!куратор @ник`.");
      return;
    }

    const norm = getNorm();
    const cn = norm.curator;

    const lines = await Promise.all(
      curators.map(async (u) => {
        const member = await message.guild?.members.fetch(u.userId).catch(() => null);
        const displayName = member?.displayName ?? u.username;
        const cs = u.curatorStats;

        const voiceOk    = u.voiceSeconds >= norm.voiceHours * 3600;
        const msgOk      = u.messages >= norm.messages;
        const obzvonOk   = cs.obzvon   >= cn.obzvon;
        const tiketOk    = cs.tiket    >= cn.tiket;
        const proverkaOk = cs.proverka >= cn.proverka;
        const spisokOk   = cs.spisok   >= cn.spisok;
        const allOk      = voiceOk && msgOk && obzvonOk && tiketOk && proverkaOk && spisokOk;

        const icon = allOk ? "✅" : "❌";
        const h = Math.floor(u.voiceSeconds / 3600);
        const m = Math.floor((u.voiceSeconds % 3600) / 60);

        return (
          `${icon} **${displayName}**\n` +
          `> 🎙 ${h}ч ${m}м/${norm.voiceHours}ч  💬 ${u.messages}/${norm.messages}\n` +
          `> 📞 Обзвоны: ${cs.obzvon}/${cn.obzvon}  🎫 Тикеты: ${cs.tiket}/${cn.tiket}  🔍 Проверки: ${cs.proverka}/${cn.proverka}  📋 Списки: ${cs.spisok}/${cn.spisok}`
        );
      })
    );

    const embed = new EmbedBuilder()
      .setTitle("🛡 Статистика кураторов — текущая неделя")
      .setDescription(lines.join("\n\n"))
      .setColor(0x5865f2)
      .setTimestamp()
      .setFooter({
        text: `Норма: голос ${norm.voiceHours}ч | сообщ ${norm.messages} | обзвоны ${cn.obzvon} | тикеты ${cn.tiket} | проверки ${cn.proverka} | списки ${cn.spisok}`,
      });

    await message.reply({ embeds: [embed] });
    return;
  }
  
  // ── !рапорткуратор ──
  if (content === "!рапорткуратор") {
    const guild = message.guild;
    if (!guild) {
      await message.reply("Команда доступна только на сервере.");
      return;
    }

    const curators = getActiveUsers().filter((u) => u.isCurator);
    if (curators.length === 0) {
      await message.reply("Нет назначенных кураторов. Используй `!куратор @ник` чтобы назначить.");
      return;
    }

    await guild.channels.fetch();
    await guild.members.fetch();

    const curatorMap = new Map(curators.map((u) => [u.userId, u]));

    const reportChannels = guild.channels.cache.filter(
      (ch) => ch.type === 0 && ch.name.toLowerCase().startsWith("рапорт-")
    );

    if (reportChannels.size === 0) {
      await message.reply("Каналы `рапорт-*` не найдены на сервере.");
      return;
    }

    await message.reply(`📤 Отправляю рапорты ${curators.length} куратор(ам)...`);

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
          nick === usernameFromChannel ||
          nick.startsWith(usernameFromChannel) ||
          display === usernameFromChannel ||
          display.startsWith(usernameFromChannel) ||
          user === usernameFromChannel
        );
      };

      const member =
        guild.members.cache.find(matchesChannel) ??
        (await guild.members
          .search({ query: usernameFromChannel, limit: 10 })
          .then((r) => r.find(matchesChannel) ?? null)
          .catch(() => null));

      if (!member) continue;
      if (!curatorMap.has(member.id)) continue;
      if (alreadySent.has(member.id)) continue;

      const userStats = curatorMap.get(member.id)!;
      const displayName = member.displayName;
      const norm = getNorm();
      const cn = norm.curator;
      const cs = userStats.curatorStats;

      const voiceOk    = userStats.voiceSeconds >= norm.voiceHours * 3600;
      const msgOk      = userStats.messages >= norm.messages;
      const obzvonOk   = cs.obzvon   >= cn.obzvon;
      const tiketOk    = cs.tiket    >= cn.tiket;
      const proverkaOk = cs.proverka >= cn.proverka;
      const spisokOk   = cs.spisok   >= cn.spisok;
      const allOk = voiceOk && msgOk && obzvonOk && tiketOk && proverkaOk && spisokOk;

      const now = new Date();
      const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
      const monday = new Date(now); monday.setDate(now.getDate() - dow);
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
      const fmt = (d: Date) =>
        `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}`;

      const h = Math.floor(userStats.voiceSeconds / 3600);
      const m2 = Math.floor((userStats.voiceSeconds % 3600) / 60);

      const text = [
        `# **Куратор: ${displayName}**`,
        `## Отчет с ${fmt(monday)}-${fmt(sunday)}`,
        `================================`,
        `**> Активность в голосовых каналах - ${voiceOk ? "✅" : "❌"}`,
        `> ${h}ч ${m2}м / ${norm.voiceHours}ч`,
        `================================`,
        `> Активность в текстовых каналах - ${msgOk ? "✅" : "❌"}`,
        `> ${userStats.messages} / ${norm.messages}`,
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

      try {
        const { TextChannel } = await import("discord.js");
        if (ch.type === 0) {
          await (ch as import("discord.js").TextChannel).send(text);
          alreadySent.add(member.id);
          sent++;
          console.log(`[CuratorReport] Отправлено куратору ${displayName} в #${ch.name}`);
        }
      } catch (e) {
        console.warn(`[CuratorReport] Ошибка отправки в #${ch.name}:`, e);
      }
    }

    await message.reply(`✅ Готово! Рапорты отправлены: ${sent} куратор(ам).`);
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

  // ── !км ──
  if (content === "!км") {
    const users = getActiveUsers();
    if (users.length === 0) {
      await message.reply("Нет участников клана.");
      return;
    }
    for (const u of users) {
      const member = await message.guild?.members.fetch(u.userId).catch(() => null);
      if (member) {
        await message.channel.send(`<@${u.userId}>`);
      }
    }
    return;
  }

  // ── !часы ──
  const hoursMatch = content.match(/^!часы <@!?(\d+)> (\d+(?:[.,]\d+)?)(м|ч)?$/i);
  if (hoursMatch) {
    const userId = hoursMatch[1];
    const amount = parseFloat(hoursMatch[2].replace(",", "."));
    const unit = hoursMatch[3]?.toLowerCase() ?? "м";
    const seconds = unit === "ч" ? amount * 3600 : amount * 60;
    const member = await message.guild?.members.fetch(userId).catch(() => null);
    if (!member) {
      await message.reply("Участник не найден.");
      return;
    }
    addVoiceSeconds(userId, member.user.username, seconds);
    await message.reply(
      `✅ **${member.displayName}** добавлено **${amount}${unit === "ч" ? "ч" : "м"}** голосового времени.`
    );
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
      await message.reply(
        `♻️ Недельная статистика **${member.displayName}** сброшена. (Общая история сохранена.)`
      );
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
        const cur = u.isCurator ? " 🛡куратор" : "";
        return `**${displayName}**${excl}${cur}: голос ${u.voiceSeconds.toFixed(0)}с (всего: ${u.totalVoiceSeconds.toFixed(0)}с), ${u.messages} сообщ. (всего: ${u.totalMessages})`;
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
        (await guild.members
          .search({ query: usernameFromChannel, limit: 10 })
          .then((r) => r.find(matchesChannel) ?? null)
          .catch(() => null));

      const dedupeKey = member?.id ?? usernameFromChannel;
      if (alreadySent.has(dedupeKey)) {
        console.log(`[TestReport] Пропуск дубля для ${dedupeKey}`);
        continue;
      }

      const displayName = member?.displayName ?? usernameFromChannel;
      const userStats =
        (member ? statsMap.get(member.id) : undefined) ??
        statsMap.get(usernameFromChannel) ?? {
          userId: member?.id ?? "",
          username: usernameFromChannel,
          messages: 0,
          voiceSeconds: 0,
          voiceJoinedAt: null,
          totalMessages: 0,
          totalVoiceSeconds: 0,
          excluded: false,
          isCurator: false,
          streak: 0,
          bestStreak: 0,
          curatorStats: { obzvon: 0, tiket: 0, proverka: 0, proverkaKm: 0, spisok: 0 },
        };

      if (userStats.excluded) continue;

      if (guild) {
        await sendPersonalReport(guild, userStats as UserStats, displayName);
        alreadySent.add(dedupeKey);
        sent++;
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
      "`!рапорткуратор` — отправить рапорт всем кураторам прямо сейчас\n" +
        "`!норма установить голос X` — изменить норму голоса (сейчас: **" + norm.voiceHours + "ч**)\n" +
        "`!норма установить сообщений X` — изменить норму сообщений (сейчас: **" + norm.messages + "**)\n" +
        "`!норма куратор установить обзвон X` — норма обзвонов для кураторов\n" +
        "`!норма куратор установить тикет X` — норма тикетов для кураторов\n" +
        "`!норма куратор установить проверка X` — норма проверок для кураторов\n" +
        "`!норма куратор установить список X` — норма списков для кураторов\n" +
        "`!куратор @user` — сделать участника куратором (или убрать статус)\n" +
      "`!вышестоящие` — показывает норму всех кураторов\n" +
        "`!исключить @user` — исключить/включить участника из учёта\n" +
        "`!часы @user (время)` — добавить участнику определенное кол-во времени в войсах\n" +
        "`!сброс @user` — сбросить недельную статистику участника\n" +
        "`!дебаг` — сырые данные\n" +
        "`!помощь` — это сообщение"
    );
  }
}
