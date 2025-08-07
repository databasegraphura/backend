// models/Payout.js
const mongoose = require('mongoose');

const payoutSchema = new mongoose.Schema({
    user: { // The employee receiving the payout (Sales Executive or Team Lead)
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: [true, 'Payout must be linked to a user.']
    },
    // The Team Lead of the user (for easier filtering)
    teamLead: {
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        default: null
    },
    // The Manager who oversees this payout (optional, if distinct from the one initiating via UI)
    manager: {
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        default: null
    },
    month: { // Month of the payout (e.g., "July 2025")
        type: String,
        required: [true, 'Payout month is required.']
    },
    amount: {
        type: Number,
        required: [true, 'Payout amount is required.'],
        min: 0
    },
    duration: String, // e.g., "Full Month", "Half Month", "Bonus"
    description: String, // Any notes about the payout
    payoutDate: {
        type: Date,
        default: Date.now
    },
    // You could link this to specific sales or performance metrics if calculating commission
    // salesGenerated: { type: Number, default: 0 },
    // commissionRate: { type: Number, default: 0 },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

const Payout = mongoose.model('Payout', payoutSchema);
module.exports = Payout;