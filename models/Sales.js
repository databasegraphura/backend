const mongoose = require('mongoose');

const salesSchema = new mongoose.Schema({
    companyName: {
        type: String,
        required: [true, 'Sale must have a company name']
    },
    clientName: {
        type: String,
        required: [true, 'Sale must have a client name']
    },
    emailId: String,
    contactNo: String,
    services: String,
    amount: {
        type: Number,
        required: [true, 'Sale must have an amount']
    },
    saleDate: {
        type: Date,
        default: Date.now
    },
    salesExecutive: { // Who closed this sale
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: [true, 'Sale must be linked to a Sales Executive']
    },
    teamLead: { // For easy filtering by Team Lead's view
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: [true, 'Sale must be associated with a Team Lead']
    },
    // Reference to the prospect if it originated from one
    prospect: {
        type: mongoose.Schema.ObjectId,
        ref: 'Prospect',
        default: null
    },
    isTransferredToFinance: {
        type: Boolean,
        default: false // Flag to mark if sale has been transferred to finance
    },
    transferredToFinanceDate: {
        type: Date,
        default: null // Timestamp when it was transferred to finance
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

const Sales = mongoose.model('Sales', salesSchema);
module.exports = Sales;