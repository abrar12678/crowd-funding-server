import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import { db } from '../index';

const router = Router();

// Protect all notification routes with JWT verification
router.use(verifyToken);

// Route 1: POST /api/notifications - Create a notification
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, toEmail, actionRoute } = req.body;

    if (!message || !toEmail) {
      res.status(400).json({ error: 'message and toEmail are required.' });
      return;
    }

    const notificationDoc = {
      message,
      toEmail,
      actionRoute: actionRoute || '/dashboard',
      time: new Date(),
      read: false,
    };

    const result = await db.collection('notifications').insertOne(notificationDoc);

    res.status(201).json({
      message: 'Notification created successfully.',
      insertedId: result.insertedId,
      notification: {
        _id: result.insertedId,
        ...notificationDoc,
      },
    });
  } catch (error) {
    console.error('Error creating notification:', error);
    res.status(500).json({ error: 'Internal server error while creating notification.' });
  }
});

// Route 2: GET /api/notifications - Get notifications for the logged-in user
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const email = (req as any).user?.email;

    if (!email) {
      res.status(401).json({ error: 'Unauthorized. Email not found in token.' });
      return;
    }

    const notifications = await db
      .collection('notifications')
      .find({ toEmail: email })
      .sort({ time: -1 })
      .toArray();

    res.status(200).json(notifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Internal server error while fetching notifications.' });
  }
});

export default router;
