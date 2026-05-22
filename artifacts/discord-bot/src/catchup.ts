import { Client, TextChannel, ChannelType, Collection, Message, Snowflake } from "discord.js";
import {
  incrementMessages,
  incrementCuratorStat,
  incrementModeratorStat,
  getUser,
  type CuratorStatKey,
  type ModeratorStatKey,
} from "./store.js";
import { isSpam } from "./antiFarm.js";
import { isCategoryIgnored } from "./dynamicConfig.js";

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
      const chName = "name" in channel ? (channel as any).name as string : "";
      const isReportChannel = chName.toLowerCase().startsWith("рапорт-");

      if (!isReportChannel && channel.type !== ChannelType.GuildText) continue;
      if (isReportChannel && !("messages" in channel)) continue;
      if (!isReportChannel && isCategoryIgnored((channel as any).parentId)) continue;

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

          const sorted = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

          let reachedCutoff = false;
          for (const msg of sorted) {
            if (msg.createdTimestamp <= since) {
              reachedCutoff = true;
              continue;
            }
            totalScanned++;
            if (msg.author.bot) continue;

            if (isReportChannel) {
              const lower = msg.content.trim().toLowerCase();
              const user = getUser(msg.author.id, msg.author.username);

              // ── Рапорты кураторов ──
              if (user.isCurator) {
                let stat: CuratorStatKey | null = null;

                if (lower.startsWith("+обзвон"))                                              stat = "obzvon";
                else if (lower.startsWith("+проверка км") || lower.startsWith("+проверкакм")) stat = "proverkaKm";
                else if (lower.startsWith("+проверка"))                                       stat = "proverka";
                else if (lower.startsWith("+тикет"))                                          stat = "tiket";
                else if (lower.startsWith("+список"))                                         stat = "spisok";

                if (stat) {
                  incrementCuratorStat(msg.author.id, msg.author.username, stat);
                  totalCounted++;
                  console.log(`[CatchUp][Curator] ${msg.author.username} +1 ${stat} в #${chName}`);
                }

              // ── Рапорты модераторов ──
              } else if (user.isModerator) {
                let stat: ModeratorStatKey | null = null;

                if (lower.startsWith("+актив"))           stat = "aktiv";
                else if (lower.startsWith("+тикет"))      stat = "tiket";

                if (stat) {
                  incrementModeratorStat(msg.author.id, msg.author.username, stat);
                  totalCounted++;
                  console.log(`[CatchUp][Moderator] ${msg.author.username} +1 ${stat} в #${chName}`);
                }
              }

            } else {
              if (!isSpam(msg.author.id, msg.content, msg.createdTimestamp)) {
                incrementMessages(msg.author.id, msg.author.username);
                totalCounted++;
              }
            }
          }

          fetched += batch.size;

          const oldestTs = Math.min(...batch.map((m) => m.createdTimestamp));
          if (oldestTs <= since || reachedCutoff) {
            done = true;
          } else {
            lastId = batch.last()?.id;
          }
        }
      } catch (err) {
        console.warn(`[CatchUp] Ошибка при чтении #${chName}:`, err);
      }
    }
  }

  console.log(`[CatchUp] Готово: просмотрено ${totalScanned} сообщений, зачтено ${totalCounted}`);
}
