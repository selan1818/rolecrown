const express = require('express');
const multer = require('multer');
const router = express.Router();
const filter = require('../utils/filterJobs');
const { parseResume } = require('../utils/parseResume');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.post('/parse-resume', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No resume file uploaded.' });
    }
    const text = await parseResume(req.file);
    res.json({
      fileName: req.file.originalname,
      text: text.trim(),
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to parse resume.' });
  }
});

router.get('/', async (req, res) => {
  const {
    location = '',
    minSalary = 0,
    maxSalary = 10000000,
    cv = '',
    currency = 'MYR',
  } = req.query;

  const min = Number(minSalary);
  const max = Number(maxSalary);
  if (!isNaN(min) && !isNaN(max) && min > max) {
    return res.status(400).json({ error: 'minSalary > maxSalary' });
  }

  const jobs = await filter.filter(location, min, max, cv, currency);
  res.json(jobs);
});

module.exports = router;
