import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { verifyToken } from '../middleware/auth';
import { db } from '../index';

const router = Router();

// Protect all contribution routes with JWT verification
router.use(verifyToken);

// POST /api/contributions - Make a new contribution (for Supporters)
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Get supporter details from token
    const supporterEmail = (req as any).user.email;
    const supporterName = (req as any).user.name || "Unknown Supporter";

    if (!supporterEmail) {
      res.status(401).json({ error: 'Unauthorized. Email not found in token.' });
      return;
    }

    // 2. Extract and validate fields from req.body
    const { campaignId, campaignTitle, amount } = req.body;
    const contributionAmount = Number(amount);

    if (!campaignId || !campaignTitle || !amount || isNaN(contributionAmount) || contributionAmount <= 0) {
      res.status(400).json({ error: 'campaignId, campaignTitle, and a valid positive amount are required.' });
      return;
    }

    // 3. Business Logic - Check Credits in users collection
    const supporter = await db.collection('users').findOne({ email: supporterEmail });

    if (!supporter) {
      res.status(404).json({ error: 'Supporter user profile not found.' });
      return;
    }

    const currentCredits = Number(supporter.credits || 0);

    if (currentCredits < contributionAmount) {
      res.status(400).json({ error: 'Insufficient credits.' });
      return;
    }

    // 4. Business Logic - Deduct Credits using $inc
    await db.collection('users').updateOne(
      { email: supporterEmail },
      { $inc: { credits: -contributionAmount } }
    );

    // 5. Find campaign to get creatorEmail & creatorName
    const campaignIdQuery = typeof campaignId === 'string' && ObjectId.isValid(campaignId)
      ? new ObjectId(campaignId)
      : campaignId;

    const campaign = await db.collection('campaigns').findOne({ _id: campaignIdQuery });

    const creatorEmail = campaign?.creatorEmail || '';
    const creatorName = campaign?.creatorName || 'Unknown Creator';

    // 6. Create contribution document
    const contributionDoc = {
      campaignId,
      campaignTitle,
      amount: contributionAmount,
      supporterEmail,
      supporterName,
      creatorEmail,
      creatorName,
      status: 'pending',
      date: new Date(),
    };

    // 7. Insert contribution document into contributions collection
    const result = await db.collection('contributions').insertOne(contributionDoc);

    // 8. Return 201 success message
    res.status(201).json({
      message: 'Contribution submitted successfully.',
      insertedId: result.insertedId,
      contribution: {
        _id: result.insertedId,
        ...contributionDoc,
      },
    });
  } catch (error) {
    console.error('Error creating contribution:', error);
    res.status(500).json({ error: 'Internal server error while processing contribution.' });
  }
});

// Route 1: GET /api/contributions/pending-for-me (Show pending contributions for creator)
router.get('/pending-for-me', async (req: Request, res: Response): Promise<void> => {
  try {
    const creatorEmail = (req as any).user.email;

    if (!creatorEmail) {
      res.status(401).json({ error: 'Unauthorized. Email not found in token.' });
      return;
    }

    const pendingContributions = await db
      .collection('contributions')
      .find({ creatorEmail: creatorEmail, status: 'pending' })
      .sort({ date: -1, createdAt: -1 })
      .toArray();

    res.status(200).json(pendingContributions);
  } catch (error) {
    console.error('Error fetching pending contributions:', error);
    res.status(500).json({ error: 'Internal server error while fetching pending contributions.' });
  }
});

// Route 2: PATCH /api/contributions/approve/:contributionId (Approve contribution)
router.patch('/approve/:contributionId', async (req: Request, res: Response): Promise<void> => {
  try {
    const contributionIdParam = req.params.contributionId;
    const contributionId = Array.isArray(contributionIdParam) ? contributionIdParam[0] : contributionIdParam;

    if (!contributionId || typeof contributionId !== 'string' || !ObjectId.isValid(contributionId)) {
      res.status(400).json({ error: 'Invalid contribution ID format.' });
      return;
    }

    // 1. Find the contribution
    const contribution = await db
      .collection('contributions')
      .findOne({ _id: new ObjectId(contributionId) });

    if (!contribution) {
      res.status(404).json({ error: 'Contribution not found.' });
      return;
    }

    // 2. Check if status is already not pending
    if (contribution.status !== 'pending') {
      res.status(400).json({ error: 'Already processed' });
      return;
    }

    // 3. Update contribution status to "approved"
    await db.collection('contributions').updateOne(
      { _id: new ObjectId(contributionId) },
      { $set: { status: 'approved', approvedAt: new Date() } }
    );

    // 4. Increase raisedAmount of the campaign using $inc
    const rawCampaignId = contribution.campaignId;
    const campaignIdQuery = typeof rawCampaignId === 'string' && ObjectId.isValid(rawCampaignId)
      ? new ObjectId(rawCampaignId)
      : rawCampaignId;

    await db.collection('campaigns').updateOne(
      { _id: campaignIdQuery },
      { $inc: { raisedAmount: Number(contribution.amount) || 0 } }
    );

    res.status(200).json({
      message: 'Contribution approved successfully and campaign raised amount updated.',
    });
  } catch (error) {
    console.error('Error approving contribution:', error);
    res.status(500).json({ error: 'Internal server error while approving contribution.' });
  }
});

// Route 3: PATCH /api/contributions/reject/:contributionId (Reject contribution & refund credits)
router.patch('/reject/:contributionId', async (req: Request, res: Response): Promise<void> => {
  try {
    const contributionIdParam = req.params.contributionId;
    const contributionId = Array.isArray(contributionIdParam) ? contributionIdParam[0] : contributionIdParam;

    if (!contributionId || typeof contributionId !== 'string' || !ObjectId.isValid(contributionId)) {
      res.status(400).json({ error: 'Invalid contribution ID format.' });
      return;
    }

    // 1. Find the contribution
    const contribution = await db
      .collection('contributions')
      .findOne({ _id: new ObjectId(contributionId) });

    if (!contribution) {
      res.status(404).json({ error: 'Contribution not found.' });
      return;
    }

    // 2. Check if status is already not pending
    if (contribution.status !== 'pending') {
      res.status(400).json({ error: 'Already processed' });
      return;
    }

    // 3. Update contribution status to "rejected"
    await db.collection('contributions').updateOne(
      { _id: new ObjectId(contributionId) },
      { $set: { status: 'rejected', rejectedAt: new Date() } }
    );

    // 4. Refund credits to the supporter using $inc
    if (contribution.supporterEmail) {
      await db.collection('users').updateOne(
        { email: contribution.supporterEmail },
        { $inc: { credits: Number(contribution.amount) || 0 } }
      );
    }

    res.status(200).json({
      message: 'Contribution rejected successfully and credits refunded to supporter.',
    });
  } catch (error) {
    console.error('Error rejecting contribution:', error);
    res.status(500).json({ error: 'Internal server error while rejecting contribution.' });
  }
});

export default router;
