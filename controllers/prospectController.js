// controllers/prospectController.js
const Prospect = require('../models/Prospect');
const User = require('../models/User'); // To find executives/TLs
const Team = require('../models/Team'); // To find team info if needed
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

// CREATE PROSPECT
exports.createProspect = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;
    const { companyName, clientName, emailId, contactNo, reminderDate, comment, assignedToExecutiveEmail, prospectId } = req.body;

    // --- DEBUGGING LOG START ---
    console.log("Backend (prospectController): createProspect received request. req.body:", req.body);
    console.log("Backend (prospectController): Current User (from JWT):", { id: currentUserId, role: currentUserRole });
    // --- DEBUGGING LOG END ---

    // Basic validation
    if (!companyName || !clientName) {
        return next(new AppError('Please provide company name and client name.', 400));
    }

    let salesExecutiveId = currentUserId; // Default to the creator
    let assignedTeamLeadId = null;

    if (currentUserRole === ROLES.SALES_EXECUTIVE) {
        salesExecutiveId = currentUserId;
        const executive = await User.findById(currentUserId).select('manager'); // 'manager' field holds TL's ID
        if (!executive || !executive.manager) {
            // --- DEBUGGING LOG START ---
            console.error("Backend Error (prospectController): Sales Executive not linked to a Team Lead. Executive ID:", currentUserId);
            // --- DEBUGGING LOG END ---
            return next(new AppError('Executive not linked to a Team Lead. Cannot create prospect.', 500));
        }
        assignedTeamLeadId = executive.manager;

    } else if (currentUserRole === ROLES.TEAM_LEAD) {
        // Team Lead creates: They can assign to one of their executives or themselves
        // If assignedToExecutiveEmail is provided, assign to that executive
        if (assignedToExecutiveEmail) { // This field is not sent by current frontend form
            const assignedExec = await User.findOne({ email: assignedToExecutiveEmail, role: ROLES.SALES_EXECUTIVE, manager: currentUserId });
            if (!assignedExec) {
                // --- DEBUGGING LOG START ---
                console.error("Backend Error (prospectController): TL tried to assign prospect to executive not found or not part of their team.", { assignedToExecutiveEmail, currentUserId });
                // --- DEBUGGING LOG END ---
                return next(new AppError('Assigned executive not found or not part of your team.', 400));
            }
            salesExecutiveId = assignedExec._id;
        } else {
            // If TL creates and doesn't explicitly assign, it's assigned to the TL themselves.
            // This is the common path for TLs creating from their simplified form.
            salesExecutiveId = currentUserId;
        }
        assignedTeamLeadId = currentUserId; // The TL creating is the assigned TL

    } else if (currentUserRole === ROLES.MANAGER) {
        // Manager creates: They must assign to an executive
        if (!assignedToExecutiveEmail) {
            // --- DEBUGGING LOG START ---
            console.error("Backend Error (prospectController): Manager tried to create prospect without assigning to executive.");
            // --- DEBUGGING LOG END ---
            return next(new AppError('Manager must assign prospect to a Sales Executive.', 400));
        }
        const assignedExec = await User.findOne({ email: assignedToExecutiveEmail, role: ROLES.SALES_EXECUTIVE });
        if (!assignedExec) {
            // --- DEBUGGING LOG START ---
            console.error("Backend Error (prospectController): Manager tried to assign prospect to executive not found.", { assignedToExecutiveEmail });
            // --- DEBUGGING LOG END ---
            return next(new AppError('Assigned executive not found.', 400));
        }
        salesExecutiveId = assignedExec._id;
        const executive = await User.findById(salesExecutiveId).select('manager');
        if (!executive || !executive.manager) {
            // --- DEBUGGING LOG START ---
            console.error("Backend Error (prospectController): Assigned executive not linked to a Team Lead. Executive ID:", assignedExecutiveId);
            // --- DEBUGGING LOG END ---
            return next(new AppError('Assigned executive not linked to a Team Lead. Cannot create prospect.', 400));
        }
        assignedTeamLeadId = executive.manager;
    }

    // --- DEBUGGING LOG START ---
    console.log("Backend (prospectController): Assigning Prospect to Sales Executive ID:", salesExecutiveId, " and Team Lead ID:", assignedTeamLeadId);
    // --- DEBUGGING LOG END ---

    const newProspect = await Prospect.create({
        companyName,
        clientName,
        emailId,
        contactNo,
        reminderDate,
        comment,
        salesExecutive: salesExecutiveId,
        teamLead: assignedTeamLeadId,
        activity: 'New', // Default activity status
        isUntouched: true // Mark as untouched initially
    });

    // --- DEBUGGING LOG START ---
    console.log("Backend (prospectController): Prospect successfully saved to DB:", newProspect);
    // --- DEBUGGING LOG END ---

    // If a prospect ID was provided (e.g., from a form submission related to an existing prospect), mark it as 'Converted'
    if (prospectId) {
        // --- DEBUGGING LOG START ---
        console.log("Backend (prospectController): Attempting to update prospect ID", prospectId, "to 'Converted' status.");
        // --- DEBUGGING LOG END ---
        await Prospect.findByIdAndUpdate(prospectId, { activity: 'Converted', isUntouched: false, lastUpdate: Date.now() });
    }

    res.status(201).json({
        status: 'success',
        data: {
            prospect: newProspect
        }
    });
});

