import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { verifyToken } from '../middleware/auth';
import { db } from '../index';

const router = Router();

// Protect all admin routes with JWT verification and Admin role authorization
router.use(verifyToken);

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
    }

    res.status(200).json({
      message: 'Withdrawal request approved successfully and creator record updated.',
    });
  } catch (error) {
    console.error('Error approving withdrawal:', error);
    res.status(500).json({ error: 'Internal server error while approving withdrawal request.' });
  }
});

export default router;
