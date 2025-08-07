// controllers/salaryController.js
const Payout = require('../models/Payout');
const User = require('../models/User'); // For populating user details
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

// CREATE PAYOUT (Manager Only)
exports.createPayout = catchAsync(async (req, res, next) => {
    const { user, month, amount, duration, description } = req.body; // 'user' is the employee ID

    if (!user || !month || !amount) {
        return next(new AppError('Please provide user, month, and amount for the payout.', 400));
    }

    // Validate that 'user' exists and is a Sales Executive or Team Lead
    const payoutUser = await User.findById(user);
    if (!payoutUser || ![ROLES.SALES_EXECUTIVE, ROLES.TEAM_LEAD].includes(payoutUser.role)) {
        return next(new AppError('Invalid user ID provided or user is not an eligible employee for payout.', 400));
    }

    // Automatically assign teamLead and manager for the payout record
    const teamLeadId = payoutUser.role === ROLES.SALES_EXECUTIVE ? payoutUser.manager : null; // For exec, manager is TL
    const managerId = payoutUser.role === ROLES.TEAM_LEAD ? payoutUser.manager : (teamLeadId ? (await User.findById(teamLeadId)).manager : null); // For TL, manager is their manager. For exec, it's their TL's manager.

    const newPayout = await Payout.create({
        user,
        month,
        amount,
        duration,
        description,
        teamLead: teamLeadId,
        manager: managerId,
        // The payoutDate defaults to Date.now
    });

    res.status(201).json({
        status: 'success',
        data: {
            payout: newPayout
        }
    });
});

// GET ALL PAYOUTS (Manager Only, filtered by query params like user, month)
exports.getAllPayouts = catchAsync(async (req, res, next) => {
    const filter = {};

    // Filter by user (employee) ID
    if (req.query.userId) {
        filter.user = req.query.userId;
    }
    // Filter by month
    if (req.query.month) {
        filter.month = req.query.month; // Expecting format like "July 2025" or "07-2025"
    }
    // Filter by Team Lead (Manager wants to see payouts for a specific TL's team)
    if (req.query.teamLeadId) {
        filter.teamLead = req.query.teamLeadId;
    }

    const payouts = await Payout.find(filter)
        .populate({ path: 'user', select: 'name email role contactNo' }) // Populate details of the employee
        .populate({ path: 'teamLead', select: 'name email' })
        .populate({ path: 'manager', select: 'name email' })
        .sort('-payoutDate');

    res.status(200).json({
        status: 'success',
        results: payouts.length,
        data: {
            payouts
        }
    });
});

// GET SINGLE PAYOUT (Manager Only)
exports.getPayout = catchAsync(async (req, res, next) => {
    const payoutId = req.params.id;

    const payout = await Payout.findById(payoutId)
        .populate({ path: 'user', select: 'name email role contactNo' })
        .populate({ path: 'teamLead', select: 'name email' })
        .populate({ path: 'manager', select: 'name email' });

    if (!payout) {
        return next(new AppError('No payout record found with that ID.', 404));
    }

    res.status(200).json({
        status: 'success',
        data: {
            payout
        }
    });
});

// UPDATE PAYOUT (Manager Only)
exports.updatePayout = catchAsync(async (req, res, next) => {
    const payoutId = req.params.id;
    const allowedFields = ['month', 'amount', 'duration', 'description']; // Fields that can be updated
    const filteredBody = filterObj(req.body, ...allowedFields);

    const updatedPayout = await Payout.findByIdAndUpdate(payoutId, filteredBody, {
        new: true, // Return the updated document
        runValidators: true // Run schema validators
    });

    if (!updatedPayout) {
        return next(new AppError('No payout record found with that ID.', 404));
    }

    res.status(200).json({
        status: 'success',
        data: {
            payout: updatedPayout
        }
    });
});

// DELETE PAYOUT (Manager Only)
exports.deletePayout = catchAsync(async (req, res, next) => {
    const payoutId = req.params.id;

    const payout = await Payout.findByIdAndDelete(payoutId);

    if (!payout) {
        return next(new AppError('No payout record found with that ID to delete.', 404));
    }

    res.status(204).json({ // 204 No Content for successful deletion
        status: 'success',
        data: null
    });
});