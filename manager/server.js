const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

// Middleware do parsowania JSON
app.use(express.json());

// Ścieżka do pliku JSON z zadaniami
const TASKS_FILE = path.join(__dirname, 'tasks.json');

// Funkcja do odczytu zadań z pliku
function readTasksFromFile() {
  try {
    if (fs.existsSync(TASKS_FILE)) {
      const data = fs.readFileSync(TASKS_FILE, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error('Błąd podczas odczytu pliku:', error);
    return [];
  }
}

// Funkcja do zapisu zadań do pliku
function saveTasksToFile(tasks) {
  try {
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf8');
  } catch (error) {
    console.error('Błąd podczas zapisu do pliku:', error);
    throw error;
  }
}

// Wczytanie zadań z pliku przy starcie serwera
let tasks = readTasksFromFile();

// Jeśli plik nie istnieje, utwórz przykładowe dane
if (tasks.length === 0) {
  tasks = [
    { id: 1, title: "Zadanie 1", description: "Opis zadania 1", completed: false, createdAt: new Date().toISOString() },
    { id: 2, title: "Zadanie 2", description: "Opis zadania 2", completed: true, createdAt: new Date().toISOString() }
  ];
  saveTasksToFile(tasks);
}

// 1. Health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

// 2. GET - pobranie wszystkich zadań lub konkretnego zadania
app.get('/tasks', (req, res) => {
  tasks = readTasksFromFile(); // Odczyt aktualnych danych z pliku
  res.json(tasks);
});

app.get('/tasks/:id', (req, res) => {
  tasks = readTasksFromFile(); // Odczyt aktualnych danych z pliku
  const id = parseInt(req.params.id);
  const task = tasks.find(t => t.id === id);
  
  if (!task) {
    return res.status(404).json({ error: 'Zadanie nie zostało znalezione' });
  }
  
  res.json(task);
});

// 3. POST - dodanie nowego zadania
app.post('/tasks', (req, res) => {
  tasks = readTasksFromFile(); // Odczyt aktualnych danych z pliku
  const { title, description, completed } = req.body;
  
  if (!title) {
    return res.status(400).json({ error: 'Tytuł zadania jest wymagany' });
  }
  
  const newTask = {
    id: tasks.length > 0 ? Math.max(...tasks.map(t => t.id)) + 1 : 1,
    title: title,
    description: description || '',
    completed: completed || false,
    createdAt: new Date().toISOString()
  };
  
  tasks.push(newTask);
  saveTasksToFile(tasks);
  res.status(201).json(newTask);
});

// 4. PUT - aktualizacja zadania
app.put('/tasks/:id', (req, res) => {
  tasks = readTasksFromFile(); // Odczyt aktualnych danych z pliku
  const id = parseInt(req.params.id);
  const taskIndex = tasks.findIndex(t => t.id === id);
  
  if (taskIndex === -1) {
    return res.status(404).json({ error: 'Zadanie nie zostało znalezione' });
  }
  
  const { title, description, completed } = req.body;
  
  tasks[taskIndex] = {
    ...tasks[taskIndex],
    title: title !== undefined ? title : tasks[taskIndex].title,
    description: description !== undefined ? description : tasks[taskIndex].description,
    completed: completed !== undefined ? completed : tasks[taskIndex].completed
  };
  
  saveTasksToFile(tasks);
  res.json(tasks[taskIndex]);
});

// 5. DELETE - usunięcie zadania
app.delete('/tasks/:id', (req, res) => {
  tasks = readTasksFromFile(); // Odczyt aktualnych danych z pliku
  const id = parseInt(req.params.id);
  const taskIndex = tasks.findIndex(t => t.id === id);
  
  if (taskIndex === -1) {
    return res.status(404).json({ error: 'Zadanie nie zostało znalezione' });
  }
  
  const deletedTask = tasks.splice(taskIndex, 1)[0];
  saveTasksToFile(tasks);
  res.json({ message: 'Zadanie zostało usunięte', task: deletedTask });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});