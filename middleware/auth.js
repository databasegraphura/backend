// middleware/auth.js
const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const User = require('../models/User');
const { jwtSecret } = require('../config/jwt');

exports.protect = catchAsync(async (req, res, next) => {
    // 1) Get token from request headers or cookies
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies.jwt) {
        token = req.cookies.jwt;
    }

    if (!token || token === 'loggedout') {
        return next(new AppError('You are not logged in! Please log in to get access.', 401));
    }

    // 2) Verify token
    const decoded = await promisify(jwt.verify)(token, jwtSecret);

    // 3) Check if user still exists
    const currentUser = await User.findById(decoded.id);
    if (!currentUser) {
        return next(new AppError('The user belonging to this token no longer exists.', 401));
    }

    // Optional: 4) Check if user changed password after the token was issued
    // This would require a timestamp on the user model for password last changed.
    // If (currentUser.passwordChangedAt && decoded.iat < currentUser.passwordChangedAt.getTime() / 1000) {
    //     return next(new AppError('User recently changed password! Please log in again.', 401));
    // }

    // GRANT ACCESS TO PROTECTED ROUTE
    req.user = currentUser; // Attach the user document to the request
    next();
});

// Middleware for Role-Based Authorization
exports.restrictTo = (...roles) => {
    return (req, res, next) => {
        // roles is an array like ['admin', 'manager']
        if (!roles.includes(req.user.role)) {
            // console.log(req.user);
            
            return next(new AppError('You do not have permission to perform this action', 403));
        }
        next();
    };
};