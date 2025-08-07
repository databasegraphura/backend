const mongoose = require('mongoose');
const validator = require('validator'); // For email validation
const bcrypt = require('bcryptjs');     // For password hashing
const crypto = require('crypto');       // For password reset tokens
const ROLES = require('../config/roles'); // Centralized roles constant

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Please tell us your name!']
    },
    email: {
        type: String,
        required: [true, 'Please provide your email'],
        unique: true,
        lowercase: true,
        validate: [validator.isEmail, 'Please provide a valid email']
    },
    role: {
        type: String,
        enum: [ROLES.SALES_EXECUTIVE, ROLES.TEAM_LEAD, ROLES.MANAGER],
        default: ROLES.SALES_EXECUTIVE,
        required: [true, 'User must have a role']
    },
    password: {
        type: String,
        required: [true, 'Please provide a password'],
        minlength: 8,
        select: false // Never send password in responses
    },
    // Removed passwordConfirm from schema fields
    
    passwordChangedAt: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
    active: {
        type: Boolean,
        default: true,
        select: false
    },
    refId: {
        type: String,
        required: true,
    },
    location: String,
    contactNo: {
        type: String,
        unique: true,
        sparse: true
    },
    joiningDate: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['active', 'inactive', 'on_leave'],
        default: 'active'
    },
    team: {
        type: mongoose.Schema.ObjectId,
        ref: 'Team',
        default: null
    },
    manager: {
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        default: null
    },
    bankDetails: {
        bankName: String,
        accountNo: String,
        ifscCode: String,
        upiId: String
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual for passwordConfirm (not stored in DB)
userSchema.virtual('passwordConfirm')
  .get(function () {
    return this._passwordConfirm;
  })
  .set(function (value) {
    this._passwordConfirm = value;
  });

// Validate passwordConfirm matches password before saving
userSchema.pre('save', function (next) {
  if (this.isModified('password')) {
    if (this.password !== this._passwordConfirm) {
      this.invalidate('passwordConfirm', 'Passwords are not the same!');
    }
  }
  next();
});

// Hash password before saving new user or updating password
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  this.password = await bcrypt.hash(this.password, 12);
  this._passwordConfirm = undefined; // Clear virtual field
  next();
});

// Update passwordChangedAt timestamp on password change
userSchema.pre('save', function (next) {
  if (!this.isModified('password') || this.isNew) return next();

  this.passwordChangedAt = Date.now() - 1000;
  next();
});

// Query middleware to exclude inactive users by default
userSchema.pre(/^find/, function (next) {
  this.find({ active: { $ne: false } });
  next();
});

// Instance methods

userSchema.methods.correctPassword = async function (candidatePassword, userPassword) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

userSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');

  this.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000;

  return resetToken;
};

const User = mongoose.model('User', userSchema);
module.exports = User;
