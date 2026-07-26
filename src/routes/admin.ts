import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { verifyToken } from '../middleware/auth';
import { db } from '../index';

const router = Router();

// Protect all routes with JWT verification
router.use(verifyToken);

// POST /api/admin/report-campaign - Submit a campaign report (Accessible by logged-in users / Supporters)
router.post('/report-campaign', async (req: Request, res: Response): Promise<void> => {
  try {
    const { campaignId, campaignTitle, reason } = req.body;
    const supporterEmail = req.body.supporterEmail || (req as any).user?.email;
    const supporterName = req.body.supporterName || (req as any).user?.name || "Anonymous Supporter";

    if (!campaignId || !campaignTitle || !reason || !supporterEmail) {
      res.status(400).json({ error: 'supporterEmail, campaignId, campaignTitle, and reason are required.' });
      return;
    }

    const reportDoc = {
      supporterEmail,
      supporterName,
      campaignId,
      campaignTitle,
      reason,
      date: new Date(),
      status: 'pending',
    };

    const result = await db.collection('reports').insertOne(reportDoc);

    res.status(201).json({
      message: 'Campaign report submitted successfully.',
      insertedId: result.insertedId,
      report: {
        _id: result.insertedId,
        ...reportDoc,
      },
    });
  } catch (error) {
    console.error('Error submitting campaign report:', error);
    res.status(500).json({ error: 'Internal server error while submitting campaign report.' });
  }
});

// Admin role check for all admin management routes below
const verifyAdmin = (req: Request, res: Response, next: NextFunction): void => {
  const role = (req as any).user?.role;
  if (role !== 'Admin') {
    res.status(403).json({ error: 'Access denied. Admin role required.' });
    return;
  }
  next();
};

router.use(verifyAdmin);

// Route 1: GET /api/admin/users - Get all users (excluding passwords)
router.get('/users', async (req: Request, res: Response): Promise<void> => {
  try {
    const users = await db
      .collection('users')
      .find({})
      .project({ password: 0 })
      .toArray();

    res.status(200).json(users);
  } catch (error) {
    console.error('Error fetching users for admin:', error);
    res.status(500).json({ error: 'Internal server error while fetching users.' });
  }
});

// Route 2: DELETE /api/admin/delete-user/:email - Delete a user by email
router.delete('/delete-user/:email', async (req: Request, res: Response): Promise<void> => {
  try {
    const emailParam = req.params.email;
    const email = Array.isArray(emailParam) ? emailParam[0] : emailParam;

    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'Valid user email is required.' });
      return;
    }

    const result = await db.collection('users').deleteOne({ email });

    if (result.deletedCount === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    res.status(200).json({ message: 'User deleted successfully.' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Internal server error while deleting user.' });
  }
});

// Route 3: PATCH /api/admin/update-role/:email - Update user role
router.patch('/update-role/:email', async (req: Request, res: Response): Promise<void> => {
  try {
    const emailParam = req.params.email;
    const email = Array.isArray(emailParam) ? emailParam[0] : emailParam;
    const { newRole } = req.body;

    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'Valid user email is required.' });
      return;
    }

    if (!newRole || !['Admin', 'Creator', 'Supporter'].includes(newRole)) {
      res.status(400).json({ error: 'Invalid role. Role must be "Admin", "Creator", or "Supporter".' });
      return;
    }

    const result = await db.collection('users').updateOne(
      { email },
      { $set: { role: newRole } }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    res.status(200).json({ message: `User role updated to ${newRole} successfully.` });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ error: 'Internal server error while updating user role.' });
  }
});

// Route 4: DELETE /api/admin/delete-campaign/:id - Delete campaign & auto-refund approved contributions
router.delete('/delete-campaign/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const idParam = req.params.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;

    if (!id || typeof id !== 'string') {
      res.status(400).json({ error: 'Valid campaign ID is required.' });
      return;
    }

    const campaignIdQuery = ObjectId.isValid(id) ? new ObjectId(id) : id;

    // 1. Find the campaign
    const campaign = await db.collection('campaigns').findOne({ _id: campaignIdQuery as any });

    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found.' });
      return;
    }

    const campaignIdStr = campaign._id.toString();

    // 2. Find all approved contributions for this campaign
    const approvedContributions = await db
      .collection('contributions')
      .find({
        campaignId: { $in: [id, campaignIdStr] },
        status: 'approved',
      } as any)
      .toArray();

    // 3. Refund credits back to supporters
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

    // 5. Delete the campaign itself
    await db.collection('campaigns').deleteOne({ _id: campaign._id });

    res.status(200).json({
      message: 'Campaign deleted, approved contributions refunded, and related contributions removed successfully.',
    });
  } catch (error) {
    console.error('Error deleting campaign:', error);
    res.status(500).json({ error: 'Internal server error while deleting campaign.' });
  }
});

