import {
  Client,
  GatewayIntentBits,
  Events,
  VoiceState,
  Message,
  Interaction,
  ButtonInteraction,
} from "discord.js";
import cron from "node-cron";
import { config } from "./config.js";
import {
  recordVoiceJoin,
  recordVoiceLeave,
  incrementMessages,
  loadStats,
  getLastSeenAt,
  updateLastSeenAt,
} from "./store.js";
import { isSpam } from "./antiFarm.js";
import { sendWeeklyReport } from "./report.js";
import { handleCommand, handleStatusButton } from "./commands.js";
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

  // Save current time as lastSeenAt baseline
  updateLastSeenAt();

  // Periodically update lastSeenAt so we don't re-scan too far back on restart
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

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isButton()) return;
  const btn = interaction as ButtonInteraction;
  if (btn.customId.startsWith("status_week_") || btn.customId.startsWith("status_all_")) {
    await handleStatusButton(btn);
  }
});

// Save lastSeenAt on graceful shutdown
function shutdown() {
  console.log("[Bot] Завершение работы, сохраняю lastSeenAt...");
  updateLastSeenAt();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

client.login(config.token).catch((err) => {
  console.error("[Bot] Ошибка авторизации:", err.message);
  process.exit(1);
});
