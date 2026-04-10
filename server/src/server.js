import express from "express"
import cors from "cors"
import "dotenv/config"
import { ENV } from "./lib/env.js";
import { connectDB } from "./lib/db.js";
import { inngestHandler } from "./inngest/index.js";
import webhookRoutes from "./routes/webhook.js";
import documentRoutes from "./routes/document.js";
import chatRoutes from "./routes/chat.js";
import flowRoutes from "./routes/flow.js";

const app = express();

// Allow requests from the frontend dev server
app.use(cors());

// Must be BEFORE express.json() — once raw reads the body, json will skip it
app.use("/api/webhooks/clerk", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
connectDB();

app.use("/api/webhooks", webhookRoutes);

app.use("/api/inngest", inngestHandler);
app.use("/api/documents", documentRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/flow", flowRoutes);

app.get("/", (_req, res) => {
    res.send("app is up and running")
})

if ("development" === ENV?.node_env) {
    const activePort = ENV.port || 5000;
    app.listen(activePort, () => {
        console.log(`server is running at: http://localhost:${activePort}`)
    })
}

export default app;

