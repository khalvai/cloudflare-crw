import os
import time
import json
import logging
import asyncio
import threading
import requests
import schedule
from datetime import datetime, timedelta
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from telegram import Update, Bot
from telegram.ext import Application, CommandHandler, ContextTypes

# Load environment variables
load_dotenv()

# Configuration
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
BOT_OWNER_CHAT_ID = os.getenv("BOT_OWNER_CHAT_ID")
TELEGRAM_CHAT_IDS = json.loads(os.getenv("TELEGRAM_CHAT_IDS", '[]')) + [BOT_OWNER_CHAT_ID]
BASE_URL = os.getenv("BASE_URL", "https://ieltsadd.ir/test?originalType=1%2C3&type=1%2C5&province=%D8%AA%D9%87%D8%B1%D8%A7%D9%86&typeMaterial=%DA%A9%D8%A7%D9%85%D9%BE%DB%8C%D9%88%D8%AA%D8%B1%DB%8C&page=")
PAGE_RANGE = range(1, int(os.getenv("PAGE_RANGE_END", 11)))
REQUEST_DELAY = float(os.getenv("REQUEST_DELAY", 1))
SCHEDULE_INTERVAL = 5  # Minutes
NO_RESULT_TIMEOUT = 60  # Minutes

# Logging setup
logging.basicConfig(
    filename=f'crawler_{datetime.now().strftime("%Y%m%d_%H%M%S")}.log',
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global state
last_found_time = datetime.now()
last_alert_sent = None

# Telegram sending utility
async def send_telegram_message(bot: Bot, message: str, chat_ids=None):
    chat_ids = chat_ids or TELEGRAM_CHAT_IDS
    for chat_id in chat_ids:
        if not chat_id:
            continue
        try:
            for i in range(0, len(message), 4000):
                await bot.send_message(chat_id=chat_id, text=message[i:i+4000])
            logger.info(f"Sent message to {chat_id}")
        except Exception as e:
            logger.error(f"Failed to send message to {chat_id}: {e}")

# Scraping utility
def scrape_data():
    incomplete = []
    completed = []

    for page in PAGE_RANGE:
        url = f"{BASE_URL}{page}"
        logger.info(f"Scraping: {url}")
        try:
            response = requests.get(url, timeout=10)
            if response.status_code != 200:
                logger.warning(f"Non-200 status: {response.status_code}")
                continue

            soup = BeautifulSoup(response.content, 'html.parser')
            table = soup.find('table', class_='table table-striped table-bordered table-responsive city_table')
            if not table:
                continue

            for row in table.find_all('tr')[2:]:
                cols = row.find_all('td')
                if not cols:
                    continue
                try:
                    status = cols[0].get_text(strip=True)
                    entry = {
                        'وضعیت': status,
                        'نام آزمون': cols[1].get_text(strip=True),
                        'نوع': cols[2].get_text(strip=True),
                        'نوع آزمون': cols[3].get_text(strip=True),
                        'تاریخ برگزاری': cols[4].get_text(strip=True),
                        'محل برگزاری': cols[5].get_text(strip=True),
                    }
                    if status == "تکمیل شد":
                        completed.append(entry)
                    else:
                        incomplete.append(entry)
                except IndexError as e:
                    logger.error(f"Index error: {e}")
        except Exception as e:
            logger.error(f"Request error: {e}")

        time.sleep(REQUEST_DELAY)

    return incomplete, completed

# Format for Telegram

def format_entries(entries):
    return "\n".join([
        f"📅 {e['تاریخ برگزاری']} | {e['نام آزمون']} | {e['نوع']} | {e['نوع آزمون']} | {e['محل برگزاری']} | 📌 {e['وضعیت']}"
        for e in entries
    ])

# Scheduled job
async def scheduled_task(bot):
    global last_found_time, last_alert_sent
    print("Running scheduled task")

    logger.info("Running scheduled task")
    incomplete, _ = scrape_data()
    now = datetime.now()

    if incomplete:
        last_found_time = now
        msg = "🚨 Incomplete tests found:\n" + format_entries(incomplete)
        await send_telegram_message(bot, msg)
    elif now - last_found_time >= timedelta(minutes=NO_RESULT_TIMEOUT):
        if not last_alert_sent or (now - last_alert_sent >= timedelta(minutes=NO_RESULT_TIMEOUT)):
            await send_telegram_message(bot, "✅ No incomplete data found in the past hour.")
            last_alert_sent = now

# Command handler: /start
async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("🛠 Bot is running. /stat get stat manually right now, /getchatid get chat id ")

# Command handler: /stat
async def cmd_stat(update: Update, context: ContextTypes.DEFAULT_TYPE):
    logger.info("Manual /stat command triggered")
    incomplete, completed = scrape_data()
    bot = context.bot

    message = f"📊 Incomplete count: {len(incomplete)}\n"
    if incomplete:
        message += "🚨 Incomplete Tests:\n" + format_entries(incomplete) + "\n"
    else:
        message += "✅ No Incomplete Tests Found.\n"

    message += f"📦 Completed count: {len(completed)}"

    await send_telegram_message(bot, message, [update.effective_chat.id])

# Command handler: /getchatid
async def cmd_getchatid(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    await update.message.reply_text(f"🆔 Your chat ID is: {chat_id}")

# Background scheduler thread

def run_scheduler(bot):
    schedule.every(SCHEDULE_INTERVAL).minutes.do(lambda: asyncio.run(scheduled_task(bot)))
    while True:
        schedule.run_pending()
        time.sleep(1)

# Main entry

def main():
    if not TELEGRAM_BOT_TOKEN or not BOT_OWNER_CHAT_ID:
        logger.error("Missing Telegram configuration.")
        return

    application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    application.add_handler(CommandHandler("start", cmd_start))
    application.add_handler(CommandHandler("stat", cmd_stat))
    application.add_handler(CommandHandler("getchatid", cmd_getchatid))

    bot = application.bot
    threading.Thread(target=run_scheduler, args=(bot,), daemon=True).start()

    logger.info("Bot started.")
    application.run_polling()

if __name__ == "__main__":
    main()
