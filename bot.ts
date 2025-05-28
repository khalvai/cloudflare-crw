import { Bot } from "grammy";
import cron from "node-cron";
import { createLogger, transports, format } from "winston";
import { config } from "dotenv";
import { promises as fs } from "fs";
import path from "path";
import { IDP, Result, Observer } from "./Idp";
import { Irsafam } from "./Irsafam";
import { ADD } from "./ADD";

// Load environment variables
config();

// Configuration
const TELEGRAM_BOT_TOKEN: string = process.env.TELEGRAM_BOT_TOKEN || "";
const BOT_OWNER_CHAT_ID: string = process.env.BOT_OWNER_CHAT_ID || "";
const TELEGRAM_CHAT_IDS: string[] = JSON.parse(
  process.env.TELEGRAM_CHAT_IDS || "[]"
).concat(BOT_OWNER_CHAT_ID);

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

// Setup logging
const logger = createLogger({
  level: "info",
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.printf(
      ({ timestamp, level, message }) =>
        `${timestamp} - ${level.toUpperCase()} - ${message}`
    )
  ),
  transports: [
    new transports.File({
      filename: path.join(
        "logs",
        `crawler_${new Date().toISOString().replace(/[:.]/g, "-")}.log`
      ),
    }),
  ],
});

// Initialize bot
const bot = new Bot(TELEGRAM_BOT_TOKEN);

// Function to send Telegram messages
async function sendTelegramMessage(
  message: string,
  chatIds: string[] = TELEGRAM_CHAT_IDS
): Promise<void> {
  const sendPromises = chatIds
    .filter((chatId) => chatId)
    .map(async (chatId) => {
      try {
        // Split message into chunks to respect Telegram's 4096-character limit
        for (let i = 0; i < message.length; i += 4096) {
          await bot.api.sendMessage(chatId, message.slice(i, i + 4096));
        }
        logger.info(`Sent Telegram message to ${chatId}`);
      } catch (error) {
        logger.error(
          `Failed to send Telegram message to ${chatId}: ${
            (error as Error).message
          }`
        );
      }
    });

  await Promise.all(sendPromises);
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
  logger.info(statsMessage);
  await sendTelegramMessage(statsMessage);
}

// 5-minute scheduled task
async function scheduledTask(): Promise<void> {
  const observers: Observer[] = [new IDP(), new Irsafam(), new ADD()];
  logger.info("Running 5-minute scheduled task");
  try {
    const promises = observers.map((ob) => ob.doYourThing());

    const results = await Promise.all(promises);
    console.log(results);

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
        logger.error(
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
    logger.error(
      `Error in 5-minute scheduled task: ${(error as Error).message}`
    );
    await sendTelegramMessage(
      `❌ Error in 5-minute scheduled task: ${(error as Error).message}`
    );
  }
}

// Hourly scheduled task
async function hourlyTask(): Promise<void> {
  logger.info("Running hourly scheduled task");
  try {
    const message = incompleteDataHistory.some(Boolean)
      ? "🕒 Hourly Update: Incomplete data was found in at least one check in the last hour."
      : "🕒 Hourly Update: No incomplete data found in the last hour.";
    await sendTelegramMessage(message);
  } catch (error) {
    logger.error(`Error in hourly scheduled task: ${(error as Error).message}`);
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
  logger.info(`User ${ctx.from?.id} started the bot`);
});

bot.command("getchatid", async (ctx) => {
  const chatId = ctx.chat.id.toString();
  await ctx.reply(`Your chat ID is: ${chatId}`);
  logger.info(`Sent chat ID ${chatId} to user ${ctx.from?.id}`);
});

bot.command("scrape", async (ctx) => {
  if (!TELEGRAM_CHAT_IDS.includes(ctx.chat.id.toString())) {
    await ctx.reply("Unauthorized access.");
    logger.warn(`Unauthorized access attempt by ${ctx.chat.id}`);
    return;
  }

  await ctx.reply("Starting the crawler...");
  try {
    await scheduledTask();

    await ctx.reply("Crawler finished.");
  } catch (error) {
    logger.error(`Error in scrape command: ${(error as Error).message}`);
    await ctx.reply(`❌ Error in scrape command: ${(error as Error).message}`);
  }
});

// Start bot and schedule tasks
async function main(): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !BOT_OWNER_CHAT_ID) {
    logger.error("TELEGRAM_BOT_TOKEN or BOT_OWNER_CHAT_ID not set");
    process.exit(1);
  }

  // Create logs directory
  await fs.mkdir("logs", { recursive: true });

  // Schedule tasks
  cron.schedule("*/1 * * * *", scheduledTask); // Every 5 minutes
  cron.schedule("0 * * * *", hourlyTask); // Every hour

  // Start bot
  await bot.start();
  logger.info("Starting Telegram bot");
}

// Handle errors and shutdown
bot.catch((err) => {
  logger.error(`Bot error: ${err.message}`);
});

process.on("SIGINT", async () => {
  logger.info("Shutting down bot");
  await bot.stop();
  process.exit(0);
});

main().catch((error) => {
  logger.error(`Main error: ${error.message}`);
  process.exit(1);
});
