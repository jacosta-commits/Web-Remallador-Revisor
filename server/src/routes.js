import { Router } from 'express';
import authRoutes from './features/auth/routes.js';
import remalladoRoutes from './features/remallado/routes.js';
import extRoutes from './features/ext/routes.js'; // rutas públicas previas al login

const api = Router();

// Rutas base (compatibles con tu frontend actual)
api.use('/', authRoutes);
api.use('/', remalladoRoutes);

// Catálogos/consultas externas SIN auth (trabajador, fallas, producto)
api.use('/ext', extRoutes); // => /api/ext/*

export default api;