// GET ALL PROSPECTS (Role-based filtering)
exports.getAllProspects = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;
    let filter = {};

    // Filtering based on user's role
    if (currentUserRole === ROLES.SALES_EXECUTIVE) {
        filter.salesExecutive = currentUserId;
    } else if (currentUserRole === ROLES.TEAM_LEAD) {
        // Team Lead sees prospects of their direct sales executives
        const teamMembers = await User.find({ manager: currentUserId, role: ROLES.SALES_EXECUTIVE }).select('_id');
        const teamMemberIds = teamMembers.map(member => member._id);
        filter.salesExecutive = { $in: teamMemberIds };
    } else if (currentUserRole === ROLES.MANAGER) {
        // Manager sees all prospects - no additional filter needed here
    }

    // Apply additional filters from query parameters (e.g., memberId, date, startDate, endDate)
    if (req.query.memberId) { // For TL/Manager to filter by specific executive
        const memberId = req.query.memberId;
        // Validate if the memberId belongs to the current TL's team if TL is making the request
        if (currentUserRole === ROLES.TEAM_LEAD) {
            const memberOfTeam = await User.findOne({ _id: memberId, manager: currentUserId, role: ROLES.SALES_EXECUTIVE });
            if (!memberOfTeam) {
                return next(new AppError('You do not have permission to view prospects for this team member.', 403));
            }
        } else if (currentUserRole === ROLES.SALES_EXECUTIVE) {
            // Sales Exec cannot filter by other member IDs for getAllProspects
            return next(new AppError('Sales Executives cannot filter prospects by other member IDs.', 403));
        }
        filter.salesExecutive = memberId;
    }

    if (req.query.startDate && req.query.endDate) {
        filter.createdAt = {
            $gte: new Date(req.query.startDate),
            $lte: new Date(req.query.endDate)
        };
    } else if (req.query.date) { // For single day filter
        const date = new Date(req.query.date);
        const startOfDay = new Date(date.setHours(0,0,0,0));
        const endOfDay = new Date(date.setHours(23,59,59,999));
        filter.createdAt = { $gte: startOfDay, $lte: endOfDay };
    }

    const prospects = await Prospect.find(filter)
        .populate({ path: 'salesExecutive', select: 'name email' })
        .populate({ path: 'teamLead', select: 'name email' })
        .sort('-lastUpdate'); // Sort by most recent update

    res.status(200).json({
        status: 'success',
        results: prospects.length,
        data: {
            prospects
        }
    });
});

// GET SINGLE PROSPECT
exports.getProspect = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;
    const prospectId = req.params.id;

    let prospect = await Prospect.findById(prospectId)
        .populate({ path: 'salesExecutive', select: 'name email' })
        .populate({ path: 'teamLead', select: 'name email' });

    if (!prospect) {
        return next(new AppError('No prospect found with that ID', 404));
    }

    // Authorization check: Ensure user has permission to view this specific prospect
    if (currentUserRole === ROLES.SALES_EXECUTIVE && prospect.salesExecutive.toString() !== currentUserId.toString()) {
        return next(new AppError('You do not have permission to view this prospect.', 403));
    }
    if (currentUserRole === ROLES.TEAM_LEAD) {
        // TL can view if the prospect's executive is one of their direct reports
        const executiveBelongsToTL = await User.exists({ _id: prospect.salesExecutive._id, manager: currentUserId });
        if (!executiveBelongsToTL) {
             return next(new AppError('You do not have permission to view this prospect.', 403));
        }
    }
    // Manager automatically has access

    res.status(200).json({
        status: 'success',
        data: {
            prospect
        }
    });
});

