import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { verifyToken, verifyCreator } from '../middleware/auth';
import { db } from '../index';

const router = Router();

// GET /api/campaigns/top - Top 6 (PUBLIC)
router.get("/top", async (req, res) => {
  try {
    const top = await db.collection("campaigns").find({ status: "approved" }).sort({ raisedAmount: -1 }).limit(6).toArray();
    res.status(200).json(top);
  } catch (e) {
    res.status(500).json({ error: "Internal server error." });
  }
});

// Apply verifyToken middleware to the whole router so only logged-in users can access
router.use(verifyToken);

// POST /api/campaigns - Create a new campaign (Creator only)
router.post('/', verifyCreator, async (req: Request, res: Response): Promise<void> => {
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

// GET /api/campaigns/my-campaigns - Get logged-in creator's campaigns (Creator only)
router.get('/my-campaigns', verifyCreator, async (req: Request, res: Response): Promise<void> => {
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

// GET /api/campaigns/approved - Get all approved campaigns whose deadline has not passed (all authenticated users)
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

// PATCH /api/campaigns/update/:id — Update campaign (Creator only)
router.patch('/update/:id', verifyCreator, async (req: Request, res: Response): Promise<void> => {
  try {
    const idParam = req.params.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;
    const creatorEmail = (req as any).user.email;

    if (!id || typeof id !== 'string' || !ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid campaign ID format.' });
      return;
    }

    const { title, story, rewardInfo } = req.body;

    if (!title && !story && !rewardInfo) {
      res.status(400).json({ error: 'At least one field (title, story, rewardInfo) is required to update.' });
      return;
    }

    const campaignIdQuery = new ObjectId(id);

    // Verify the campaign belongs to this creator
    const campaign = await db.collection('campaigns').findOne({ _id: campaignIdQuery });
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found.' });
      return;
    }
    if (campaign.creatorEmail !== creatorEmail) {
      res.status(403).json({ error: 'You can only update your own campaigns.' });
      return;
    }

    const updateFields: Record<string, string> = {};
    if (title) updateFields.title = title;
    if (story) updateFields.story = story;
    if (rewardInfo) updateFields.rewardInfo = rewardInfo;

    await db.collection('campaigns').updateOne(
      { _id: campaignIdQuery },
      { $set: { ...updateFields, updatedAt: new Date() } }
    );

    res.status(200).json({ message: 'Campaign updated successfully.' });
  } catch (error) {
    console.error('Error updating campaign:', error);
    res.status(500).json({ error: 'Internal server error while updating campaign.' });
  }
});

// DELETE /api/campaigns/delete/:id — Delete campaign + refund approved contributors (Creator only)
router.delete('/delete/:id', verifyCreator, async (req: Request, res: Response): Promise<void> => {
  try {
    const idParam = req.params.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;
    const creatorEmail = (req as any).user.email;

    if (!id || typeof id !== 'string' || !ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid campaign ID format.' });
      return;
    }

    const campaignIdQuery = new ObjectId(id);

    // 1. Find the campaign
    const campaign = await db.collection('campaigns').findOne({ _id: campaignIdQuery });
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found.' });
      return;
    }

    // 2. Verify ownership
    if (campaign.creatorEmail !== creatorEmail) {
      res.status(403).json({ error: 'You can only delete your own campaigns.' });
      return;
    }

    const campaignIdStr = campaign._id.toString();

    // 3. Find all approved contributions for this campaign and refund
    const approvedContributions = await db
      .collection('contributions')
      .find({
        campaignId: { $in: [id, campaignIdStr] },
        status: 'approved',
      } as any)
      .toArray();

    for (const contribution of approvedContributions) {
      if (contribution.supporterEmail && contribution.amount) {
        await db.collection('users').updateOne(
          { email: contribution.supporterEmail },
          { $inc: { credits: Number(contribution.amount) || 0 } }
        );
      }
    }

    // 4. Delete all contributions related to this campaign
    await db.collection('contributions').deleteMany({
      campaignId: { $in: [id, campaignIdStr] },
    } as any);

    // 5. Delete the campaign
    await db.collection('campaigns').deleteOne({ _id: campaign._id });

    res.status(200).json({
      message: 'Campaign deleted successfully. Approved contributions refunded to supporters.',
    });
  } catch (error) {
    console.error('Error deleting campaign:', error);
    res.status(500).json({ error: 'Internal server error while deleting campaign.' });
  }
});

export default router;
