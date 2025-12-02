import express from 'express';
import session from 'express-session';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import MongoStore from 'connect-mongo';
import path from 'path';
import expressLayouts from 'express-ejs-layouts';

import authRoutes from './src/routes/auth.js';
import interviewRoutes from './src/routes/interview.js';
import dashboardRoutes from './src/routes/dashboard.js';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 4000;

app.set('view engine','ejs');
app.set('views', path.join(process.cwd(),'src','views'));
app.use(expressLayouts);
app.set('layout','layout');

app.use(express.static(path.join(process.cwd(),'src','public')));
app.use(express.urlencoded({extended:true}));
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser:true, useUnifiedTopology:true })
  .then(()=>console.log("MongoDB connected"))
  .catch(e=>console.error("Mongo connect error:", e));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
  cookie: { maxAge: 1000*60*60*24 }
}));

app.use((req,res,next)=>{ res.locals.currentUser = req.session.user || null; next(); });

app.get('/', (req,res)=> res.render('index'));
app.use('/auth', authRoutes);
app.use('/interview', interviewRoutes);
app.use('/dashboard', dashboardRoutes);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Catch-all route for 404 errors
app.use((req, res) => {
  res.status(404).render('404');
});


// error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error', err);
  res.status(500).send('Internal Server Error');
});

app.listen(PORT, ()=> console.log(`Server running on http://localhost:${PORT}`));
