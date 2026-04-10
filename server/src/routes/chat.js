import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { connectDB } from "../lib/db.js";
import { qdrant } from "../lib/qdrant.js";
import { ENV } from "../lib/env.js";
import Document from "../models/document.model.js";

const router = express.Router();
const genAI = new GoogleGenerativeAI(ENV.gemini_api_key);

const TOP_K = 6; // number of Qdrant results to use as context
const JINA_MODEL = "jina-embeddings-v3";
const JINA_DIM = 1024;

// ─── Embed a single query with Jina ──────────────────────────────────────────

async function embedQuery(query) {
  const response = await fetch("https://api.jina.ai/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ENV.jina_api_key}`,
    },
    body: JSON.stringify({
      model: JINA_MODEL,
      task: "retrieval.query",
      dimensions: JINA_DIM,
      input: [query],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Jina embed error: ${response.status} — ${err}`);
  }

  const json = await response.json();
  return json.data[0].embedding;
}

// ─── POST /api/chat/:documentId ───────────────────────────────────────────────

router.post("/:documentId", async (req, res) => {
  const { query } = req.body;

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return res.status(400).json({ error: "query is required" });
  }

  try {
    await connectDB();

    // 1. Fetch document — get qdrantCollection
    const doc = await Document.findById(req.params.documentId).select(
      "name status qdrantCollection"
    );

    if (!doc) return res.status(404).json({ error: "Document not found" });

    if (doc.status !== "done") {
      return res.status(409).json({
        error: `Document is not ready yet (status: ${doc.status}). Please wait.`,
      });
    }

    if (!doc.qdrantCollection) {
      return res.status(409).json({ error: "Document has no Qdrant collection" });
    }

    // 2. Embed the user query
    const queryVector = await embedQuery(query.trim());

    // 3. Similarity search in Qdrant
    const searchResults = await qdrant.search(doc.qdrantCollection, {
      vector: queryVector,
      limit: TOP_K,
      with_payload: true,
    });

    if (searchResults.length === 0) {
      return res.json({
        answer: "I couldn't find any relevant content in this document for your question.",
        sources: [],
      });
    }

    // 4. Build context from top-k chunks
    const context = searchResults
      .map((r, i) => `[Chunk ${i + 1}]\n${r.payload.text}`)
      .join("\n\n---\n\n");

    // 5. Call Gemini with context + query
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `You are a helpful assistant that answers questions based strictly on the provided document excerpts.
If the answer cannot be found in the excerpts, say "I don't have enough information in this document to answer that."

Document: "${doc.name}"

--- DOCUMENT EXCERPTS ---
${context}
--- END EXCERPTS ---

User question: ${query}

Answer:`

    const result = await model.generateContent(prompt);
    const answer = result.response.text();

    res.json({
      answer,
      sources: searchResults.map((r) => ({
        chunkIndex: r.payload.chunkIndex,
        score: Math.round(r.score * 1000) / 1000,
        text: r.payload.text.slice(0, 200) + (r.payload.text.length > 200 ? "…" : ""),
      })),
    });
  } catch (err) {
    console.error("[Chat Error]", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
