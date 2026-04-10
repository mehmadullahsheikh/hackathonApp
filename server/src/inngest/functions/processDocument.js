import { inngest } from "../client.js";
import Document from "../../models/document.model.js";
import { cloudinary } from "../../lib/cloudinary.js";
import { connectDB } from "../../lib/db.js";
import { ENV } from "../../lib/env.js";
import { ensureCollection, upsertVectors } from "../../lib/qdrant.js";

// ─── Chunking helpers ────────────────────────────────────────────────────────

const CHUNK_SIZE = 500;   // target chars per chunk
const CHUNK_OVERLAP = 80; // overlap between chunks

/**
 * Split text into overlapping chunks by paragraph, then by size.
 */
function chunkText(text) {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let current = "";

  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > CHUNK_SIZE && current.length > 0) {
      chunks.push(current.trim());
      // keep tail for overlap
      const words = current.split(" ");
      current = words.slice(-Math.floor(CHUNK_OVERLAP / 5)).join(" ") + "\n\n" + para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ─── Jina Embeddings ─────────────────────────────────────────────────────────

const JINA_BATCH_SIZE = 50;
const JINA_MODEL = "jina-embeddings-v3";
const JINA_DIM = 1024;

/**
 * Embed an array of text strings using Jina Embeddings API.
 * Returns float32 vectors, one per input string.
 */
async function embedChunks(texts) {
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += JINA_BATCH_SIZE) {
    const batch = texts.slice(i, i + JINA_BATCH_SIZE);

    const response = await fetch("https://api.jina.ai/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ENV.jina_api_key}`,
      },
      body: JSON.stringify({
        model: JINA_MODEL,
        task: "retrieval.passage",
        dimensions: JINA_DIM,
        input: batch,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Jina API error (batch ${i}): ${response.status} — ${err}`);
    }

    const json = await response.json();
    allEmbeddings.push(...json.data.map((d) => d.embedding));
  }

  return allEmbeddings;
}

// ─── Inngest Function ─────────────────────────────────────────────────────────

export const processDocument = inngest.createFunction(
  {
    id: "process-document",
    triggers: [{ event: "document/process.started" }],
    retries: 2,
  },
  async ({ event, step }) => {
    const { documentId, fileBase64, fileName } = event.data;

    // ─── Step 1: Upload to Cloudinary ────────────────────────────────────────
    const cloudinaryResult = await step.run("upload-to-cloudinary", async () => {
      await connectDB();
      await Document.findByIdAndUpdate(documentId, { status: "uploading" });

      const buffer = Buffer.from(fileBase64, "base64");

      const uploadResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            resource_type: "raw",
            folder: "documents",
            public_id: `${documentId}_${fileName}`,
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        uploadStream.end(buffer);
      });

      await Document.findByIdAndUpdate(documentId, {
        cloudinaryUrl: uploadResult.secure_url,
        cloudinaryPublicId: uploadResult.public_id,
        status: "extracting",
      });

      return {
        cloudinaryUrl: uploadResult.secure_url,
        publicId: uploadResult.public_id,
      };
    });

    // ─── Step 2: Extract text via Python / Docling ───────────────────────────
    const extractionResult = await step.run("extract-with-docling", async () => {
      await connectDB();

      const pythonUrl = ENV.python_service_url || "http://localhost:8000";

      const response = await fetch(`${pythonUrl}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cloudinary_url: cloudinaryResult.cloudinaryUrl,
          document_id: documentId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Python service error: ${response.status} — ${errorText}`);
      }

      const { extracted_text } = await response.json();

      await Document.findByIdAndUpdate(documentId, {
        extractedText: extracted_text,
        status: "embedding",
      });

      return { extracted_text };
    });

    // ─── Step 3: Chunk + Embed with Jina ─────────────────────────────────────
    const embeddingResult = await step.run("chunk-and-embed", async () => {
      const chunks = chunkText(extractionResult.extracted_text);
      if (chunks.length === 0) throw new Error("No text chunks produced from extracted content");

      const embeddings = await embedChunks(chunks);

      return { chunks, embeddings };
    });

    // ─── Step 4: Index vectors in Qdrant ─────────────────────────────────────
    await step.run("index-in-qdrant", async () => {
      await connectDB();

      const collectionName = `doc_${documentId}`;

      // Create collection if it doesn't exist
      await ensureCollection(collectionName, JINA_DIM);

      // Build Qdrant points
      const points = embeddingResult.chunks.map((text, idx) => ({
        id: idx,
        vector: embeddingResult.embeddings[idx],
        payload: {
          text,
          chunkIndex: idx,
          documentId,
        },
      }));

      await upsertVectors(collectionName, points);

      // Persist Qdrant connection info on the document for future chat retrieval
      await Document.findByIdAndUpdate(documentId, {
        status: "done",
        qdrantCollection: collectionName,
        chunkCount: points.length,
      });

      return { collectionName, chunkCount: points.length };
    });

    return {
      documentId,
      cloudinaryUrl: cloudinaryResult.cloudinaryUrl,
      extractedLength: extractionResult.extracted_text?.length ?? 0,
      chunkCount: embeddingResult.chunks.length,
    };
  }
);
