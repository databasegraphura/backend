// controllers/salesController.js
const Sales = require('../models/Sales');
const User = require('../models/User'); // To find executives/TLs for filtering
const Prospect = require('../models/Prospect'); // To potentially update prospect status to 'Converted'
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const ROLES = require('../config/roles');

// Helper to filter allowed fields for updates (though sales are often immutable)
const filterObj = (obj, ...allowedFields) => {
    const newObj = {};
    Object.keys(obj).forEach(el => {
        if (allowedFields.includes(el)) newObj[el] = obj[el];
    });
    return newObj;
};

// CREATE SALE (When a deal is closed, potentially converts a prospect)
exports.createSale = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;
    const {
        companyName,
        clientName,
        emailId,
        contactNo,
        services,
        amount,
        prospectId, // Optional: if this sale originated from a prospect
        assignedToExecutiveEmail // Only for TL/Manager assigning
    } = req.body;

    // Basic validation
    if (!companyName || !clientName || !amount) {
        return next(new AppError('Please provide company name, client name, and amount.', 400));
    }

    let salesExecutiveId = currentUserId; // Default to the creator
    let teamLeadId = null;

    if (currentUserRole === ROLES.SALES_EXECUTIVE) {
        // Executive creates: Sale is assigned to them
        const executive = await User.findById(currentUserId).select('manager');
        if (!executive || !executive.manager) {
            return next(new AppError('Executive not linked to a Team Lead. Cannot create sale.', 500));
        }
        teamLeadId = executive.manager;

    } else if (currentUserRole === ROLES.TEAM_LEAD) {
        // Team Lead creates: They can assign to one of their executives or themselves
        if (assignedToExecutiveEmail) {
            const assignedExec = await User.findOne({ email: assignedToExecutiveEmail, role: ROLES.SALES_EXECUTIVE, manager: currentUserId });
            if (!assignedExec) {
                return next(new AppError('Assigned executive not found or not part of your team.', 400));
            }
            salesExecutiveId = assignedExec._id;
        } else {
            salesExecutiveId = currentUserId; // TL assigning to themselves
        }
        teamLeadId = currentUserId; // The TL creating is the assigned TL

    } else if (currentUserRole === ROLES.MANAGER) {
        // Manager creates: They must assign to an executive
        if (!assignedToExecutiveEmail) {
            return next(new AppError('Manager must assign sale to a Sales Executive.', 400));
        }
        const assignedExec = await User.findOne({ email: assignedToExecutiveEmail, role: ROLES.SALES_EXECUTIVE });
        if (!assignedExec) {
            return next(new AppError('Assigned executive not found.', 400));
        }
        salesExecutiveId = assignedExec._id;
        const executive = await User.findById(salesExecutiveId).select('manager');
        if (!executive || !executive.manager) {
            return next(new AppError('Assigned executive not linked to a Team Lead. Cannot create sale.', 400));
        }
        teamLeadId = executive.manager;
    }

    const newSale = await Sales.create({
        companyName,
        clientName,
        emailId,
        contactNo,
        services,
        amount,
        salesExecutive: salesExecutiveId,
        teamLead: teamLeadId,
        prospect: prospectId // Link to the original prospect if provided
    });

    // If a prospect ID was provided, mark it as 'Converted'
    if (prospectId) {
        await Prospect.findByIdAndUpdate(prospectId, { activity: 'Converted', isUntouched: false, lastUpdate: Date.now() });
    }

    res.status(201).json({
        status: 'success',
        data: {
            sale: newSale
        }
    });
});

// GET ALL SALES (Role-based filtering)
exports.getAllSales = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;
    let filter = {};

    // Filtering based on user's role
    if (currentUserRole === ROLES.SALES_EXECUTIVE) {
        filter.salesExecutive = currentUserId;
    } else if (currentUserRole === ROLES.TEAM_LEAD) {
        // Team Lead sees sales of their direct sales executives
        const teamMembers = await User.find({ manager: currentUserId, role: ROLES.SALES_EXECUTIVE }).select('_id');
        const teamMemberIds = teamMembers.map(member => member._id);
        filter.salesExecutive = { $in: teamMemberIds };
    } else if (currentUserRole === ROLES.MANAGER) {
        // Manager sees all sales - no additional filter needed here
    }

    // Apply additional filters from query parameters (e.g., month, team lead name, client name)
    if (req.query.month) {
        const year = new Date().getFullYear(); // Assuming current year, could be dynamic
        const monthNum = parseInt(req.query.month, 10) - 1; // Months are 0-indexed in JS
        const startDate = new Date(year, monthNum, 1);
        const endDate = new Date(year, monthNum + 1, 0, 23, 59, 59, 999); // Last day of the month
        filter.saleDate = { $gte: startDate, $lte: endDate };
    }
    if (req.query.teamLeadId) { // For Manager to filter by specific TL
        if (currentUserRole === ROLES.MANAGER) {
            filter.teamLead = req.query.teamLeadId;
        } else {
            return next(new AppError('Only Managers can filter sales by Team Lead.', 403));
        }
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
    if (req.query.clientName) {
        filter.clientName = { $regex: req.query.clientName, $options: 'i' }; // Case-insensitive search
    }


    const sales = await Sales.find(filter)
        .populate({ path: 'salesExecutive', select: 'name email' })
        .populate({ path: 'teamLead', select: 'name email' })
        .sort('-saleDate'); // Sort by most recent sale date

    res.status(200).json({
        status: 'success',
        results: sales.length,
        data: {
            sales
        }
    });
});

// GET SINGLE SALE
exports.getSale = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;
    const saleId = req.params.id;

    let sale = await Sales.findById(saleId)
        .populate({ path: 'salesExecutive', select: 'name email' })
        .populate({ path: 'teamLead', select: 'name email' });

    if (!sale) {
        return next(new AppError('No sale found with that ID', 404));
    }

    // Authorization check: Ensure user has permission to view this specific sale
    if (currentUserRole === ROLES.SALES_EXECUTIVE && sale.salesExecutive.toString() !== currentUserId.toString()) {
        return next(new AppError('You do not have permission to view this sale.', 403));
    }
    if (currentUserRole === ROLES.TEAM_LEAD && sale.teamLead.toString() !== currentUserId.toString()) {
        // Also ensure the sale's executive is actually one of their direct reports
        const executiveBelongsToTL = await User.exists({ _id: sale.salesExecutive._id, manager: currentUserId });
        if (!executiveBelongsToTL) {
             return next(new AppError('You do not have permission to view this sale.', 403));
        }
    }
    // Manager automatically has access

    res.status(200).json({
        status: 'success',
        data: {
            sale
        }
    });
});

// Note: Sales records are often considered immutable or have very restricted update/delete permissions.
// If updates are needed, typically only a Manager would do it, and the allowed fields would be very limited.
// For now, no update/delete endpoint is provided as per typical CRM practice, but can be added.