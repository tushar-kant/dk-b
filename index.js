const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const morgan = require('morgan');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const User = require('./models/User');
const Otp = require('./models/Otp');
const UserTask = require('./models/UserTask');
const Transaction = require('./models/Transaction');
const Settings = require('./models/Settings');
const OfferSubmission = require('./models/OfferSubmission');
const WithdrawalRequest = require('./models/WithdrawalRequest');
const Task = require('./models/Task');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Admin Middleware
const adminAuth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// Admin Routes
app.get('/api/admin/users', adminAuth, async (req, res) => {
  try {
    const users = await User.find().select('-__v').sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

app.get('/api/admin/users/:userId/tasks', adminAuth, async (req, res) => {
  try {
    const tasks = await UserTask.find({ userId: req.params.userId }).sort({ completedAt: -1 });
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch user tasks' });
  }
});

app.post('/api/admin/users/:userId/balance', adminAuth, async (req, res) => {
  const { amount } = req.body;
  if (typeof amount !== 'number') return res.status(400).json({ message: 'Invalid amount' });

  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.balance += amount;
    await user.save();

    // Record Transaction
    await Transaction.create({
      userId: user._id,
      userName: user.name,
      type: amount >= 0 ? 'credit' : 'debit',
      amount: Math.abs(amount),
      description: amount >= 0 ? 'Admin Credit' : 'Admin Debit'
    });

    res.json({ message: 'Balance updated', balance: user.balance });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update balance' });
  }
});

app.get('/api/admin/transactions', adminAuth, async (req, res) => {
  try {
    const transactions = await Transaction.find().sort({ createdAt: -1 }).limit(100);
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch transactions' });
  }
});

// Admin Task Management
app.get('/api/admin/tasks', adminAuth, async (req, res) => {
  try {
    const tasks = await Task.find().sort({ createdAt: -1 });
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch tasks' });
  }
});

app.post('/api/admin/tasks', adminAuth, async (req, res) => {
  try {
    const task = await Task.create(req.body);
    res.status(201).json(task);
  } catch (error) {
    res.status(400).json({ message: 'Failed to create task' });
  }
});

app.put('/api/admin/tasks/:id', adminAuth, async (req, res) => {
  try {
    const task = await Task.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(task);
  } catch (error) {
    res.status(400).json({ message: 'Failed to update task' });
  }
});

app.delete('/api/admin/tasks/:id', adminAuth, async (req, res) => {
  try {
    await Task.findByIdAndDelete(req.params.id);
    res.json({ message: 'Task deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete task' });
  }
});

// Public Task Routes
app.get('/api/tasks', async (req, res) => {
  try {
    const tasks = await Task.find({ isActive: true }).sort({ createdAt: -1 });
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch tasks' });
  }
});

// Settings Routes
app.get('/api/settings', async (req, res) => {
  try {
    const maintenance = await Settings.findOne({ key: 'maintenanceMode' });
    res.json({ maintenanceMode: maintenance ? maintenance.value : false });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch settings' });
  }
});

app.post('/api/admin/settings', adminAuth, async (req, res) => {
  const { key, value } = req.body;
  try {
    const setting = await Settings.findOneAndUpdate(
      { key },
      { value, updatedAt: Date.now() },
      { upsert: true, new: true }
    );
    res.json(setting);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update setting' });
  }
});

// Admin Order Management (Offer Submissions)
app.get('/api/admin/orders', adminAuth, async (req, res) => {
  try {
    const orders = await OfferSubmission.find().sort({ submittedAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
});

app.post('/api/admin/orders/:orderId/process', adminAuth, async (req, res) => {
  const { status } = req.body; // 'approved' or 'rejected'
  try {
    const order = await OfferSubmission.findById(req.orderId || req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status !== 'pending') return res.status(400).json({ message: 'Order already processed' });

    order.status = status;
    order.processedAt = Date.now();
    await order.save();

    if (status === 'approved') {
      const user = await User.findById(order.userId);
      if (user) {
        user.balance += order.reward;
        await user.save();

        // Log Transaction
        await Transaction.create({
          userId: user._id,
          userName: user.name,
          type: 'credit',
          amount: order.reward,
          description: `Offer Approved: ${order.offerTitle}`
        });

        // Record User Task
        await UserTask.create({
          userId: user._id,
          taskTitle: order.offerTitle,
          reward: order.reward,
          status: 'completed'
        });
      }
    }

    res.json({ message: `Order ${status}`, order });
  } catch (error) {
    res.status(500).json({ message: 'Failed to process order' });
  }
});

// User Offer Submission
app.post('/api/offers/submit', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { email, offerTitle } = req.body;

    const existing = await OfferSubmission.findOne({ userId: decoded.userId, offerTitle, status: 'pending' });
    if (existing) return res.status(400).json({ message: 'You already have a pending submission for this offer' });

    const user = await User.findById(decoded.userId);

    const submission = await OfferSubmission.create({
      userId: decoded.userId,
      userName: user.name,
      userEmail: email,
      offerTitle: offerTitle || 'MLBB Topup Registration',
      reward: 1,
      status: 'pending'
    });

    res.json({ message: 'Offer submitted for verification', submission });
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
});

// User Withdrawal Request
app.post('/api/withdraw/request', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { amount, paymentDetails } = req.body;

    const user = await User.findById(decoded.userId);
    if (user.balance < amount) return res.status(400).json({ message: 'Insufficient balance' });

    const request = await WithdrawalRequest.create({
      userId: decoded.userId,
      userName: user.name,
      amount,
      paymentDetails,
      status: 'pending'
    });

    res.json({ message: 'Withdrawal request submitted', request });
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
});

// Admin Withdrawal Management
app.get('/api/admin/withdrawals', adminAuth, async (req, res) => {
  try {
    const requests = await WithdrawalRequest.find().sort({ submittedAt: -1 });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch withdrawals' });
  }
});

app.post('/api/admin/withdrawals/:id/process', adminAuth, async (req, res) => {
  const { status } = req.body; // 'success' or 'rejected'
  try {
    const request = await WithdrawalRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    if (request.status !== 'pending') return res.status(400).json({ message: 'Request already processed' });

    const user = await User.findById(request.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (status === 'success') {
      if (user.balance < request.amount) {
        return res.status(400).json({ message: 'User no longer has enough balance' });
      }
      user.balance -= request.amount;
      await user.save();

      // Log Transaction
      await Transaction.create({
        userId: user._id,
        userName: user.name,
        type: 'debit',
        amount: request.amount,
        description: `Withdrawal Successful`
      });
    }

    request.status = status;
    request.processedAt = Date.now();
    await request.save();

    res.json({ message: `Withdrawal ${status}`, request });
  } catch (error) {
    res.status(500).json({ message: 'Failed to process withdrawal' });
  }
});

// User Profile Route
app.get('/api/user/profile', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
});

// Update Balance Route (for games/tasks)
app.post('/api/user/update-balance', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { amount, description } = req.body;

    const user = await User.findById(decoded.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.balance += amount;
    await user.save();

    // Log Transaction
    await Transaction.create({
      userId: user._id,
      userName: user.name,
      type: amount >= 0 ? 'credit' : 'debit',
      amount: Math.abs(amount),
      description: description || 'Game Reward'
    });

    res.json({ message: 'Balance updated', balance: user.balance });
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
});

// Google Auth Route
app.post('/api/auth/google', async (req, res) => {
  const { token } = req.body;

  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    let user = await User.findOne({ email });

    if (!user) {
      user = new User({
        googleId,
        email,
        name,
        picture,
        isVerified: true,
      });
      await user.save();
    } else if (!user.googleId || !user.isVerified) {
      user.googleId = googleId;
      user.picture = picture;
      user.isVerified = true;
      await user.save();
    }

    const authToken = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token: authToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        picture: user.picture,
        balance: user.balance,
        role: user.role,
      }
    });
  } catch (error) {
    console.error('Google Auth Error:', error);
    res.status(401).json({ message: 'Invalid Google token' });
  }
});

