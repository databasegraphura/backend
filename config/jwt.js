// config/jwt.js
module.exports = {
    jwtSecret: process.env.JWT_SECRET || 'your-default-jwt-secret', // Fallback for development if .env fails
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '90d',
    jwtCookieExpiresIn: process.env.JWT_COOKIE_EXPIRES_IN ? parseInt(process.env.JWT_COOKIE_EXPIRES_IN, 10) : 90,
};