// Route 5: PATCH /api/admin/approve-withdrawal/:id - Approve creator withdrawal request
router.patch('/approve-withdrawal/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const idParam = req.params.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;

    if (!id || typeof id !== 'string' || !ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Valid withdrawal request ID is required.' });
      return;
    }

    // 1. Find the withdrawal request
    const withdrawal = await db.collection('withdrawals').findOne({ _id: new ObjectId(id) });

    if (!withdrawal) {
      res.status(404).json({ error: 'Withdrawal request not found.' });
      return;
    }

    if (withdrawal.status === 'approved') {
      res.status(400).json({ error: 'Already approved' });
      return;
    }

    // 2. Update status to "approved"
    await db.collection('withdrawals').updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'approved', approvedAt: new Date() } }
    );

    // 3. Update creator's user document with $inc on withdrawnCredits
    const withdrawCreditAmount = Number(withdrawal.withdrawCredit) || 0;
    if (withdrawal.creatorEmail) {
      await db.collection('users').updateOne(
        { email: withdrawal.creatorEmail },
        { $inc: { withdrawnCredits: withdrawCreditAmount } }
      );

      // #24: Send notification to creator about withdrawal approval
      await db.collection('notifications').insertOne({
        message: `Your withdrawal of ${withdrawCreditAmount} credits ($${(withdrawCreditAmount / 20).toFixed(2)}) via ${withdrawal.paymentSystem || 'payment system'} has been approved and is being processed.`,
        toEmail: withdrawal.creatorEmail,
        actionRoute: '/dashboard/withdrawals',
        time: new Date(),
        read: false,
      });
    }

    res.status(200).json({
      message: 'Withdrawal request approved successfully and creator record updated.',
    });
  } catch (error) {
    console.error('Error approving withdrawal:', error);
    res.status(500).json({ error: 'Internal server error while approving withdrawal request.' });
  }
});

// Route 6: GET /api/admin/pending-campaigns - Get all campaigns pending approval
router.get('/pending-campaigns', async (req: Request, res: Response): Promise<void> => {
  try {
    const pendingCampaigns = await db
      .collection('campaigns')
      .find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json(pendingCampaigns);
  } catch (error) {
    console.error('Error fetching pending campaigns:', error);
    res.status(500).json({ error: 'Internal server error while fetching pending campaigns.' });
  }
});

// #26: GET /api/admin/all-campaigns - Get ALL campaigns (pending + approved + rejected)
router.get('/all-campaigns', async (req: Request, res: Response): Promise<void> => {
  try {
    const allCampaigns = await db
      .collection('campaigns')
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    res.status(200).json(allCampaigns);
  } catch (error) {
    console.error('Error fetching all campaigns:', error);
    res.status(500).json({ error: 'Internal server error while fetching all campaigns.' });
  }
});

// Route 7: PATCH /api/admin/approve-campaign/:id - Approve a pending campaign (+ #23 notification to creator)
router.patch('/approve-campaign/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const idParam = req.params.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;

    if (!id || typeof id !== 'string') {
      res.status(400).json({ error: 'Valid campaign ID is required.' });
      return;
    }

    const campaignIdQuery = ObjectId.isValid(id) ? new ObjectId(id) : id;

    // Fetch campaign first to get creator info for notification
    const campaign = await db.collection('campaigns').findOne({ _id: campaignIdQuery as any });
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found.' });
      return;
    }

    const result = await db.collection('campaigns').updateOne(
      { _id: campaignIdQuery as any },
      { $set: { status: 'approved', approvedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ error: 'Campaign not found.' });
      return;
    }

    // #23: Send notification to creator
    if (campaign.creatorEmail) {
      await db.collection('notifications').insertOne({
        message: `Your campaign "${campaign.title}" has been approved and is now live!`,
        toEmail: campaign.creatorEmail,
        actionRoute: '/dashboard/my-campaigns',
        time: new Date(),
        read: false,
      });
    }

    res.status(200).json({ message: 'Campaign approved successfully.' });
  } catch (error) {
    console.error('Error approving campaign:', error);
    res.status(500).json({ error: 'Internal server error while approving campaign.' });
  }
});

