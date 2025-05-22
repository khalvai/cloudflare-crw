# Use a lightweight Python base image
FROM python:3.12-slim

# Set working directory inside the container
WORKDIR /app

# Copy requirements.txt to install dependencies
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application code and .env file
COPY crawler.py .
COPY .env .

# Set environment variable to ensure Python doesn't buffer output
ENV PYTHONUNBUFFERED=1

# Command to run the Python script
CMD ["python", "crawler.py"]