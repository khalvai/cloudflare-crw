import { Observer, Result } from "./Idp";
import axios from "axios";
import { load } from "cheerio";

export class Irsafam implements Observer {
  constructor() {}

  async doYourThing(): Promise<Result> {
    try {
      const specificText = "بر اساس جستجوی شما هیچ آزمونی پیدا نشد.";
      // Load the webpage

      const url = "https://irsafam.org/ielts?";
      const response = await axios.get(url);
      const html = response.data;

      // Load the HTML into cheerio
      const $ = load(html);

      // Check if the specific text is present in the page
      if ($("body").text().includes(specificText)) {
        return {
          found: false,
          site: "Irsafam",
          hasError: false,
          data: "No test found",
        };
      } else {
        return {
          found: true,
          site: "Irsafam",
          hasError: false,
          data: "Test found",
        };
      }
    } catch (error) {
      console.error("Error loading the page:", error);
      return {
        found: false,
        site: "Irsafam",
        hasError: true,
        data: error,
      };
    }
  }
}
