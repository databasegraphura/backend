// controllers/userController.js
const User = require('../models/User');
const Team = require('../models/Team'); // Needed for Team Lead's team context and creating/assigning teams
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const ROLES = require('../config/roles');
const { v4: uuidv4 } = require('uuid'); // For generating unique IDs (e.g., for refId)

// Helper function to filter allowed fields from an object
const filterObj = (obj, ...allowedFields) => {
    const newObj = {};
    Object.keys(obj).forEach(el => {
        if (allowedFields.includes(el)) newObj[el] = obj[el];
    });
    return newObj;
};

// Middleware for the /getMe route. It simply allows the request to proceed
// and getUser will handle identifying the current user based on req.user.id.
exports.getMe = (req, res, next) => {
    next();
};

// CREATE USER (Manager or TL onboarding new users)
exports.createUser = catchAsync(async (req, res, next) => {
    const { role: currentUserRole, id: currentUserId } = req.user;
    // Destructure fields from req.body. Password, passwordConfirm, refId are conditionally handled.
    const { name, email, password, passwordConfirm, refId, role, contactNo, location, joiningDate } = req.body;

    // 1) Basic validation for fields always expected from the frontend form
    if (!name || !email || !role) {
        return next(new AppError('Please provide name, email, and role.', 400));
    }

    // 2) Authorization check for who can create which role
    if (currentUserRole === ROLES.MANAGER) {
        if (![ROLES.TEAM_LEAD, ROLES.SALES_EXECUTIVE].includes(role)) {
            return next(new AppError('Manager can only create Team Leads or Sales Executives.', 403));
        }
    } else if (currentUserRole === ROLES.TEAM_LEAD) {
        if (role !== ROLES.SALES_EXECUTIVE) {
            return next(new AppError('Team Lead can only create Sales Executives.', 403));
        }
    } else {
        return next(new AppError('You do not have permission to create users.', 403));
    }

    // --- IMPORTANT: Conditional handling for password and refId based on creator and role ---
    let finalPassword = password;
    let finalRefId = refId;

    if (currentUserRole === ROLES.TEAM_LEAD && role === ROLES.SALES_EXECUTIVE) {
        // Scenario: Team Lead is creating a Sales Executive via the simplified frontend form.
        // Auto-generate password and refId if not provided.
        if (!password || !passwordConfirm) {
            const generatedPassword = Math.random().toString(36).slice(-10); // Generate a 10-char random password
            finalPassword = generatedPassword;
            // Note: In a real app, this generated password should be securely communicated to the user (e.g., via email).
        } else if (password !== passwordConfirm) {
            return next(new AppError('Password and password confirmation do not match!', 400));
        } else if (password.length < 8) {
            return next(new AppError('Password must be at least 8 characters long!', 400));
        }

        if (!refId) {
            finalRefId = `EXEC-${uuidv4().substring(0, 8).toUpperCase()}`; // Generate a unique refId for new Exec
        }
    } else {
        // Scenario: Manager is creating a Team Lead or Sales Executive, or other direct creation.
        // Password, passwordConfirm, and refId are explicitly required from req.body.
        if (!password || !passwordConfirm || !refId) {
             return next(new AppError('Password, password confirmation, and reference ID are required.', 400));
        }
        if (password !== passwordConfirm) {
            return next(new AppError('Password and password confirmation do not match!', 400));
        }
        if (password.length < 8) {
            return next(new AppError('Password must be at least 8 characters long!', 400));
        }
    }

    // 3) Determine managerId and teamId for the new user based on creator's role and potential assignments
    let newUserManagerId = null;
    let newAssignedTeamId = null;

    if (currentUserRole === ROLES.MANAGER) {
        // Manager creates user:
        // If the manager explicitly assigns a TL (via assignedTeamLeadId in body, if frontend supported it)
        if (req.body.assignedTeamLeadId && (role === ROLES.SALES_EXECUTIVE || role === ROLES.TEAM_LEAD)) {
            const targetTl = await User.findById(req.body.assignedTeamLeadId);
            if (!targetTl || targetTl.role !== ROLES.TEAM_LEAD) {
                 return next(new AppError('Assigned Team Lead ID is invalid or not a Team Lead.', 400));
            }
            newUserManagerId = targetTl._id; // Executive reports to this specific TL
            const tlTeam = await Team.findOne({ teamLead: targetTl._id });
            if (!tlTeam) {
                 return next(new AppError('Assigned Team Lead does not have an associated team.', 400));
            }
            newAssignedTeamId = tlTeam._id;
        } else if (role === ROLES.SALES_EXECUTIVE) {
            // Manager creating SE without explicit TL assignment means unassigned initially
            newUserManagerId = null;
            newAssignedTeamId = null;
        } else if (role === ROLES.TEAM_LEAD) {
            // Manager creating TL: TL's manager is the creating Manager
            newUserManagerId = currentUserId;
        }
    } else if (currentUserRole === ROLES.TEAM_LEAD && role === ROLES.SALES_EXECUTIVE) {
        // Team Lead creates Sales Executive: new executive's manager is the current TL,
        // and the team is the current TL's team.
        newUserManagerId = currentUserId;
        const tlTeam = await Team.findOne({ teamLead: currentUserId });
        if (!tlTeam) {
            return next(new AppError('Team Lead does not have an associated team. Cannot create Sales Executive.', 400));
        }
        newAssignedTeamId = tlTeam._id;
    }

    // 4) Create the new user in the database
    const newUser = await User.create({
        name,
        email,
        password: finalPassword, // Use the determined password
        role,
        refId: finalRefId, // Use the determined refId
        manager: newUserManagerId,
        team: newAssignedTeamId,
        contactNo, // Directly pass these if provided by frontend
        location,
        joiningDate: joiningDate || Date.now(), // Use provided or default to now
    });

    // 5) If the created user is a Team Lead (by a Manager), automatically create a new team for them
    if (role === ROLES.TEAM_LEAD && currentUserRole === ROLES.MANAGER) {
        const newTeam = await Team.create({
            name: `${newUser.name}'s Team`,
            teamLead: newUser._id
        });
        // Update the newly created TL's user document to link to their own team
        await User.findByIdAndUpdate(newUser._id, { $set: { team: newTeam._id } });
    }

    res.status(201).json({
        status: 'success',
        data: {
            user: newUser
        }
    });
});


