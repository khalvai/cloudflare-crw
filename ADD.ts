import { Observer, Result } from "./Idp";
import { Bot } from "grammy";
import axios from "axios";
import { load } from "cheerio";
import cron from "node-cron";
import { createLogger, transports, format } from "winston";
import { config } from "dotenv";
import { promises as fs } from "fs";
import path from "path";
import pLimit from "p-limit";
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
  hasError: boolean;
  message: string;
}

// Incomplete data history for hourly checks
let incompleteDataHistory: boolean[] = [];
const CONCURRENCY_LIMIT = 5; // Limit concurrent requests

const PAGE_RANGE_END: number = parseInt(process.env.PAGE_RANGE_END || "11", 10);
const REQUEST_DELAY: number =
  parseFloat(process.env.REQUEST_DELAY || "1") * 1000;

const limit = pLimit(CONCURRENCY_LIMIT);
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
export class ADD implements Observer {
  constructor() {}

  async doYourThing(): Promise<Result> {
    try {
      const completedData: ExamEntry[] = [];
      const incompleteData: ExamEntry[] = [];

      const PAGE_RANGE_END = 3;
      const pages = Array.from({ length: PAGE_RANGE_END - 1 }, (_, i) => i + 1);
      let requestCount = 0;

      const scrapePromises = pages.map((page) =>
        limit(async () => {
          if (requestCount > 0) {
            await delay(REQUEST_DELAY);
          }
          requestCount++;
          return this.scrapePage(page);
        })
      );

      const results = await Promise.all(scrapePromises);
      let hasError2 = false;
      let message2 = "";
      for (const {
        completedData: pageCompleted,
        incompleteData: pageIncomplete,
        hasError,
        message,
      } of results) {
        completedData.push(...pageCompleted);
        incompleteData.push(...pageIncomplete);
        if (hasError) {
          hasError2 = true;
          message2 = `ADD - Error occurred while scraping page: ${message}`;
          break;
        }
      }

      if (hasError2) {
        return {
          hasError: true,
          site: "ADD",
          data: message2,
          found: false,
        };
      }

      if (incompleteData.length > 0) {
        const tests = incompleteData
          .map(
            (entity) =>
              `Name: ${entity.examName}\n` +
              `Status: ${entity.status}\n` +
              `Exam Date: ${new Intl.DateTimeFormat("fa-IR").format(
                new Date(entity.examDate)
              )}\n`
          )
          .join("\n");

        return {
          found: true,
          site: "ADD",
          data: tests,
          hasError: false,
        };
      }

      return {
        found: false,
        hasError: false,
        site: "ADD",
        data: "No test found",
      };
    } catch (error) {
      console.error("Error fetching ADD data:", error);
      return {
        found: false,
        hasError: true,
        site: "ADD",
        data: `An error occurred while fetching data from ADD: ${error}`,
      };
    }
  }

  async scrapePage(page: number): Promise<ScrapeResult> {
    const completedData: ExamEntry[] = [];
    const incompleteData: ExamEntry[] = [];
    const url = `https://www.ieltsadd.ir/test?originalType=1%2C3&type=1%2C5&province=%D8%AA%D9%87%D8%B1%D8%A7%D9%86&typeMaterial=%DA%A9%D8%A7%D9%85%D9%BE%DB%8C%D9%88%D8%AA%D8%B1%DB%8C&page=${page}`;
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
            //@ts-ignore
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
                  return {
                    hasError: true,
                    message: `ADD - Error parsing row on page ${page}: ${error}`,
                    completedData: [],
                    incompleteData: [],
                  };
                }
              }
            });
        } else {
          return {
            hasError: false,
            message: `ADD - No table found on page ${page}`,
            completedData: [],
            incompleteData: [],
          };
        }
      } else {
        return {
          hasError: true,
          message: `ADD - Failed to retrieve page ${page}. Status code: ${response.status}`,
          completedData: [],
          incompleteData: [],
        };
      }
    } catch (error) {
      return {
        hasError: true,
        message: `ADD - Error occurred while scraping data, ${error}`,
        completedData: [],
        incompleteData: [],
      };
    }

    return { completedData, incompleteData, hasError: false, message: "" };
  }
}
