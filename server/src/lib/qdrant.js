import { QdrantClient } from "@qdrant/js-client-rest";
import { ENV } from "./env.js";

export const qdrant = new QdrantClient({
  url: ENV.qdrant_url,
  apiKey: ENV.qdrant_api_key,
});

/**
 * Create a Qdrant collection for a document if it doesn't already exist.
 * @param {string} collectionName - e.g. "doc_664abc123"
 * @param {number} vectorSize - embedding dimension (1024 for jina-embeddings-v3)
 */
export async function ensureCollection(collectionName, vectorSize = 1024) {
  const existing = await qdrant.getCollections();
  const exists = existing.collections.some((c) => c.name === collectionName);
  if (!exists) {
    await qdrant.createCollection(collectionName, {
      vectors: {
        size: vectorSize,
        distance: "Cosine",
      },
    });
  }
}

/**
 * Upsert a batch of vectors into a Qdrant collection.
 * @param {string} collectionName
 * @param {{ id: number, vector: number[], payload: object }[]} points
 */
export async function upsertVectors(collectionName, points) {
  await qdrant.upsert(collectionName, {
    wait: true,
    points,
  });
}
