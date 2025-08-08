// api/index.js
const app = require('../app'); // Import your Express app
const connectDB = require('../config/db'); // Import your DB connection function

// Connect to the database
connectDB();

// Export the app for Vercel
module.exports = app;
