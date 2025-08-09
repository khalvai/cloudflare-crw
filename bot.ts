import { Bot } from "grammy";
import cron from "node-cron";
import { config } from "dotenv";
import { IDP, Result, Observer } from "./Idp";
import { Irsafam } from "./Irsafam";
import { ADD } from "./ADD";

// Load environment variables
config();

// Configuration
const TELEGRAM_BOT_TOKEN: string | undefined = process.env.TELEGRAM_BOT_TOKEN;
const BOT_OWNER_CHAT_ID: string | undefined = process.env.BOT_OWNER_CHAT_ID;
const TELEGRAM_CHANNEL_ID: string | undefined = process.env.TELEGRAM_CHANNEL_ID;

if (!TELEGRAM_BOT_TOKEN || !BOT_OWNER_CHAT_ID || !TELEGRAM_CHANNEL_ID) {
  console.error("Missing required environment variables.");

  throw new Error(
    "TELEGRAM_BOT_TOKEN, BOT_OWNER_CHAT_ID, or TELEGRAM_CHANNEL_ID is not set."
  );
  process.exit(1);
}
// Interface for scraped data
interface ExamEntry {
  status: string;
  examName: string;
  examType: string;
  testType: string;
  examDate: string;
  location: string;
  cost: string;
}

// Incomplete data history for hourly checks
let incompleteDataHistory: boolean[] = [];

// Initialize bot
const bot = new Bot(TELEGRAM_BOT_TOKEN);

// Function to send Telegram messages
async function sendTelegramMessage(message: string): Promise<void> {
  try {
    // Split message into chunks to respect Telegram's 4096-character limit
    for (let i = 0; i < message.length; i += 4096) {
      // await bot.api.s
      await bot.api.sendMessage(
        TELEGRAM_CHANNEL_ID || "",
        message.slice(i, i + 4096)
      );
    }
    console.info(`Sent Telegram message to ${TELEGRAM_CHANNEL_ID}`);
  } catch (error) {
    console.error(
      `Failed to send Telegram message to ${TELEGRAM_CHANNEL_ID}: ${
        (error as Error).message
      }`
    );
  }
}

// Function to get statistics
async function getStats(
  completedData: ExamEntry[],
  incompleteData: ExamEntry[]
): Promise<void> {
  const stats = {
    totalCompleted: completedData.length,
    totalIncomplete: incompleteData.length,
    totalEntries: completedData.length + incompleteData.length,
  };
  const statsMessage = `📊 Stats: ${stats.totalCompleted} completed, ${stats.totalIncomplete} incomplete, ${stats.totalEntries} total entries.`;
  console.info(statsMessage);
  await sendTelegramMessage(statsMessage);
}

// 5-minute scheduled task
async function scheduledTask(): Promise<void> {
  const observers: Observer[] = [new IDP(), new Irsafam()];
  console.info("Running 5-minute scheduled task");
  try {
    const promises = observers.map((ob) => ob.doYourThing());

    const results = await Promise.all(promises);

    if (results.some((result) => result.found)) {
      try {
        await sendTelegramMessage(
          "✅  Found:" +
            results
              .filter((result) => result.found)
              .map((result) => result.data)
              .join("\n")
        );
      } catch (error) {
        console.error(
          `Error sending found message: ${(error as Error).message}`
        );
        incompleteDataHistory.push(true);
      }
    }
    if (results.some((result) => result.hasError)) {
      let messages = "";
      results.forEach((result) => {
        if (result.hasError) {
          console.log("res", result);
          messages = messages
            .concat("\n")
            .concat(`${result.site}: ${result.data}`);
        }
      });
      if (messages) {
        await sendTelegramMessage(`❌ Error: ${messages}`);
      }
    }
  } catch (error) {
    console.error(
      `Error in 5-minute scheduled task: ${(error as Error).message}`
    );
    await sendTelegramMessage(
      `❌ Error in 5-minute scheduled task: ${(error as Error).message}`
    );
  }
}

// Hourly scheduled task
async function hourlyTask(): Promise<void> {
  console.info("Running hourly scheduled task");
  try {
    const message = incompleteDataHistory.some(Boolean)
      ? "🕒 Hourly Update: Incomplete data was found in at least one check in the last hour."
      : "🕒 Hourly Update: No incomplete data found in the last hour.";
    await sendTelegramMessage(message);
  } catch (error) {
    console.error(
      `Error in hourly scheduled task: ${(error as Error).message}`
    );
    await sendTelegramMessage(
      `❌ Error in hourly scheduled task: ${(error as Error).message}`
    );
  }
}

// Bot command handlers
bot.command("start", async (ctx) => {
  await ctx.reply(
    "Welcome to the IELTS Crawler Bot! Use /scrape to run the crawler, /stats to get statistics, or /getchatid to get your chat ID."
  );
  console.info(`User ${ctx.from?.id} started the bot`);
});

bot.command("getchatid", async (ctx) => {
  const chatId = ctx.chat.id.toString();
  await ctx.reply(`Your chat ID is: ${chatId}`);
  console.info(`Sent chat ID ${chatId} to user ${ctx.from?.id}`);
});

bot.command("scrape", async (ctx) => {
  if (BOT_OWNER_CHAT_ID !== ctx.chat.id.toString()) {
    await ctx.reply("Unauthorized access.");
    console.warn(`Unauthorized access attempt by ${ctx.chat.id}`);
    return;
  }

  await ctx.reply("Starting the crawler...");
  try {
    await scheduledTask();

    await ctx.reply("Crawler finished.");
  } catch (error) {
    console.error(`Error in scrape command: ${(error as Error).message}`);
    await ctx.reply(`❌ Error in scrape command: ${(error as Error).message}`);
  }
});

// Start bot and schedule tasks
async function main(): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !BOT_OWNER_CHAT_ID) {
    console.error("TELEGRAM_BOT_TOKEN or BOT_OWNER_CHAT_ID not set");
    process.exit(1);
  }

  // Create logs directory

  // cron.schedule("* * * * *", scheduledTask); // Every minute

  // Schedule tasks
  // Schedule the task to run every 5 minutes
  cron.schedule("*/5 * * * *", scheduledTask); // Every 5 minutes
  cron.schedule("0 * * * *", hourlyTask); // Every hour

  // Start bot
  await bot.start();
  console.info("Starting Telegram bot");
}

// Handle errors and shutdown
bot.catch((err) => {
  console.error(`Bot error: ${err.message}`);
});

process.on("SIGINT", async () => {
  console.info("Shutting down bot");
  await bot.stop();
  process.exit(0);
});

main().catch((error) => {
  console.error(`Main error: ${error.message}`);
  process.exit(1);
});
