import "dotenv/config";
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";

const PDF_PATH = process.argv[2];

if (!PDF_PATH) {
  console.error("Usage: node pdf-to-sheet.js <path-to-pdf>");
  process.exit(1);
}

const pdfId = path.basename(PDF_PATH).replace(/\.pdf$/i, "");
const CITIZENS_PATH = path.resolve("output", `citizens-${pdfId}.json`);

if (!fs.existsSync(CITIZENS_PATH)) {
  console.error(`Not found: ${CITIZENS_PATH}`);
  console.error(`Run \`node pdf-to-gemini.js ${PDF_PATH}\` first to extract voters.`);
  process.exit(1);
}

const SHEETS_DIR = path.resolve("sheets");
fs.mkdirSync(SHEETS_DIR, { recursive: true });
const WORKBOOK_PATH = path.join(SHEETS_DIR, `${pdfId}.xlsx`);

const citizens = JSON.parse(fs.readFileSync(CITIZENS_PATH, "utf8"));
const district = citizens.district || "Karnal";
const constituency = citizens.constituency || "Gharaunda";
const booth = citizens.booth || "";

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet(pdfId.slice(0, 31));
sheet.columns = [
  { header: "Voter ID",      key: "voterId",      width: 15 },
  { header: "Name",          key: "name",         width: 25 },
  { header: "Father's Name", key: "fathersName",  width: 25 },
  { header: "Mobile",        key: "mobile",       width: 15 },
  { header: "District",      key: "district",     width: 15 },
  { header: "Constituency",  key: "constituency", width: 20 },
  { header: "Village",       key: "village",      width: 20 },
  { header: "Booth",         key: "booth",        width: 30 },
];
sheet.getRow(1).font = { bold: true };

for (const v of citizens.voters || []) {
  sheet.addRow({
    voterId:      v.voterId || "",
    name:         v.name || "",
    fathersName:  v.relative_name || "",
    mobile:       "",
    district,
    constituency,
    village:      v.village || "",
    booth,
  });
}

await workbook.xlsx.writeFile(WORKBOOK_PATH);
console.log(`Written: ${WORKBOOK_PATH}  (${sheet.rowCount - 1} voters)`);
