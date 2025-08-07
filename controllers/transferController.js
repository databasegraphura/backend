// controllers/transferController.js
const TransferLog = require('../models/TransferLog');
const Prospect = require('../models/Prospect');
const Sales = require('../models/Sales');
const User = require('../models/User'); // For user lookup
const Team = require('../models/Team'); // For team-based filtering
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const ROLES = require('../config/roles');

// --- INTERNAL DATA TRANSFER ---
exports.transferInternalData = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;
    const {
        sourceUserId,   // The current owner's ID (Sales Executive or Team Lead)
        targetUserId,   // The new owner's ID (Sales Executive or Team Lead)
        dataIds,        // Array of Prospect or Sales IDs to transfer
        dataType        // 'prospects' or 'sales'
    } = req.body;

    if (!sourceUserId || !targetUserId || !dataIds || !Array.isArray(dataIds) || dataIds.length === 0 || !dataType) {
        return next(new AppError('Missing required transfer data: sourceUserId, targetUserId, dataIds, dataType.', 400));
    }
    if (!['prospects', 'sales'].includes(dataType)) {
        return next(new AppError('Invalid data type. Must be "prospects" or "sales".', 400));
    }

    // 1. Validate Source and Target Users
    const sourceUser = await User.findById(sourceUserId);
    const targetUser = await User.findById(targetUserId);

    if (!sourceUser || !targetUser) {
        return next(new AppError('Source or target user not found.', 404));
    }

    // Basic role check for source/target
    if (![ROLES.SALES_EXECUTIVE, ROLES.TEAM_LEAD].includes(sourceUser.role) || ![ROLES.SALES_EXECUTIVE, ROLES.TEAM_LEAD].includes(targetUser.role)) {
         return next(new AppError('Data can only be transferred between Sales Executives and Team Leads.', 400));
    }

    // 2. Authorization Check (who can transfer what to whom)
    if (currentUserRole === ROLES.TEAM_LEAD) {
        // TL can only transfer data:
        // a) From themselves to their executives.
        // b) Between their own executives.
        if (sourceUser._id.toString() !== currentUserId.toString() && sourceUser.manager.toString() !== currentUserId.toString()) {
            return next(new AppError('You can only transfer data from your own account or your direct reports.', 403));
        }
        // Ensure target user is either current TL or one of their executives
        if (targetUser._id.toString() !== currentUserId.toString() && targetUser.manager.toString() !== currentUserId.toString()) {
             return next(new AppError('You can only transfer data to yourself or your direct reports.', 403));
        }
        // If transferring from executive to executive, ensure both are in current TL's team
        if (sourceUser.role === ROLES.SALES_EXECUTIVE && targetUser.role === ROLES.SALES_EXECUTIVE &&
            (sourceUser.manager.toString() !== currentUserId.toString() || targetUser.manager.toString() !== currentUserId.toString())) {
            return next(new AppError('You can only transfer data between executives in your team.', 403));
        }
        // If source is TL and target is Executive, ensure executive is direct report
        if (sourceUser.role === ROLES.TEAM_LEAD && targetUser.role === ROLES.SALES_EXECUTIVE && targetUser.manager.toString() !== currentUserId.toString()) {
             return next(new AppError('You can only transfer data to your direct reports.', 403));
        }

    } else if (currentUserRole === ROLES.MANAGER) {
        // Manager can transfer data:
        // a) Between any Sales Executives.
        // b) Between any Team Leads.
        // c) Between a TL and an Executive (if TL manages that executive).
        // For simplicity here, Manager has full override. Add more granular checks if needed.
    } else {
        return next(new AppError('You do not have permission to transfer data internally.', 403));
    }

    // 3. Perform the transfer operation on documents
    let updatedCount = 0;
    let transferLogIds = [];
    const updateQuery = { $set: {} };

    if (dataType === 'prospects') {
        updateQuery.$set.salesExecutive = targetUser._id;
        updateQuery.$set.teamLead = targetUser.role === ROLES.TEAM_LEAD ? targetUser._id : targetUser.manager; // If target is exec, keep their TL; if target is TL, they are the TL.
        const result = await Prospect.updateMany(
            { _id: { $in: dataIds }, salesExecutive: sourceUser._id },
            updateQuery
        );
        updatedCount = result.modifiedCount;
        transferLogIds = dataIds; // Log all IDs attempted to transfer
    } else if (dataType === 'sales') {
        updateQuery.$set.salesExecutive = targetUser._id;
        updateQuery.$set.teamLead = targetUser.role === ROLES.TEAM_LEAD ? targetUser._id : targetUser.manager;
        const result = await Sales.updateMany(
            { _id: { $in: dataIds }, salesExecutive: sourceUser._id },
            updateQuery
        );
        updatedCount = result.modifiedCount;
        transferLogIds = dataIds; // Log all IDs attempted to transfer
    }

    if (updatedCount === 0) {
        return next(new AppError('No matching data found to transfer or data already transferred.', 404));
    }

    // 4. Log the transfer
    await TransferLog.create({
        transferType: 'internal_data_transfer',
        transferredBy: currentUserId,
        transferredFrom: sourceUser._id,
        transferredTo: targetUser._id,
        dataCount: updatedCount,
        dataIds: transferLogIds,
    });

    res.status(200).json({
        status: 'success',
        message: `${updatedCount} ${dataType} transferred successfully from ${sourceUser.name} to ${targetUser.name}.`
    });
});

