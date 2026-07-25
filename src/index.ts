import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient, ServerApiVersion, ObjectId, Db } from 'mongodb';
import authRoutes from './routes/auth';
import campaignRoutes from './routes/campaigns';
import dashboardRoutes from './routes/dashboard';
import contributionRoutes from './routes/contributions';
import paymentRoutes from './routes/payments';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
const dbName = process.env.DB_NAME || "crowdfunding_db";

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

export let db: Db;

async function connectDB() {
    try {
        await client.connect();
        db = client.db(dbName);
        console.log(` Successfully connected to MongoDB! (Database: ${dbName})`);
    } catch (error) {
        console.error("MongoDB connection failed:", error);
    }
}

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/contributions', contributionRoutes);
app.use('/api/payments', paymentRoutes);

app.get('/', async (req, res) => {
    try {
        const collections = await db.listCollections().toArray();
        res.json({
            message: 'Server is running & DB Connected!',
            database: dbName,
            yourCollections: collections.map(c => c.name)
        });
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch data from database" });
    }
});

async function startServer() {
    await connectDB();
    app.listen(port, () => {
        console.log(`🚀 Server is running on port: http://localhost:${port}`);
    });
}

startServer();