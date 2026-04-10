import express from "express"
import "dotenv/config"
import { ENV } from "./lib/env.js";
import { connectDB } from "./lib/db.js";
import { inngestHandler } from "./inngest/index.js";
import webhookRoutes from "./routes/webhook.js";

const app = express();


// Must be BEFORE express.json() — once raw reads the body, json will skip it
app.use("/api/webhooks/clerk", express.raw({ type: "application/json" }));

app.use(express.json());
connectDB();

app.use("/api/webhooks", webhookRoutes);

app.use("/api/inngest", inngestHandler);

app.get("/", (_req,res) => {
    res.send("app is up and running")
})

if ( "development" === ENV?.node_env) {
    const activePort = ENV.port || 5000;
    app.listen(activePort, () => {
        console.log(`server is running at: http://localhost:${activePort}`)
    })
}

export default app;

