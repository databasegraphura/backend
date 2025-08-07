// controllers/callLogController.js
const CallLog = require('../models/CallLog');
const Prospect = require('../models/Prospect'); // To update prospect activity from call log
const User = require('../models/User'); // To find executives/TLs for filtering
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

// CREATE CALL LOG
exports.createCallLog = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;
    const { companyName, clientName, emailId, contactNo, activity, comment, prospectId } = req.body;

    // Basic validation
    if (!companyName || !clientName || !activity) {
        return next(new AppError('Please provide company name, client name, and activity.', 400));
    }

    let salesExecutiveId = currentUserId; // Default to the creator

    // If a TL or Manager creates a call log, they might assign it to an executive.
    // For now, let's assume call logs are primarily created by the executive performing the call.
    // If a TL/Manager needs to create one on behalf of someone, 'assignedToExecutiveId' should be in req.body.

    // If current user is Executive, they are the salesExecutive
    if (currentUserRole === ROLES.SALES_EXECUTIVE) {
        salesExecutiveId = currentUserId;
    } else {
        // For TL/Manager creating a call log, if not on behalf of an executive,
        // it's not a direct 'sales executive' call log in the spirit of the UI.
        // For simplicity, let's enforce that call logs are always tied to a Sales Executive.
        return next(new AppError('Only Sales Executives can log direct calls. Managers/Team Leads manage via executive reports.', 403));
        // If you want TL/Manager to log calls on behalf of an executive,
        // you'd add 'assignedToExecutiveId' to req.body and validate it here.
    }

    const newCallLog = await CallLog.create({
        companyName,
        clientName,
        emailId,
        contactNo,
        activity,
        comment,
        salesExecutive: salesExecutiveId,
        prospect: prospectId // Link to a prospect if this call is related to one
    });

    // If prospectId is provided, update the prospect's activity and lastUpdate
    if (prospectId) {
        await Prospect.findByIdAndUpdate(prospectId, {
            activity: activity, // Update prospect's activity to the call's activity
            lastUpdate: Date.now(),
            isUntouched: false // If a call is logged, it's no longer untouched
        });
    }

    res.status(201).json({
        status: 'success',
        data: {
            callLog: newCallLog
        }
    });
});

// GET ALL CALL LOGS (Role-based filtering)
exports.getAllCallLogs = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;
    let filter = {};

    // Filtering based on user's role
    if (currentUserRole === ROLES.SALES_EXECUTIVE) {
        filter.salesExecutive = currentUserId;
    } else if (currentUserRole === ROLES.TEAM_LEAD) {
        // Team Lead sees call logs of their direct sales executives
        const teamMembers = await User.find({ manager: currentUserId, role: ROLES.SALES_EXECUTIVE }).select('_id');
        const teamMemberIds = teamMembers.map(member => member._id);
        filter.salesExecutive = { $in: teamMemberIds };
    } else if (currentUserRole === ROLES.MANAGER) {
        // Manager sees all call logs - no additional filter needed here
    }

    // Apply additional filters from query parameters (e.g., date, companyName, executiveId)
    if (req.query.date) { // For specific date queries (e.g., Today's Call List)
        const date = new Date(req.query.date);
        const startOfDay = new Date(date.setHours(0,0,0,0));
        const endOfDay = new Date(date.setHours(23,59,59,999));
        filter.callDate = { $gte: startOfDay, $lte: endOfDay };
    }
    if (req.query.companyName) {
        filter.companyName = { $regex: req.query.companyName, $options: 'i' };
    }
    if (req.query.executiveId) { // For TL/Manager to filter by specific executive
        const executiveId = req.query.executiveId;
        if (currentUserRole === ROLES.TEAM_LEAD) {
            const isMyExecutive = await User.exists({ _id: executiveId, manager: currentUserId, role: ROLES.SALES_EXECUTIVE });
            if (!isMyExecutive) {
                 return next(new AppError('You can only filter by executives in your team.', 403));
            }
        }
        filter.salesExecutive = executiveId;
    }


    const callLogs = await CallLog.find(filter)
        .populate({ path: 'salesExecutive', select: 'name email' })
        .populate({ path: 'prospect', select: 'companyName clientName' }) // Populate prospect details
        .sort('-callDate'); // Sort by most recent call date

    res.status(200).json({
        status: 'success',
        results: callLogs.length,
        data: {
            callLogs
        }
    });
});

// GET SINGLE CALL LOG
exports.getCallLog = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;
    const callLogId = req.params.id;

    let callLog = await CallLog.findById(callLogId)
        .populate({ path: 'salesExecutive', select: 'name email' })
        .populate({ path: 'prospect', select: 'companyName clientName' });

    if (!callLog) {
        return next(new AppError('No call log found with that ID', 404));
    }

    // Authorization check: Ensure user has permission to view this specific call log
    if (currentUserRole === ROLES.SALES_EXECUTIVE && callLog.salesExecutive.toString() !== currentUserId.toString()) {
        return next(new AppError('You do not have permission to view this call log.', 403));
    }
    if (currentUserRole === ROLES.TEAM_LEAD) {
        // TL can view if the call log's executive reports to them
        const executiveBelongsToTL = await User.exists({ _id: callLog.salesExecutive._id, manager: currentUserId });
        if (!executiveBelongsToTL) {
             return next(new AppError('You do not have permission to view this call log.', 403));
        }
    }
    // Manager automatically has access

    res.status(200).json({
        status: 'success',
        data: {
            callLog
        }
    });
});

// UPDATE CALL LOG (Used for "Update Call Details" pop-ups)
exports.updateCallLog = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;
    const callLogId = req.params.id;

    // Allowed fields to update in a call log
    const allowedFields = ['activity', 'comment'];
    const filteredBody = filterObj(req.body, ...allowedFields);

    const callLog = await CallLog.findById(callLogId);
    if (!callLog) {
        return next(new AppError('No call log found with that ID', 404));
    }

    // Authorization check: User must own the call log, or be its TL/Manager
    let authorizedToUpdate = false;
    if (currentUserRole === ROLES.SALES_EXECUTIVE && callLog.salesExecutive.toString() === currentUserId.toString()) {
        authorizedToUpdate = true;
    } else if (currentUserRole === ROLES.TEAM_LEAD) {
        const executiveBelongsToTL = await User.exists({ _id: callLog.salesExecutive._id, manager: currentUserId });
        if (executiveBelongsToTL) authorizedToUpdate = true;
    } else if (currentUserRole === ROLES.MANAGER) {
        authorizedToUpdate = true; // Manager can update any
    }

    if (!authorizedToUpdate) {
        return next(new AppError('You do not have permission to update this call log.', 403));
    }

    // Update the call log
    const updatedCallLog = await CallLog.findByIdAndUpdate(callLogId, filteredBody, {
        new: true,
        runValidators: true
    });

    // If a prospect is linked and activity is 'Delete Client\'s Profile', update prospect
    if (updatedCallLog.prospect && updatedCallLog.activity === 'Delete Client\'s Profile') {
        await Prospect.findByIdAndUpdate(updatedCallLog.prospect, {
            activity: 'Deleted', // Or 'Archived', etc.
            isUntouched: false,
            lastUpdate: Date.now()
        });
    }


    res.status(200).json({
        status: 'success',
        data: {
            callLog: updatedCallLog
        }
    });
});