const mongoose = require('mongoose');

const offerSubmissionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userName: String,
  userEmail: String, // The email they registered with on the target site
  offerTitle: {
    type: String,
    default: 'MLBB Topup Registration'
  },
  reward: {
    type: Number,
    default: 1
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  submittedAt: {
    type: Date,
    default: Date.now
  },
  processedAt: Date
});

module.exports = mongoose.model('OfferSubmission', offerSubmissionSchema);
