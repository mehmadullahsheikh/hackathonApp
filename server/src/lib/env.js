import "dotenv/config"

export const ENV = {
    port: process.env.PORT,
    db_url: process.env.MONGO_URI,
}