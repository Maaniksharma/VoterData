import mongoose from "mongoose";

const voterSchema = new mongoose.Schema(
  {
    district: { type: String },
    constituency: { type: String },
    village: { type: String },
    ward: { type: String },
    votingBooth: { type: String },
    pollingStation: { type: String },
    sourceFile: { type: String, unique: true },
    voters: [
      {
        name: { type: String, required: true },
        phone: { type: String },
        relative_name: { type: String },
        relation: { type: String, enum: ["Father", "Husband", "Mother", "Other"] },
        gender: { type: String, enum: ["male", "female"] },
        age: { type: Number },
        houseNumber: { type: String },
        pageNumber: { type: Number },
      },
    ],
  },
  { timestamps: true }
);

const VoterList = mongoose.model("VoterList", voterSchema);

export default VoterList;