// GET INTERNAL TRANSFER HISTORY
exports.getInternalTransferHistory = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;
    let filter = { transferType: 'internal_data_transfer' };

    // Manager sees all internal transfers
    // Team Lead sees transfers initiated by them, or to/from their direct reports
    if (currentUserRole === ROLES.TEAM_LEAD) {
        const teamMembers = await User.find({ manager: currentUserId, role: ROLES.SALES_EXECUTIVE }).select('_id');
        const teamMemberIds = teamMembers.map(member => member._id);
        filter.$or = [
            { transferredBy: currentUserId }, // Transfers initiated by the TL
            { transferredFrom: { $in: teamMemberIds } }, // Transfers from their executives
            { transferredTo: { $in: teamMemberIds } }, // Transfers to their executives
            { transferredFrom: currentUserId }, // If TL transfers from themselves
            { transferredTo: currentUserId } // If TL receives transfer
        ];
    } else if (currentUserRole !== ROLES.MANAGER) {
        return next(new AppError('You do not have permission to view internal transfer history.', 403));
    }

    const history = await TransferLog.find(filter)
        .populate({ path: 'transferredBy', select: 'name email role' })
        .populate({ path: 'transferredFrom', select: 'name email role' })
        .populate({ path: 'transferredTo', select: 'name email role' })
        .sort('-transferDate');

    res.status(200).json({
        status: 'success',
        results: history.length,
        data: {
            history
        }
    });
});


// --- TRANSFER DATA TO FINANCE ---
exports.transferToFinance = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;
    const { salesIds } = req.body; // Array of Sales IDs to transfer to finance

    if (currentUserRole !== ROLES.MANAGER) {
        return next(new AppError('Only Managers can transfer data to finance.', 403));
    }
    if (!salesIds || !Array.isArray(salesIds) || salesIds.length === 0) {
        return next(new AppError('Please provide sales IDs to transfer to finance.', 400));
    }

    // 1. Mark Sales as transferred (e.g., add a 'transferredToFinance' flag)
    // You might also want to prevent re-transferring already transferred sales.
    const updateResult = await Sales.updateMany(
        { _id: { $in: salesIds }, isTransferredToFinance: { $ne: true } }, // Only transfer if not already
        { $set: { isTransferredToFinance: true, transferredToFinanceDate: Date.now() } }
    );

    if (updateResult.modifiedCount === 0) {
        return next(new AppError('No eligible sales found to transfer to finance (already transferred or invalid IDs).', 404));
    }

    // 2. Create a TransferLog entry for finance transfer
    // Fetch details of the transferred sales for the log
    const transferredSales = await Sales.find({ _id: { $in: salesIds } }).select('companyName clientName amount salesExecutive teamLead');
    const totalAmount = transferredSales.reduce((sum, sale) => sum + sale.amount, 0);

    // Create a log for each sale or a single log for the batch
    // For simplicity, let's create one log for the batch, combining relevant details
    await TransferLog.create({
        transferType: 'transfer_to_finance',
        transferredBy: currentUserId,
        transferredFrom: null, // N/A for finance transfer, or source user if applicable
        transferredTo: null, // N/A as it's a department
        dataCount: updateResult.modifiedCount,
        dataIds: salesIds,
        amount: totalAmount,
        companyName: transferredSales.map(s => s.companyName).join(', '), // List all companies
        clientName: transferredSales.map(s => s.clientName).join(', '), // List all clients
    });

    res.status(200).json({
        status: 'success',
        message: `${updateResult.modifiedCount} sales successfully marked for finance transfer. Total amount: ${totalAmount}.`
    });
});

// GET FINANCE TRANSFER HISTORY
exports.getFinanceTransferHistory = catchAsync(async (req, res, next) => {
    const { role: currentUserRole } = req.user;

    if (currentUserRole !== ROLES.MANAGER) {
        return next(new AppError('You do not have permission to view finance transfer history.', 403));
    }

    const history = await TransferLog.find({ transferType: 'transfer_to_finance' })
        .populate({ path: 'transferredBy', select: 'name email' })
        .sort('-transferDate');

    res.status(200).json({
        status: 'success',
        results: history.length,
        data: {
            history
        }
    });
});