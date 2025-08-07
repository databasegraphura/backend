// controllers/reportController.js
const User = require('../models/User');
const Sales = require('../models/Sales');
const Prospect = require('../models/Prospect');
const CallLog = require('../models/CallLog');
const Team = require('../models/Team'); // Needed for team-related lookups
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const ROLES = require('../config/roles');

// Helper to get start/end of day/month/year
const getStartOfDay = (date = new Date()) => new Date(date.setHours(0, 0, 0, 0));
const getEndOfDay = (date = new Date()) => new Date(date.setHours(23, 59, 59, 999));
const getStartOfMonth = (date = new Date()) => new Date(date.getFullYear(), date.getMonth(), 1);
const getEndOfMonth = (date = new Date()) => new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
const getStartOfLastMonth = (date = new Date()) => new Date(date.getFullYear(), date.getMonth() - 1, 1);
const getEndOfLastMonth = (date = new Date()) => new Date(date.getFullYear(), date.getMonth(), 0, 23, 59, 59, 999);


// --- DASHBOARD SUMMARY ---
exports.getDashboardSummary = catchAsync(async (req, res, next) => {
    const { id: userId, role } = req.user;
    let dashboardData = {};

    try {
        switch (role) {
            case ROLES.SALES_EXECUTIVE:
                // Sales Executive Dashboard (Screenshot 2025-07-27 114551.png)
                dashboardData.totalClientsData = await Prospect.countDocuments({ salesExecutive: userId, activity: 'Converted' }); // Assuming 'Client Data' means converted prospects
                dashboardData.totalSales = await Sales.aggregate([
                    { $match: { salesExecutive: userId } },
                    { $group: { _id: null, totalAmount: { $sum: '$amount' } } }
                ]);
                dashboardData.totalSales = dashboardData.totalSales.length > 0 ? dashboardData.totalSales[0].totalAmount : 0;

                // 'Last Month Payout' - This requires a Payout/Salary system, which is not fully modeled yet.
                // For now, provide a placeholder or calculate based on sales with a commission rate.
                dashboardData.lastMonthPayout = 0; // Placeholder for now

                // Prospect Number (excluding converted ones)
                dashboardData.prospectNumber = await Prospect.countDocuments({ salesExecutive: userId, activity: { $ne: 'Converted' } });

                break;

            case ROLES.TEAM_LEAD:
                // Sales Team Lead Dashboard (Screenshot 2025-07-27 105750.png)
                const tlTeam = await Team.findOne({ teamLead: userId }).select('_id');
                let teamMemberIds = []; // Executives under this TL

                if (tlTeam) {
                    const teamMembers = await User.find({ team: tlTeam._id, role: ROLES.SALES_EXECUTIVE }).select('_id');
                    teamMemberIds = teamMembers.map(member => member._id);
                } else {
                    // If TL doesn't have a team, they see no team data.
                    dashboardData = {
                        teamMembers: 0,
                        totalCallByTeam: 0,
                        totalProspect: 0,
                        totalClientData: 0
                    };
                    res.status(200).json({ status: 'success', data: dashboardData });
                    return;
                }

                dashboardData.teamMembers = teamMemberIds.length;
                dashboardData.totalCallByTeam = await CallLog.countDocuments({ salesExecutive: { $in: teamMemberIds } });
                dashboardData.totalProspect = await Prospect.countDocuments({ salesExecutive: { $in: teamMemberIds } });
                dashboardData.totalClientData = await Sales.countDocuments({ salesExecutive: { $in: teamMemberIds } }); // Assuming "Total Client Data" means closed sales

                break;

            case ROLES.MANAGER:
                // Sales Manager Dashboard (Screenshot 2025-07-26 165244.png)

                // Total Sales (overall)
                const totalSalesResult = await Sales.aggregate([{ $group: { _id: null, totalAmount: { $sum: '$amount' } } }]);
                dashboardData.totalSales = totalSalesResult.length > 0 ? totalSalesResult[0].totalAmount : 0;

                // Last Month Sales
                const lastMonthSalesResult = await Sales.aggregate([
                    { $match: { saleDate: { $gte: getStartOfLastMonth(), $lte: getEndOfLastMonth() } } },
                    { $group: { _id: null, totalAmount: { $sum: '$amount' } } }
                ]);
                dashboardData.lastMonthSales = lastMonthSalesResult.length > 0 ? lastMonthSalesResult[0].totalAmount : 0;

                // This Month Sales
                const thisMonthSalesResult = await Sales.aggregate([
                    { $match: { saleDate: { $gte: getStartOfMonth(), $lte: getEndOfMonth() } } },
                    { $group: { _id: null, totalAmount: { $sum: '$amount' } } }
                ]);
                dashboardData.thisMonthSales = thisMonthSalesResult.length > 0 ? thisMonthSalesResult[0].totalAmount : 0;

                // Today's Sales
                const todaySalesResult = await Sales.aggregate([
                    { $match: { saleDate: { $gte: getStartOfDay(), $lte: getEndOfDay() } } },
                    { $group: { _id: null, totalAmount: { $sum: '$amount' } } }
                ]);
                dashboardData.todaySales = todaySalesResult.length > 0 ? todaySalesResult[0].totalAmount : 0;

                dashboardData.totalTransferData = 0; // Requires a TransferLog collection, placeholder for now
                dashboardData.totalEmployees = await User.countDocuments({ role: { $in: [ROLES.SALES_EXECUTIVE, ROLES.TEAM_LEAD] } });
                dashboardData.totalTLs = await User.countDocuments({ role: ROLES.TEAM_LEAD });
                dashboardData.totalProspectOverall = await Prospect.countDocuments({});
                dashboardData.todayProspect = await Prospect.countDocuments({ createdAt: { $gte: getStartOfDay(), $lte: getEndOfDay() } });

                // Income calculations would require a dedicated income/payouts collection
                dashboardData.monthlyIncome = 0; // Placeholder
                dashboardData.lastMonthIncome = 0; // Placeholder
                dashboardData.totalIncome = 0; // Placeholder
                dashboardData.totalImportData = 0; // Requires an 'isImported' flag on Prospects or specific import logs, placeholder

                break;

            default:
                return next(new AppError('Forbidden: Unknown role or dashboard not configured for this role.', 403));
        }

        res.status(200).json({
            status: 'success',
            data: dashboardData
        });

    } catch (error) {
        console.error('Error fetching dashboard summary:', error);
        return next(new AppError('Failed to fetch dashboard data.', 500));
    }
});

