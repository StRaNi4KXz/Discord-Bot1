import {
  Message,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ButtonInteraction,
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
  setModerator,
  type UserStats,
} from "./store.js";
import { sendWeeklyReport } from "./report.js";
import { config } from "./config.js";
import { getNorm, setVoiceHours, setMessages, setCuratorNorm, setModeratorNorm, addIgnoredCategory, removeIgnoredCategory } from "./dynamicConfig.js";
import { getHistory } from "./history.js";

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}ч ${m}м`;
}

function getWeekDates(): { monday: Date; sunday: Date } {
  const now = new Date();
  const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dow);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { monday, sunday };
}

function fmtDate(d: Date): string {
  return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}`;
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
    const resolved = await Promise.all(
      users.map(async (u) => {
        const member = await message.guild?.members.fetch(u.userId).catch(() => null);
        if (message.guild && !member) {
          excludeUser(u.userId, u.username);
          return null;
        }
        return { u, displayName: member?.displayName ?? u.username };
      })
    );
    const lines = resolved
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map(({ u, displayName }) => {
        const voiceDone = u.voiceSeconds >= norm.voiceHours * 3600;
        const msgDone = u.messages >= norm.messages;
        const icon = voiceDone && msgDone ? "✅" : "❌";
        return `${icon} **${displayName}** — голос: ${formatTime(u.voiceSeconds)}/${norm.voiceHours}ч, сообщений: ${u.messages}/${norm.messages}`;
      });
    const embed = new EmbedBuilder()
      .setTitle("📊 Текущая статистика")
      .setDescription(lines.join("\n").slice(0, 4096) || "Нет активных участников.")
      .setColor(0x5865f2)
      .setTimestamp()
      .setFooter({ text: `Норма: ${norm.voiceHours}ч голос + ${norm.messages} сообщений` });
    await message.reply({ embeds: [embed] });
    return;
  }

  // ── !км ──
  if (content === "!км") {
    if (!message.guild) return;

    // Пингуем всех участников у которых в нике есть "|" (формат "Ник | Роль")
    const allMembers = await message.guild.members.fetch().catch(() => null);
    if (!allMembers) {
      await message.reply("Не удалось получить список участников.");
      return;
    }

    const targets = allMembers.filter((m) => {
      const name = m.nickname ?? m.displayName ?? m.user.username;
      return name.includes("|") && !m.user.bot;
    });

    if (targets.size === 0) {
      await message.reply("Участников с изменённым ником (формат «Ник | Роль») не найдено.");
      return;
    }

    const ch = message.channel as import("discord.js").TextChannel;
    for (const member of targets.values()) {
      await ch.send(`<@${member.id}>`);
    }

    await ch.send(`Конец списка. ${targets.size} км в общем`);
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

  // ── !норма модератор установить X Y ──
  const moderatorNormMatch = content.match(
    /^!норма модератор установить (актив|тикет) (\d+)$/i
  );
  if (moderatorNormMatch) {
    const keyMap: Record<string, keyof ReturnType<typeof getNorm>["moderator"]> = {
      актив: "aktiv",
      тикет: "tiket",
    };
    const key = keyMap[moderatorNormMatch[1].toLowerCase()];
    const value = parseInt(moderatorNormMatch[2], 10);
    if (!key || isNaN(value) || value < 0) {
      await message.reply("❌ Некорректное значение.");
      return;
    }
    setModeratorNorm(key, value);
    await message.reply(`✅ Норма модератора **${moderatorNormMatch[1]}** установлена: **${value}** в неделю.`);
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
    if (user.isCurator) {
      setCurator(userId, member.user.username, false);
      await message.reply(
        `🔄 **${member.displayName}** больше не куратор — будет получать обычный рапорт.`
      );
    } else {
      setCurator(userId, member.user.username, true);
      await message.reply(`🛡 **${member.displayName}** назначен куратором.`);
    }
    return;
  }

  // ── !модер ──
  if (content.startsWith("!модер")) {
    const parts = content.split(" ");
    const mention = parts[1];
    if (!mention || !mention.startsWith("<@")) {
      await message.reply("Укажите участника: `!модер @username`");
      return;
    }
    const userId = mention.replace(/[<@!>]/g, "");
    const member = await message.guild?.members.fetch(userId).catch(() => null);
    if (!member) {
      await message.reply("Участник не найден.");
      return;
    }
    const user = getUser(userId, member.user.username);
    if (user.isModerator) {
      setModerator(userId, member.user.username, false);
      await message.reply(
        `🔄 **${member.displayName}** больше не клан-модератор — будет получать обычный рапорт.`
      );
    } else {
      setModerator(userId, member.user.username, true);
      await message.reply(`🔰 **${member.displayName}** назначен клан-модератором.`);
    }
    return;
  }


  // ── !категория ──
  if (content.startsWith("!категория")) {
    const parts = content.split(" ");
    const sub = parts[1]?.toLowerCase();

    // !категория список
    if (!sub || sub === "список") {
      const norm = getNorm();
      if (norm.ignoredCategoryIds.length === 0) {
        await message.reply("Игнорируемых категорий нет. Добавить: `!категория игнор #канал-из-категории`");
        return;
      }
      const lines = norm.ignoredCategoryIds.map((id) => {
        const cat = message.guild?.channels.cache.get(id);
        return cat ? `• **${(cat as any).name}** (\`${id}\`)` : `• \`${id}\` *(категория не найдена)*`;
      });
      await message.reply(`🚫 **Игнорируемые категории:**\n${lines.join("\n")}`);
      return;
    }

    // !категория игнор #канал или ID
    if (sub === "игнор" || sub === "добавить") {
      const arg = parts[2];
      if (!arg) {
        await message.reply("Укажите канал из нужной категории или ID категории: `!категория игнор #канал`");
        return;
      }

      const channelId = arg.replace(/[<#>]/g, "");
      const ch = message.guild?.channels.cache.get(channelId);

      let categoryId: string | null = null;
      let categoryName: string | null = null;

      if (ch && (ch as any).parentId) {
        // передан канал — берём его категорию
        categoryId = (ch as any).parentId;
        const cat = message.guild?.channels.cache.get(categoryId!);
        categoryName = (cat as any)?.name ?? categoryId;
      } else if (ch && ch.type === 4) {
        // передан ID самой категории
        categoryId = ch.id;
        categoryName = (ch as any).name;
      } else if (/^\d+$/.test(arg)) {
        // голый ID
        categoryId = arg;
        categoryName = arg;
      }

      if (!categoryId) {
        await message.reply("❌ Не удалось определить категорию. Укажите канал из нужной категории или её ID.");
        return;
      }

      const added = addIgnoredCategory(categoryId);
      if (added) {
        await message.reply(`🚫 Категория **${categoryName}** добавлена в игнор — сообщения из неё не будут считаться.`);
      } else {
        await message.reply(`ℹ️ Категория **${categoryName}** уже в игноре.`);
      }
      return;
    }

    // !категория вернуть #канал или ID
    if (sub === "вернуть" || sub === "убрать") {
      const arg = parts[2];
      if (!arg) {
        await message.reply("Укажите канал или ID категории: `!категория вернуть #канал`");
        return;
      }

      const channelId = arg.replace(/[<#>]/g, "");
      const ch = message.guild?.channels.cache.get(channelId);

      let categoryId: string | null = null;
      let categoryName: string | null = null;

      if (ch && (ch as any).parentId) {
        categoryId = (ch as any).parentId;
        const cat = message.guild?.channels.cache.get(categoryId!);
        categoryName = (cat as any)?.name ?? categoryId;
      } else if (ch && ch.type === 4) {
        categoryId = ch.id;
        categoryName = (ch as any).name;
      } else if (/^\d+$/.test(arg)) {
        categoryId = arg;
        categoryName = arg;
      }

      if (!categoryId) {
        await message.reply("❌ Не удалось определить категорию.");
        return;
      }

      const removed = removeIgnoredCategory(categoryId);
      if (removed) {
        await message.reply(`✅ Категория **${categoryName}** убрана из игнора — сообщения снова считаются.`);
      } else {
        await message.reply(`ℹ️ Категория **${categoryName}** не была в игноре.`);
      }
      return;
    }

    await message.reply(
      "**Команды категорий:**\n" +
      "`!категория список` — показать игнорируемые категории\n" +
      "`!категория игнор #канал` — добавить категорию в игнор\n" +
      "`!категория вернуть #канал` — убрать категорию из игнора"
    );
    return;
  }

  // ── !исключить ──
  if (content.startsWith("!исключить") || content.startsWith("!exclude")) {
    const parts = content.split(" ");
    const target = parts.slice(1).join(" ").trim();

    if (!target) {
      await message.reply("Укажите участника: `!исключить @упоминание` или `!исключить username`");
      return;
    }

    let userId: string;
    let displayName: string;
    let username: string;

    if (target.startsWith("<@")) {
      // @упоминание
      const id = target.replace(/[<@!>]/g, "");
      const member = await message.guild?.members.fetch(id).catch(() => null);
      if (!member) {
        await message.reply("Участник не найден.");
        return;
      }
      userId = id;
      username = member.user.username;
      displayName = member.displayName;
    } else {
      // поиск по username в stats
      const needle = target.toLowerCase();
      const allUsers = getAllUsers();
      const found = allUsers.find(
        (u) => u.username.toLowerCase() === needle || u.username.toLowerCase().startsWith(needle)
      );
      if (!found) {
        await message.reply(`❌ Участник \`${target}\` не найден в статистике. Проверь имя или используй @упоминание.`);
        return;
      }
      userId = found.userId;
      username = found.username;
      // попробуем получить displayName из кэша сервера
      const member = message.guild?.members.cache.get(userId);
      displayName = member?.displayName ?? found.username;
    }

    const user = getUser(userId, username);
    if (user.excluded) {
      includeUser(userId, username);
      await message.reply(`✅ **${displayName}** снова включён в учёт активности.`);
    } else {
      excludeUser(userId, username);
      await message.reply(`🚫 **${displayName}** исключён из учёта активности и отчётов.`);
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
        const mod = u.isModerator ? " 🔰модер" : "";
        return `**${displayName}**${excl}${cur}${mod}: голос ${u.voiceSeconds.toFixed(0)}с, ${u.messages} сообщ.`;
      })
    );
    const debugEmbed = new EmbedBuilder()
      .setTitle("🔍 Сырые данные")
      .setDescription(lines.join("\n").slice(0, 4096))
      .setColor(0x99aab5)
      .setTimestamp();
    await message.reply({ embeds: [debugEmbed] });
    return;
  }


  // ── !отчёт [дата1] [дата2] ──
  const reportMatch = content.match(/^!отчёт(?:\s+(\d{1,2}\.\d{1,2})(?:\s+(\d{1,2}\.\d{1,2}))?)?$/i)
    || content.match(/^!report(?:\s+(\d{1,2}\.\d{1,2})(?:\s+(\d{1,2}\.\d{1,2}))?)?$/i);
  if (reportMatch) {
    const date1 = reportMatch[1];
    const date2 = reportMatch[2];
    const dateRange = date1 && date2 ? `${date1}-${date2}` : undefined;
    const label = dateRange ? ` за период ${dateRange}` : "";
    await message.reply(`📊 Запускаю недельный отчёт${label}...`);
    await sendWeeklyReport(message.client, dateRange);
    return;
  }

  // ── !помощь ──
  if (content === "!помощь" || content === "!help") {
    const embed = new EmbedBuilder()
      .setTitle("📖 Команды бота")
      .setColor(0x5865f2)
      .addFields(
        {
          name: "👤 Личные",
          value: [
            "`!статус [@user]` — статистика за неделю",
            "`!топ` — топ активности",
            "`!история` — последние 5 недель",
            "`!помощь` — это сообщение",
          ].join("\n"),
        },
        {
          name: "📊 Общие",
          value: [
            "`!норма` — прогресс всех участников",
            "`!км` — пинг всех участников",
          ].join("\n"),
        },
        {
          name: "🛡 Управление",
          value: [
            "`!куратор @user` — назначить/снять куратора",
            "`!модер @user` — назначить/снять клан-модератора",
            "`!исключить @user` — исключить/включить из учёта",
            "`!сброс @user` — сброс недельной статистики",
            "`!часы @user X(ч/м)` — добавить время голоса",
          ].join("\n"),
        },
        {
          name: "📋 Рапорты",
          value: [
            "`!отчёт [ДД.ММ ДД.ММ]` — запустить отчёт (с датами или без)",
          ].join("\n"),
        },
        {
          name: "⚙️ Настройки норм",
          value: [
            "`!норма установить голос X` — норма голоса (ч)",
            "`!норма установить сообщений X` — норма сообщений",
            "`!норма куратор установить [обзвон|тикет|проверка|список] X`",
            "`!норма модератор установить [актив|тикет] X`",
          ].join("\n"),
        }
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });
    return;
  }
}
