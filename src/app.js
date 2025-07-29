const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const cors = require('cors');
require('dotenv').config();

const { globalErrorHandler, notFound } = require('./middleware/errorHandler');
const eventRoutes = require('./routes/eventRoutes');

const app = express();

// Basic middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// Routes
app.use('/api/events', eventRoutes);

// Error handling
app.use(notFound);
app.use(globalErrorHandler);

module.exports = app;
