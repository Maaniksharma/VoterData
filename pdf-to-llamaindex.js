import "dotenv/config";
import LlamaCloud from "@llamaindex/llama-cloud";
import fs from "fs";
import path from "path";

const PDF_PATH = process.argv[2];

if (!PDF_PATH) {
  console.error("Usage: node pdf-to-llamaindex.js <path-to-pdf>");
  process.exit(1);
}

const resolvedPath = path.resolve(PDF_PATH);
if (!fs.existsSync(resolvedPath)) {
  console.error(`File not found: ${resolvedPath}`);
  process.exit(1);
}

const client = new LlamaCloud({ apiKey: process.env.LLAMA_CLOUD_API_KEY });

const fileName = path.basename(resolvedPath);

// Step 1: upload file
const fileObj = await client.files.create({
  file: fs.createReadStream(resolvedPath),
  purpose: "extract",
});
console.error(`Uploaded: ${fileObj.id}`);

// Step 2: create extraction job with raw JSON schema
let job = await client.extract.create({
  file_input: fileObj.id,
  configuration: {
    tier: "agentic",
    extraction_target: "per_doc",
    data_schema: {
      type: "object",
      properties: {
        district: {
          type: "string",
          description: "District name from the PDF header",
        },
        constituency: {
          type: "string",
          description: "Assembly constituency name from the PDF header",
        },
        village: {
          type: "string",
          description: "Village or ward name from the PDF header",
        },
        votingBooth: {
          type: "string",
          description: "Polling booth number and name",
        },
        voters: {
          type: "array",
          description: "List of all voters from every page",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Voter's full name" },
              age: { type: "integer", description: "Voter's age" },
              relative_name: { type: "string", description: "Father's, husband's or mother's name" },
              relation: { type: "string", description: "Relation type: Father, Husband, Mother, or Other" },
              gender: { type: "string", description: "male or female" },
              pageNumber: { type: "integer", description: "PDF page number where this voter appears" },
            },
          },
        },
      },
    },
    cite_sources: false,
    confidence_scores: false,
    system_prompt:
      "Extract all voter records from every page. पिता का नाम = Father, पति का नाम = Husband, माता का नाम = Mother. पुरुष = male, महिला = female. Do not skip any voter.",
  },
});
console.error(`Extraction job: ${job.id}`);

// Step 3: poll until done
while (!["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) {
  await new Promise((r) => setTimeout(r, 3000));
  job = await client.extract.get(job.id);
  console.error(`Status: ${job.status}`);
}

if (job.status !== "COMPLETED") {
  console.error("Extraction failed:", job);
  process.exit(1);
}

const data = job.extract_result;
data.voters = data.voters.map((v) => ({ ...v, sourceFile: fileName }));

const finalData = JSON.stringify(data, null, 2)

console.log(finalData.voters.length, "voters extracted");
