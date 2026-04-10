import express from "express";
import multer from "multer";
import { inngest } from "../inngest/client.js";
import Document from "../models/document.model.js";
import { connectDB } from "../lib/db.js";

const router = express.Router();

// Store file in memory buffer — we pass it directly to Cloudinary
const ALLOWED_MIMETYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/vnd.ms-powerpoint", // .ppt
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "text/html",
  "text/markdown",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/tiff",
  "image/bmp",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMETYPES.has(file.mimetype)) return cb(null, true);
    cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

// POST /api/documents
router.post("/", upload.single("file"), async (req, res) => {
  try {
    await connectDB();

    const { name, description, userId } = req.body;

    if (!name || !req.file) {
      return res.status(400).json({ error: "name and file are required" });
    }

    // Save document record to DB immediately
    const doc = await Document.create({
      userId: userId || "anonymous",
      name,
      description: description || "",
      status: "pending",
    });

    // Fire Inngest event — pass the file buffer as base64 so Inngest can carry it
    await inngest.send({
      name: "document/process.started",
      data: {
        documentId: doc._id.toString(),
        fileBase64: req.file.buffer.toString("base64"),
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
      },
    });

    res.status(201).json({
      message: "Document upload started",
      documentId: doc._id,
    });
  } catch (err) {
    console.error("[Document Upload Error]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/user/:userId — all documents for a user
router.get("/user/:userId", async (req, res) => {
  try {
    await connectDB();
    const docs = await Document.find({ userId: req.params.userId })
      .select("name description status cloudinaryUrl qdrantCollection chunkCount errorMessage createdAt")
      .sort({ createdAt: -1 });
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/:id — poll status / full detail
router.get("/:id", async (req, res) => {
  try {
    await connectDB();
    const doc = await Document.findById(req.params.id).select(
      "name description status cloudinaryUrl extractedText qdrantCollection chunkCount errorMessage createdAt"
    );
    if (!doc) return res.status(404).json({ error: "Document not found" });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
