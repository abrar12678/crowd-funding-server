import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import { db } from '../index';

const router = Router();

// Protect all payment routes with JWT verification
router.use(verifyToken);

// Route 1: GET /api/payments/my-contributions (For Supporter - Paginated)
router.get('/my-contributions', async (req: Request, res: Response): Promise<void> => {
  try {
    const supporterEmail = (req as any).user.email;

    if (!supporterEmail) {
      res.status(401).json({ error: 'Unauthorized. Email not found in token.' });
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 10);
    const skip = (page - 1) * limit;

    const contributions = await db
      .collection('contributions')
      .find({ supporterEmail })
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const totalCount = await db.collection('contributions').countDocuments({ supporterEmail });
    const totalPages = Math.ceil(totalCount / limit) || 1;

    res.status(200).json({
      contributions,
      totalPages,
      currentPage: page,
      totalCount,
    });
  } catch (error) {
    console.error('Error fetching supporter contributions:', error);
    res.status(500).json({ error: 'Internal server error while fetching contributions.' });
  }
});

// Route 2: POST /api/payments/request-withdrawal (For Creator)
router.post('/request-withdrawal', async (req: Request, res: Response): Promise<void> => {
  try {
    const creatorEmail = (req as any).user.email;
    const creatorName = (req as any).user.name || "Unknown Creator";

    if (!creatorEmail) {
      res.status(401).json({ error: 'Unauthorized. Email not found in token.' });
      return;
    }

    const { withdrawCredit, paymentSystem, accountNumber } = req.body;
    const withdrawCreditNum = Number(withdrawCredit);

    if (!withdrawCredit || isNaN(withdrawCreditNum) || !paymentSystem || !accountNumber) {
      res.status(400).json({
        error: 'withdrawCredit, paymentSystem, and accountNumber are required.',
      });
      return;
    }

    // 1. Business Logic Check: minimum 200 credits
    if (withdrawCreditNum < 200) {
      res.status(400).json({ error: 'Minimum 200 credits required to withdraw' });
      return;
    }

    const withdrawAmount = withdrawCreditNum / 20;

    // 2. Business Logic Check: Total raised credits from approved campaigns
    const raisedResult = await db.collection('campaigns').aggregate([
      { $match: { creatorEmail, status: 'approved' } },
      { $group: { _id: null, totalRaised: { $sum: '$raisedAmount' } } },
    ]).toArray();

    const totalRaisedCredits = raisedResult[0]?.totalRaised || 0;

    if (totalRaisedCredits < withdrawCreditNum) {
      res.status(400).json({ error: 'Insufficient raised credits' });
      return;
    }

    // 3. Create withdrawal document
    const withdrawalDoc = {
      creatorEmail,
      creatorName,
      withdrawCredit: withdrawCreditNum,
      withdrawAmount,
      paymentSystem,
      accountNumber,
      status: 'pending',
      date: new Date(),
    };

    // 4. Insert into 'withdrawals' collection
    const result = await db.collection('withdrawals').insertOne(withdrawalDoc);

    res.status(201).json({
      message: 'Withdrawal request submitted successfully',
      insertedId: result.insertedId,
      withdrawal: {
        _id: result.insertedId,
        ...withdrawalDoc,
      },
    });
  } catch (error) {
    console.error('Error requesting withdrawal:', error);
    res.status(500).json({ error: 'Internal server error while requesting withdrawal.' });
  }
});

// Route 3: GET /api/payments/my-payments (For Creator)
router.get('/my-payments', async (req: Request, res: Response): Promise<void> => {
  try {
    const creatorEmail = (req as any).user.email;

    if (!creatorEmail) {
      res.status(401).json({ error: 'Unauthorized. Email not found in token.' });
      return;
    }

    const withdrawals = await db
      .collection('withdrawals')
      .find({ creatorEmail })
      .sort({ date: -1 })
      .toArray();

    res.status(200).json(withdrawals);
  } catch (error) {
    console.error('Error fetching creator withdrawals:', error);
    res.status(500).json({ error: 'Internal server error while fetching payment requests.' });
  }
});


// POST /api/payments/purchase-credits (Supporter)
router.post("/purchase-credits", async (req, res) => {
  try {
    const email = req.user.email;
    const name = req.user.name || "Unknown";
    const { credits, amount } = req.body;
    const creditsNum = Number(credits);
    const amountNum = Number(amount);
    if (!credits || !amount || isNaN(creditsNum) || isNaN(amountNum) || creditsNum <= 0) {
      res.status(400).json({ error: "Valid credits and amount required." }); return;
    }
    await db.collection("users").updateOne({ email }, { $inc: { credits: creditsNum } });
    await db.collection("credit_purchases").insertOne({ supporterEmail: email, supporterName: name, credits: creditsNum, amount: amountNum, paymentMethod: "simulated", status: "completed", date: new Date() });
    const updatedUser = await db.collection("users").findOne({ email });
    const { password, ...safe } = updatedUser;
    res.status(200).json({ message: creditsNum + " credits purchased!", user: safe });
  } catch (e) { res.status(500).json({ error: "Internal server error." }); }
});

// GET /api/payments/my-purchases (Supporter)
router.get("/my-purchases", async (req, res) => {
  try {
    const email = req.user.email;
    const purchases = await db.collection("credit_purchases").find({ supporterEmail: email }).sort({ date: -1 }).toArray();
    res.status(200).json(purchases);
  } catch (e) { res.status(500).json({ error: "Internal server error." }); }
});
export default router;
