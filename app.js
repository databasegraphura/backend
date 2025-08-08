// app.js - SIMPLIFIED VERSION
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const AppError = require('./utils/appError');
const globalErrorHandler = require('./controllers/errorController');

// Import Routes
const authRoutes = require('./routes/authRoutes');
// Uncomment these as you develop them
const userRoutes = require('./routes/userRoutes');
const salesRoutes = require('./routes/salesRoutes');
const prospectRoutes = require('./routes/prospectRoutes');
const teamRoutes = require('./routes/teamRoutes');
const reportRoutes = require('./routes/reportRoutes');
const callLogRoutes = require('./routes/callLogRoutes');
const salaryRoutes = require('./routes/salaryRoutes');
const transferRoutes = require('./routes/transferRoutes');

const app = express();

// 1) GLOBAL MIDDLEWARES

// Enable CORS (Cross-Origin Resource Sharing)
// WITH THIS:
const allowedOrigins = [
  process.env.FRONTEND_URL_1,
  process.env.FRONTEND_URL_2,
  process.env.FRONTEND_URL_3,
  process.env.FRONTEND_URL_4
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));



// Body parsers, reading data from body into req.body
app.use(express.json({ limit: '10kb' })); // For JSON bodies
app.use(express.urlencoded({ extended: true, limit: '10kb' })); // For URL-encoded bodies
// app.use(bodyParser.urlencoded({ extended: true }));
// Cookie parser, reading cookies from req.headers into req.cookies
app.use(cookieParser());

// 2) ROUTES
app.get('/', (req, res) => {
  res.status(200).json({ status: 'success', message: 'Welcome to the API!' });
});

// Authentication routes (signup, login, logout)
app.use('/api/v1/auth', authRoutes);

// Uncomment these lines as you implement their respective controllers and routes:
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/sales', salesRoutes);
app.use('/api/v1/prospects', prospectRoutes);
app.use('/api/v1/teams', teamRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/calllogs', callLogRoutes);
app.use('/api/v1/transfer', transferRoutes);
app.use('/api/v1/salary', salaryRoutes);

// Handle undefined routes - This should always be placed AFTER all your specific routes
// Handle undefined routes — fix for Express v5
app.all("/*splat", (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// GLOBAL ERROR HANDLING MIDDLEWARE - This should always be the last middleware
app.use(globalErrorHandler);

module.exports = app;
