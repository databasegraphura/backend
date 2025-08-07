// models/TransferLog.js
const mongoose = require('mongoose');

const transferLogSchema = new mongoose.Schema({
    transferType: { // 'internal_data_transfer' or 'transfer_to_finance'
        type: String,
        enum: ['internal_data_transfer', 'transfer_to_finance'],
        required: [true, 'Transfer type is required.']
    },
    transferredBy: { // The user who initiated the transfer (Manager or Team Lead)
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: [true, 'Transfer must be linked to the user who initiated it.']
    },
    transferredFrom: { // Original owner (Sales Executive or Team Lead)
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: [true, 'Original data owner is required.']
    },
    transferredTo: { // New owner (Sales Executive or Team Lead) or null for finance transfer
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        default: null
    },
    transferDate: {
        type: Date,
        default: Date.now
    },
    dataCount: { // Number of prospects/sales transferred
        type: Number,
        default: 0
    },
    dataIds: [ // IDs of the actual documents transferred (Prospects or Sales)
        {
            type: mongoose.Schema.ObjectId,
            required: true // At least one ID should be present
        }
    ],
    // For 'transfer_to_finance' type
    amount: {
        type: Number,
        default: 0
    },
    companyName: String,
    clientName: String,
    // Add any other relevant details for finance transfer
});

const TransferLog = mongoose.model('TransferLog', transferLogSchema);
module.exports = TransferLog;