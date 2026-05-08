import {
  Client,
  GatewayIntentBits,
  Events,
  VoiceState,
  Message,
} from "discord.js";
import cron from "node-cron";
import { config } from "./config.js";
import {
  recordVoiceJoin,
  recordVoiceLeave,
  incrementMessages,
  loadStats,
} from "./store.js";
import { isSpam } from "./antiFarm.js";
import { sendWeeklyReport } from "./report.js";
import { handleCommand } from "./commands.js";

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

const processedMessages = new Set<string>();

client.once(Events.ClientReady, (c) => {
  console.log(`[Bot] Запущен как ${c.user.tag}`);
  console.log(`[Bot] Проверка нормы: каждый понедельник в 15:00`);
  if (!config.reportChannelId) {
    console.warn(
      "[Bot] DISCORD_REPORT_CHANNEL_ID не задан — отчёты не будут отправляться"
    );
  }
});

client.on(Events.VoiceStateUpdate, (oldState: VoiceState, newState: VoiceState) => {
  const userId = newState.member?.id || oldState.member?.id;
  const username =
    newState.member?.user.username || oldState.member?.user.username;

  if (!userId || !username) return;

  console.log(`[Voice] ${username} | old: ${oldState.channelId ?? "нет"} → new: ${newState.channelId ?? "нет"}`);

  const joined = !oldState.channelId && newState.channelId;
  const left = oldState.channelId && !newState.channelId;
  const switched = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;

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

  if (content.startsWith("!")) {
    await handleCommand(message);
    return;
  }

  if (!isSpam(userId, content)) {
    incrementMessages(userId, username);
  }
});

const cronExpr = `${config.checkMinute} ${config.checkHour} * * ${config.checkDay}`;
cron.schedule(cronExpr, async () => {
  console.log("[Cron] Запуск еженедельной проверки нормы...");
  await sendWeeklyReport(client);
});

client.login(config.token).catch((err) => {
  console.error("[Bot] Ошибка авторизации:", err.message);
  process.exit(1);
});
