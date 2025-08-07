// config/db.js
const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const DB_URI = process.env.DATABASE;

        if (!DB_URI) {
            throw new Error('MongoDB connection URI is not defined in environment variables.');
        }

        const conn = await mongoose.connect(DB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            // useCreateIndex: true, // Deprecated in recent Mongoose versions
            // useFindAndModify: false // Deprecated in recent Mongoose versions
        });
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (err) {
        console.error(`Error: ${err.message}`);
        // Exit process with failure
        process.exit(1);
    }
};

module.exports = connectDB;