// GET ALL USERS (Manager sees all, Team Lead sees their Sales Executives)
exports.getAllUsers = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;
    let filter = {};

    if (currentUserRole === ROLES.TEAM_LEAD) {
        // Team Lead should only see Sales Executives who report to them
        filter.manager = currentUserId; // Filter by their ID as manager
        filter.role = ROLES.SALES_EXECUTIVE; // Only sales executives
    } else if (currentUserRole === ROLES.MANAGER) {
        // Manager sees all users (Sales Executives and Team Leads)
        filter.role = { $in: [ROLES.SALES_EXECUTIVE, ROLES.TEAM_LEAD] };
    } else {
        // Sales Executive (or other unauthorized roles) should not access this route
        return next(new AppError('You do not have permission to view all users.', 403));
    }

    const users = await User.find(filter).select('-password -__v -bankDetails')
        .populate({ path: 'team', select: 'name' }) // Populate team name
        .populate({ path: 'manager', select: 'name email' }); // Populate manager/TL name/email


    res.status(200).json({
        status: 'success',
        results: users.length,
        data: {
            users
        }
    });
});

// GET SINGLE USER (Any user can get their own, Manager can get any, TL can get their execs)
exports.getUser = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;

    // Determine the user ID to fetch:
    // If req.params.id is NOT provided (e.g., for /getMe route), use the current logged-in user's ID.
    // If req.params.id IS provided (e.g., for /users/:id route), use that ID.
    const userIdToFetch = req.params.id || currentUserId.toString(); // Ensure it's a string for consistent comparison

    if (!userIdToFetch) {
        return next(new AppError('User ID not provided or could not be determined.', 400));
    }

    let user;

    // 1. Check if the user is trying to access their *own* profile
    if (userIdToFetch === currentUserId.toString()) {
        user = await User.findById(userIdToFetch).select('-password -__v');
    }
    // 2. Manager always has permission to fetch any user
    else if (currentUserRole === ROLES.MANAGER) {
        user = await User.findById(userIdToFetch).select('-password -__v');
    }
    // 3. Team Lead can only fetch their direct Sales Executives
    else if (currentUserRole === ROLES.TEAM_LEAD) {
        const targetUser = await User.findById(userIdToFetch);
        // Ensure targetUser exists, is a Sales Executive, and reports to the current TL
        if (!targetUser || targetUser.role !== ROLES.SALES_EXECUTIVE || targetUser.manager?.toString() !== currentUserId.toString()) {
            return next(new AppError('You do not have permission to view this user.', 403));
        }
        user = targetUser; // If authorized, set user
    }
    // 4. Sales Executives (and other roles not explicitly allowed above)
    //    cannot view other users' profiles.
    else {
        return next(new AppError('You do not have permission to view this user.', 403));
    }

    if (!user) {
        return next(new AppError('No user found with that ID', 404));
    }

    res.status(200).json({
        status: 'success',
        data: {
            user
        }
    });
});