// --- PERFORMANCE REPORT ---
// This handles the 'Report' section for all three roles, with filters for Day/Month and Team Lead Name.
exports.getPerformanceReport = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;
    const { period, teamLeadId } = req.query; // period: 'day', 'month'; teamLeadId: optional for Manager/TL

    let filterDate = {};
    if (period === 'day') {
        filterDate = { $gte: getStartOfDay(), $lte: getEndOfDay() };
    } else if (period === 'month') {
        filterDate = { $gte: getStartOfMonth(), $lte: getEndOfMonth() };
    } else {
        return next(new AppError('Please provide a valid period (day or month) for the report.', 400));
    }

    let usersToReport = []; // IDs of users whose data we'll aggregate

    // Determine the scope of users based on the current user's role
    if (currentUserRole === ROLES.SALES_EXECUTIVE) {
        // Executive only sees their own data
        usersToReport = [currentUserId];
    } else if (currentUserRole === ROLES.TEAM_LEAD) {
        // Team Lead sees their own data + their direct sales executives
        const teamMembers = await User.find({ manager: currentUserId, role: ROLES.SALES_EXECUTIVE }).select('_id');
        usersToReport = [currentUserId, ...teamMembers.map(member => member._id)];

        // If TL is trying to filter by another TL (not applicable, but to prevent misuse)
        if (teamLeadId && teamLeadId.toString() !== currentUserId.toString()) {
            return next(new AppError('Team Leads can only view reports for their own team.', 403));
        }
    } else if (currentUserRole === ROLES.MANAGER) {
        // Manager sees all data, or filtered by a specific Team Lead
        if (teamLeadId) {
            // If filtering by a specific TL, get that TL's executives + the TL themselves
            const targetTL = await User.findById(teamLeadId);
            if (!targetTL || targetTL.role !== ROLES.TEAM_LEAD) {
                return next(new AppError('Specified Team Lead not found or invalid.', 400));
            }
            const tlTeamMembers = await User.find({ manager: targetTL._id, role: ROLES.SALES_EXECUTIVE }).select('_id');
            usersToReport = [targetTL._id, ...tlTeamMembers.map(member => member._id)];
        } else {
            // Manager wants all data for all relevant roles
            const allSalesPersonnel = await User.find({ role: { $in: [ROLES.SALES_EXECUTIVE, ROLES.TEAM_LEAD] } }).select('_id');
            usersToReport = allSalesPersonnel.map(user => user._id);
        }
    } else {
        return next(new AppError('You do not have permission to view this report.', 403));
    }

    // Fetch data for each user in the scope
    const reportData = [];
    for (const userRefId of usersToReport) {
        const user = await User.findById(userRefId).select('name role');
        if (!user) continue; // Skip if user not found (e.g., deleted)

        const totalCalls = await CallLog.countDocuments({ salesExecutive: user._id, callDate: filterDate });
        const totalProspects = await Prospect.countDocuments({ salesExecutive: user._id, createdAt: filterDate });
        const untouchedData = await Prospect.countDocuments({ salesExecutive: user._id, isUntouched: true, createdAt: filterDate }); // Untouched within the period
        const totalSalesAmount = await Sales.aggregate([
            { $match: { salesExecutive: user._id, saleDate: filterDate } },
            { $group: { _id: null, totalAmount: { $sum: '$amount' } } }
        ]);
        const monthlySales = totalSalesAmount.length > 0 ? totalSalesAmount[0].totalAmount : 0;
        const totalSalesCount = await Sales.countDocuments({ salesExecutive: user._id, saleDate: filterDate });

        reportData.push({
            name: user.name,
            role: user.role,
            totalCalls: totalCalls,
            totalProspects: totalProspects,
            untouchedData: untouchedData,
            monthlySales: monthlySales, // Renamed from totalSales to monthlySales for period context
            totalSalesCount: totalSalesCount // Added count of sales
        });
    }

    res.status(200).json({
        status: 'success',
        results: reportData.length,
        data: {
            report: reportData
        }
    });
});


