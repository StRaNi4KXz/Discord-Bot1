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

  const joined = !oldState.channelId && newState.channelId;
  const left = oldState.channelId && !newState.channelId;

  if (joined) {
    recordVoiceJoin(userId, username);
    console.log(`[Voice] ${username} зашёл в голосовой канал`);
  } else if (left) {
    recordVoiceLeave(userId, username);
    console.log(`[Voice] ${username} вышел из голосового канала`);
  }
});

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;

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
