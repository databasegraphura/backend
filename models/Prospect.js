const mongoose = require('mongoose');

const prospectSchema = new mongoose.Schema({
    companyName: {
        type: String,
        required: [true, 'Prospect must have a company name']
    },
    clientName: {
        type: String,
        required: [true, 'Prospect must have a client name']
    },
    emailId: String,
    contactNo: String,
    reminderDate: Date,
    comment: String,
    activity: { // Status of interaction: e.g., 'New', 'Contacted', 'Follow-up', 'Converted'
        type: String,
        default: 'New'
    },
    salesExecutive: { // Who owns this prospect
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: [true, 'Prospect must be assigned to a Sales Executive']
    },
    teamLead: { // For easy filtering by Team Lead's view
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: [true, 'Prospect must be associated with a Team Lead']
    },
    lastUpdate: { // For "Last Update" history
        type: Date,
        default: Date.now
    },
    callLogs: [ // Embedded or referenced, let's reference for now if detailed history is needed
        {
            type: mongoose.Schema.ObjectId,
            ref: 'CallLog'
        }
    ],
    isUntouched: { // For 'Untouched Data' section
        type: Boolean,
        default: true
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

const Prospect = mongoose.model('Prospect', prospectSchema);
module.exports = Prospect;