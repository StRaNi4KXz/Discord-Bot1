export const config = {
  token: process.env.DISCORD_TOKEN!,
  reportChannelId: process.env.DISCORD_REPORT_CHANNEL_ID || "",

  weeklyNorm: {
    voiceHours: 2,
    messages: 40,
  },

  antiFarm: {
    minMessageLength: 5,
    duplicateWindowMs: 60_000,
    minVoiceSessionSec: 30,
  },

  checkDay: 1,
  checkHour: 10,
  checkMinute: 20,
};
