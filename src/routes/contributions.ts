import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { verifyToken } from '../middleware/auth';
import { db } from '../index';

const router = Router();

// Protect all contribution routes with JWT verification
router.use(verifyToken);

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
