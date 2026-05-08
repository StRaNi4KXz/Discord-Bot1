import { Message } from "discord.js";
import { getAllUsers, getUser } from "./store.js";
import { config } from "./config.js";
import { sendPersonalReport } from "./report.js";

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}ч ${m}м`;
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

  if (content.startsWith("!статус ") || content.startsWith("!status ")) {
    const parts = content.split(" ");
    const mention = parts[1];
    const userId = mention?.replace(/[<@!>]/g, "");
    if (!userId) {
      await message.reply("Укажите пользователя: `!статус @username`");
      return;
    }

    const member = await message.guild?.members.fetch(userId).catch(() => null);
    if (!member) {
      await message.reply("Пользователь не найден.");
      return;
    }

    const displayName = member.displayName;
    const user = getUser(userId, member.user.username);
    const voiceDone = user.voiceSeconds >= config.weeklyNorm.voiceHours * 3600;
    const msgDone = user.messages >= config.weeklyNorm.messages;
    const voiceIcon = voiceDone ? "✅" : "❌";
    const msgIcon = msgDone ? "✅" : "❌";

    await message.reply(
      `📊 **Статистика ${displayName} за неделю:**\n` +
      `${voiceIcon} Голос: ${formatTime(user.voiceSeconds)} / ${config.weeklyNorm.voiceHours}ч\n` +
      `${msgIcon} Сообщений: ${user.messages} / ${config.weeklyNorm.messages}`
    );
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
        return `**${displayName}**: ${u.voiceSeconds.toFixed(0)}с в голосе, ${u.messages} сообщ., в канале: ${u.voiceJoinedAt ? "да" : "нет"}`;
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

    const statsMap = new Map(getAllUsers().map((u) => [u.userId, u]));
    let sent = 0;

    for (const [, ch] of reportChannels) {
      const channelName = ch.name.toLowerCase();
      const usernameFromChannel = channelName.replace("рапорт-", "");

      const member = guild.members.cache.find(
        (m) => m.user.username.toLowerCase() === usernameFromChannel
      );

      if (!member) {
        console.warn(`[TestReport] Участник для канала #${ch.name} не найден`);
        continue;
      }

      const userStats = statsMap.get(member.id) ?? {
        userId: member.id,
        username: member.user.username,
        messages: 0,
        voiceSeconds: 0,
        voiceJoinedAt: null,
      };

      const displayName = member.displayName;
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
        const { ChannelType } = await import("discord.js");
        if (ch.type === ChannelType.GuildText) {
          await (ch as import("discord.js").TextChannel).send(text);
          console.log(`[TestReport] Отправлено в #${ch.name}`);
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
      "`!норма` — показать статистику всех участников\n" +
      "`!статус @user` — статистика конкретного участника\n" +
      "`!тестрапорт` — отправить рапорты в личные каналы прямо сейчас\n" +
      "`!дебаг` — сырые данные (секунды, счётчики)\n" +
      "`!помощь` — это сообщение"
    );
  }
}
