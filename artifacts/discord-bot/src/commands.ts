import { Message } from "discord.js";
import { getAllUsers, getUser } from "./store.js";
import { config } from "./config.js";

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

  if (content === "!помощь" || content === "!help") {
    await message.reply(
      "**Команды бота:**\n" +
      "`!норма` — показать статистику всех участников\n" +
      "`!статус @user` — статистика конкретного участника\n" +
      "`!дебаг` — сырые данные (секунды, счётчики)\n" +
      "`!помощь` — это сообщение"
    );
  }
}
