import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../index';

const router = Router();

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, profilepictureurl, role } = req.body;

    // 1. Input Validation: Check if all fields are provided
    if (!name || !email || !password || !profilepictureurl || !role) {
      res.status(400).json({ error: 'All fields (name, email, password, profilepictureurl, role) are required.' });
      return;
    }

    // Check if role is either "Supporter" or "Creator"
    if (role !== 'Supporter' && role !== 'Creator') {
      res.status(400).json({ error: 'Invalid role. Role must be either "Supporter" or "Creator".' });
      return;
    }

    // 2. Check if user already exists
    const existingUser = await db.collection('users').findOne({ email });
    if (existingUser) {
      res.status(400).json({ error: 'User with this email already exists.' });
      return;
    }

    // 3. Hash the password using bcrypt (salt rounds: 10)
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // 4. Business Logic for Credits
    const initialCredits = role === 'Supporter' ? 50 : 20;

    // 5. Create user document
    const newUser = {
      name,
      email,
      password: hashedPassword,
      profilepictureurl,
      role,
      credits: initialCredits,
      provider: 'email',
      createdAt: new Date(),
    };

    // 6. Insert user into database
    const result = await db.collection('users').insertOne(newUser);

    // 7. Generate JWT token (expires in 7d)
    const secretKey = process.env.JWT_SECRET || 'default-secret-key';
    const token = jwt.sign(
      { email: newUser.email, role: newUser.role },
      secretKey,
      { expiresIn: '7d' }
    );

    // 8. Remove password from user object before returning
    const { password: _, ...userWithoutPassword } = newUser;
    const userResponse = {
      _id: result.insertedId,
      ...userWithoutPassword,
    };

    // 9. Return success response
    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: userResponse,
    });
  } catch (error) {
    console.error('Registration Error:', error);
    res.status(500).json({ error: 'Internal server error during registration.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    // 1. Input Validation
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    // 2. Check if user exists
    const user = await db.collection('users').findOne({ email });
    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    // 3. Compare password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }

    // 4. Generate JWT token (expires in 7d)
    const secretKey = process.env.JWT_SECRET || 'default-secret-key';
    const token = jwt.sign(
      { email: user.email, role: user.role },
      secretKey,
      { expiresIn: '7d' }
    );

    // 5. Remove password from user object before returning
    const { password: _, ...userWithoutPassword } = user;

    // 6. Return success response (200 status)
    res.status(200).json({
      message: 'Login successful',
      token,
      user: userWithoutPassword,
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ error: 'Internal server error during login.' });
  }
});

export default router;
