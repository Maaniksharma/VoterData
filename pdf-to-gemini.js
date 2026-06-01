import 'dotenv/config';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { PDFDocument } from "pdf-lib";
import mongoose from "mongoose";
import VoterList from "./schema.js";
import fs from "fs";
import path from "path";

const apiKey = process.env.GEMINI_API_KEY;

const PDF_PATH = process.argv[2];

if (!PDF_PATH) {
  console.error("Usage: node pdf-to-gemini.js <path-to-pdf>");
  process.exit(1);
}

const resolvedPath = path.resolve(PDF_PATH);
if (!fs.existsSync(resolvedPath)) {
  console.error(`File not found: ${resolvedPath}`);
  process.exit(1);
}

const PAGE_PROMPT = (pageNumber) => `
Extract all voter records from this single PDF page (page ${pageNumber}) and return a JSON object:

{
  "voters": [
    {
      "name": "voter name in english",
      "relative_name": "father/husband/mother name in english",
      "relation": "Father | Husband | Mother | Other",
      "gender": "male",
      "age": "voter age in integer",
      "houseNumber": "voter's house number if available",
      "pageNumber": ${pageNumber}
    }
  ]
}

Rules:
- relation: exactly "Father in english" | "Husband in english" | "Mother in english" | "Other in english"
  (पिता का नाम = Father, पति का नाम = Husband, माता का नाम = Mother)
- gender: exactly "male" | "female"  (पुरुष = male, महिला = female)
- If this page has no voter records return { "voters": [] }
- Return ONLY valid JSON, no markdown or explanation
`;

const LOCATION_PROMPT = `
Extract location info from this voter list PDF page header and return JSON:
{
  "district": "district name in english",
  "constituency": "assembly constituency full name in english",
  "village": "village or ward name in english",
  "ward": "ward name in english",
  "votingBooth": "polling booth number and name in english"
}
Return ONLY valid JSON, no markdown or explanation.
`;

async function extractPageAsBase64(pdfBytes, pageIndex) {
  const srcPdf = await PDFDocument.load(pdfBytes);
  const newPdf = await PDFDocument.create();
  const [page] = await newPdf.copyPages(srcPdf, [pageIndex]);
  newPdf.addPage(page);
  const singlePageBytes = await newPdf.save();
  return Buffer.from(singlePageBytes).toString("base64");
}

async function callGemini(model, base64Page, prompt) {
  const result = await model.generateContent([
    { inlineData: { mimeType: "application/pdf", data: base64Page } },
    prompt,
  ]);
  return JSON.parse(result.response.text());
}

async function main() {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    generationConfig: { responseMimeType: "application/json" },
  });

  const pdfBytes = fs.readFileSync(resolvedPath);
  const srcPdf = await PDFDocument.load(pdfBytes);
  const totalPages = srcPdf.getPageCount();
  const fileName = path.basename(resolvedPath);

  console.error(`Processing ${totalPages} pages from ${fileName}...`);

  // extract location from page 1
  const page1Base64 = await extractPageAsBase64(pdfBytes, 0);
  const location = await callGemini(model, page1Base64, LOCATION_PROMPT);
  console.error("Location:", JSON.stringify(location));

  // extract voters page by page
  const allVoters = [];
  for (let i = 0; i < totalPages; i++) {
    const pageNumber = i + 1;
    process.stderr.write(`  Page ${pageNumber}/${totalPages}...\r`);
    try {
      const base64Page = await extractPageAsBase64(pdfBytes, i);
      const { voters } = await callGemini(model, base64Page, PAGE_PROMPT(pageNumber));
      allVoters.push(...voters);
    } catch {
      // skip non-voter pages (cover, map, summary)
    }
  }

  console.error(`\nTotal voters extracted: ${allVoters.length}`);

  // save to MongoDB — upsert by sourceFile so re-running updates instead of duplicating
  await mongoose.connect(process.env.MONGODB_URI);
  const doc = await VoterList.findOneAndUpdate(
    { sourceFile: fileName },
    { ...location, sourceFile: fileName, voters: allVoters },
    { upsert: true, new: true }
  );
  console.error(`Saved to DB with id: ${doc._id}`);
  await mongoose.disconnect();
}

main().catch(console.error);
