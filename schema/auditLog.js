import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ["CREATE", "UPDATE", "DELETE"],
      required: true,
    },
    pokemonName: {
      type: String,
      required: true,
      index: true,
    },
    sourceIp: {
      type: String,
      required: true,
    },
    statusCode: {
      type: Number,
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("AuditLog", auditLogSchema);
