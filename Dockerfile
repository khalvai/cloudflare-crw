# Use a lightweight Python base image
FROM docker.arvancloud.ir/python:3.12-slim

# Set working directory inside the container
WORKDIR /app

# Copy crawler.py and .env file to the container
COPY crawler.py .

# Copy requirements.txt to install dependencies
RUN pip install requests>=2.28.0 \
    beautifulsoup4>=4.11.0 \
    python-telegram-bot>=20.0 \
    python-dotenv>=1.0.0 \
    schedule>=1.2.0

# Copy the application code and .env fileCOPY crawler.py .

# Set environment variable to ensure Python doesn't buffer output
ENV PYTHONUNBUFFERED=1

# Command to run the Python script
CMD ["python", "crawler.py"]