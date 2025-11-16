const express = require('express');
const app = express();
const PORT = 3000;

// Middleware do parsowania JSON
app.use(express.json());

// Dane w pamięci (tymczasowo)
let data = [
  { id: 1, name: "Element 1" },
  { id: 2, name: "Element 2" }
];

// 1. Health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

// 2. GET - pobranie danych
app.get('/data', (req, res) => {
  res.json(data);
});

// 3. POST - dodanie danych
app.post('/data', (req, res) => {
  const newItem = {
    id: data.length + 1,
    name: req.body.name
  };
  data.push(newItem);
  res.status(201).json(newItem);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});