import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { connectDB } from "../lib/db.js";
import { qdrant } from "../lib/qdrant.js";
import { ENV } from "../lib/env.js";
import Document from "../models/document.model.js";

const router = express.Router();
const genAI = new GoogleGenerativeAI(ENV.gemini_api_key);

const TOP_K = 8;
const JINA_MODEL = "jina-embeddings-v3";
const JINA_DIM = 1024;

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

// POST /api/flow/:documentId
router.post("/:documentId", async (req, res) => {
  const { query } = req.body;

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return res.status(400).json({ error: "query is required" });
  }

  try {
    await connectDB();

    // 1. Fetch document
    const doc = await Document.findById(req.params.documentId).select(
      "name status qdrantCollection"
    );
    if (!doc) return res.status(404).json({ error: "Document not found" });
    if (doc.status !== "done") {
      return res.status(409).json({
        error: `Document not ready (status: ${doc.status})`,
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
      return res.json({ flow: {}, message: "No relevant content found in document." });
    }

    // 4. Build context
    const context = searchResults
      .map((r, i) => `[Excerpt ${i + 1}]\n${r.payload.text}`)
      .join("\n\n---\n\n");

    // 5. Ask Gemini to generate a structured flow
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `You are an expert task planner. Based on the document excerpts and the user's goal, generate a clear, actionable step-by-step flow to achieve the goal.

Document: "${doc.name}"
User Goal: "${query}"

--- DOCUMENT EXCERPTS ---
${context}
--- END EXCERPTS ---

Return ONLY a valid JSON object in this exact format (no markdown, no explanation, just raw JSON):
{
  "title": "Short title for this plan",
  "description": "One sentence describing what this plan achieves",
  "flow": {
    "step1": {
      "name": "Step name",
      "do": "Detailed action to take",
      "time": "Estimated time (e.g. 30 minutes, 2 hours)"
    },
    "step2": {
      "name": "Step name",
      "do": "Detailed action to take",
      "time": "Estimated time"
    }
  }
}

Generate between 3 and 8 steps based on complexity. Use only information from the document excerpts.`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();

    // Strip markdown code fences if Gemini wraps in ```json ... ```
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({
        error: "Gemini returned invalid JSON",
        raw,
      });
    }

    res.json(parsed);
  } catch (err) {
    console.error("[Flow Error]", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
