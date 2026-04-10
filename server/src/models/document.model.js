import mongoose from "mongoose";

const documentSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },        // Clerk user ID
    name: { type: String, required: true },
    description: { type: String, default: "" },
    cloudinaryUrl: { type: String, default: null },
    cloudinaryPublicId: { type: String, default: null },
    status: {
      type: String,
      enum: ["pending", "uploading", "extracting", "embedding", "indexing", "done", "failed"],
      default: "pending",
    },
    extractedText: { type: String, default: null },
    errorMessage: { type: String, default: null },
    // Qdrant — stored so users can chat with this document again later
    qdrantCollection: { type: String, default: null }, // e.g. "doc_664abc123"
    chunkCount: { type: Number, default: 0 },           // number of vectors indexed
  },
  { timestamps: true }
);

export default mongoose.model("Document", documentSchema);
