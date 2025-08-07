// models/Team.js
const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Team must have a name'],
        unique: true,
        trim: true,
        maxlength: [40, 'A team name must have less or equal than 40 characters']
    },
    teamLead: { // Reference to the User who is the Team Lead
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: [true, 'A team must have a Team Lead'],
        unique: true // A Team Lead can only lead one team
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual populate for team members (Sales Executives)
// 'members' is the virtual field we want to add to the Team document
// 'User' is the model to populate from
// 'team' is the field in the User model that refers to this Team's _id
teamSchema.virtual('members', {
    ref: 'User',
    localField: '_id',
    foreignField: 'team',
    justOne: false // We expect multiple members
});

const Team = mongoose.model('Team', teamSchema);
module.exports = Team;