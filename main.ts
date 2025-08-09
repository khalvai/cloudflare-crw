import { Bot } from "grammy";
import { IDP, Observer } from "./Idp";
import { Irsafam } from "./Irsafam";
import { ADD } from "./ADD";

interface ExamEntry {
  status: string;
  examName: string;
  examType: string;
  testType: string;
  examDate: string;
  location: string;
  cost: string;
}

let incompleteDataHistory: boolean[] = [];

export default {
  // Handle Telegram webhook requests
  async fetch(request: Request, env: Env) {
    const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

    // Commands
    bot.command("start", (ctx) =>
      ctx.reply(
        "Welcome to the IELTS Crawler Bot! Use /scrape to run the crawler, /stats to get statistics, or /getchatid to get your chat ID."
      )
    );

    bot.command("getchatid", (ctx) =>
      ctx.reply(`Your chat ID is: ${ctx.chat.id}`)
    );

    bot.command("scrape", async (ctx) => {
      if (env.BOT_OWNER_CHAT_ID !== ctx.chat.id.toString()) {
        return ctx.reply("Unauthorized access.");
      }
      await ctx.reply("Starting the crawler...");
      await scheduledTask(env);
      await ctx.reply("Crawler finished.");
    });

    bot.catch((err) => {
      console.error(`Bot error: ${err.message}`);
    });

    return bot.handleUpdate(await request.json());
  },

  // Handle Cloudflare Cron Triggers
  async scheduled(event: ScheduledEvent, env: Env) {
    if (event.cron === "*/5 * * * *") {
      await scheduledTask(env);
    }
    if (event.cron === "0 * * * *") {
      await hourlyTask(env);
    }
  },
};

// Send Telegram messages (splits if >4096 chars)
async function sendTelegramMessage(env: Env, message: string) {
  for (let i = 0; i < message.length; i += 4096) {
    await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHANNEL_ID,
          text: message.slice(i, i + 4096),
        }),
      }
    );
  }
}

// Every 5 minutes
async function scheduledTask(env: Env) {
  const observers: Observer[] = [new IDP(), new Irsafam()];
  console.info("Running scheduled check...");

  try {
    const results = await Promise.all(observers.map((ob) => ob.doYourThing()));

    if (results.some((r) => r.found)) {
      await sendTelegramMessage(
        env,
        "✅ Found:\n" +
          results
            .filter((r) => r.found)
            .map((r) => r.data)
            .join("\n")
      );
    }

    if (results.some((r) => r.hasError)) {
      const errors = results
        .filter((r) => r.hasError)
        .map((r) => `${r.site}: ${r.data}`)
        .join("\n");
      await sendTelegramMessage(env, `❌ Error:\n${errors}`);
    }
  } catch (err) {
    await sendTelegramMessage(env, `❌ Error in scheduled task: ${err}`);
  }
}

// Every hour
async function hourlyTask(env: Env) {
  const message = incompleteDataHistory.some(Boolean)
    ? "🕒 Hourly Update: Incomplete data found in the last hour."
    : "🕒 Hourly Update: No incomplete data in the last hour.";
  await sendTelegramMessage(env, message);
}

// Cloudflare Env variable typing
interface Env {
  TELEGRAM_BOT_TOKEN: string;
  BOT_OWNER_CHAT_ID: string;
  TELEGRAM_CHANNEL_ID: string;
}
