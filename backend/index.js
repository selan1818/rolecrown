const express = require('express');
const cors = require('cors');
const jobsRouter = require('./routes/jobs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'RoleCrown API' });
});

app.use('/jobs', jobsRouter);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`RoleCrown API running on port ${PORT}`);
});