// Send OTP Route
app.post('/api/auth/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email is required' });

  try {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await Otp.findOneAndUpdate(
      { email },
      { otp, createdAt: Date.now() },
      { upsert: true, new: true }
    );

    const mailOptions = {
      from: `"Buff GG" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: `[Verification] Your OTP for Buff GG`,
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #8B5CF6; margin: 0; font-size: 28px;">Buff GG</h1>
            <p style="color: #64748b; margin-top: 5px;">Your Gaming Reward Hub</p>
          </div>
          <div style="background-color: #f8fafc; padding: 25px; border-radius: 12px; text-align: center;">
            <p style="color: #1e293b; font-size: 16px; margin-bottom: 20px;">Use the following verification code to complete your login:</p>
            <h2 style="color: #8B5CF6; font-size: 36px; letter-spacing: 5px; margin: 0; font-weight: 800;">${otp}</h2>
            <p style="color: #94a3b8; font-size: 13px; margin-top: 20px;">This code will expire in <b>10 minutes</b>. If you didn't request this, please ignore this email.</p>
          </div>
          <div style="margin-top: 30px; text-align: center; color: #94a3b8; font-size: 12px;">
            <p>© 2026 Buff GG. All rights reserved.</p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    res.json({ message: 'OTP sent successfully' });
  } catch (error) {
    console.error('Send OTP Error:', error);
    res.status(500).json({ message: 'Failed to send OTP' });
  }
});

// Verify OTP Route
app.post('/api/auth/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ message: 'Email and OTP are required' });

  try {
    const otpRecord = await Otp.findOne({ email, otp });
    if (!otpRecord) return res.status(401).json({ message: 'Invalid or expired OTP' });

    // OTP is valid, delete it
    await Otp.deleteOne({ _id: otpRecord._id });

    console.log('OTP verified for:', email);

    let user = await User.findOne({ email });
    if (!user) {
      console.log('Creating new user for:', email);
      try {
        user = new User({
          email,
          name: email.split('@')[0],
          isVerified: true,
        });
        await user.save();
        console.log('New user created successfully');
      } catch (saveErr) {
        console.error('Error saving new user:', saveErr);
        return res.status(500).json({ message: 'Failed to create user account' });
      }
    } else {
      console.log('Existing user found, updating verification status');
      user.isVerified = true;
      await user.save();
    }

    if (!process.env.JWT_SECRET) {
      console.error('CRITICAL: JWT_SECRET is missing in .env file!');
      return res.status(500).json({ message: 'Server configuration error' });
    }

    const authToken = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token: authToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        picture: user.picture,
        balance: user.balance,
        role: user.role,
      }
    });
  } catch (error) {
    console.error('CRITICAL Verify OTP Error:', error);
    res.status(500).json({ message: 'Verification failed: ' + error.message });
  }
});

// Sample Route
app.get('/', (req, res) => {
  res.json({ message: 'Task Earn API is running' });
});

// Mock Data Route for Tasks
app.get('/api/tasks', (req, res) => {
  const tasks = [
    { id: '1', title: 'Daily Check-in', reward: '$0.50', icon: 'calendar-outline', color: '#4CAF50' },
    { id: '2', title: 'Watch Video Ad', reward: '$0.10', icon: 'play-circle-outline', color: '#FF9800' },
    { id: '3', title: 'Install App: FitLife', reward: '$2.00', icon: 'download-outline', color: '#2196F3' },
    { id: '4', title: 'Complete Survey', reward: '$1.50', icon: 'clipboard-outline', color: '#9C27B0' },
  ];
  res.json(tasks);
});

// Database Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB connection error:', err));

// Delete Account
app.delete('/api/user/account', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    await User.findByIdAndDelete(decoded.userId);
    // Also delete their submissions and withdrawals
    await OfferSubmission.deleteMany({ userId: decoded.userId });
    await WithdrawalRequest.deleteMany({ userId: decoded.userId });
    await Transaction.deleteMany({ userId: decoded.userId });

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
});

// Daily Check-in
app.post('/api/user/checkin', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (user.lastCheckIn) {
      const last = new Date(user.lastCheckIn);
      const lastDay = new Date(last.getFullYear(), last.getMonth(), last.getDate());

      if (today.getTime() === lastDay.getTime()) {
        return res.status(400).json({ message: 'Already checked in today!' });
      }

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      if (lastDay.getTime() === yesterday.getTime()) {
        // Streak continues
        user.checkInStreak = (user.checkInStreak % 7) + 1;
      } else {
        // Missed a day, restart streak
        user.checkInStreak = 1;
      }
    } else {
      // First check-in
      user.checkInStreak = 1;
    }

    const rewards = [0.05, 0.05, 0.07, 0.10, 0.10, 0.15, 0.20];
    const reward = rewards[user.checkInStreak - 1];

    user.balance += reward;
    user.lastCheckIn = today;
    await user.save();

    // Log Transaction
    await Transaction.create({
      userId: user._id,
      userName: user.name,
      type: 'credit',
      amount: reward,
      description: `Daily Check-in Day ${user.checkInStreak}`
    });

    res.json({
      message: 'Check-in successful!',
      reward,
      streak: user.checkInStreak,
      balance: user.balance
    });
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
