// controllers/authController.js
const jwt = require('jsonwebtoken');
const User = require('../models/User'); // User Model
const Team = require('../models/Team'); // Team Model
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { jwtSecret, jwtExpiresIn, jwtCookieExpiresIn } = require('../config/jwt');
const ROLES = require('../config/roles'); // Centralized ROLES constant
const mongoose = require('mongoose');
// Helper function to sign JWT
const signToken = (id, role) => {
    return jwt.sign({ id, role }, jwtSecret, {
        expiresIn: jwtExpiresIn
    });
};

// Helper function to send JWT as cookie and JSON response
const createSendToken = (user, statusCode, req, res) => {
    const token = signToken(user._id, user.role);

    const cookieOptions = {
        expires: new Date(Date.now() + jwtCookieExpiresIn * 24 * 60 * 60 * 1000), // Convert days to milliseconds
        httpOnly: true, // Prevents client-side JS from reading the cookie
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https', // Only send on HTTPS in production
        sameSite: 'Lax' // Consider 'None' if cross-site cookies are strictly needed (requires 'secure: true')
    };

    // If in production, ensure cookie is secure
    if (process.env.NODE_ENV === 'production') cookieOptions.secure = true;

    res.cookie('jwt', token, cookieOptions);

    // Remove password from output before sending response
    user.password = undefined;

    res.status(statusCode).json({
        status: 'success',
        token,
        data: {
            user
        }
    });
};

// --- AUTH CONTROLLERS ---

exports.signup = catchAsync(async (req, res, next) => {
    console.log(`[SIGNUP][REQ] Incoming payload:`, req.body);

    const {
        name,
        email,
        password,
        passwordConfirm,
        refId,
        role
    } = req.body;

    // Step 1: Validate required fields
    console.log(`[SIGNUP][STEP 1] Validating required fields`);
    if (!name || !email || !password || !passwordConfirm || !refId || !role) {
        console.warn(`[SIGNUP][VALIDATION ERROR] Missing required fields`, { name, email, password, passwordConfirm, refId, role });
        return next(new AppError('Please provide all required fields!', 400));
    }

    if (password !== passwordConfirm) {
        console.warn(`[SIGNUP][VALIDATION ERROR] Passwords do not match`);
        return next(new AppError('Password and password confirmation do not match!', 400));
    }

    if (password.length < 8) {
        console.warn(`[SIGNUP][VALIDATION ERROR] Password too short`);
        return next(new AppError('Password must be at least 8 characters long!', 400));
    }

    // Step 2: Validate role
    const allowedRoles = Object.values(ROLES);
    console.log(`[SIGNUP][STEP 2] Validating role: ${role}`);
    if (!allowedRoles.includes(role)) {
        console.warn(`[SIGNUP][VALIDATION ERROR] Invalid role: ${role}`);
        return next(new AppError(`Invalid role. Allowed roles: ${allowedRoles.join(', ')}`, 400));
    }

    // Step 3: Verify refId
    const expectedRefIdForRole = {
        [ROLES.MANAGER]: process.env.MANAGER_SIGNUP_REFID,
        [ROLES.TEAM_LEAD]: process.env.TEAM_LEAD_SIGNUP_REFID,
        [ROLES.SALES_EXECUTIVE]: process.env.EXECUTIVE_SIGNUP_REFID,
    };

    console.log(`[SIGNUP][STEP 3] Verifying refId for role: ${role}`);
    if (refId !== expectedRefIdForRole[role]) {
        console.warn(`[SIGNUP][VALIDATION ERROR] Invalid refId for role: ${role}`, {
            provided: refId,
            expected: expectedRefIdForRole[role]
        });
        return next(new AppError(`Invalid reference ID for ${role} role.`, 400));
    }

    // Step 4: Check if email already exists
    console.log(`[SIGNUP][STEP 4] Checking for existing email: ${email}`);
    const existingUser = await User.findOne({ email });
    if (existingUser) {
        console.warn(`[SIGNUP][VALIDATION ERROR] Email already exists: ${email}`);
        return next(new AppError('Email already exists. Please use a different email.', 400));
    }

    // Step 5: Create user and handle errors
    console.log(`[SIGNUP][STEP 5] Creating new user`);
    try {
        const newUser = new User({
            name,
            email,
            password,
            role,
            refId,
            team: null,
            manager: null
        });

        await newUser.save();
        console.log(`[SIGNUP][SUCCESS] New user created: ${newUser.email}`);

        // Step 6: Create team if Team Lead
        if (role === ROLES.TEAM_LEAD) {
            console.log(`[SIGNUP][STEP 6] Creating team for Team Lead`);
            const newTeam = await Team.create({
                name: `${newUser.name}'s Team`,
                teamLead: newUser._id
            });
            await User.findByIdAndUpdate(newUser._id, {
                $set: { team: newTeam._id }
            });
            console.log(`[SIGNUP][STEP 6] Linked team ${newTeam.name} to Team Lead`);
        }

        // Step 7: Send token
        console.log(`[SIGNUP][STEP 7] Sending token`);
        return res.status(201).json({
            status: 'success',
            message: 'User successfully registered'
        });

    } catch (err) {
        console.error(`[SIGNUP][ERROR] Failed to create user`, err);
        return next(new AppError('Something went wrong during signup. Please try again.', 500));
    }
});


exports.login = catchAsync(async (req, res, next) => {
    const { email, password } = req.body;

    // 1) Check if email and password exist
    if (!email || !password) {
        return next(new AppError('Please provide email and password!', 400));
    }

    // 2) Check if user exists AND password is correct
    // Select '+password' to explicitly include the password field, which is `select: false` in schema
    const user = await User.findOne({ email }).select('+password');

    // Use the correctPassword method from the User model to compare hashed password
    if (!user || !(await user.correctPassword(password, user.password))) {
        return next(new AppError('Incorrect email or password', 401));
    }

    // 3) If everything is okay, send token to client
    createSendToken(user, 200, req, res);
});

exports.logout = (req, res) => {
    // Clear the JWT cookie to log the user out
    res.cookie('jwt', 'loggedout', {
        expires: new Date(Date.now() + 10 * 1000), // Expires in 10 seconds (effectively immediately)
        httpOnly: true, // Remains HttpOnly
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https', // Same secure setting
        sameSite: 'Lax' // Same sameSite setting
    });
    res.status(200).json({ status: 'success', message: 'Logged out successfully' });
};

// Placeholder for future development - Refresh Token endpoint
// This would involve validating a longer-lived refresh token (typically from a cookie)
// and issuing a new short-lived access token.
exports.refreshToken = catchAsync(async (req, res, next) => {
    return next(new AppError('Refresh token functionality not implemented yet!', 501));
});