// Route 8: PATCH /api/admin/reject-campaign/:id - Reject a pending campaign (+ #22 notification to creator)
router.patch('/reject-campaign/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const idParam = req.params.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;

    if (!id || typeof id !== 'string') {
      res.status(400).json({ error: 'Valid campaign ID is required.' });
      return;
    }

    const campaignIdQuery = ObjectId.isValid(id) ? new ObjectId(id) : id;

    // Fetch campaign first to get creator info for notification
    const campaign = await db.collection('campaigns').findOne({ _id: campaignIdQuery as any });
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found.' });
      return;
    }

    const result = await db.collection('campaigns').updateOne(
      { _id: campaignIdQuery as any },
      { $set: { status: 'rejected', rejectedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ error: 'Campaign not found.' });
      return;
    }

    // #22: Send notification to creator
    if (campaign.creatorEmail) {
      await db.collection('notifications').insertOne({
        message: `Your campaign "${campaign.title}" has been rejected. You may review and resubmit.`,
        toEmail: campaign.creatorEmail,
        actionRoute: '/dashboard/my-campaigns',
        time: new Date(),
        read: false,
      });
    }

    res.status(200).json({ message: 'Campaign rejected successfully.' });
  } catch (error) {
    console.error('Error rejecting campaign:', error);
    res.status(500).json({ error: 'Internal server error while rejecting campaign.' });
  }
});

// Route 9: GET /api/admin/pending-withdrawals - Get all pending creator withdrawal requests
router.get('/pending-withdrawals', async (req: Request, res: Response): Promise<void> => {
  try {
    const pendingWithdrawals = await db
      .collection('withdrawals')
      .find({ status: 'pending' })
      .sort({ date: -1 })
      .toArray();

    res.status(200).json(pendingWithdrawals);
  } catch (error) {
    console.error('Error fetching pending withdrawals for admin:', error);
    res.status(500).json({ error: 'Internal server error while fetching pending withdrawals.' });
  }
});

// Route 10: GET /api/admin/reports - Get all reports (Admin only)
router.get('/reports', async (req: Request, res: Response): Promise<void> => {
  try {
    const reports = await db
      .collection('reports')
      .find({})
      .sort({ date: -1 })
      .toArray();

    res.status(200).json(reports);
  } catch (error) {
    console.error('Error fetching reports for admin:', error);
    res.status(500).json({ error: 'Internal server error while fetching reports.' });
  }
});

// #25: PATCH /api/admin/resolve-report/:id - Suspend/Delete reported campaign
router.patch('/resolve-report/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const idParam = req.params.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;
    const { action } = req.body; // 'delete' or 'suspend'

    if (!id || typeof id !== 'string' || !ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Valid report ID is required.' });
      return;
    }

    if (!action || !['delete', 'suspend'].includes(action)) {
      res.status(400).json({ error: 'Action must be "delete" or "suspend".' });
      return;
    }

    const report = await db.collection('reports').findOne({ _id: new ObjectId(id) });
    if (!report) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }

    const campaignId = report.campaignId;
    const campaignIdQuery = ObjectId.isValid(campaignId) ? new ObjectId(campaignId) : campaignId;

    if (action === 'delete') {
      // 1. Find the campaign and refund approved supporters
      const campaign = await db.collection('campaigns').findOne({ _id: campaignIdQuery as any });
      if (campaign) {
        const campaignIdStr = campaign._id.toString();
        const approvedContributions = await db
          .collection('contributions')
          .find({ campaignId: { $in: [campaignId, campaignIdStr] }, status: 'approved' } as any)
          .toArray();
        for (const c of approvedContributions) {
          if (c.supporterEmail && c.amount) {
            await db.collection('users').updateOne(
              { email: c.supporterEmail },
              { $inc: { credits: Number(c.amount) || 0 } }
            );
          }
        }
        await db.collection('contributions').deleteMany({ campaignId: { $in: [campaignId, campaignIdStr] } } as any);
        await db.collection('campaigns').deleteOne({ _id: campaign._id });

        // Notify creator
        if (campaign.creatorEmail) {
          await db.collection('notifications').insertOne({
            message: `Your campaign "${campaign.title}" has been removed by admin due to policy violations.`,
            toEmail: campaign.creatorEmail,
            actionRoute: '/dashboard/my-campaigns',
            time: new Date(),
            read: false,
          });
        }
      }
    } else if (action === 'suspend') {
      await db.collection('campaigns').updateOne(
        { _id: campaignIdQuery as any },
        { $set: { status: 'suspended', suspendedAt: new Date() } }
      );

      // Notify creator
      const campaign = await db.collection('campaigns').findOne({ _id: campaignIdQuery as any });
      if (campaign?.creatorEmail) {
        await db.collection('notifications').insertOne({
          message: `Your campaign "${campaign.title}" has been suspended by admin for review.`,
          toEmail: campaign.creatorEmail,
          actionRoute: '/dashboard/my-campaigns',
          time: new Date(),
          read: false,
        });
      }
    }

    // Mark report as resolved
    await db.collection('reports').updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'resolved', resolvedAt: new Date(), resolvedAction: action } }
    );

    res.status(200).json({ message: `Campaign ${action === 'delete' ? 'deleted' : 'suspended'} successfully.` });
  } catch (error) {
    console.error('Error resolving report:', error);
    res.status(500).json({ error: 'Internal server error while resolving report.' });
  }
});

export default router;
