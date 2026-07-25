import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import { db } from '../index';

const router = Router();

// Apply verifyToken middleware to the whole router so only logged-in users can access
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

export default router;