// UPDATE USER (User can update self, Manager can update any, TL can update their execs)
exports.updateUser = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;
    const userIdToUpdate = req.params.id; // From URL parameter

    // 1) Prevent password updates here (use dedicated password change route if needed)
    if (req.body.password || req.body.passwordConfirm) {
        return next(new AppError('This route is not for password updates. Please use a dedicated route for password changes.', 400));
    }

    let allowedFields = []; // Fields allowed for update based on context

    // 2) Determine allowed fields based on role and target user
    if (userIdToUpdate === currentUserId.toString()) { // User updating their *own* profile
        allowedFields = ['name', 'email', 'contactNo', 'location']; // Can update basic profile details
    } else if (currentUserRole === ROLES.MANAGER) {
        // Manager can update most fields for any user, including role, refId, bankDetails, etc.
        allowedFields = ['name', 'email', 'contactNo', 'location', 'role', 'refId', 'status', 'team', 'manager', 'bankDetails'];
    } else if (currentUserRole === ROLES.TEAM_LEAD) {
        // Team Lead can update basic fields for their direct Sales Executives
        const targetUser = await User.findById(userIdToUpdate);
        // Ensure targetUser exists, is a Sales Executive, and reports to the current TL
        if (!targetUser || targetUser.role !== ROLES.SALES_EXECUTIVE || targetUser.manager?.toString() !== currentUserId.toString()) {
            return next(new AppError('You do not have permission to update this user.', 403));
        }
        allowedFields = ['name', 'email', 'contactNo', 'location', 'status']; // TL can activate/deactivate too
    } else {
        return next(new AppError('You do not have permission to update this user.', 403));
    }

    // 3) Filter out unwanted fields from the request body
    const filteredBody = filterObj(req.body, ...allowedFields);

    // If Manager is updating bank details, ensure it's nested correctly
    if (filteredBody.bankDetails && typeof filteredBody.bankDetails === 'object') {
        const bankFields = ['bankName', 'accountNo', 'ifscCode', 'upiId'];
        filteredBody.bankDetails = filterObj(filteredBody.bankDetails, ...bankFields);
    }

    // 4) Perform the update operation
    const updatedUser = await User.findByIdAndUpdate(userIdToUpdate, filteredBody, {
        new: true, // Return the updated document
        runValidators: true // Run schema validators on the update
    }).select('-password -__v'); // Exclude sensitive fields from response

    if (!updatedUser) {
        return next(new AppError('No user found with that ID to update', 404));
    }

    // 5) If manager changed user's team or manager field, ensure consistency for TLs/Execs
    if (currentUserRole === ROLES.MANAGER && (filteredBody.team || filteredBody.manager)) {
        // If a Team Lead's team is updated, ensure their team document reflects it
        if (updatedUser.role === ROLES.TEAM_LEAD && filteredBody.team) {
            await Team.findOneAndUpdate({ teamLead: updatedUser._id }, { $set: { _id: filteredBody.team } }, { upsert: true });
        }
        // If an Executive's manager (TL) is changed, update their associated team if the new TL has a team
        if (updatedUser.role === ROLES.SALES_EXECUTIVE && filteredBody.manager) {
            const newTl = await User.findById(filteredBody.manager);
            if (newTl && newTl.role === ROLES.TEAM_LEAD && newTl.team) {
                await User.findByIdAndUpdate(updatedUser._id, { $set: { team: newTl.team } });
            } else if (newTl && newTl.role !== ROLES.TEAM_LEAD) {
                // If assigned to a non-TL manager, remove team association
                await User.findByIdAndUpdate(updatedUser._id, { $unset: { team: "" } });
            }
        }
    }

    res.status(200).json({
        status: 'success',
        data: {
            user: updatedUser
        }
    });
});

// DELETE USER (Manager Only)
exports.deleteUser = catchAsync(async (req, res, next) => {
    const { id: currentUserId, role: currentUserRole } = req.user;
    const userIdToDelete = req.params.id;

    // Manager can delete any user except themselves (unless specific logic allows)
    if (userIdToDelete === currentUserId.toString() && currentUserRole === ROLES.MANAGER) {
        return next(new AppError('Managers cannot delete their own account via this route.', 403));
    }

    const userToDelete = await User.findById(userIdToDelete);
    if (!userToDelete) {
        return next(new AppError('No user found with that ID', 404));
    }

    // Prevent manager from accidentally deleting another manager (if desired)
    if (userToDelete.role === ROLES.MANAGER && currentUserRole === ROLES.MANAGER) {
        return next(new AppError('Managers cannot delete other manager accounts.', 403));
    }

    // If the user to delete is a Team Lead, also handle their associated Team and subordinates
    if (userToDelete.role === ROLES.TEAM_LEAD) {
        // Delete the team led by this TL
        await Team.deleteOne({ teamLead: userToDelete._id });
        // Update any Sales Executives that reported to this TL (set their manager/team to null or reassign)
        await User.updateMany(
            { manager: userToDelete._id, role: ROLES.SALES_EXECUTIVE },
            { $set: { manager: null, team: null } } // Set to null, admin can reassign later
        );
    }

    // If the user to delete is a Manager, update any TLs reporting to them
    if (userToDelete.role === ROLES.MANAGER) {
        await User.updateMany(
            { manager: userToDelete._id, role: ROLES.TEAM_LEAD },
            { $set: { manager: null } } // Set to null, admin can reassign later
        );
    }

    // Perform the actual deletion (or soft delete by setting active: false)
    await User.findByIdAndDelete(userIdToDelete); // Using findByIdAndDelete for hard delete

    res.status(204).json({ // 204 No Content for successful deletion
        status: 'success',
        data: null
    });
});