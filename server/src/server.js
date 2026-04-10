import express from "express"
import "dotenv/config"
import { ENV } from "./lib/env.js";
import { connectDB } from "./lib/db.js";
import { inngestHandler } from "./inngest/index.js";
import webhookRoutes from "./routes/webhook.js";

const app = express();

app.use(express.json())
connectDB()

app.use("/api/inngest", inngestHandler);

app.use("/api/webhooks", webhookRoutes);

app.get("/", (_req,res) => {
    res.send("app is up and running")
})

app.listen(ENV.port || 5000, () => {
    console.log(`server is running on: http://localhost:${ENV.port || 5000}`)
})

