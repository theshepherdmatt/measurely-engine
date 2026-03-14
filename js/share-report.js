import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";

const path = require("path");

const ROOT = process.cwd();
const OUTPUT_PATH = path.join(ROOT, "web", "report.png");
const REPORT_TEMPLATE = "file://" + path.join(ROOT, "web", "report-template.html");


if (process.argv.length < 3) {
    console.error("Usage: node share-report.js <sweep-folder>");
    process.exit(1);
}

const sweepFolder = process.argv[2];

// --------------------------------------------------
// LOAD ANALYSIS
// --------------------------------------------------
const analysis = JSON.parse(
    fs.readFileSync(path.join(sweepFolder, "analysis.json"), "utf8")
);

// --------------------------------------------------
// LOAD DASHBOARD-IDENTICAL CURVE
// --------------------------------------------------
const reportCurve = JSON.parse(
    fs.readFileSync(path.join(sweepFolder, "report_curve.json"), "utf8")
);

// --------------------------------------------------
// DATA INJECTED INTO REPORT
// --------------------------------------------------
const sweepData = {
    score: analysis.scores.overall,
    metrics: analysis.scores,
    freqs: reportCurve.freqs,
    mag: reportCurve.mag
};

// --------------------------------------------------
// PUPPETEER
// --------------------------------------------------
(async () => {
    const browser = await puppeteer.launch({
        executablePath: "/usr/bin/chromium",
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--allow-file-access-from-files",
            "--disable-web-security"
        ]
    });

    const page = await browser.newPage();

    // Make data available inside report template
    await page.exposeFunction("getSweepData", () => sweepData);

    await page.goto(REPORT_TEMPLATE, { waitUntil: "networkidle0" });
    await page.waitForSelector('#report-ready[data-ready="1"]');

    await page.screenshot({
        path: OUTPUT_PATH,
        fullPage: true
    });

    await browser.close();
})();