// MANAGER CALL REPORT (specific for Manager Dashboard -> Manager Report -> Call Logs)
exports.getManagerCallReport = catchAsync(async (req, res, next) => {
    // This endpoint specifically serves the call logs for the Manager's view,
    // potentially with more details or specific filters from the Manager Report screen.
    // It largely overlaps with CallLog.getAllCallLogs but ensures manager permissions.
    const { id: currentUserId, role: currentUserRole } = req.user;

    if (currentUserRole !== ROLES.MANAGER) {
        return next(new AppError('You do not have permission to access this report.', 403));
    }

    let filter = {};
    // Manager Report -> Call Logs has filters for 'Month' and 'Team Leader Name'
    if (req.query.month) {
        const year = new Date().getFullYear();
        const monthNum = parseInt(req.query.month, 10) - 1;
        const startDate = new Date(year, monthNum, 1);
        const endDate = new Date(year, monthNum + 1, 0, 23, 59, 59, 999);
        filter.callDate = { $gte: startDate, $lte: endDate };
    }
    if (req.query.teamLeadId) {
        filter.teamLead = req.query.teamLeadId; // Assuming TeamLead field in CallLog model
    }
    if (req.query.executiveId) {
        filter.salesExecutive = req.query.executiveId;
    }


    const callLogs = await CallLog.find(filter)
        .populate({ path: 'salesExecutive', select: 'name email' })
        .populate({ path: 'prospect', select: 'companyName clientName' })
        .sort('-callDate');

    res.status(200).json({
        status: 'success',
        results: callLogs.length,
        data: {
            callLogs
        }
    });
});

// MANAGER ACTIVITY LOGS (for "Last Update" section on Manager Dashboard)
exports.getActivityLogs = catchAsync(async (req, res, next) => {
    const { role: currentUserRole } = req.user;

    if (currentUserRole !== ROLES.MANAGER) {
        return next(new AppError('You do not have permission to access activity logs.', 403));
    }

    // Activity logs can come from multiple sources:
    // 1. Prospect updates (lastUpdate field)
    // 2. Sales creation (createdAt field)
    // 3. CallLog creation/update (callDate field, activity)
    // 4. User creation/update (if you log administrative actions)

    // For simplicity, let's pull recent Prospect updates and CallLogs.
    // In a real system, you might have a dedicated 'ActivityLog' collection.

    const prospectUpdates = await Prospect.find()
        .sort('-lastUpdate')
        .limit(20) // Get the 20 most recent updates
        .populate({ path: 'salesExecutive', select: 'name' })
        .select('companyName clientName activity lastUpdate');

    const recentCalls = await CallLog.find()
        .sort('-callDate')
        .limit(20)
        .populate({ path: 'salesExecutive', select: 'name' })
        .select('companyName clientName activity callDate comment');

    // Combine and sort by date
    const combinedActivities = [...prospectUpdates.map(p => ({
        type: 'Prospect Update',
        date: p.lastUpdate,
        description: `Prospect ${p.clientName} (${p.companyName}) activity: ${p.activity}`,
        user: p.salesExecutive ? p.salesExecutive.name : 'N/A'
    })), ...recentCalls.map(c => ({
        type: 'Call Log',
        date: c.callDate,
        description: `Call with ${c.clientName} (${c.companyName}): ${c.activity} - ${c.comment || 'No comment'}`,
        user: c.salesExecutive ? c.salesExecutive.name : 'N/A'
    }))];

    combinedActivities.sort((a, b) => b.date - a.date); // Sort descending by date

    res.status(200).json({
        status: 'success',
        results: combinedActivities.length,
        data: {
            activityLogs: combinedActivities
        }
    });
});