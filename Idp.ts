
export type Result = {
  found: boolean;
  hasError: boolean;
  site: string;
  data: any;
};
export interface Observer {
  doYourThing(): Promise<Result>;
}

interface ResponseData {
  sessions: {
    Title: string;
    SessionId: string;
    TestSessionDateUtc: string;
    TestSessionDateLocal: string;
    TestCentreLocationId: string;
    TestCentreLocation: string;
    TestFormatId: number;
    SeatMaxAvailable: number;
    SeatRemaining: number;
    SpeakingRange: object;
    TestModule: string;
    TestCategory: string;
    Fee: number;
    FeeCurrency: string;
    externalBookableProductId: string;
    testLocalTimeZone: string;
    externalReferenceId: string;
  }[];
  total_records: number;
}
export class IDP implements Observer {
  constructor() {}
  notIntrestedkeywords = ["IRSAFAM", "ADD"];
  async doYourThing(): Promise<Result> {
    try {
      const response = await fetch(
        "https://api.rebrand.ieltsweb.idp.com/v2/externalapi/test-dates",
        {
          headers: {
            accept: "application/json, text/plain, */*",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/json",
            priority: "u=1, i",
            "sec-ch-ua":
              '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Linux"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-site",
            "x-api-key": "0vuLJeTp7AiX7zvzB6Un8LfUPkISVTz5MAUfNERc",
            Referer: "https://ielts.idp.com/iran/test-dates/tehran?page=1",
            "Referrer-Policy": "no-referrer-when-downgrade",
          },
          body: '{"days":"90","country":"IR","city":"Tehran","showMore":0,"testType":"Academic","testFormat":"Computer-delivered","centreType":"all","enableBxSearch":"Yes","bxSearchTestCentreCodes":[],"bxSearchTestVenues":["fff1598c-cff9-4013-a8b4-33499a70a7ec","05b97781-c654-4b2c-b010-917e02fc6206","94337932-1585-4dde-a33b-3ec84eeb5a95","0a700ace-6041-4ce5-8b5f-89dc4e22dfb0","816f4ccf-4a66-47cb-bbe1-85860e697e34","4a06b417-e58c-4b4b-89fc-308ec01f019b","5507fb2f-a2e3-469d-ab1f-941ae84739eb","134cf0a8-6631-4bf2-bded-873b75fa9ea2","2fca0792-61a7-4c9f-aa22-19259a074e69","6255b200-c20b-4c26-883b-f84d4f3138c9","d30af4d2-44f2-4f19-bdfd-c8f0713cf420","4ee48039-2966-44b7-9dba-53b54b332c61","cd82bc2e-b6df-4470-bbb6-f9052cf1d00f","8e982fbf-9412-4f83-bc21-306702837ab1","727d0935-33ba-439b-ac08-67280dae61da","4c964a3e-a09e-4941-94b9-f211b27ae507"],"testCentreCode":"","venueId":"","isSort":"False","pageType":"cityLanding","limit":30,"countryISO3Code":"IRN","fromTestStartDate":"2025-05-29","toTestStartDate":"2025-08-27","timesOfDay":""}',
          method: "POST",
        }
      );
      const responseData = (await response.json()) as ResponseData; // const $ = cheerio.load(response);
      const tests = responseData.sessions.filter((session) => {
        const location = session.TestCentreLocation?.toLowerCase() || "";
        return !this.notIntrestedkeywords.some((keyword) =>
          location.includes(keyword.toLowerCase())
        );
      });

      if (tests.length === 0) {
        return {
          found: false,
          site: "IDP",
          hasError: false,
          data: "No available test sessions found for Tehran center.",
        };
      }

      const message = tests
        .map(
          (session) =>
            `Title: ${session.Title}\n` +
            `Session ID: ${session.SessionId}\n` +
            `Date (UTC): ${session.TestSessionDateUtc}\n` +
            `Date (Local): ${new Intl.DateTimeFormat("fa-IR").format(
              new Date(session.TestSessionDateLocal)
            )}\n` +
            `Location: ${session.TestCentreLocation}\n` +
            `Format: ${session.TestFormatId === 1 ? "Computer" : "Paper"}\n` +
            `Seats Available: ${session.SeatRemaining}/${session.SeatMaxAvailable}\n` +
            `Test Module: ${session.TestModule}\n` +
            `Test Category: ${session.TestCategory}\n` +
            `Fee: ${session.Fee} ${session.FeeCurrency}\n` +
            `External Reference ID: ${session.externalReferenceId}\n` +
            `External Bookable Product ID: ${session.externalBookableProductId}\n` +
            `Test Local Time Zone: ${session.testLocalTimeZone}\n` +
            `Test Format: ${session.TestFormatId}\n` +
            `Test Centre Location ID: ${session.TestCentreLocationId}\n` +
            `Test Session Date Local: ${session.TestSessionDateLocal}\n` +
            `Test Session Date UTC: ${session.TestSessionDateUtc}\n` +
            `Speaking Range: ${JSON.stringify(session.SpeakingRange)}\n` +
            `\n`
        )
        .join("\n");

      return {
        found: true,
        site: `IDP`,
        data: message,
        hasError: false,
      };
    } catch (error) {
      console.error("Error in IDP doYourThing:", error);
      return {
        found: false,
        site: "IDP",
        hasError: true,
        data: `An error occurred while fetching data from IDP: ${error}`,
      };
    }
  }
}