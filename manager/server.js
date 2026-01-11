require("./instrument.js");
const Sentry = require("@sentry/node");
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const app = express();
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Zwykły klient Supabase (z RLS)
const supabase = require('./supabase'); 

// Service Role Client (omija RLS!) - dla operacji adminów
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PORT = 3000;
app.get("/", function rootHandler(req, res) {
  res.end("Hello world!");
});

// The error handler must be registered before any other error middleware and after all controllers
Sentry.setupExpressErrorHandler(app);

// Optional fallthrough error handler
app.use(function onError(err, req, res, next) {
  // The error id is attached to `res.sentry` to be returned
  // and optionally displayed to the user for support.
  res.statusCode = 500;
  res.end(res.sentry + "\n");
});

// Globalny limiter – 100 requestów / 15 minut
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 15 minut
  max: 100,
  message: {
    error: 'Zbyt wiele requestów. Spróbuj ponownie za 15 minut.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limiter dla auth – 5 prób / 1 minuta
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuta
  max: 10, // zwiększona ilość logowań ze względu na testy
  message: {
    error: 'Zbyt wiele prób logowania. Poczekaj minutę.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(helmet());
app.use(express.json());        
app.use(globalLimiter);         // globalny limiter
app.use('/auth', authLimiter);  // limiter specyficzny dla /auth

// Middleware autoryzacji 
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  // Weryfikacja tokenu przez Supabase
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Pobranie roli z tabeli profiles
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .single();

  req.user = {
    id: data.user.id,
    email: data.user.email,
    role: profile?.role || 'user',
  };

  // Przypisz odpowiedni klient Supabase (admin = service role, user = zwykły)
  req.supabase = (req.user.role === 'admin') ? supabaseAdmin : supabase;

  next();
};

// Middleware sprawdzający rolę admina
const adminMiddleware = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// =======================
// AUTH ENDPOINTY
// =======================

// POST /auth/register
app.post('/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email i hasło są wymagane' });
  }

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.status(201).json({ 
    message: 'User created', 
    user: {
      id: data.user.id,
      email: data.user.email
    }
  });
});

// POST /auth/login
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email i hasło są wymagane' });
  }

  // Logowanie przez Supabase
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ 
    email, 
    password 
  });
  
  if (authError) {
    return res.status(401).json({ error: authError.message });
  }

  // Pobranie roli z tabeli profiles
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', authData.user.id)
    .single();

  // Zwracamy token Supabase + informacje o użytkowniku
  res.json({ 
    token: authData.session.access_token,
    user: {
      id: authData.user.id,
      email: authData.user.email,
      role: profile?.role || 'user'
    }
  });
});

// =======================
// TASK ENDPOINTY (PROTECTED)
// =======================

// GET wszystkie taski
app.get('/tasks', authMiddleware, async (req, res) => {
  const { data, error } = await req.supabase
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Dla zwykłych użytkowników filtruj (dla admina req.supabase już pomija RLS)
  const tasks = req.user.role === 'admin' 
    ? data 
    : data.filter(t => t.user_id === req.user.id);
  
  res.json(tasks);
});

// GET task po ID
app.get('/tasks/:id', authMiddleware, async (req, res) => {
  const id = req.params.id;

  const { data: task, error } = await req.supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  // Sprawdzenie uprawnień (jeśli nie admin)
  if (req.user.role !== 'admin' && task.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json(task);
});

// POST - dodanie taska
app.post('/tasks', authMiddleware, async (req, res) => {
  const { title, description, completed = false } = req.body;
  
  if (!title) {
    return res.status(400).json({ error: 'Tytuł zadania jest wymagany' });
  }

  const { data, error } = await req.supabase
    .from('tasks')
    .insert({ 
      title, 
      description, 
      completed, 
      user_id: req.user.id 
    })
    .select()
    .single();

  if (error) {
    console.error('❌ Błąd przy dodawaniu taska:', error);
    return res.status(500).json({ error: error.message });
  }
  
  res.status(201).json(data);
});

// PUT / PATCH - aktualizacja taska
app.put('/tasks/:id', authMiddleware, async (req, res) => {
  const id = req.params.id;
  const { title, description, completed } = req.body;

  // Najpierw sprawdź czy task istnieje i czy masz dostęp
  const { data: task, error: fetchError } = await req.supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError) {
    return res.status(500).json({ error: fetchError.message });
  }
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  // Sprawdź uprawnienia (jeśli nie admin)
  if (req.user.role !== 'admin' && task.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Przygotuj aktualizacje
  const updates = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (completed !== undefined) updates.completed = completed;

  const { data, error } = await req.supabase
    .from('tasks')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  
  res.json(data);
});

// DELETE taska
app.delete('/tasks/:id', authMiddleware, async (req, res) => {
  const id = req.params.id;

  // Sprawdź czy task istnieje i czy masz dostęp
  const { data: task, error: fetchError } = await req.supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError) {
    return res.status(500).json({ error: fetchError.message });
  }
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  // Sprawdź uprawnienia (jeśli nie admin)
  if (req.user.role !== 'admin' && task.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { error } = await req.supabase
    .from('tasks')
    .delete()
    .eq('id', id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  
  res.status(204).send();
});

// =======================
// ADMIN ENDPOINTY
// =======================

// GET lista wszystkich użytkowników
app.get('/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  // Używamy supabaseAdmin aby ominąć RLS
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*');
  
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  
  res.json(data);
});

// DELETE użytkownika
app.delete('/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const userId = req.params.id;

  // Używamy supabaseAdmin aby ominąć RLS
  const { data: user, error: fetchError } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (fetchError) {
    return res.status(500).json({ error: fetchError.message });
  }
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .delete()
    .eq('id', userId);

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  
  res.status(204).send();
});

// START SERWERA
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});