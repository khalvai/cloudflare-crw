import { Bot } from "grammy";
import axios from "axios";
import { load } from "cheerio";
import cron from "node-cron";
import { createLogger, transports, format } from "winston";
import { config } from "dotenv";
import { promises as fs } from "fs";
import path from "path";

// Load environment variables
config();

// Configuration
const TELEGRAM_BOT_TOKEN: string = process.env.TELEGRAM_BOT_TOKEN || "";
const BOT_OWNER_CHAT_ID: string = process.env.BOT_OWNER_CHAT_ID || "";
const TELEGRAM_CHAT_IDS: string[] = JSON.parse(
  process.env.TELEGRAM_CHAT_IDS || "[]"
).concat(BOT_OWNER_CHAT_ID);
const BASE_URL: string =
  process.env.BASE_URL ||
  "https://ieltsadd.ir/test?originalType=1%2C3&type=1%2C5&province=%D8%AA%D9%87%D8%B1%D8%A7%D9%86&typeMaterial=%DA%A9%D8%A7%D9%85%D9%BE%DB%8C%D9%88%D8%AA%D8%B1%DB%8C&page=";
const PAGE_RANGE_END: number = parseInt(process.env.PAGE_RANGE_END || "11", 10);
const REQUEST_DELAY: number =
  parseFloat(process.env.REQUEST_DELAY || "1") * 1000; // Convert to milliseconds

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

interface ScrapeResult {
  completedData: ExamEntry[];
  incompleteData: ExamEntry[];
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
  for (const chatId of chatIds) {
    if (chatId) {
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
    }
  }
}

// Function to scrape data
async function scrapeData(): Promise<ScrapeResult> {
  const completedData: ExamEntry[] = [];
  const incompleteData: ExamEntry[] = [];

  for (let page = 1; page < PAGE_RANGE_END; page++) {
    const url = `${BASE_URL}${page}`;
    logger.info(`Scraping page ${page}: ${url}`);
    try {
      const response = await axios.get(url, { timeout: 10000 });
      if (response.status === 200) {
        const $ = load(response.data);
        const table = $(
          "table.table.table-striped.table-bordered.table-responsive.city_table"
        );

        if (table.length) {
          table
            .find("tr")
            .slice(2)
            .each((_, row) => {
              const columns = $(row).find("td");
              if (columns.length) {
                try {
                  const entry: ExamEntry = {
                    status: $(columns[0]).text().trim(),
                    examName: $(columns[1]).text().trim(),
                    examType: $(columns[2]).text().trim(),
                    testType: $(columns[3]).text().trim(),
                    examDate: $(columns[4]).text().trim(),
                    location: $(columns[5]).text().trim(),
                    cost: $(columns[6]).text().trim(),
                  };

                  if (entry.status === "تکمیل شد") {
                    completedData.push(entry);
                  } else {
                    incompleteData.push(entry);
                  }
                } catch (error) {
                  logger.error(
                    `Error parsing row on page ${page}: ${
                      (error as Error).message
                    }`
                  );
                }
              }
            });
        } else {
          logger.warn(`No table found on page ${page}`);
        }
      } else {
        logger.error(
          `Failed to retrieve page ${page}. Status code: ${response.status}`
        );
      }
    } catch (error) {
      logger.error(
        `Network error on page ${page}: ${(error as Error).message}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY));
  }

  return { completedData, incompleteData };
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
  logger.info("Running 5-minute scheduled task");
  try {
    const { completedData, incompleteData } = await scrapeData();
    const hasIncomplete = incompleteData.length > 0;

    // Update incomplete data history
    incompleteDataHistory.push(hasIncomplete);
    incompleteDataHistory = incompleteDataHistory.slice(-12); // Keep last 12 checks (1 hour)

    // Send stats
    await getStats(completedData, incompleteData);

    // Send incomplete data if it exists
    if (hasIncomplete) {
      let message = "🚨 There is incomplete data:\n";
      for (const entry of incompleteData) {
        message += `📅 ${entry.examDate} | ${entry.examName} | Status: ${entry.status} | Location: ${entry.location} | Cost: ${entry.cost}\n`;
      }
      await sendTelegramMessage(message);
    } else {
      await sendTelegramMessage("✅ No incomplete data found in this check.");
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
    const { completedData, incompleteData } = await scrapeData();
    const hasIncomplete = incompleteData.length > 0;

    if (hasIncomplete) {
      let message = "🚨 There is incomplete data:\n";
      for (const entry of incompleteData) {
        message += `📅 ${entry.examDate} | ${entry.examName} | Status: ${entry.status} | Location: ${entry.location} | Cost: ${entry.cost}\n`;
      }
      await sendTelegramMessage(message);
    } else {
      await sendTelegramMessage("✅ No incomplete data found.");
    }

    await getStats(completedData, incompleteData);
    await ctx.reply("Crawler finished.");
  } catch (error) {
    logger.error(`Error in scrape command: ${(error as Error).message}`);
    await ctx.reply(`❌ Error in scrape command: ${(error as Error).message}`);
  }
});

bot.command("stats", async (ctx) => {
  if (!TELEGRAM_CHAT_IDS.includes(ctx.chat.id.toString())) {
    await ctx.reply("Unauthorized access.");
    logger.warn(`Unauthorized access attempt by ${ctx.chat.id}`);
    return;
  }

  try {
    const { completedData, incompleteData } = await scrapeData();
    await getStats(completedData, incompleteData);
  } catch (error) {
    logger.error(`Error in stats command: ${(error as Error).message}`);
    await ctx.reply(`❌ Error in stats command: ${(error as Error).message}`);
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
  cron.schedule("*/5 * * * *", scheduledTask); // Every 5 minutes
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