// UPDATE PROSPECT (Sales Executive can update their own, TL can update their team's, Manager can update any)
exports.updateProspect = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;
    const prospectId = req.params.id;

    const allowedFields = ['companyName', 'clientName', 'emailId', 'contactNo', 'reminderDate', 'comment', 'activity', 'isUntouched'];
    const filteredBody = filterObj(req.body, ...allowedFields);

    // If activity is updated, set lastUpdate
    if (filteredBody.activity) {
        filteredBody.lastUpdate = Date.now();
    }

    // Find the prospect to check ownership/permissions
    const prospect = await Prospect.findById(prospectId);
    if (!prospect) {
        return next(new AppError('No prospect found with that ID', 404));
    }

    // Authorization check
    let authorizedToUpdate = false;
    if (currentUserRole === ROLES.SALES_EXECUTIVE && prospect.salesExecutive.toString() === currentUserId.toString()) {
        authorizedToUpdate = true;
    } else if (currentUserRole === ROLES.TEAM_LEAD) {
        // TL can update if the prospect's executive reports to them
        const executiveBelongsToTL = await User.exists({ _id: prospect.salesExecutive._id, manager: currentUserId });
        if (executiveBelongsToTL) authorizedToUpdate = true;
    } else if (currentUserRole === ROLES.MANAGER) {
        authorizedToUpdate = true; // Manager can update any
    }

    if (!authorizedToUpdate) {
        return next(new AppError('You do not have permission to update this prospect.', 403));
    }

    // Update prospect
    const updatedProspect = await Prospect.findByIdAndUpdate(prospectId, filteredBody, {
        new: true,
        runValidators: true
    });

    res.status(200).json({
        status: 'success',
        data: {
            prospect: updatedProspect
        }
    });
});

// DELETE PROSPECT (Manager Only, as restricted in routes)
exports.deleteProspect = catchAsync(async (req, res, next) => {
    const prospectId = req.params.id;

    const prospect = await Prospect.findByIdAndDelete(prospectId);

    if (!prospect) {
        return next(new AppError('No prospect found with that ID to delete', 404));
    }

    res.status(204).json({ // 204 No Content for successful deletion
        status: 'success',
        data: null
    });
});


// GET UNTOUCHED PROSPECTS (Manager sees all untouched, Team Lead sees their team's untouched)
exports.getUntouchedProspects = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;
    let filter = { isUntouched: true }; // Base filter for untouched data

    // Apply additional filters from query parameters (e.g., Member Name, Date)
    if (req.query.memberId) { // For TL/Manager to filter by specific executive
        const memberId = req.query.memberId;
        // Validate if the memberId is valid for the current user's scope
        if (currentUserRole === ROLES.TEAM_LEAD) {
            const memberOfTeam = await User.findOne({ _id: memberId, manager: currentUserId, role: ROLES.SALES_EXECUTIVE });
            if (!memberOfTeam) {
                return next(new AppError('You do not have permission to view untouched prospects for this team member.', 403));
            }
        } else if (currentUserRole === ROLES.SALES_EXECUTIVE) {
            // Sales Exec cannot filter by other member IDs for getAllProspects
            return next(new AppError('Sales Executives do not have access to the general untouched data view.', 403));
        }
        filter.salesExecutive = memberId;
    }

    if (req.query.startDate && req.query.endDate) {
        filter.createdAt = {
            $gte: new Date(req.query.startDate),
            $lte: new Date(req.query.endDate)
        };
    } else if (req.query.date) { // For single day filter
        const date = new Date(req.query.date);
        const startOfDay = new Date(date.setHours(0,0,0,0));
        const endOfDay = new Date(date.setHours(23,59,59,999));
        filter.createdAt = { $gte: startOfDay, $lte: endOfDay };
    }

    // Apply role-based scope
    if (currentUserRole === ROLES.SALES_EXECUTIVE) {
        // Sales Executives typically don't access a general 'untouched' list beyond their own prospects.
        return next(new AppError('Sales Executives do not have access to the general untouched data view.', 403));
    } else if (currentUserRole === ROLES.TEAM_LEAD) {
        // Team Lead sees untouched prospects of their direct sales executives
        const teamMembers = await User.find({ manager: currentUserId, role: ROLES.SALES_EXECUTIVE }).select('_id');
        const teamMemberIds = teamMembers.map(member => member._id);
        filter.salesExecutive = { $in: teamMemberIds };
    } else if (currentUserRole === ROLES.MANAGER) {
        // Manager sees all untouched prospects - no additional filter needed here
    }

    const untouchedProspects = await Prospect.find(filter)
        .populate({ path: 'salesExecutive', select: 'name email' })
        .populate({ path: 'teamLead', select: 'name email' })
        .sort('-createdAt'); // Sort by creation date

    res.status(200).json({
        status: 'success',
        results: untouchedProspects.length,
        data: {
            prospects: untouchedProspects
        }
    });
});