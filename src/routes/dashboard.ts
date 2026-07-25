import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import { db } from '../index';

const router = Router();

// Apply verifyToken middleware to all dashboard routes
router.use(verifyToken);

// GET /api/dashboard/stats
router.get('/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const email = user?.email;
    const role = user?.role;

    if (!email || !role) {
      res.status(401).json({ error: 'User information missing in token.' });
      return;
    }

    let stats: Record<string, any> = {};

    if (role === 'Supporter') {
      // 1. Total Contributions count for this supporter
      const totalContributions = await db.collection('contributions').countDocuments({
        supporterEmail: email,
      });

      // 2. Pending Contributions count
      const pendingContributions = await db.collection('contributions').countDocuments({
        supporterEmail: email,
        status: 'pending',
      });

      // 3. Total Amount Contributed (Sum of approved contributions)
      const totalAmountResult = await db.collection('contributions').aggregate([
        {
          $match: {
            supporterEmail: email,
            status: 'approved',
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' },
          },
        },
      ]).toArray();

      const totalAmountContributed = totalAmountResult[0]?.total || 0;

      stats = {
        totalContributions,
        pendingContributions,
        totalAmountContributed,
      };
    } else if (role === 'Creator') {
      // 1. Total Campaigns count created by this user
      const totalCampaigns = await db.collection('campaigns').countDocuments({
        creatorEmail: email,
      });

      // 2. Active Campaigns count (status is approved AND deadline >= now)
      const currentDate = new Date();
      const currentDateISO = currentDate.toISOString();
      const activeCampaigns = await db.collection('campaigns').countDocuments({
        creatorEmail: email,
        status: 'approved',
        $or: [
          { deadline: { $gte: currentDate } },
          { deadline: { $gte: currentDateISO } },
        ],
      });

      // 3. Total Raised amount across creator's campaigns
      const totalRaisedResult = await db.collection('campaigns').aggregate([
        {
          $match: {
            creatorEmail: email,
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$raisedAmount' },
          },
        },
      ]).toArray();

      const totalRaised = totalRaisedResult[0]?.total || 0;

      stats = {
        totalCampaigns,
        activeCampaigns,
        totalRaised,
      };
    } else if (role === 'Admin') {
      // 1. Total Supporters count
      const totalSupporters = await db.collection('users').countDocuments({
        role: 'Supporter',
      });

      // 2. Total Creators count
      const totalCreators = await db.collection('users').countDocuments({
        role: 'Creator',
      });

      // 3. Total Credits across all users
      const totalCreditsResult = await db.collection('users').aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: '$credits' },
          },
        },
      ]).toArray();

      const totalCredits = totalCreditsResult[0]?.total || 0;

      // 4. Total Payments (Approved withdrawals count)
      const totalPayments = await db.collection('withdrawals').countDocuments({
        status: 'approved',
      });

      stats = {
        totalSupporters,
        totalCreators,
        totalCredits,
        totalPayments,
      };
    } else {
      res.status(400).json({ error: `Invalid or unsupported user role: ${role}` });
      return;
    }

    res.status(200).json({
      role,
      stats,
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Internal server error while fetching dashboard stats.' });
  }
});

export default router;
