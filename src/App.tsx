import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import SchemaPlanner from './pages/SchemaPlanner';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<SchemaPlanner />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
