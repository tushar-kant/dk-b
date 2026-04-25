const mongoose = require('mongoose');

const withdrawalRequestSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userName: String,
  amount: {
    type: Number,
    required: true
  },
  paymentDetails: String, // e.g., UPI ID or Bank Details
  status: {
    type: String,
    enum: ['pending', 'success', 'rejected'],
    default: 'pending'
  },
  submittedAt: {
    type: Date,
    default: Date.now
  },
  processedAt: Date
});

module.exports = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);
