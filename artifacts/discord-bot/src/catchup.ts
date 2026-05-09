import { Client, TextChannel, ChannelType, Collection, Message, Snowflake } from "discord.js";
import { incrementMessages } from "./store.js";
import { isSpam } from "./antiFarm.js";

const BATCH_SIZE = 100;
const MAX_MESSAGES_PER_CHANNEL = 2000;

export async function catchUpMissedMessages(client: Client, since: number): Promise<void> {
  const sinceDate = new Date(since);
  console.log(`[CatchUp] Восстанавливаю сообщения с ${sinceDate.toISOString()}...`);

  let totalCounted = 0;
  let totalScanned = 0;

  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.channels.fetch();
    } catch {
      console.warn(`[CatchUp] Не удалось получить каналы гильдии ${guild.name}`);
      continue;
    }

    for (const channel of guild.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildText) continue;

      // Skip report channels (рапорт-*)
      if (channel.name.startsWith("рапорт-")) continue;

      try {
        let lastId: Snowflake | undefined;
        let fetched = 0;
        let done = false;

        while (!done && fetched < MAX_MESSAGES_PER_CHANNEL) {
          const options: { limit: number; before?: Snowflake } = { limit: BATCH_SIZE };
          if (lastId) options.before = lastId;

          let batch: Collection<Snowflake, Message>;
          try {
            batch = await (channel as TextChannel).messages.fetch(options);
          } catch {
            break;
          }

          if (batch.size === 0) break;

          // Sort oldest first to preserve duplicate-window ordering
          const sorted = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

          let reachedCutoff = false;
          for (const msg of sorted) {
            if (msg.createdTimestamp <= since) {
              reachedCutoff = true;
              continue;
            }
            totalScanned++;
            if (msg.author.bot) continue;
            if (!isSpam(msg.author.id, msg.content, msg.createdTimestamp)) {
              incrementMessages(msg.author.id, msg.author.username);
              totalCounted++;
            }
          }

          fetched += batch.size;

          // Oldest message in this batch
          const oldestTs = Math.min(...batch.map((m) => m.createdTimestamp));
          if (oldestTs <= since || reachedCutoff) {
            done = true;
          } else {
            lastId = batch.last()?.id;
          }
        }
      } catch (err) {
        console.warn(`[CatchUp] Ошибка при чтении #${channel.name}:`, err);
      }
    }
  }

  console.log(`[CatchUp] Готово: просмотрено ${totalScanned} сообщений, зачтено ${totalCounted}`);
}
