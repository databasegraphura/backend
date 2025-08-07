const mongoose = require('mongoose');

const callLogSchema = new mongoose.Schema({
    companyName: {
        type: String,
        required: [true, 'Call log must have a company name']
    },
    clientName: {
        type: String,
        required: [true, 'Call log must have a client name']
    },
    emailId: String,
    contactNo: String,
    activity: { // e.g., 'Talked', 'Not Talked', 'Follow Up', 'Deleted Profile'
        type: String,
        required: [true, 'Call activity is required']
    },
    comment: String,
    callDate: {
        type: Date,
        default: Date.now
    },
    salesExecutive: { // Who made the call
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: [true, 'Call log must be linked to a Sales Executive']
    },
    prospect: { // Link to a prospect (optional, but good for context)
        type: mongoose.Schema.ObjectId,
        ref: 'Prospect',
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const CallLog = mongoose.model('CallLog', callLogSchema);
module.exports = CallLog;