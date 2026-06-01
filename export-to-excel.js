import "dotenv/config";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import path from "path";
import VoterList from "./schema.js";

const OUTPUT_FILE = process.argv[2] || "voters.xlsx";

await mongoose.connect(process.env.MONGODB_URI);

const records = await VoterList.find({}).lean();

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet("Voters");

sheet.columns = [
  { header: "Name",          key: "name",          width: 25 },
  { header: "Father's Name", key: "fathersName",   width: 25 },
  { header: "Mobile",        key: "mobile",        width: 15 },
  { header: "District",      key: "district",      width: 15 },
  { header: "Constituency",  key: "constituency",  width: 20 },
  { header: "Village",       key: "village",       width: 20 },
  { header: "Booth",         key: "booth",         width: 25 },
];

// bold header row
sheet.getRow(1).font = { bold: true };

for (const record of records) {
  for (const voter of record.voters) {
    sheet.addRow({
      name:         voter.name,
      fathersName:  voter.relative_name,
      mobile:       voter.phone || "",
      district:     record.district,
      constituency: record.constituency,
      village:      record.village,
      booth:        record.votingBooth,
    });
  }
}

const outputPath = path.resolve(OUTPUT_FILE);
await workbook.xlsx.writeFile(outputPath);
console.log(`Excel saved: ${outputPath}  (${sheet.rowCount - 1} voters)`);

await mongoose.disconnect();
