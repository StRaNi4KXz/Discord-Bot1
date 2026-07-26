import {
  Client,
  GatewayIntentBits,
  Events,
  VoiceState,
  Message,
  Interaction,
  ButtonInteraction,
  ChannelType,
  GuildMember,
  PartialGuildMember,
} from "discord.js";
import { config } from "./config.js";
import {
  recordVoiceJoin,
  recordVoiceLeave,
  incrementMessages,
  loadStats,
  getLastSeenAt,
  updateLastSeenAt,
  incrementCuratorStat,
  incrementModeratorStat,
  getUser,
  getActiveUsers,
  excludeUser,
  type CuratorStatKey,
  type ModeratorStatKey,
} from "./store.js";
import { loadDynamicConfig, isCategoryIgnored } from "./dynamicConfig.js";
import { loadHistory } from "./history.js";
import { isSpam } from "./antiFarm.js";
import { sendWeeklyReport } from "./report.js";
import { handleCommand, handleStatusButton, handleTopButton } from "./commands.js";
import { catchUpMissedMessages } from "./catchup.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

loadStats();
loadDynamicConfig();
loadHistory();

const processedMessages = new Set<string>();

client.once(Events.ClientReady, async (c) => {
  console.log(`[Bot] Запущен как ${c.user.tag}`);
  console.log(`[Bot] Проверка нормы: каждый понедельник в 15:00`);
  if (!config.reportChannelId) {
    console.warn(
      "[Bot] DISCORD_REPORT_CHANNEL_ID не задан — отчёты не будут отправляться"
    );
  }

  const since = getLastSeenAt();
  if (since !== null) {
    await catchUpMissedMessages(client, since);
  } else {
    console.log("[CatchUp] Первый запуск, история не восстанавливается");
  }

  // Авто-исключаем участников, которых больше нет на сервере
  const guild = client.guilds.cache.first();
  if (guild) {
    const allActive = getActiveUsers();
    console.log(`[Prune] Проверяю ${allActive.length} активных участников...`);
    let pruned = 0;
    for (const user of allActive) {
      const member = guild.members.cache.get(user.userId)
        ?? await guild.members.fetch(user.userId).catch(() => null);
      if (!member) {
        excludeUser(user.userId, user.username);
        pruned++;
        console.log(`[Prune] ${user.username} (${user.userId}) не найден — авто-исключён.`);
      }
    }
    console.log(`[Prune] Готово: исключено ${pruned} участников.`);
  }

  // Восстанавливаем войс-сессии для тех, кто уже в канале
  let voiceRestored = 0;
  for (const guild of client.guilds.cache.values()) {
    const afkChannelId = guild.afkChannelId;
    for (const [, vs] of guild.voiceStates.cache) {
      if (!vs.channelId || !vs.member) continue;
      if (vs.member.user.bot) continue;
      if (vs.channelId === afkChannelId) continue;
      const catId = vs.channel?.parentId ?? null;
      if (isCategoryIgnored(catId)) continue;
      recordVoiceJoin(vs.member.id, vs.member.user.username);
      voiceRestored++;
      console.log(`[VoiceRestore] ${vs.member.user.username} уже в канале #${vs.channel?.name ?? vs.channelId}`);
    }
  }
  console.log(`[VoiceRestore] Восстановлено ${voiceRestored} войс-сессий`);

  updateLastSeenAt();

  setInterval(() => {
    updateLastSeenAt();
  }, 5 * 60 * 1000);
});

