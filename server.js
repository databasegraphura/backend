// server.js
const dotenv = require('dotenv');
dotenv.config({ path: './.env' }); // Load environment variables first

const app = require('./app'); // <--- Ensure this path is correct and it imports the Express app
const connectDB = require('./config/db');

// Connect to MongoDB
connectDB(); // <--- Comment this line out temporarily for this test

const port = process.env.PORT || 5000;
const server = app.listen(port, () => {
    console.log(`App running on port ${port} in ${process.env.NODE_ENV} mode...`);
});

// Handle unhandled promise rejections (e.g., DB connection errors)
process.on('unhandledRejection', err => {
    console.error('UNHANDLED REJECTION! 💥 Shutting down...');
    console.error(err.name, err.message);
    server.close(() => {
        process.exit(1);
    });
});

// Handle uncaught exceptions (e.g., synchronous errors)
process.on('uncaughtException', err => {
    console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
    console.error(err.name, err.message);
    server.close(() => {
        process.exit(1);
    });
});