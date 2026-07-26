import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
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

// Route 3: PATCH /api/notifications/mark-read/:id - Mark a single notification as read
router.patch('/mark-read/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const email = (req as any).user?.email;
    const idParam = req.params.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;

    if (!id || typeof id !== 'string' || !ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Valid notification ID is required.' });
      return;
    }

    const result = await db.collection('notifications').updateOne(
      { _id: new ObjectId(id), toEmail: email },
      { $set: { read: true } }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ error: 'Notification not found.' });
      return;
    }

    res.status(200).json({ message: 'Notification marked as read.' });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: 'Internal server error while updating notification.' });
  }
});

// Route 4: PATCH /api/notifications/mark-all-read - Mark all notifications as read for the user
router.patch('/mark-all-read', async (req: Request, res: Response): Promise<void> => {
  try {
    const email = (req as any).user?.email;

    if (!email) {
      res.status(401).json({ error: 'Unauthorized. Email not found in token.' });
      return;
    }

    const result = await db.collection('notifications').updateMany(
      { toEmail: email, read: false },
      { $set: { read: true } }
    );

    res.status(200).json({
      message: `${result.modifiedCount} notification(s) marked as read.`,
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ error: 'Internal server error while updating notifications.' });
  }
});

// Route 5: GET /api/notifications/unread-count - Get count of unread notifications
router.get('/unread-count', async (req: Request, res: Response): Promise<void> => {
  try {
    const email = (req as any).user?.email;

    if (!email) {
      res.status(401).json({ error: 'Unauthorized. Email not found in token.' });
      return;
    }

    const count = await db.collection('notifications').countDocuments({
      toEmail: email,
      read: false,
    });

    res.status(200).json({ unreadCount: count });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({ error: 'Internal server error while fetching unread count.' });
  }
});

export default router;