client.on(Events.VoiceStateUpdate, (oldState: VoiceState, newState: VoiceState) => {
  const userId = newState.member?.id || oldState.member?.id;
  const username =
    newState.member?.user.username || oldState.member?.user.username;

  if (!userId || !username) return;

  console.log(`[Voice] ${username} | old: ${oldState.channelId ?? "нет"} → new: ${newState.channelId ?? "нет"}`);

  const joined = !oldState.channelId && newState.channelId;
  const left = oldState.channelId && !newState.channelId;
  const switched =
    oldState.channelId &&
    newState.channelId &&
    oldState.channelId !== newState.channelId;

  if (joined) {
    recordVoiceJoin(userId, username);
    console.log(`[Voice] ${username} ВОШЁЛ в канал #${newState.channel?.name}`);
  } else if (left) {
    recordVoiceLeave(userId, username);
    console.log(`[Voice] ${username} ВЫШЕЛ из канала #${oldState.channel?.name}`);
  } else if (switched) {
    recordVoiceLeave(userId, username);
    recordVoiceJoin(userId, username);
    console.log(`[Voice] ${username} СМЕНИЛ канал: #${oldState.channel?.name} → #${newState.channel?.name}`);
  }
});

client.on(Events.GuildMemberRemove, (member: GuildMember | PartialGuildMember) => {
  const userId = member.id;
  const username = member.user?.username ?? userId;
  if (excludeUser) {
    excludeUser(userId, username);
    console.log(`[Bot] Участник ${username} покинул сервер — исключён из учёта.`);
  }
});

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;
  if (processedMessages.has(message.id)) {
    console.log(`[Bot] Дубль сообщения проигнорирован: ${message.id}`);
    return;
  }
  processedMessages.add(message.id);
  setTimeout(() => processedMessages.delete(message.id), 30_000);

  const userId = message.author.id;
  const username = message.author.username;
  const content = message.content;

  const channelName = "name" in message.channel
    ? (message.channel as any).name as string
    : "";

  if (channelName.toLowerCase().startsWith("рапорт-")) {
    const lower = content.trim().toLowerCase();
    const user = getUser(userId, username);

    // ── Рапорты кураторов ──
    if (user.isCurator) {
      let stat: CuratorStatKey | null = null;

      if (lower.startsWith("+обзвон"))                                              stat = "obzvon";
      else if (lower.startsWith("+проверка км") || lower.startsWith("+проверкакм")) stat = "proverkaKm";
      else if (lower.startsWith("+проверка"))                                       stat = "proverka";
      else if (lower.startsWith("+тикет"))                                          stat = "tiket";
      else if (lower.startsWith("+список"))                                         stat = "spisok";
      else if (lower.startsWith("+актив"))                                          stat = "aktiv";

      if (stat) {
        incrementCuratorStat(userId, username, stat);
        console.log(`[Curator] ${username} +1 ${stat} в #${channelName}`);
        message.react("✅").catch(() => {});
      }
      return;
    }

    // ── Рапорты модераторов ──
    if (user.isModerator) {
      let stat: ModeratorStatKey | null = null;

      if (lower.startsWith("+актив"))  stat = "aktiv";
      else if (lower.startsWith("+тикет")) stat = "tiket";

      if (stat) {
        incrementModeratorStat(userId, username, stat);
        console.log(`[Moderator] ${username} +1 ${stat} в #${channelName}`);
        message.react("✅").catch(() => {});
      }
      return;
    }

    return;
  }

  if (content.startsWith("!")) {
    await handleCommand(message);
    return;
  }

  const categoryId = "parentId" in message.channel ? (message.channel as any).parentId as string | null : null;
  if (isCategoryIgnored(categoryId)) return;

  if (!isSpam(userId, content)) {
    incrementMessages(userId, username);
  }
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isButton()) return;
  const btn = interaction as ButtonInteraction;

  if (btn.customId.startsWith("status_week_") || btn.customId.startsWith("status_all_")) {
    await handleStatusButton(btn);
  } else if (btn.customId === "top_week" || btn.customId === "top_all") {
    await handleTopButton(btn);
  }
});


function shutdown() {
  console.log("[Bot] Завершение работы, сохраняю lastSeenAt...");
  updateLastSeenAt();
  client.destroy();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

client.on("error", (err) => {
  console.error("[Bot] WebSocket error (non-fatal):", err.message);
});

client.login(config.token).catch((err) => {
  console.error("[Bot] Ошибка авторизации:", err.message);
  process.exit(1);
});
