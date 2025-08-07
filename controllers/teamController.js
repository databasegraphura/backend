// controllers/teamController.js
const Team = require('../models/Team');
const User = require('../models/User'); // To update user's team/manager fields
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const ROLES = require('../config/roles');

// Helper to filter allowed fields for updates
const filterObj = (obj, ...allowedFields) => {
    const newObj = {};
    Object.keys(obj).forEach(el => {
        if (allowedFields.includes(el)) newObj[el] = obj[el];
    });
    return newObj;
};

// CREATE TEAM (Manager Only)
exports.createTeam = catchAsync(async (req, res, next) => {
    const { name, teamLeadId } = req.body; // teamLeadId is the user ID of the TL for this team

    if (!name || !teamLeadId) {
        return next(new AppError('Please provide a team name and assign a Team Lead.', 400));
    }

    // Ensure the assigned teamLeadId corresponds to an existing user with 'team_lead' role
    const teamLeadUser = await User.findById(teamLeadId);
    if (!teamLeadUser || teamLeadUser.role !== ROLES.TEAM_LEAD) {
        return next(new AppError('Invalid Team Lead ID provided or user is not a Team Lead.', 400));
    }

    // Check if the Team Lead is already assigned to another team
    const existingTeam = await Team.findOne({ teamLead: teamLeadId });
    if (existingTeam) {
        return next(new AppError('This Team Lead is already assigned to another team.', 400));
    }

    const newTeam = await Team.create({
        name,
        teamLead: teamLeadId
    });

    // Update the Team Lead's user document to link to this new team
    await User.findByIdAndUpdate(teamLeadId, { $set: { team: newTeam._id } });

    res.status(201).json({
        status: 'success',
        data: {
            team: newTeam
        }
    });
});

// GET ALL TEAMS (Manager sees all, Team Lead sees only their own team)
exports.getAllTeams = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;
    let filter = {};

    if (currentUserRole === ROLES.TEAM_LEAD) {
        // Team Lead can only see their own team
        filter.teamLead = currentUserId;
    } else if (currentUserRole !== ROLES.MANAGER) {
        return next(new AppError('You do not have permission to view teams.', 403));
    }

    const teams = await Team.find(filter)
        .populate({ path: 'teamLead', select: 'name email contactNo' })
        .populate({ path: 'members', select: 'name email contactNo' }); // Populate team members (Sales Executives)

    res.status(200).json({
        status: 'success',
        results: teams.length,
        data: {
            teams
        }
    });
});

// GET SINGLE TEAM (Manager gets any, Team Lead gets their own)
exports.getTeam = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;
    const teamId = req.params.id;

    let team = await Team.findById(teamId)
        .populate({ path: 'teamLead', select: 'name email contactNo' })
        .populate({ path: 'members', select: 'name email contactNo' }); // Populate team members (Sales Executives)

    if (!team) {
        return next(new AppError('No team found with that ID.', 404));
    }

    // Authorization check
    if (currentUserRole === ROLES.TEAM_LEAD && team.teamLead.toString() !== currentUserId.toString()) {
        return next(new AppError('You do not have permission to view this team.', 403));
    }
    // Manager automatically has access

    res.status(200).json({
        status: 'success',
        data: {
            team
        }
    });
});

// UPDATE TEAM (Manager Only)
exports.updateTeam = catchAsync(async (req, res, next) => {
    const teamId = req.params.id;
    const { name, teamLeadId, addMembers, removeMembers } = req.body;

    const team = await Team.findById(teamId);
    if (!team) {
        return next(new AppError('No team found with that ID.', 404));
    }

    const filteredBody = filterObj(req.body, 'name'); // Only 'name' can be directly updated on the team document
    const updateOps = { ...filteredBody };

    // Handle Team Lead reassignment if teamLeadId is provided
    if (teamLeadId && teamLeadId.toString() !== team.teamLead.toString()) {
        const newTeamLead = await User.findById(teamLeadId);
        if (!newTeamLead || newTeamLead.role !== ROLES.TEAM_LEAD) {
            return next(new AppError('Invalid new Team Lead ID provided or user is not a Team Lead.', 400));
        }
        // Check if the new TL is already assigned to another team
        const existingTeamForNewTL = await Team.findOne({ teamLead: teamLeadId });
        if (existingTeamForNewTL && existingTeamForNewTL._id.toString() !== teamId) {
            return next(new AppError('New Team Lead is already assigned to another team.', 400));
        }

        // Unassign old TL from their team field
        if (team.teamLead) {
            await User.findByIdAndUpdate(team.teamLead, { $unset: { team: "" } });
        }
        updateOps.teamLead = teamLeadId;
        // Assign new TL to this team
        await User.findByIdAndUpdate(teamLeadId, { $set: { team: team._id } });
    }

    // Handle adding members (Sales Executives)
    if (Array.isArray(addMembers) && addMembers.length > 0) {
        const executivesToAdd = await User.find({ _id: { $in: addMembers }, role: ROLES.SALES_EXECUTIVE });
        if (executivesToAdd.length !== addMembers.length) {
            return next(new AppError('One or more IDs in addMembers are not valid Sales Executives.', 400));
        }
        // Add members to the team's 'members' array (virtual populate uses 'team' field on user)
        // More importantly, update the 'team' and 'manager' fields on the User documents
        await User.updateMany(
            { _id: { $in: addMembers }, role: ROLES.SALES_EXECUTIVE },
            { $set: { team: team._id, manager: team.teamLead } }
        );
    }

    // Handle removing members (Sales Executives)
    if (Array.isArray(removeMembers) && removeMembers.length > 0) {
        // Remove members from the team's 'members' array (virtual populate uses 'team' field on user)
        // More importantly, unset the 'team' and 'manager' fields on the User documents
        await User.updateMany(
            { _id: { $in: removeMembers }, role: ROLES.SALES_EXECUTIVE, team: teamId }, // Ensure they are actually in this team
            { $unset: { team: "", manager: "" } } // Unset manager too, as they no longer report to this TL
        );
    }

    const updatedTeam = await Team.findByIdAndUpdate(teamId, updateOps, {
        new: true,
        runValidators: true
    })
        .populate({ path: 'teamLead', select: 'name email contactNo' })
        .populate({ path: 'members', select: 'name email contactNo' });

    res.status(200).json({
        status: 'success',
        data: {
            team: updatedTeam
        }
    });
});


// DELETE TEAM (Manager Only)
exports.deleteTeam = catchAsync(async (req, res, next) => {
    const teamId = req.params.id;

    const team = await Team.findById(teamId);
    if (!team) {
        return next(new AppError('No team found with that ID to delete.', 404));
    }

    // Before deleting the team, disassociate its Team Lead and Sales Executives
    // Unset the 'team' field for the Team Lead
    await User.findByIdAndUpdate(team.teamLead, { $unset: { team: "" } });

    // Unset 'team' and 'manager' fields for all Sales Executives in this team
    await User.updateMany(
        { team: teamId, role: ROLES.SALES_EXECUTIVE },
        { $unset: { team: "", manager: "" } }
    );

    // Delete the team document
    await Team.findByIdAndDelete(teamId);

    res.status(204).json({ // 204 No Content for successful deletion
        status: 'success',
        data: null
    });
});