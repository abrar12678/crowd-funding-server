import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import { db } from '../index';

const router = Router();

// -----------------------------------------------
// PUBLIC ROUTES (no auth required)
// -----------------------------------------------

// GET /api/campaigns/top — Top 6 funded campaigns (public, no auth)
router.get('/top', async (req: Request, res: Response): Promise<void> => {
  try {
    const topCampaigns = await db
      .collection('campaigns')
      .find({ status: 'approved' })
      .sort({ raisedAmount: -1 })
      .limit(6)
      .toArray();

    res.status(200).json(topCampaigns);
  } catch (error) {
    console.error('Error fetching top campaigns:', error);
    res.status(500).json({ error: 'Internal server error while fetching top campaigns.' });
  }
});

// -----------------------------------------------
// PROTECTED ROUTES (auth required)
// -----------------------------------------------

// Apply verifyToken middleware to all routes below this line
router.use(verifyToken);

// POST /api/campaigns - Create a new campaign
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      title,
      story,
      category,
      fundingGoal,
      minimumContribution,
      deadline,
      rewardInfo,
      campaignImageUrl,
    } = req.body;

    // 1. Input Validation: Check if all fields are provided
    if (
      !title ||
      !story ||
      !category ||
      fundingGoal === undefined || fundingGoal === null ||
      minimumContribution === undefined || minimumContribution === null ||
      !deadline ||
      !rewardInfo ||
      !campaignImageUrl
    ) {
      res.status(400).json({
        error: 'All fields (title, story, category, fundingGoal, minimumContribution, deadline, rewardInfo, campaignImageUrl) are required.',
      });
      return;
    }

    // 2. Get creator details from token
    const creatorEmail = (req as any).user.email;
    const creatorName = (req as any).user.name || "Unknown Creator";

    // 3. Create campaign document
    const campaignDoc = {
      title,
      story,
      category,
      fundingGoal: Number(fundingGoal),
      minimumContribution: Number(minimumContribution),
      deadline,
      rewardInfo,
      campaignImageUrl,
      creatorEmail,
      creatorName,
      raisedAmount: 0,
      status: "pending",
      createdAt: new Date(),
    };

    // 4. Insert into database
    const result = await db.collection('campaigns').insertOne(campaignDoc);

    // 5. Return success response (201 status)
    res.status(201).json({
      message: 'Campaign created successfully',
      insertedId: result.insertedId,
      campaign: {
        _id: result.insertedId,
        ...campaignDoc,
      },
    });
  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json({ error: 'Internal server error while creating campaign.' });
  }
});

// GET /api/campaigns/my-campaigns - Get logged-in creator's campaigns sorted by deadline descending
router.get('/my-campaigns', async (req: Request, res: Response): Promise<void> => {
  try {
    const creatorEmail = (req as any).user.email;

    if (!creatorEmail) {
      res.status(401).json({ error: 'Unauthorized. Email not found in token.' });
      return;
    }

    const campaigns = await db
      .collection('campaigns')
      .find({ creatorEmail })
      .sort({ deadline: -1 })
      .toArray();

    res.status(200).json(campaigns);
  } catch (error) {
    console.error('Error fetching creator campaigns:', error);
    res.status(500).json({ error: 'Internal server error while fetching campaigns.' });
  }
});

// GET /api/campaigns/approved - Get all approved campaigns whose deadline has not passed sorted by newest first
router.get('/approved', async (req: Request, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const nowISO = now.toISOString();

    const approvedCampaigns = await db
      .collection('campaigns')
      .find({
        status: 'approved',
        $or: [
          { deadline: { $gte: now } },
          { deadline: { $gte: nowISO } },
        ],
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json(approvedCampaigns);
  } catch (error) {
    console.error('Error fetching approved campaigns:', error);
    res.status(500).json({ error: 'Internal server error while fetching approved campaigns.' });
  }
});

export default router;
