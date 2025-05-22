import requests
from bs4 import BeautifulSoup
import csv
import os
import logging
import time
from datetime import datetime
import json
from telegram.ext import Application, CommandHandler
from telegram import Bot
import asyncio
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configuration
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
BOT_OWNER_CHAT_ID = os.getenv("BOT_OWNER_CHAT_ID")
TELEGRAM_CHAT_IDS = json.loads(os.getenv("TELEGRAM_CHAT_IDS", '[]')) + [BOT_OWNER_CHAT_ID]
BASE_URL = os.getenv("BASE_URL", "https://ieltsadd.ir/test?originalType=1%2C3&type=1%2C5&province=%D8%AA%D9%87%D8%B1%D8%A7%D9%86&typeMaterial=%DA%A9%D8%A7%D9%85%D9%BE%DB%8C%D9%88%D8%AA%D8%B1%DB%8C&page=")
PAGE_RANGE = range(1, int(os.getenv("PAGE_RANGE_END", 11)))
REQUEST_DELAY = float(os.getenv("REQUEST_DELAY", 1))  # Delay in seconds between requests

# Setup logging
logging.basicConfig(
    filename=f'crawler_{datetime.now().strftime("%Y%m%d_%H%M%S")}.log',
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Function to send a message via Telegram
async def send_telegram_message(bot, message, chat_ids=TELEGRAM_CHAT_IDS):
    for chat_id in chat_ids:
        if chat_id:
            try:
                # Split long messages to avoid Telegram's 4096-character limit
                for i in range(0, len(message), 4000):
                    await bot.send_message(chat_id=chat_id, text=message[i:i+4000])
                logger.info(f"Sent Telegram message to {chat_id}")
            except Exception as e:
                logger.error(f"Failed to send Telegram message to {chat_id}: {e}")

# Function to scrape data from the website
def scrape_data():
    completed_data = []
    incomplete_data = []

    for page in PAGE_RANGE:
        url = f"{BASE_URL}{page}"
        logger.info(f"Scraping page {page}: {url}")
        try:
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                soup = BeautifulSoup(response.content, 'html.parser')
                table = soup.find('table', class_='table table-striped table-bordered table-responsive city_table')
                
                if table:
                    for row in table.find_all('tr')[2:]:  # Skip header rows
                        columns = row.find_all('td')
                        if columns:
                            try:
                                status = columns[0].get_text(strip=True)
                                exam_name = columns[1].get_text(strip=True)
                                exam_type = columns[2].get_text(strip=True)
                                test_type = columns[3].get_text(strip=True)
                                exam_date = columns[4].get_text(strip=True)
                                location = columns[5].get_text(strip=True)
                                cost = columns[6].get_text(strip=True)

                                entry = {
                                    'وضعیت': status,
                                    'نام آزمون': exam_name,
                                    'نوع': exam_type,
                                    'نوع آزمون': test_type,
                                    'تاریخ برگزاری': exam_date,
                                    'محل برگزاری': location,
                                    'هزینه آزمون': cost
                                }

                                if status == "تکمیل شد":
                                    completed_data.append(entry)
                                else:
                                    incomplete_data.append(entry)
                            except IndexError as e:
                                logger.error(f"Error parsing row on page {page}: {e}")
                else:
                    logger.warning(f"No table found on page {page}")
            else:
                logger.error(f"Failed to retrieve page {page}. Status code: {response.status_code}")
        except requests.RequestException as e:
            logger.error(f"Network error on page {page}: {e}")
        time.sleep(REQUEST_DELAY)  # Rate limiting

    return completed_data, incomplete_data

# Function to write data to CSV files
def write_to_csv(completed_data, incomplete_data):
    try:
        if completed_data:
            with open('completed_data.csv', mode='w', newline='', encoding='utf-8') as completed_file:
                writer = csv.DictWriter(completed_file, fieldnames=completed_data[0].keys())
                writer.writeheader()
                writer.writerows(completed_data)
                logger.info("Wrote completed data to completed_data.csv")
        else:
            logger.info("No completed data to write to completed_data.csv")
    except IOError as e:
        logger.error(f"Error writing to completed_data.csv: {e}")

    try:
        if incomplete_data:
            with open('incomplete_data.csv', mode='w', newline='', encoding='utf-8') as incomplete_file:
                writer = csv.DictWriter(incomplete_file, fieldnames=incomplete_data[0].keys())
                writer.writeheader()
                writer.writerows(incomplete_data)
                logger.info("Wrote incomplete data to incomplete_data.csv")
            return True
        else:
            logger.info("No incomplete data to write to incomplete_data.csv")
            return False
    except IOError as e:
        logger.error(f"Error writing to incomplete_data.csv: {e}")
        return False

# Function to get statistics
async def get_stats(bot, completed_data, incomplete_data):
    stats = {
        "total_completed": len(completed_data),
        "total_incomplete": len(incomplete_data),
        "total_entries": len(completed_data) + len(incomplete_data)
    }
    stats_message = f"📊 Stats: {stats['total_completed']} completed, {stats['total_incomplete']} incomplete, {stats['total_entries']} total entries."
    logger.info(stats_message)
    await send_telegram_message(bot, stats_message)
    return stats

# Function to read CSV files
async def get_csv_contents(bot):
    csv_files = {
        "completed_data.csv": [],
        "incomplete_data.csv": []
    }
    
    for file_name in csv_files:
        if os.path.exists(file_name):
            try:
                with open(file_name, mode='r', encoding='utf-8') as file:
                    reader = csv.DictReader(file)
                    csv_files[file_name] = [row for row in reader]
                    content_message = f"📄 Contents of {file_name}:\n"
                    for row in csv_files[file_name]:
                        content_message += f"{row}\n"
                    await send_telegram_message(bot, content_message)
                    logger.info(f"Read contents of {file_name}")
            except IOError as e:
                logger.error(f"Error reading {file_name}: {e}")
                await send_telegram_message(bot, f"Error reading {file_name}: {e}")
        else:
            logger.warning(f"{file_name} does not exist")
            await send_telegram_message(bot, f"{file_name} does not exist")
            csv_files[file_name] = []
    
    return csv_files

# Telegram command handlers
async def start(update, context):
    await update.message.reply_text("Welcome to the IELTS Crawler Bot! Use /scrape to run the crawler, /stats to get statistics, or /csv to get CSV contents.")
    logger.info(f"User {update.effective_user.id} started the bot")

async def scrape(update, context):
    if str(update.effective_user.id) not in TELEGRAM_CHAT_IDS:
        await update.message.reply_text("Unauthorized access.")
        logger.warning(f"Unauthorized access attempt by {update.effective_user.id}")
        return
    
    await update.message.reply_text("Starting the crawler...")
    completed_data, incomplete_data = scrape_data()
    has_incomplete = write_to_csv(completed_data, incomplete_data)
    
    if has_incomplete:
        message = "🚨 There is incomplete data:\n"
        for entry in incomplete_data:
            message += f"📅 {entry['تاریخ برگزاری']} | {entry['نام آزمون']} | Status: {entry['وضعیت']} | Location: {entry['محل برگزاری']} | Cost: {entry['هزینه آزمون']}\n"
        await send_telegram_message(context.bot, message)
    else:
        await send_telegram_message(context.bot, "✅ No incomplete data found.")
    
    await get_stats(context.bot, completed_data, incomplete_data)
    await update.message.reply_text("Crawler finished.")

async def stats(update, context):
    if str(update.effective_user.id) not in TELEGRAM_CHAT_IDS:
        await update.message.reply_text("Unauthorized access.")
        logger.warning(f"Unauthorized access attempt by {update.effective_user.id}")
        return
    
    completed_data, incomplete_data = scrape_data()
    await get_stats(context.bot, completed_data, incomplete_data)

async def csv(update, context):
    if str(update.effective_user.id) not in TELEGRAM_CHAT_IDS:
        await update.message.reply_text("Unauthorized access.")
        logger.warning(f"Unauthorized access attempt by {update.effective_user.id}")
        return
    
    await get_csv_contents(context.bot)

# Main function to run the bot
def main():
    if not TELEGRAM_BOT_TOKEN or not BOT_OWNER_CHAT_ID:
        logger.error("TELEGRAM_BOT_TOKEN or BOT_OWNER_CHAT_ID not set")
        return

    application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("scrape", scrape))
    application.add_handler(CommandHandler("stats", stats))
    application.add_handler(CommandHandler("csv", csv))
    
    logger.info("Starting Telegram bot")
    application.run_polling()

if __name__ == "__main__":
    main()